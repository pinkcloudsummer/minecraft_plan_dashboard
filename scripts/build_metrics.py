import bisect
import importlib.util
import json
import os
import sqlite3
import sys
import time

# Run from cron by path, so make the sibling module importable
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import metric_details  # noqa: E402

PLAN_DB = os.environ.get("PLAN_DB", "/opt/stacks/minecraft/data/plugins/Plan/database.db")
SNAPSHOT_DB = os.environ.get("SNAPSHOT_DB", "/opt/stacks/minecraft/data/plugins/Plan/metric_snapshots.db")
OUTPUT = os.environ.get("METRICS_OUTPUT", "/opt/stacks/minecraft/data/plugins/Plan/web/js/metrics.json")

METRICS_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "metrics")


def load_derived():
    # One file per metric in scripts/metrics/. A broken file is skipped so it can't
    # stop the other metrics from updating.
    # A "sum" metric combines SOURCES; a "ratio" metric (KIND = "ratio") is NUMERATOR / DENOMINATOR,
    # where each side is the sum of its listed sources. Optional ORDER sets the display order.
    derived, visible, ratios = [], [], {}
    for filename in sorted(os.listdir(METRICS_DIR)) if os.path.isdir(METRICS_DIR) else []:
        if not filename.endswith(".py") or filename.startswith("_"):
            continue
        path = os.path.join(METRICS_DIR, filename)
        try:
            spec = importlib.util.spec_from_file_location(f"metric_{filename[:-3]}", path)
            module = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(module)
            name, label = module.NAME, module.LABEL
            order = getattr(module, "ORDER", 100)
            # Optional COMPONENT_SCALE converts component stats to the metric's unit for display
            extra = {"component_scale": getattr(module, "COMPONENT_SCALE", 1.0)}
            if getattr(module, "KIND", "sum") == "ratio":
                numerator = list(dict.fromkeys(module.NUMERATOR))
                denominator = list(dict.fromkeys(module.DENOMINATOR))
                parts = [
                    {"name": f"{name}__num", "sources": numerator, "combine": sum},
                    {"name": f"{name}__den", "sources": denominator, "combine": sum},
                ]
                entry_ratios = {name: {"num": parts[0]["name"], "den": parts[1]["name"]}}
                kind = "ratio"
                extra.update(type="ratio", numerator=numerator, denominator=denominator)
            else:
                # dict.fromkeys drops accidental duplicates so a source is never counted twice
                sources = list(dict.fromkeys(module.SOURCES))
                parts = [{
                    "name": name,
                    "sources": sources,
                    "combine": getattr(module, "combine", sum),
                }]
                entry_ratios = {}
                kind = "sum"
                # TYPE = "single" marks a stat like coal that happens to have several layers
                default_type = "single" if len(sources) == 1 else "aggregate"
                extra.update(type=getattr(module, "TYPE", default_type), sources=sources)
        except Exception as err:
            print(f"Skipping metric {filename}: {err}")
            continue
        derived.extend(parts)
        ratios.update(entry_ratios)
        visible.append({"name": name, "label": label, "kind": kind, "order": order, **extra})
    visible.sort(key=lambda item: item["order"])
    return derived, visible, ratios


DERIVED, VISIBLE_DERIVED, RATIOS = load_derived()

METRICS = [(d["name"], d["label"]) for d in VISIBLE_DERIVED]
KINDS = {d["name"]: d["kind"] for d in VISIBLE_DERIVED}
TYPES = {d["name"]: d["type"] for d in VISIBLE_DERIVED}

HOUR_MS = 3_600_000
WINDOWS = {"gain_24h": 24 * HOUR_MS, "gain_7d": 7 * 24 * HOUR_MS}
# Plan may refresh a player's values a few minutes after they log out
SESSION_END_GRACE_MS = 10 * 60 * 1000
LEADERBOARD_SIZE = 5


def load_series(snap):
    series = {}
    for uuid, metric, ts, value in snap.execute(
        "SELECT uuid, metric, ts, value FROM metric_changes ORDER BY ts"
    ):
        series.setdefault((uuid, metric), []).append((ts, value))
    return series


def value_at(points, t):
    idx = bisect.bisect_right([p[0] for p in points], t)
    return points[idx - 1][1] if idx else None


def window_gain(points, now, window_ms):
    # Before tracking began the true baseline is unknown, so fall back to the first recorded value
    baseline = value_at(points, now - window_ms)
    if baseline is None:
        baseline = points[0][1]
    return points[-1][1] - baseline


def session_gains(points, sessions):
    gains = []
    for i, (start, end) in enumerate(sessions):
        next_start = sessions[i + 1][0] if i + 1 < len(sessions) else None
        cutoff = end + SESSION_END_GRACE_MS
        if next_start is not None:
            cutoff = min(cutoff, next_start)
        before = value_at(points, start)
        after = value_at(points, cutoff)
        if before is None or after is None:
            continue
        gains.append(after - before)
    return gains


def derive_sums(series):
    # A derived value only exists from the moment every source stat has been recorded for the
    # player, otherwise tracking a new stat would show up as a fake jump in gains
    players = {uuid for uuid, _ in series}
    for derived in DERIVED:
        for uuid in players:
            sources = [series.get((uuid, metric)) for metric in derived["sources"]]
            if not all(sources):
                continue
            start = max(points[0][0] for points in sources)
            timestamps = sorted({ts for points in sources for ts, _ in points if ts >= start} | {start})
            series[(uuid, derived["name"])] = [
                (ts, derived["combine"]([value_at(points, ts) for points in sources])) for ts in timestamps
            ]


def load_names():
    plan = sqlite3.connect(f"file:{PLAN_DB}?mode=ro", uri=True, timeout=30)
    try:
        return dict(plan.execute("SELECT uuid, name FROM plan_users"))
    finally:
        plan.close()


def round_or_none(value, digits=2):
    return None if value is None else round(value, digits)


def safe_div(numerator, denominator):
    return None if not denominator else numerator / denominator


def ratio_parts(series, uuid, spec, now):
    # (numerator, denominator) for the lifetime total and for each gain window
    num, den = series.get((uuid, spec["num"])), series.get((uuid, spec["den"]))
    if not num or not den:
        return None
    parts = {"total": (num[-1][1], den[-1][1])}
    for key, window in WINDOWS.items():
        parts[key] = (window_gain(num, now, window), window_gain(den, now, window))
    return parts


def main():
    now = int(time.time() * 1000)
    names = load_names()

    snap = sqlite3.connect(f"file:{SNAPSHOT_DB}?mode=ro", uri=True, timeout=30)
    series = load_series(snap)
    derive_sums(series)
    tracking_since = snap.execute("SELECT MIN(ts) FROM snapshot_runs").fetchone()[0]

    sessions_by_player = {}
    for uuid, start, end, afk in snap.execute(
        "SELECT uuid, session_start, session_end, COALESCE(afk_time, 0) "
        "FROM sessions_archive ORDER BY uuid, session_start"
    ):
        sessions_by_player.setdefault(uuid, []).append((start, end, afk))
    snap.close()

    uuids = sorted({uuid for uuid, _ in series})
    players = {}
    parts_by_player = {}
    for uuid in uuids:
        sessions = sessions_by_player.get(uuid, [])
        # Sessions that began before tracking have no baseline value, so they are skipped per resource
        spans = [(s, e) for s, e, _ in sessions]

        entry = {
            "name": names.get(uuid, uuid[:8]),
            "total": {},
            "gain_24h": {},
            "gain_7d": {},
            "avg_per_session": {},
            "sessions_counted": {},
        }
        for metric, _ in METRICS:
            if metric in RATIOS:
                parts = ratio_parts(series, uuid, RATIOS[metric], now)
                if not parts:
                    continue
                parts_by_player.setdefault(uuid, {})[metric] = parts
                for key, (num, den) in parts.items():
                    entry[key][metric] = round_or_none(safe_div(num, den), 3)
                entry["avg_per_session"][metric] = None
                entry["sessions_counted"][metric] = 0
                continue
            points = series.get((uuid, metric))
            if not points:
                continue
            entry["total"][metric] = points[-1][1]
            for key, window in WINDOWS.items():
                entry[key][metric] = window_gain(points, now, window)
            gains = session_gains(points, spans)
            entry["sessions_counted"][metric] = len(gains)
            entry["avg_per_session"][metric] = round_or_none(sum(gains) / len(gains)) if gains else None
        players[uuid] = entry

    server = {"total": {}, "gain_24h": {}, "gain_7d": {}}
    for metric, _ in METRICS:
        if metric in RATIOS:
            # A server ratio is total numerator over total denominator, not an average of player ratios
            for key in ("total", "gain_24h", "gain_7d"):
                nums = [parts[metric][key][0] for parts in parts_by_player.values() if metric in parts]
                dens = [parts[metric][key][1] for parts in parts_by_player.values() if metric in parts]
                server[key][metric] = round_or_none(safe_div(sum(nums), sum(dens)), 3)
            continue
        for key in ("total", "gain_24h", "gain_7d"):
            server[key][metric] = sum(p[key].get(metric, 0) for p in players.values())

    leaderboards = {}
    for metric, _ in METRICS:
        leaderboards[metric] = {}
        for key in ("total", "gain_7d"):
            ranked = sorted(
                ((uuid, p[key][metric]) for uuid, p in players.items() if (p[key].get(metric) or 0) > 0),
                key=lambda item: item[1],
                reverse=True,
            )[:LEADERBOARD_SIZE]
            leaderboards[metric][key] = [
                {"uuid": uuid, "name": players[uuid]["name"], "value": value} for uuid, value in ranked
            ]

    payload = {
        "generated_at": now,
        "tracking_since": tracking_since,
        "resources": [
            {"name": name, "label": label, "kind": KINDS.get(name, "sum"), "type": TYPES.get(name, "single")}
            for name, label in METRICS
        ],
        "server": server,
        "players": players,
        "leaderboards": leaderboards,
    }

    write_json(OUTPUT, payload)

    # One detail file per metric for its page, loaded only when someone opens it
    detail_dir = os.path.join(os.path.dirname(OUTPUT), "metric_data")
    os.makedirs(detail_dir, exist_ok=True)
    written = set()
    for spec in VISIBLE_DERIVED:
        try:
            detail = metric_details.build_detail(spec, series, sessions_by_player, names, now, tracking_since)
            write_json(os.path.join(detail_dir, f'{spec["name"]}.json'), detail)
            written.add(f'{spec["name"]}.json')
        except Exception as err:
            print(f'Could not build details for {spec["name"]}: {err}')
    for stale in set(os.listdir(detail_dir)) - written:
        if stale.endswith(".json"):
            os.remove(os.path.join(detail_dir, stale))
    print(f"Wrote {OUTPUT}: {len(players)} players, {len(METRICS)} metrics, {len(written)} detail files.")


def write_json(path, payload):
    # Write atomically so the dashboard never reads a half-written file
    tmp = path + ".tmp"
    with open(tmp, "w") as f:
        json.dump(payload, f, separators=(",", ":"))
    os.chmod(tmp, 0o644)
    os.replace(tmp, path)


if __name__ == "__main__":
    main()

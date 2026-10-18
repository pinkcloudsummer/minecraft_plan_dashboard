import bisect
import importlib.util
import json
import os
import sqlite3
import time

PLAN_DB = os.environ.get("PLAN_DB", "/opt/stacks/minecraft/data/plugins/Plan/database.db")
SNAPSHOT_DB = os.environ.get("SNAPSHOT_DB", "/opt/stacks/minecraft/data/plugins/Plan/metric_snapshots.db")
OUTPUT = os.environ.get("METRICS_OUTPUT", "/opt/stacks/minecraft/data/plugins/Plan/web/js/metrics.json")

# Resources the card shows; add a line here after tracking the placeholder in plan/config.yml
RESOURCES = [
    ("statistic_mine_block:stone", "Stone"),
    ("statistic_mine_block:coal_ore", "Coal Ore"),
    ("statistic_mine_block:iron_ore", "Iron Ore"),
    ("statistic_mine_block:copper_ore", "Copper Ore"),
    ("statistic_mine_block:diamond_ore", "Diamond Ore"),
]

METRICS_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "metrics")


def load_derived():
    # One file per custom metric in scripts/metrics/. A broken file is skipped so it can't
    # stop the other metrics from updating.
    derived = []
    for filename in sorted(os.listdir(METRICS_DIR)) if os.path.isdir(METRICS_DIR) else []:
        if not filename.endswith(".py") or filename.startswith("_"):
            continue
        path = os.path.join(METRICS_DIR, filename)
        try:
            spec = importlib.util.spec_from_file_location(f"metric_{filename[:-3]}", path)
            module = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(module)
            derived.append({
                "name": module.NAME,
                "label": module.LABEL,
                "sources": list(module.SOURCES),
                "combine": getattr(module, "combine", sum),
            })
        except Exception as err:
            print(f"Skipping metric {filename}: {err}")
    return derived


DERIVED = load_derived()

METRICS = RESOURCES + [(d["name"], d["label"]) for d in DERIVED]

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
    for uuid in uuids:
        sessions = sessions_by_player.get(uuid, [])
        # Sessions that began before tracking have no baseline value, so they are skipped per resource
        spans = [(s, e) for s, e, _ in sessions]
        active_hours = sum(max(e - s - afk, 0) for s, e, afk in sessions) / HOUR_MS

        entry = {
            "name": names.get(uuid, uuid[:8]),
            "active_hours": round(active_hours, 2),
            "total": {},
            "gain_24h": {},
            "gain_7d": {},
            "per_hour": {},
            "avg_per_session": {},
            "sessions_counted": {},
        }
        for metric, _ in METRICS:
            points = series.get((uuid, metric))
            if not points:
                continue
            total = points[-1][1]
            entry["total"][metric] = total
            for key, window in WINDOWS.items():
                entry[key][metric] = window_gain(points, now, window)
            entry["per_hour"][metric] = round_or_none(total / active_hours) if active_hours > 0 else None
            gains = session_gains(points, spans)
            entry["sessions_counted"][metric] = len(gains)
            entry["avg_per_session"][metric] = round_or_none(sum(gains) / len(gains)) if gains else None
        players[uuid] = entry

    total_hours = sum(p["active_hours"] for p in players.values())
    server = {"active_hours": round(total_hours, 2)}
    for key in ("total", "gain_24h", "gain_7d"):
        server[key] = {
            metric: sum(p[key].get(metric, 0) for p in players.values()) for metric, _ in METRICS
        }
    server["per_hour"] = {
        metric: round_or_none(server["total"][metric] / total_hours) if total_hours > 0 else None
        for metric, _ in METRICS
    }

    leaderboards = {}
    for metric, _ in METRICS:
        leaderboards[metric] = {}
        for key in ("total", "gain_7d"):
            ranked = sorted(
                ((uuid, p[key][metric]) for uuid, p in players.items() if p[key].get(metric, 0) > 0),
                key=lambda item: item[1],
                reverse=True,
            )[:LEADERBOARD_SIZE]
            leaderboards[metric][key] = [
                {"uuid": uuid, "name": players[uuid]["name"], "value": value} for uuid, value in ranked
            ]

    payload = {
        "generated_at": now,
        "tracking_since": tracking_since,
        "resources": [{"name": name, "label": label} for name, label in METRICS],
        "server": server,
        "players": players,
        "leaderboards": leaderboards,
    }

    # Write atomically so the dashboard never reads a half-written file
    tmp = OUTPUT + ".tmp"
    with open(tmp, "w") as f:
        json.dump(payload, f, separators=(",", ":"))
    os.chmod(tmp, 0o644)
    os.replace(tmp, OUTPUT)
    print(f"Wrote {OUTPUT}: {len(players)} players, {len(METRICS)} metrics.")


if __name__ == "__main__":
    main()

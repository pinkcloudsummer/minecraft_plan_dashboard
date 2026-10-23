import re

HOUR_MS = 3_600_000
SESSION_END_GRACE_MS = 10 * 60 * 1000
MAX_SESSIONS = 300

VERBS = {
    "mine_block": "Mined",
    "use_item": "Used",
    "craft_item": "Crafted",
    "kill_entity": "Killed",
    "entity_killed_by": "Killed by",
    "break_item": "Broken",
    "picked_up": "Picked up",
    "dropped": "Dropped",
}
TYPED = re.compile(r"^statistic_(" + "|".join(VERBS) + r"):(.+)$")


def component_label(source):
    typed = TYPED.match(source)
    if typed:
        verb, name = VERBS[typed.group(1)], typed.group(2)
    else:
        verb, name = "Stat", source[len("statistic_"):] if source.startswith("statistic_") else source
        if name.endswith("_one_cm"):
            verb, name = "Distance (blocks)", name[: -len("_one_cm")]
    return {"name": source, "label": name.replace("_", " ").title(), "group": verb}


def value_at(points, t):
    # Latest recorded value at or before t, or None before the first record
    lo, hi = 0, len(points)
    while lo < hi:
        mid = (lo + hi) // 2
        if points[mid][0] <= t:
            lo = mid + 1
        else:
            hi = mid
    return points[lo - 1][1] if lo else None


def window_gains(points, now, scale=1.0):
    # Same rule as the overview table: before tracking began the baseline is the first record
    def at(offset):
        value = value_at(points, now - offset)
        return points[0][1] if value is None else value

    latest, day, week, two_weeks = points[-1][1], at(24 * HOUR_MS), at(7 * 24 * HOUR_MS), at(14 * 24 * HOUR_MS)
    return {
        "d1": round((latest - day) * scale, 3),
        "d7": round((latest - week) * scale, 3),
        "p7": round((week - two_weeks) * scale, 3),
    }


def hourly_gains(points, scale=1.0):
    # Gain between consecutive recorded values, booked to the UTC hour of the later record.
    # The first record is a baseline, not a gain, and decreases (stat resets) are ignored.
    gains = {}
    for (_, previous), (ts, value) in zip(points, points[1:]):
        gain = (value - previous) * scale
        if gain > 0:
            bucket = ts // HOUR_MS * HOUR_MS
            gains[bucket] = gains.get(bucket, 0) + gain
    return gains


def sparse(gains):
    return [[hour, round(value, 3)] for hour, value in sorted(gains.items())]


def add_into(target, source):
    for hour, value in source.items():
        target[hour] = target.get(hour, 0) + value


def build_block(series, uuids, derived_name, source_names, now, scale=1.0):
    # One set of numbers: the combined stat plus each of its components, per player.
    # Players only appear once the combined stat exists for them.
    players = [uuid for uuid in uuids if series.get((uuid, derived_name))]
    block = {
        "components": [component_label(source) for source in source_names],
        "total": {},
        "windows": {},
        "hourly": {},
        "component_totals": {source: {} for source in source_names},
        "component_windows": {source: {} for source in source_names},
        "component_hourly": {source: {} for source in source_names},
    }
    for uuid in players:
        points = series[(uuid, derived_name)]
        block["total"][uuid] = round(points[-1][1], 3)
        block["windows"][uuid] = window_gains(points, now)
        block["hourly"][uuid] = sparse(hourly_gains(points))
        for source in source_names:
            component = series.get((uuid, source))
            if not component:
                continue
            block["component_totals"][source][uuid] = round(component[-1][1] * scale, 3)
            block["component_windows"][source][uuid] = window_gains(component, now, scale)
            block["component_hourly"][source][uuid] = sparse(hourly_gains(component, scale))
    return block, players


def session_rows(series, uuid, name, sessions):
    points = series.get((uuid, name))
    if not points:
        return []
    rows = []
    for i, (start, end) in enumerate(sessions):
        cutoff = end + SESSION_END_GRACE_MS
        if i + 1 < len(sessions):
            cutoff = min(cutoff, sessions[i + 1][0])
        before, after = value_at(points, start), value_at(points, cutoff)
        if before is None or after is None:
            continue
        rows.append([uuid, start, end, round(after - before, 3)])
    return rows


def build_detail(spec, series, sessions_by_player, names, now, tracking_since):
    """Everything the metric page needs, as plain data. The browser does the bucketing into days,
    weeks and hours so it can use the viewer's own timezone."""
    uuids = sorted({uuid for uuid, _ in series})
    detail = {
        "name": spec["name"],
        "label": spec["label"],
        "type": spec["type"],
        "generated_at": now,
        "tracking_since": tracking_since,
    }
    involved = set()
    if spec["type"] == "ratio":
        num, num_players = build_block(series, uuids, f'{spec["name"]}__num', spec["numerator"], now)
        den, den_players = build_block(series, uuids, f'{spec["name"]}__den', spec["denominator"], now)
        detail["num"], detail["den"] = num, den
        involved = set(num_players) & set(den_players)
    else:
        main, involved_list = build_block(
            series, uuids, spec["name"], spec["sources"], now, spec.get("component_scale", 1.0)
        )
        detail["main"] = main
        involved = set(involved_list)
        sessions = []
        for uuid in involved_list:
            spans = [(start, end) for start, end, _ in sessions_by_player.get(uuid, [])]
            sessions.extend(session_rows(series, uuid, spec["name"], spans))
        sessions.sort(key=lambda row: row[1])
        detail["sessions"] = sessions[-MAX_SESSIONS:]
    detail["players"] = {uuid: names.get(uuid, uuid[:8]) for uuid in sorted(involved)}
    return detail

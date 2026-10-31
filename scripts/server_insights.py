import bisect
import datetime
import math

HOUR_MS = 3_600_000
DAY_MS = 24 * HOUR_MS
SESSION_END_GRACE_MS = 10 * 60 * 1000
TINY_SESSION_MAX_MS = 5 * 60 * 1000
NEAR_MISS_WINDOW_MS = 30 * 60 * 1000
MIN_SOCIAL_PLAYTIME_MS = 30 * 60 * 1000
TOP_N_RECORDS = 5

WEEKDAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
WEEKDAY_SHORT = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]

# Activity categories used for session archetypes and habit detection
ACTIVITY_DEFS = [
    {
        "key": "mining",
        "label": "⛏️ Mining",
        "short": "Mining",
        "verb": "mining blocks",
        "metrics": ["pickaxe_total", "stone_total", "coal_ore_total", "iron_ore_total", "copper_ore_total", "diamond_ore_total", "dirt_miner_total"],
        "primary": "pickaxe_total",
        "raw_prefixes": ("statistic_mine_block:stone", "statistic_mine_block:cobblestone", "statistic_mine_block:deepslate", "statistic_mine_block:dirt", "statistic_mine_block:coal_ore", "statistic_mine_block:iron_ore", "statistic_mine_block:copper_ore", "statistic_mine_block:diamond_ore"),
    },
    {
        "key": "lumber",
        "label": "🪓 Lumberjack",
        "short": "Woodcutting",
        "verb": "cutting trees",
        "metrics": ["lumberjack_total", "planter_of_forests_total"],
        "primary": "lumberjack_total",
        "raw_prefixes": ("statistic_mine_block:oak_log", "statistic_mine_block:spruce_log", "statistic_mine_block:birch_log", "statistic_mine_block:jungle_log", "statistic_mine_block:acacia_log", "statistic_mine_block:dark_oak_log", "statistic_mine_block:mangrove_log"),
    },
    {
        "key": "farming",
        "label": "🌾 Farming",
        "short": "Farming",
        "verb": "harvesting & ranching",
        "metrics": ["farmer_total", "livestock_farmer_total"],
        "primary": "farmer_total",
        "raw_prefixes": ("statistic_mine_block:wheat", "statistic_mine_block:carrots", "statistic_mine_block:potatoes", "statistic_animals_bred"),
    },
    {
        "key": "crafting",
        "label": "🔨 Crafting & Building",
        "short": "Crafting",
        "verb": "crafting & building",
        "metrics": ["woodworker_total", "mason_total", "baker_total", "master_chef_total"],
        "primary": None,
        "raw_prefixes": ("statistic_craft_item:",),
    },
    {
        "key": "combat",
        "label": "🗡️ Combat",
        "short": "Slaying",
        "verb": "slaying mobs",
        "metrics": ["slayer_overworld_total", "slayer_nether_total"],
        "primary": None,
        "raw_prefixes": ("statistic_kill_entity:",),
    },
    {
        "key": "exploration",
        "label": "🥾 Exploration",
        "short": "Exploring",
        "verb": "exploring the world",
        "metrics": ["traveler_total"],
        "primary": "traveler_total",
        "raw_prefixes": ("statistic_walk_one_cm", "statistic_sprint_one_cm", "statistic_swim_one_cm"),
    },
]


def _local_dt(ts_ms):
    return datetime.datetime.fromtimestamp(ts_ms / 1000.0)


def _day_key(ts_ms):
    dt = _local_dt(ts_ms)
    return dt.strftime("%Y-%m-%d")


def _day_start_ms(ts_ms):
    dt = _local_dt(ts_ms).replace(hour=0, minute=0, second=0, microsecond=0)
    return int(dt.timestamp() * 1000)


def _next_day_start_ms(day_start_ms):
    dt = _local_dt(day_start_ms) + datetime.timedelta(days=1)
    dt = dt.replace(hour=0, minute=0, second=0, microsecond=0)
    return int(dt.timestamp() * 1000)


def _format_hour(h):
    h = int(h) % 24
    if h == 0:
        return "12am"
    if h < 12:
        return f"{h}am"
    if h == 12:
        return "12pm"
    return f"{h - 12}pm"


def _format_duration_hm(ms):
    total_mins = max(0, int(round(ms / 60000.0)))
    hours = total_mins // 60
    mins = total_mins % 60
    if hours > 0:
        return f"{hours}h {mins}m" if mins else f"{hours}h"
    return f"{mins}m"


def _value_at(points, t):
    idx = bisect.bisect_right([p[0] for p in points], t)
    return points[idx - 1][1] if idx else None


def _split_session_by_day(start_ms, end_ms):
    """Yields (day_str, overlap_start_ms, overlap_end_ms, fraction_of_session)."""
    if end_ms <= start_ms:
        return
    total = float(end_ms - start_ms)
    cur = start_ms
    while cur < end_ms:
        d_start = _day_start_ms(cur)
        d_end = _next_day_start_ms(d_start)
        seg_end = min(end_ms, d_end)
        if seg_end > cur:
            yield _day_key(cur), cur, seg_end, (seg_end - cur) / total
        cur = seg_end


def _split_session_night_ms(start_ms, end_ms):
    """Returns dict of {day_str: night_ms} for 12:00 AM - 5:00 AM local time."""
    out = {}
    if end_ms <= start_ms:
        return out
    cur = start_ms
    while cur < end_ms:
        d_start = _day_start_ms(cur)
        night_end = d_start + 5 * HOUR_MS
        d_end = _next_day_start_ms(d_start)
        ov_start = max(cur, d_start)
        ov_end = min(end_ms, night_end)
        if ov_end > ov_start:
            day_str = _day_key(d_start)
            out[day_str] = out.get(day_str, 0) + (ov_end - ov_start)
        cur = min(end_ms, d_end)
    return out


def _daily_metric_gains(series, uuids, metric_names, scale=1.0):
    """Returns {day_str: {"total": float, "by_player": {uuid: float}}}."""
    by_day = {}
    for uuid in uuids:
        for m_name in metric_names:
            points = series.get((uuid, m_name))
            if not points or len(points) < 2:
                continue
            for (_, prev), (ts, val) in zip(points, points[1:]):
                gain = (val - prev) * scale
                if gain <= 0:
                    continue
                d_key = _day_key(ts)
                bucket = by_day.setdefault(d_key, {"total": 0.0, "by_player": {}})
                bucket["total"] += gain
                bucket["by_player"][uuid] = bucket["by_player"].get(uuid, 0.0) + gain
    return by_day


def _rank_daily_buckets(by_day, names, unit, decimals=0):
    """Turns a daily bucket dict into a top-N list for records."""
    ranked = sorted(
        ((day, info) for day, info in by_day.items() if info["total"] > 0),
        key=lambda item: item[1]["total"],
        reverse=True,
    )[:TOP_N_RECORDS]
    result = []
    for day, info in ranked:
        by_p = info.get("by_player", {})
        top_uuid, top_val = None, 0.0
        if by_p:
            top_uuid, top_val = max(by_p.items(), key=lambda kv: kv[1])
        val = round(info["total"], decimals) if decimals else int(round(info["total"]))
        t_val = round(top_val, decimals) if decimals else int(round(top_val))
        result.append({
            "date": day,
            "value": val,
            "unit": unit,
            "top_player": names.get(top_uuid, top_uuid[:8]) if top_uuid else None,
            "top_player_uuid": top_uuid,
            "top_player_value": t_val if top_uuid else None,
            "contributors": len([u for u, v in by_p.items() if v > 0]),
        })
    return result


def compute_server_records(series, full_sessions_by_player, names):
    """Computes the 12 all-time server records (top days + session milestones)."""
    uuids = sorted({u for u, _ in series} | set(full_sessions_by_player.keys()))

    # Flatten all valid sessions: (uuid, start, end, afk, deaths, mob_kills)
    all_sessions = []
    for uuid, sess_list in full_sessions_by_player.items():
        for row in sess_list:
            start, end = row[0], row[1]
            afk = row[2] if len(row) > 2 else 0
            deaths = row[3] if len(row) > 3 else 0
            mob_kills = row[4] if len(row) > 4 else 0
            if end > start:
                all_sessions.append((uuid, start, end, max(0, afk or 0), max(0, deaths or 0), max(0, mob_kills or 0)))

    # 1. Daily session aggregates: playtime, active playtime, AFK, unique players, tiny sessions, deaths, mob kills, night owl
    daily_playtime = {}
    daily_afk = {}
    daily_players = {}
    daily_tiny = {}
    daily_deaths = {}
    daily_mob_kills = {}
    daily_night = {}

    for uuid, start, end, afk, deaths, mob_kills in all_sessions:
        dur = end - start
        is_tiny = dur <= TINY_SESSION_MAX_MS
        if is_tiny:
            d_key = _day_key(start)
            tb = daily_tiny.setdefault(d_key, {"total": 0, "by_player": {}})
            tb["total"] += 1
            tb["by_player"][uuid] = tb["by_player"].get(uuid, 0) + 1

        for d_key, seg_s, seg_e, frac in _split_session_by_day(start, end):
            seg_ms = seg_e - seg_s
            pb = daily_playtime.setdefault(d_key, {"total": 0.0, "by_player": {}})
            pb["total"] += seg_ms / HOUR_MS
            pb["by_player"][uuid] = pb["by_player"].get(uuid, 0.0) + (seg_ms / HOUR_MS)

            if afk > 0:
                ab = daily_afk.setdefault(d_key, {"total": 0.0, "by_player": {}})
                afk_h = (afk * frac) / HOUR_MS
                ab["total"] += afk_h
                ab["by_player"][uuid] = ab["by_player"].get(uuid, 0.0) + afk_h

            if deaths > 0:
                db = daily_deaths.setdefault(d_key, {"total": 0.0, "by_player": {}})
                d_cnt = deaths * frac
                db["total"] += d_cnt
                db["by_player"][uuid] = db["by_player"].get(uuid, 0.0) + d_cnt

            if mob_kills > 0:
                mb = daily_mob_kills.setdefault(d_key, {"total": 0.0, "by_player": {}})
                m_cnt = mob_kills * frac
                mb["total"] += m_cnt
                mb["by_player"][uuid] = mb["by_player"].get(uuid, 0.0) + m_cnt

            pl_set = daily_players.setdefault(d_key, set())
            pl_set.add(uuid)

        for d_key, n_ms in _split_session_night_ms(start, end).items():
            nb = daily_night.setdefault(d_key, {"total": 0.0, "by_player": {}})
            nb["total"] += n_ms / HOUR_MS
            nb["by_player"][uuid] = nb["by_player"].get(uuid, 0.0) + (n_ms / HOUR_MS)

    # Peak concurrent players via interval sweep
    events = []
    for uuid, start, end, *_ in all_sessions:
        events.append((start, 1, uuid))
        events.append((end, -1, uuid))
    events.sort(key=lambda e: (e[0], -e[1]))

    online_now = set()
    peak_concurrent_by_day = {}
    for ts, delta, uuid in events:
        if delta == 1:
            online_now.add(uuid)
            d_key = _day_key(ts)
            cur_best = peak_concurrent_by_day.get(d_key)
            if not cur_best or len(online_now) > cur_best["count"]:
                peak_concurrent_by_day[d_key] = {
                    "count": len(online_now),
                    "ts": ts,
                    "players": sorted(names.get(u, u[:8]) for u in online_now),
                }
        else:
            online_now.discard(uuid)

    # Metric-based daily records: prefer pickaxe_total + dirt_miner_total when present,
    # otherwise fall back to individual stone/ore/log raw series so nothing is double-counted.
    def _metric_or_sources(derived_names, raw_prefixes=()):
        out = _daily_metric_gains(series, uuids, derived_names)
        if out:
            return out
        if not raw_prefixes:
            return out
        raw_names = sorted({
            m for _, m in series
            if any(m == p or m.startswith(p) for p in raw_prefixes)
        })
        return _daily_metric_gains(series, uuids, raw_names)

    mined_daily = _metric_or_sources(
        ["pickaxe_total", "dirt_miner_total"],
        ("statistic_mine_block:stone", "statistic_mine_block:cobblestone", "statistic_mine_block:deepslate", "statistic_mine_block:dirt", "statistic_mine_block:coal_ore", "statistic_mine_block:iron_ore", "statistic_mine_block:copper_ore", "statistic_mine_block:diamond_ore", "statistic_mine_block:netherrack"),
    )
    lumber_daily = _metric_or_sources(
        ["lumberjack_total"],
        ("statistic_mine_block:oak_log", "statistic_mine_block:spruce_log", "statistic_mine_block:birch_log", "statistic_mine_block:jungle_log", "statistic_mine_block:acacia_log", "statistic_mine_block:dark_oak_log", "statistic_mine_block:mangrove_log", "statistic_mine_block:crimson_stem", "statistic_mine_block:warped_stem", "statistic_mine_block:poplar_log"),
    )
    farmer_daily = _metric_or_sources(
        ["farmer_total"],
        ("statistic_mine_block:wheat", "statistic_mine_block:carrots", "statistic_mine_block:potatoes", "statistic_mine_block:beetroots", "statistic_mine_block:nether_wart", "statistic_mine_block:sweet_berries", "statistic_mine_block:pumpkins", "statistic_mine_block:melons", "statistic_mine_block:bamboo"),
    )
    craft_daily = _metric_or_sources(
        ["woodworker_total", "mason_total", "baker_total", "master_chef_total"],
        ("statistic_craft_item:",),
    )
    travel_daily = _daily_metric_gains(series, uuids, ["traveler_total"])
    if not travel_daily:
        travel_daily = _daily_metric_gains(
            series, uuids,
            ["statistic_walk_one_cm", "statistic_sprint_one_cm", "statistic_swim_one_cm"],
            scale=0.01,
        )
    slayer_daily = _metric_or_sources(
        ["slayer_overworld_total", "slayer_nether_total"],
        ("statistic_kill_entity:",),
    )

    # Fall back to session mob_kills if slayer metric series is empty
    slayer_top = _rank_daily_buckets(slayer_daily, names, "mobs", 0)
    if not slayer_top:
        slayer_top = _rank_daily_buckets(daily_mob_kills, names, "mobs", 0)

    # Most people on the server (ranked by unique players that day, tie-broken by peak concurrent)
    people_days = sorted(
        daily_players.keys(),
        key=lambda d: (len(daily_players[d]), peak_concurrent_by_day.get(d, {}).get("count", 0)),
        reverse=True,
    )[:TOP_N_RECORDS]
    people_top = []
    for d in people_days:
        u_list = sorted(names.get(u, u[:8]) for u in daily_players[d])
        pk = peak_concurrent_by_day.get(d, {})
        people_top.append({
            "date": d,
            "value": len(u_list),
            "unit": "players",
            "peak_concurrent": pk.get("count", len(u_list)),
            "peak_ts": pk.get("ts"),
            "top_player": f"Peak {pk.get('count', 1)} at once" if pk else None,
            "players_list": u_list[:8],
            "contributors": len(u_list),
        })

    # Longest continuous session
    longest_sessions = sorted(all_sessions, key=lambda s: s[2] - s[1], reverse=True)[:TOP_N_RECORDS]
    longest_top = []
    for uuid, start, end, afk, deaths, mob_kills in longest_sessions:
        dur_ms = end - start
        active_pct = int(round(100.0 * max(0, dur_ms - afk) / dur_ms)) if dur_ms > 0 else 100
        longest_top.append({
            "date": _day_key(start),
            "start_ts": start,
            "value": round(dur_ms / HOUR_MS, 2),
            "display_value": _format_duration_hm(dur_ms),
            "unit": "hrs",
            "top_player": names.get(uuid, uuid[:8]),
            "top_player_uuid": uuid,
            "active_pct": active_pct,
        })

    records = [
        {
            "id": "most_blocks_mined",
            "icon": "⛏️",
            "title": "Most Blocks Mined",
            "subtitle": "Single-day mining record",
            "kind": "day",
            "top": _rank_daily_buckets(mined_daily, names, "blocks", 0),
        },
        {
            "id": "most_people_online",
            "icon": "👥",
            "title": "Most People on Server",
            "subtitle": "Unique players in a day & peak simultaneous",
            "kind": "people",
            "top": people_top,
        },
        {
            "id": "most_collective_time",
            "icon": "⏳",
            "title": "Most Collective Time",
            "subtitle": "Combined player-hours in a single day",
            "kind": "day_hours",
            "top": _rank_daily_buckets(daily_playtime, names, "hrs", 1),
        },
        {
            "id": "longest_session",
            "icon": "🏃",
            "title": "Longest Continuous Session",
            "subtitle": "All-time marathon single login",
            "kind": "session",
            "top": longest_top,
        },
        {
            "id": "most_tiny_sessions",
            "icon": "⚡",
            "title": "Most Tiny Sessions",
            "subtitle": "Quick logins (< 5m) in a single day",
            "kind": "day",
            "top": _rank_daily_buckets(daily_tiny, names, "logins", 0),
        },
        {
            "id": "most_trees_felled",
            "icon": "🪓",
            "title": "Biggest Deforestation Day",
            "subtitle": "Most logs & stems chopped in a day",
            "kind": "day",
            "top": _rank_daily_buckets(lumber_daily, names, "logs", 0),
        },
        {
            "id": "most_mobs_slain",
            "icon": "🗡️",
            "title": "Monster Purge Day",
            "subtitle": "Most hostile mobs slain in a day",
            "kind": "day",
            "top": slayer_top,
        },
        {
            "id": "most_distance_traveled",
            "icon": "🥾",
            "title": "Greatest Expedition Day",
            "subtitle": "Most blocks walked, sprinted & swum",
            "kind": "day",
            "top": _rank_daily_buckets(travel_daily, names, "blocks", 0),
        },
        {
            "id": "most_crops_harvested",
            "icon": "🌾",
            "title": "Bumper Harvest Day",
            "subtitle": "Most crops harvested in a single day",
            "kind": "day",
            "top": _rank_daily_buckets(farmer_daily, names, "crops", 0),
        },
        {
            "id": "most_items_crafted",
            "icon": "🔨",
            "title": "Most Industrious Crafting Day",
            "subtitle": "Wood, stone & food crafted in a day",
            "kind": "day",
            "top": _rank_daily_buckets(craft_daily, names, "items", 0),
        },
        {
            "id": "deadliest_day",
            "icon": "💀",
            "title": "Deadliest Day",
            "subtitle": "Most player deaths in a single day",
            "kind": "day",
            "top": _rank_daily_buckets(daily_deaths, names, "deaths", 0),
        },
        {
            "id": "night_owl_day",
            "icon": "🦉",
            "title": "Late-Night Grind Record",
            "subtitle": "Most collective hours between 12am–5am",
            "kind": "day_hours",
            "top": _rank_daily_buckets(daily_night, names, "hrs", 1),
        },
    ]

    return records


def compute_session_habits(series, full_sessions_by_player, names):
    """Analyzes per-player session activities, day/hour splitting, and habit badges."""
    uuids = sorted({u for u, _ in series} | set(full_sessions_by_player.keys()))

    # 1. Compute server-wide totals for each activity category so we can normalize session focus
    cat_server_totals = {c["key"]: 0.0 for c in ACTIVITY_DEFS}
    player_cat_series = {}  # (uuid, cat_key) -> {"by_dow": [7], "by_hour": [24], "total": float, "session_hits": int}

    for uuid in uuids:
        for cat in ACTIVITY_DEFS:
            c_key = cat["key"]
            by_dow = [0.0] * 7
            by_hour = [0.0] * 24
            total = 0.0
            if cat["primary"] and series.get((uuid, cat["primary"])):
                metrics_to_use = [cat["primary"]]
            else:
                metrics_to_use = [m for m in cat["metrics"] if series.get((uuid, m))]
                if not metrics_to_use and cat.get("raw_prefixes"):
                    metrics_to_use = sorted({
                        m for u, m in series
                        if u == uuid and any(m == p or m.startswith(p) for p in cat["raw_prefixes"])
                    })
            for m_name in metrics_to_use:
                pts = series.get((uuid, m_name))
                if not pts:
                    continue
                if len(pts) == 1:
                    total += max(0.0, pts[0][1])
                else:
                    for (_, prev), (ts, val) in zip(pts, pts[1:]):
                        gain = val - prev
                        if gain > 0:
                            dt = _local_dt(ts)
                            by_dow[dt.weekday()] += gain
                            by_hour[dt.hour] += gain
                            total += gain
                    if total == 0 and pts[-1][1] > 0:
                        total = pts[-1][1]
            cat_server_totals[c_key] += total
            player_cat_series[(uuid, c_key)] = {
                "by_dow": by_dow,
                "by_hour": by_hour,
                "total": total,
            }

    player_profiles = {}
    for uuid in uuids:
        sess_list = [s for s in full_sessions_by_player.get(uuid, []) if s[1] > s[0]]
        sess_list.sort(key=lambda s: s[0])
        spans = [(s[0], s[1]) for s in sess_list]

        play_by_dow = [0.0] * 7
        play_by_hour = [0.0] * 24
        total_play_ms = 0
        total_afk_ms = 0
        tiny_count = 0
        longest_ms = 0
        active_days = set()

        for s in sess_list:
            start, end = s[0], s[1]
            afk = max(0, s[2] or 0) if len(s) > 2 else 0
            dur = end - start
            total_play_ms += dur
            total_afk_ms += min(dur, afk)
            if dur <= TINY_SESSION_MAX_MS:
                tiny_count += 1
            if dur > longest_ms:
                longest_ms = dur

            # Walk in 15-min slices or segment boundaries to bucket playtime by local hour & weekday
            cur = start
            while cur < end:
                dt = _local_dt(cur)
                active_days.add(dt.strftime("%Y-%m-%d"))
                next_hour = (dt.replace(minute=0, second=0, microsecond=0) + datetime.timedelta(hours=1))
                seg_end = min(end, int(next_hour.timestamp() * 1000))
                if seg_end <= cur:
                    seg_end = min(end, cur + 60000)
                seg_h = (seg_end - cur) / HOUR_MS
                play_by_dow[dt.weekday()] += seg_h
                play_by_hour[dt.hour] += seg_h
                cur = seg_end

        # Session-level activity gains for this player
        cat_session_gains = {c["key"]: [0.0] * len(spans) for c in ACTIVITY_DEFS}
        for cat in ACTIVITY_DEFS:
            c_key = cat["key"]
            metrics_to_use = [cat["primary"]] if cat["primary"] and series.get((uuid, cat["primary"])) else cat["metrics"]
            for m_name in metrics_to_use:
                pts = series.get((uuid, m_name))
                if not pts:
                    continue
                for idx, (s_start, s_end) in enumerate(spans):
                    cutoff = s_end + SESSION_END_GRACE_MS
                    if idx + 1 < len(spans):
                        cutoff = min(cutoff, spans[idx + 1][0])
                    before = _value_at(pts, s_start)
                    after = _value_at(pts, cutoff)
                    if before is not None and after is not None and after > before:
                        cat_session_gains[c_key][idx] += (after - before)

        # Normalize activity shares across categories (relative to server total so 1000 stone ~= 50 logs)
        weighted_scores = {}
        raw_totals = {}
        for cat in ACTIVITY_DEFS:
            c_key = cat["key"]
            p_tot = player_cat_series[(uuid, c_key)]["total"]
            raw_totals[c_key] = round(p_tot, 1)
            srv_tot = cat_server_totals[c_key]
            weighted_scores[c_key] = (p_tot / srv_tot) if srv_tot > 0 else 0.0

        sum_weights = sum(weighted_scores.values())
        activity_mix = []
        for cat in ACTIVITY_DEFS:
            c_key = cat["key"]
            if raw_totals[c_key] <= 0:
                continue
            share = int(round(100.0 * weighted_scores[c_key] / sum_weights)) if sum_weights > 0 else 0
            activity_mix.append({
                "key": c_key,
                "label": cat["label"],
                "short": cat["short"],
                "total": raw_totals[c_key],
                "share_pct": share,
            })
        activity_mix.sort(key=lambda x: (x["share_pct"], x["total"]), reverse=True)

        # Favorite hour and favorite day of week from playtime (or stat timestamps if no sessions)
        if sum(play_by_hour) == 0:
            for cat in ACTIVITY_DEFS:
                for h_i, v in enumerate(player_cat_series[(uuid, cat["key"])]["by_hour"]):
                    play_by_hour[h_i] += v
                for d_i, v in enumerate(player_cat_series[(uuid, cat["key"])]["by_dow"]):
                    play_by_dow[d_i] += v

        fav_hour = max(range(24), key=lambda h: play_by_hour[h]) if sum(play_by_hour) > 0 else None
        fav_hour_pct = int(round(100.0 * play_by_hour[fav_hour] / sum(play_by_hour))) if fav_hour is not None and sum(play_by_hour) > 0 else 0

        fav_dow = max(range(7), key=lambda d: play_by_dow[d]) if sum(play_by_dow) > 0 else None
        fav_dow_pct = int(round(100.0 * play_by_dow[fav_dow] / sum(play_by_dow))) if fav_dow is not None and sum(play_by_dow) > 0 else 0

        weekend_play = play_by_dow[5] + play_by_dow[6]
        total_dow_play = sum(play_by_dow)
        weekend_play_pct = int(round(100.0 * weekend_play / total_dow_play)) if total_dow_play > 0 else 0

        # Detect specialized "Day / Time Habit Splitting"insights!
        habits = []
        if fav_hour is not None and sum(play_by_hour) > 0:
            habits.append({
                "type": "peak_time",
                "icon": "🕒",
                "title": f"{_format_hour(fav_hour)} Regular",
                "text": f"{_format_hour(fav_hour)} is their favorite time to be on ({fav_hour_pct}% of activity)",
                "score": fav_hour_pct,
            })

        if fav_dow is not None and total_dow_play > 0:
            if weekend_play_pct >= 55:
                habits.append({
                    "type": "weekend_warrior",
                    "icon": "📅",
                    "title": "Weekend Warrior",
                    "text": f"Spends {weekend_play_pct}% of their server time on Saturdays & Sundays",
                    "score": weekend_play_pct,
                })
            elif weekend_play_pct <= 15 and len(sess_list) >= 3:
                habits.append({
                    "type": "weekday_regular",
                    "icon": "💼",
                    "title": "Weekday Specialist",
                    "text": f"{100 - weekend_play_pct}% of their playtime is Monday–Friday",
                    "score": 100 - weekend_play_pct,
                })

        # Check activity-by-day and activity-by-time splitting (e.g. "Mining on weekends, cutting trees on Fridays")
        for cat in ACTIVITY_DEFS:
            c_key = cat["key"]
            c_info = player_cat_series[(uuid, c_key)]
            c_dow = c_info["by_dow"]
            c_hour = c_info["by_hour"]
            c_sum = sum(c_dow)
            if c_sum <= 0:
                continue

            # Weekend concentration for this specific activity
            wknd_share = (c_dow[5] + c_dow[6]) / c_sum
            if wknd_share >= 0.60:
                pct = int(round(wknd_share * 100))
                habits.append({
                    "type": "activity_weekend",
                    "icon": cat["label"].split()[0],
                    "title": f"Weekend {cat['short']}",
                    "text": f"{pct}% of their {cat['verb']} happens on weekends",
                    "score": pct + 15,
                })

            # Specific weekday spike for this activity
            best_d = max(range(7), key=lambda d: c_dow[d])
            d_share = c_dow[best_d] / c_sum
            if d_share >= 0.45:
                pct = int(round(d_share * 100))
                habits.append({
                    "type": "activity_day",
                    "icon": cat["label"].split()[0],
                    "title": f"{WEEKDAY_NAMES[best_d]} {cat['short']}",
                    "text": f"Does {pct}% of their {cat['verb']} on {WEEKDAY_NAMES[best_d]}s",
                    "score": pct + 10,
                })

            # Specific hour / time-of-day spike for this activity
            best_h = max(range(24), key=lambda h: c_hour[h])
            h_share = c_hour[best_h] / c_sum
            if h_share >= 0.40:
                pct = int(round(h_share * 100))
                habits.append({
                    "type": "activity_hour",
                    "icon": cat["label"].split()[0],
                    "title": f"{_format_hour(best_h)} {cat['short']}",
                    "text": f"{pct}% of their {cat['verb']} is around {_format_hour(best_h)}",
                    "score": pct,
                })

        # Deduplicate & sort habits so the most interesting specialized ones appear first
        habits.sort(key=lambda h: h["score"], reverse=True)
        seen_titles = set()
        top_habits = []
        for h in habits:
            if h["title"] not in seen_titles:
                seen_titles.add(h["title"])
                top_habits.append(h)
            if len(top_habits) >= 4:
                break

        # Compute time-of-day 4-block breakdown (Night 0-5, Morning 6-11, Afternoon 12-17, Evening 18-23)
        tod_blocks = [
            ("Late Night (12a–6a)", sum(play_by_hour[0:6])),
            ("Morning (6a–12p)", sum(play_by_hour[6:12])),
            ("Afternoon (12p–6p)", sum(play_by_hour[12:18])),
            ("Evening (6p–12a)", sum(play_by_hour[18:24])),
        ]
        tot_tod = sum(v for _, v in tod_blocks)
        time_of_day_split = [
            {
                "label": lbl,
                "hours": round(val, 1),
                "pct": int(round(100.0 * val / tot_tod)) if tot_tod > 0 else 0,
            }
            for lbl, val in tod_blocks
        ]

        # Per-activity peak day & peak hour for the expanded drawer
        for item in activity_mix:
            c_info = player_cat_series[(uuid, item["key"])]
            c_dow = c_info["by_dow"]
            c_hour = c_info["by_hour"]
            c_sum = sum(c_dow)
            if c_sum > 0:
                best_d = max(range(7), key=lambda d: c_dow[d])
                best_h = max(range(24), key=lambda h: c_hour[h])
                item["peak_day"] = WEEKDAY_SHORT[best_d]
                item["peak_day_pct"] = int(round(100.0 * c_dow[best_d] / c_sum))
                item["peak_hour"] = _format_hour(best_h)
                item["peak_hour_pct"] = int(round(100.0 * c_hour[best_h] / c_sum))
                item["weekend_pct"] = int(round(100.0 * (c_dow[5] + c_dow[6]) / c_sum))

        avg_sess_ms = (total_play_ms / len(sess_list)) if sess_list else 0
        player_profiles[uuid] = {
            "uuid": uuid,
            "name": names.get(uuid, uuid[:8]),
            "session_count": len(sess_list),
            "active_days": len(active_days),
            "total_hours": round(total_play_ms / HOUR_MS, 1),
            "avg_session_mins": int(round(avg_sess_ms / 60000.0)),
            "longest_session_hours": round(longest_ms / HOUR_MS, 2),
            "longest_session_display": _format_duration_hm(longest_ms),
            "tiny_sessions": tiny_count,
            "fav_hour": fav_hour,
            "fav_hour_label": _format_hour(fav_hour) if fav_hour is not None else "–",
            "fav_hour_pct": fav_hour_pct,
            "fav_weekday": WEEKDAY_NAMES[fav_dow] if fav_dow is not None else "–",
            "fav_weekday_short": WEEKDAY_SHORT[fav_dow] if fav_dow is not None else "–",
            "fav_weekday_pct": fav_dow_pct,
            "weekend_pct": weekend_play_pct,
            "weekday_pct": 100 - weekend_play_pct if total_dow_play > 0 else 0,
            "time_of_day_split": time_of_day_split,
            "activity_mix": activity_mix[:5],
            "habits": top_habits,
            "hours_histogram": [round(v, 2) for v in play_by_hour],
            "weekdays_histogram": [round(v, 2) for v in play_by_dow],
        }

    return player_profiles


def _detect_cohorts(by_player, total_ms_by_player, pairs, names):
    """Identifies multi-player cohorts/groups (2+ and 3+ players) who play together and when."""
    uuids = sorted(by_player.keys())
    if len(uuids) < 2:
        return [], {u: [] for u in uuids}

    # Sweep line to collect all time slices with >= 2 players online simultaneously
    events = []
    for u, intervals in by_player.items():
        for s, e in intervals:
            events.append((s, 1, u))
            events.append((e, -1, u))
    events.sort(key=lambda x: (x[0], -x[1]))

    online = set()
    multi_slices = []  # (start_ms, end_ms, frozenset_of_online_uuids)
    prev_ts = None
    for ts, delta, u in events:
        if prev_ts is not None and ts > prev_ts and len(online) >= 2:
            multi_slices.append((prev_ts, ts, frozenset(online)))
        if delta == 1:
            online.add(u)
        else:
            online.discard(u)
        prev_ts = ts

    if not multi_slices:
        return [], {u: [] for u in uuids}

    # Build adjacency graph from pairs with meaningful co-play
    pair_lookup = {}
    adj = {u: set() for u in uuids}
    for p in pairs:
        if p["shared_ms"] <= 0:
            continue
        u1, u2 = p["u1"], p["u2"]
        pair_lookup[(u1, u2)] = p
        pair_lookup[(u2, u1)] = p
        if p["overlap_pct"] >= 5.0 or p["shared_ms"] >= 15 * 60 * 1000:
            adj[u1].add(u2)
            adj[u2].add(u1)

    # Fallback if all overlaps are tiny: include any positive overlap edge
    if not any(adj.values()):
        for (u1, u2), p in pair_lookup.items():
            adj[u1].add(u2)

    # Bron-Kerbosch to find maximal cliques of size >= 2
    cliques = set()

    def bron_kerbosch(r, p_set, x_set):
        if not p_set and not x_set:
            if len(r) >= 2:
                cliques.add(frozenset(r))
            return
        pivot = next(iter(p_set | x_set))
        for v in list(p_set - adj[pivot]):
            bron_kerbosch(r | {v}, p_set & adj[v], x_set & adj[v])
            p_set.remove(v)
            x_set.add(v)

    bron_kerbosch(set(), set(uuids), set())

    # Candidate groups: maximal cliques, exact simultaneous online sets (up to size 6), and top pairs
    candidate_groups = set(cliques)
    for _, _, oset in multi_slices:
        if 2 <= len(oset) <= 6:
            candidate_groups.add(oset)
    for p in sorted(pairs, key=lambda x: x["shared_ms"], reverse=True)[:10]:
        if p["shared_ms"] > 0:
            candidate_groups.add(frozenset([p["u1"], p["u2"]]))

    tod_defs = [
        ("Late Night", "12a–6a", "🌙", range(0, 6)),
        ("Morning", "6a–12p", "☀️", range(6, 12)),
        ("Afternoon", "12p–6p", "🌤️", range(12, 18)),
        ("Evening", "6p–12a", "🌆", range(18, 24)),
    ]

    scored_cohorts = []
    for grp in candidate_groups:
        size = len(grp)
        if size < 2:
            continue

        # Require every pair in the group to have co-played at least once
        all_pairs_connected = True
        for i_u in grp:
            for j_u in grp:
                if i_u < j_u and (i_u, j_u) not in pair_lookup:
                    all_pairs_connected = False
                    break
            if not all_pairs_connected:
                break
        if not all_pairs_connected:
            continue

        # Collect slices where all members of `grp` are online simultaneously,
        # and for size >= 3 also track slices where at least 2 members of `grp` are online together
        exact_intervals = []
        core_intervals = []
        member_active_ms = {u: 0 for u in grp}
        all_together_ms = 0
        core_together_ms = 0

        for s, e, oset in multi_slices:
            dt = e - s
            inter = grp & oset
            if len(inter) == size:
                all_together_ms += dt
                exact_intervals.append((s, e))
            if len(inter) >= 2:
                core_together_ms += dt
                core_intervals.append((s, e))
                for u in inter:
                    member_active_ms[u] += dt

        # For 3+ player cohorts, require either real simultaneous overlap or strong participation by every member
        if size == 2:
            if all_together_ms <= 0:
                continue
            timing_intervals = exact_intervals
            primary_ms = all_together_ms
        else:
            if core_together_ms <= 0:
                continue
            min_member_share = min(member_active_ms.values()) / float(core_together_ms)
            if all_together_ms <= 0 and min_member_share < 0.35:
                continue
            if min_member_share < 0.25:
                continue
            timing_intervals = exact_intervals if all_together_ms >= 0.4 * core_together_ms else core_intervals
            primary_ms = all_together_ms if all_together_ms >= 0.4 * core_together_ms else core_together_ms

        # Merge contiguous/nearby timing intervals (within 5 mins) to count distinct group sessions
        merged_timing = []
        for s, e in sorted(timing_intervals, key=lambda x: x[0]):
            if merged_timing and s - merged_timing[-1][1] <= 5 * 60 * 1000:
                merged_timing[-1] = (merged_timing[-1][0], max(merged_timing[-1][1], e))
            else:
                merged_timing.append((s, e))

        by_hour = [0.0] * 24
        by_dow = [0.0] * 7
        shared_days = set()
        for s, e in timing_intervals:
            cur = s
            while cur < e:
                dt = _local_dt(cur)
                shared_days.add(dt.strftime("%Y-%m-%d"))
                next_hour = dt.replace(minute=0, second=0, microsecond=0) + datetime.timedelta(hours=1)
                seg_end = min(e, int(next_hour.timestamp() * 1000))
                if seg_end <= cur:
                    seg_end = min(e, cur + 60000)
                seg_h = (seg_end - cur) / HOUR_MS
                by_dow[dt.weekday()] += seg_h
                by_hour[dt.hour] += seg_h
                cur = seg_end

        tot_h = sum(by_hour)
        if tot_h <= 0:
            continue

        # Determine dominant Time-of-Day block and favorite hour
        best_tod = max(tod_defs, key=lambda td: sum(by_hour[h] for h in td[3]))
        tod_name, tod_range, tod_icon, tod_hours = best_tod
        tod_pct = int(round(100.0 * sum(by_hour[h] for h in tod_hours) / tot_h))
        fav_h = max(range(24), key=lambda h: by_hour[h])
        fav_h_label = _format_hour(fav_h)

        # Determine day-of-week signature
        wkend_h = by_dow[5] + by_dow[6]
        wkend_pct = int(round(100.0 * wkend_h / tot_h))
        wkday_pct = 100 - wkend_pct
        ranked_dows = sorted(range(7), key=lambda d: by_dow[d], reverse=True)
        top_dow = ranked_dows[0]
        second_dow = ranked_dows[1]
        top_dow_pct = int(round(100.0 * by_dow[top_dow] / tot_h))

        if top_dow_pct >= 60:
            day_tag = f"{WEEKDAY_NAMES[top_dow]}s"
            day_detail = f"{WEEKDAY_SHORT[top_dow]} ({top_dow_pct}%)"
        elif wkend_pct >= 62:
            day_tag = "Weekend"
            day_detail = f"Weekends ({wkend_pct}%)"
        elif top_dow_pct >= 45:
            day_tag = f"{WEEKDAY_NAMES[top_dow]}s"
            day_detail = f"{WEEKDAY_SHORT[top_dow]} ({top_dow_pct}%)"
        elif wkday_pct >= 75:
            if by_dow[second_dow] > 0 and (by_dow[top_dow] + by_dow[second_dow]) / tot_h >= 0.6:
                day_tag = f"{WEEKDAY_SHORT[top_dow]}/{WEEKDAY_SHORT[second_dow]}"
                day_detail = f"{WEEKDAY_SHORT[top_dow]} & {WEEKDAY_SHORT[second_dow]}"
            else:
                day_tag = "Weekday"
                day_detail = f"Weekdays ({wkday_pct}%)"
        else:
            day_tag = f"{WEEKDAY_SHORT[top_dow]}/{WEEKDAY_SHORT[second_dow]}"
            day_detail = f"{WEEKDAY_SHORT[top_dow]} & {WEEKDAY_SHORT[second_dow]}"

        group_noun = "Duo" if size == 2 else ("Trio" if size == 3 else ("Quad" if size == 4 else "Crew"))
        cohort_title = f"{tod_icon} {day_tag} {tod_name} {group_noun}"

        members = sorted(
            [{"uuid": u, "name": names.get(u, u[:8])} for u in grp],
            key=lambda m: (-member_active_ms.get(m["uuid"], 0), m["name"].lower()),
        )

        # Score favors multi-player cohorts (3+) when they have meaningful time, while still ranking strong duos
        size_bonus = 1.35 if size >= 3 else 1.0
        score = primary_ms * size_bonus

        scored_cohorts.append({
            "group_set": grp,
            "score": score,
            "primary_ms": primary_ms,
            "size": size,
            "title": cohort_title,
            "icon": tod_icon,
            "members": members,
            "member_names": [m["name"] for m in members],
            "shared_hours": round(primary_ms / HOUR_MS, 2),
            "shared_display": _format_duration_hm(primary_ms),
            "all_together_display": _format_duration_hm(all_together_ms) if all_together_ms > 0 else None,
            "shared_sessions": len(merged_timing),
            "shared_days": len(shared_days),
            "time_window": f"{tod_name} ({tod_range})",
            "time_window_pct": tod_pct,
            "peak_hour": fav_h_label,
            "day_pattern": day_detail,
            "weekend_pct": wkend_pct,
            "weekday_pct": wkday_pct,
        })

    # Sort by score descending, then prune redundant subsets/supersets
    scored_cohorts.sort(key=lambda c: (c["score"], c["size"]), reverse=True)
    selected = []
    for cand in scored_cohorts:
        g = cand["group_set"]
        redundant = False
        for existing in selected:
            eg = existing["group_set"]
            # If cand is a subset of an already selected larger cohort with similar time, skip cand
            if g < eg and cand["primary_ms"] <= existing["primary_ms"] * 1.5:
                redundant = True
                break
            # If cand is a superset of an already selected smaller cohort but barely played together as full group
            if g > eg and cand["primary_ms"] < existing["primary_ms"] * 0.35:
                redundant = True
                break
        if not redundant:
            selected.append(cand)
        if len(selected) >= 8:
            break

    # Clean internal fields and build per-player cohort membership
    cohorts_out = []
    per_player_cohorts = {u: [] for u in uuids}
    for idx, c in enumerate(selected, start=1):
        cohort_obj = {
            "id": f"cohort_{idx}",
            "size": c["size"],
            "title": c["title"],
            "icon": c["icon"],
            "members": c["members"],
            "member_names": c["member_names"],
            "shared_hours": c["shared_hours"],
            "shared_display": c["shared_display"],
            "all_together_display": c["all_together_display"],
            "shared_sessions": c["shared_sessions"],
            "shared_days": c["shared_days"],
            "time_window": c["time_window"],
            "time_window_pct": c["time_window_pct"],
            "peak_hour": c["peak_hour"],
            "day_pattern": c["day_pattern"],
            "weekend_pct": c["weekend_pct"],
            "weekday_pct": c["weekday_pct"],
        }
        cohorts_out.append(cohort_obj)
        for m in c["members"]:
            u = m["uuid"]
            if u in per_player_cohorts:
                others = [om["name"] for om in c["members"] if om["uuid"] != u]
                per_player_cohorts[u].append({
                    **cohort_obj,
                    "other_members": others,
                })

    return cohorts_out, per_player_cohorts


def compute_social_overlap(full_sessions_by_player, names):
    """Computes pairwise co-play time, Jaccard affinity, near-misses (<30m), and solo vs social %."""
    # Filter and normalize sessions per player
    by_player = {}
    total_ms_by_player = {}
    for uuid, sess_list in full_sessions_by_player.items():
        valid = sorted([(s[0], s[1]) for s in sess_list if s[1] > s[0]], key=lambda x: x[0])
        if not valid:
            continue
        # Merge overlapping intervals for the same player if any exist
        merged = [valid[0]]
        for s, e in valid[1:]:
            if s <= merged[-1][1]:
                merged[-1] = (merged[-1][0], max(merged[-1][1], e))
            else:
                merged.append((s, e))
        by_player[uuid] = merged
        total_ms_by_player[uuid] = sum(e - s for s, e in merged)

    uuids = sorted(by_player.keys())
    pairs = []
    per_player_buddies = {u: [] for u in uuids}
    per_player_missed = {u: [] for u in uuids}

    for i in range(len(uuids)):
        u1 = uuids[i]
        s1 = by_player[u1]
        t1 = total_ms_by_player[u1]
        for j in range(i + 1, len(uuids)):
            u2 = uuids[j]
            s2 = by_player[u2]
            t2 = total_ms_by_player[u2]

            # Two-pointer interval intersection + near-miss detection
            p1, p2 = 0, 0
            shared_ms = 0
            shared_sessions = 0
            near_misses = 0
            closest_gap_ms = None

            while p1 < len(s1) and p2 < len(s2):
                a_start, a_end = s1[p1]
                b_start, b_end = s2[p2]
                ov_start = max(a_start, b_start)
                ov_end = min(a_end, b_end)
                if ov_end > ov_start:
                    shared_ms += (ov_end - ov_start)
                    shared_sessions += 1
                else:
                    gap = max(a_start - b_end, b_start - a_end)
                    if closest_gap_ms is None or gap < closest_gap_ms:
                        closest_gap_ms = gap
                    if 0 <= gap <= NEAR_MISS_WINDOW_MS:
                        near_misses += 1

                if a_end < b_end:
                    p1 += 1
                else:
                    p2 += 1

            union_ms = t1 + t2 - shared_ms
            jaccard_pct = round(100.0 * shared_ms / union_ms, 1) if union_ms > 0 else 0.0
            min_play = min(t1, t2)
            overlap_of_smaller_pct = round(100.0 * shared_ms / min_play, 1) if min_play > 0 else 0.0

            pair_obj = {
                "u1": u1,
                "u2": u2,
                "name1": names.get(u1, u1[:8]),
                "name2": names.get(u2, u2[:8]),
                "shared_hours": round(shared_ms / HOUR_MS, 2),
                "shared_display": _format_duration_hm(shared_ms),
                "shared_ms": shared_ms,
                "shared_sessions": shared_sessions,
                "jaccard_pct": jaccard_pct,
                "overlap_pct": overlap_of_smaller_pct,
                "near_misses": near_misses,
                "closest_gap_mins": int(round(closest_gap_ms / 60000.0)) if closest_gap_ms is not None else None,
                "combined_hours": round((t1 + t2) / HOUR_MS, 1),
                "active_both": t1 >= MIN_SOCIAL_PLAYTIME_MS and t2 >= MIN_SOCIAL_PLAYTIME_MS,
            }
            pairs.append(pair_obj)

            if shared_ms > 0:
                per_player_buddies[u1].append({
                    "uuid": u2,
                    "name": names.get(u2, u2[:8]),
                    "shared_hours": pair_obj["shared_hours"],
                    "shared_display": pair_obj["shared_display"],
                    "overlap_pct": round(100.0 * shared_ms / t1, 1) if t1 > 0 else 0.0,
                })
                per_player_buddies[u2].append({
                    "uuid": u1,
                    "name": names.get(u1, u1[:8]),
                    "shared_hours": pair_obj["shared_hours"],
                    "shared_display": pair_obj["shared_display"],
                    "overlap_pct": round(100.0 * shared_ms / t2, 1) if t2 > 0 else 0.0,
                })

            if pair_obj["active_both"] and (shared_ms == 0 or overlap_of_smaller_pct < 5.0 or near_misses > 0):
                per_player_missed[u1].append({
                    "uuid": u2,
                    "name": names.get(u2, u2[:8]),
                    "shared_display": pair_obj["shared_display"],
                    "overlap_pct": overlap_of_smaller_pct,
                    "near_misses": near_misses,
                    "closest_gap_mins": pair_obj["closest_gap_mins"],
                })
                per_player_missed[u2].append({
                    "uuid": u1,
                    "name": names.get(u1, u1[:8]),
                    "shared_display": pair_obj["shared_display"],
                    "overlap_pct": overlap_of_smaller_pct,
                    "near_misses": near_misses,
                    "closest_gap_mins": pair_obj["closest_gap_mins"],
                })

    for u in uuids:
        per_player_buddies[u].sort(key=lambda x: x["shared_hours"], reverse=True)
        per_player_missed[u].sort(key=lambda x: (-x["near_misses"], x["overlap_pct"]))

    # Compute solo vs social time per player via sweep line
    events = []
    for u, intervals in by_player.items():
        for s, e in intervals:
            events.append((s, 1, u))
            events.append((e, -1, u))
    events.sort(key=lambda x: (x[0], -x[1]))

    online = set()
    solo_ms = {u: 0 for u in uuids}
    social_ms = {u: 0 for u in uuids}
    prev_ts = None
    for ts, delta, u in events:
        if prev_ts is not None and ts > prev_ts and online:
            dt = ts - prev_ts
            if len(online) == 1:
                only_u = next(iter(online))
                solo_ms[only_u] += dt
            else:
                for ou in online:
                    social_ms[ou] += dt
        if delta == 1:
            online.add(u)
        else:
            online.discard(u)
        prev_ts = ts

    solo_vs_social = []
    for u in uuids:
        tot = total_ms_by_player[u]
        if tot <= 0:
            continue
        soc_pct = int(round(100.0 * social_ms[u] / tot))
        solo_vs_social.append({
            "uuid": u,
            "name": names.get(u, u[:8]),
            "social_pct": soc_pct,
            "solo_pct": 100 - soc_pct,
            "social_hours": round(social_ms[u] / HOUR_MS, 1),
            "solo_hours": round(solo_ms[u] / HOUR_MS, 1),
            "total_hours": round(tot / HOUR_MS, 1),
        })
    solo_vs_social.sort(key=lambda x: (x["social_pct"], x["social_hours"]), reverse=True)

    top_duos = sorted(
        [p for p in pairs if p["shared_ms"] > 0],
        key=lambda p: (p["shared_ms"], p["jaccard_pct"]),
        reverse=True,
    )[:8]

    # Ships in the night: active players who have low overlap (< 25%) or near-misses
    ships_candidates = [p for p in pairs if p["active_both"] and (p["overlap_pct"] < 25.0 or p["near_misses"] > 0)]
    if not ships_candidates:
        ships_candidates = [p for p in pairs if p["overlap_pct"] < 25.0 or p["near_misses"] > 0]
    ships_in_night = sorted(
        ships_candidates,
        key=lambda p: (p["overlap_pct"], -p["near_misses"], -p["combined_hours"]),
    )[:8]

    most_near_misses = sorted(
        [p for p in pairs if p["near_misses"] > 0],
        key=lambda p: (p["near_misses"], -p["overlap_pct"]),
        reverse=True,
    )[:5]

    cohorts, per_player_cohorts = _detect_cohorts(by_player, total_ms_by_player, pairs, names)

    return {
        "cohorts": cohorts,
        "top_duos": top_duos,
        "ships_in_night": ships_in_night,
        "most_near_misses": most_near_misses,
        "solo_vs_social": solo_vs_social,
        "by_player": {
            u: {
                "cohorts": per_player_cohorts.get(u, [])[:4],
                "buddies": per_player_buddies[u][:3],
                "missed": per_player_missed[u][:3],
                "social_pct": next((x["social_pct"] for x in solo_vs_social if x["uuid"] == u), 0),
                "solo_pct": next((x["solo_pct"] for x in solo_vs_social if x["uuid"] == u), 100),
            }
            for u in uuids
        },
    }


def build_insights(series, full_sessions_by_player, names):
    records = compute_server_records(series, full_sessions_by_player, names)
    habits = compute_session_habits(series, full_sessions_by_player, names)
    social = compute_social_overlap(full_sessions_by_player, names)
    return {
        "records": records,
        "habits": habits,
        "social": social,
    }

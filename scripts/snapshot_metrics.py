import json
import os
import re
import sqlite3
import time

PLAN_DB = os.environ.get("PLAN_DB", "/opt/stacks/minecraft/data/plugins/Plan/database.db")
SNAPSHOT_DB = os.environ.get("SNAPSHOT_DB", "/opt/stacks/minecraft/data/plugins/Plan/metric_snapshots.db")
PLAN_CONFIG = os.environ.get("PLAN_CONFIG", "/opt/stacks/minecraft/data/plugins/Plan/config.yml")
SERVER_DIR = os.environ.get("SERVER_DIR", "/opt/stacks/minecraft/data")

# Kept in a separate file so Plan's own schema/patches never touch it.
# Only changes are stored: a player's value at time T is the latest row with ts <= T.
# snapshot_runs records every run so "no change" can be told apart from "not checked".
SCHEMA = """
CREATE TABLE IF NOT EXISTS snapshot_runs (
    ts INTEGER PRIMARY KEY
);
CREATE TABLE IF NOT EXISTS metric_changes (
    ts INTEGER NOT NULL,
    uuid TEXT NOT NULL,
    metric TEXT NOT NULL,
    value REAL NOT NULL,
    PRIMARY KEY (uuid, metric, ts)
);
CREATE INDEX IF NOT EXISTS idx_metric_changes_ts ON metric_changes (ts);
CREATE TABLE IF NOT EXISTS sessions_archive (
    uuid TEXT NOT NULL,
    server_uuid TEXT NOT NULL,
    session_start INTEGER NOT NULL,
    session_end INTEGER NOT NULL,
    afk_time INTEGER,
    deaths INTEGER,
    mob_kills INTEGER,
    PRIMARY KEY (uuid, server_uuid, session_start)
);
"""


def read_plan_data():
    # Read-only so a snapshot can never interfere with Plan's own writes
    plan = sqlite3.connect(f"file:{PLAN_DB}?mode=ro", uri=True, timeout=30)
    try:
        rows = plan.execute(
            """
            SELECT v.uuid, p.name, v.string_value
            FROM plan_extension_user_values v
            JOIN plan_extension_providers p ON p.id = v.provider_id
            WHERE v.string_value IS NOT NULL
            """
        ).fetchall()
        sessions = plan.execute(
            """
            SELECT u.uuid, sv.uuid, s.session_start, s.session_end, s.afk_time, s.deaths, s.mob_kills
            FROM plan_sessions s
            JOIN plan_users u ON u.id = s.user_id
            JOIN plan_servers sv ON sv.id = s.server_id
            """
        ).fetchall()
        known_uuids = {row[0] for row in plan.execute("SELECT uuid FROM plan_users")}
    finally:
        plan.close()

    values = {}
    for uuid, metric, raw in rows:
        try:
            values[(uuid, metric)] = float(raw)
        except ValueError:
            continue
    return values, sessions, known_uuids


# PlaceholderAPI %statistic_<type>:<name>% type -> category in Minecraft's stats file
STAT_CATEGORIES = {
    "mine_block": "minecraft:mined",
    "use_item": "minecraft:used",
    "break_item": "minecraft:broken",
    "craft_item": "minecraft:crafted",
    "kill_entity": "minecraft:killed",
    "entity_killed_by": "minecraft:killed_by",
}
# Plain stats (walk_one_cm, deaths, ...) live under this category in the stats file
PLAIN_STAT_CATEGORY = "minecraft:custom"
# PlaceholderAPI computes these itself, so they have no matching key in the stats file
COMPUTED_PLAIN_STATS = {
    "ticks_played", "seconds_played", "minutes_played", "hours_played", "days_played", "time_played",
}


TYPED_STAT = re.compile(r"^statistic_(" + "|".join(STAT_CATEGORIES) + r"):([a-z0-9_]+)$")
PLAIN_STAT = re.compile(r"^statistic_([a-z0-9_]+)$")


def wanted_metrics():
    # Stats to read from Minecraft: everything Plan is configured to track, plus every source a
    # custom metric needs (so metrics don't force dozens of extra placeholders into Plan's config)
    wanted = set()
    try:
        with open(PLAN_CONFIG) as f:
            wanted.update(re.findall(r'^\s*-\s*"%(statistic_[a-z0-9_:]+)%"', f.read(), re.MULTILINE))
    except OSError:
        pass
    try:
        import build_metrics
        for derived in build_metrics.DERIVED:
            wanted.update(derived["sources"])
    except Exception as err:
        print(f"Could not load custom metrics: {err}")
    return wanted


def parse_metric(metric):
    # statistic_mine_block:stone -> ("mine_block", "stone"); statistic_walk_one_cm -> (None, "walk_one_cm")
    typed = TYPED_STAT.match(metric)
    if typed:
        return typed.group(1), typed.group(2)
    plain = PLAIN_STAT.match(metric)
    if plain and plain.group(1) not in COMPUTED_PLAIN_STATS:
        return None, plain.group(1)
    return False


def stats_dir():
    level = "world"
    try:
        with open(os.path.join(SERVER_DIR, "server.properties")) as f:
            for line in f:
                if line.startswith("level-name="):
                    level = line.split("=", 1)[1].strip() or level
    except OSError:
        pass
    for sub in ("players/stats", "stats"):
        path = os.path.join(SERVER_DIR, level, sub)
        if os.path.isdir(path):
            return path
    return None


def read_minecraft_stats(known_uuids):
    # Minecraft keeps lifetime counts for every player, online or not
    directory = stats_dir()
    parsed = {metric: parse_metric(metric) for metric in wanted_metrics()}
    parsed = {metric: spec for metric, spec in parsed.items() if spec}
    values = {}
    if not directory or not parsed:
        return values
    for filename in os.listdir(directory):
        uuid = filename[:-5]
        if not filename.endswith(".json") or uuid not in known_uuids:
            continue
        try:
            with open(os.path.join(directory, filename)) as f:
                stats = json.load(f).get("stats", {})
        except (OSError, ValueError):
            continue
        for metric, (stat_type, name) in parsed.items():
            category = stats.get(STAT_CATEGORIES[stat_type] if stat_type else PLAIN_STAT_CATEGORY, {})
            values[(uuid, metric)] = float(category.get(f"minecraft:{name}", 0))
    return values


def main():
    now = int(time.time() * 1000)
    current, sessions, known_uuids = read_plan_data()

    snap = sqlite3.connect(SNAPSHOT_DB, timeout=30)
    snap.executescript(SCHEMA)

    latest = {
        (uuid, metric): value
        for uuid, metric, value in snap.execute(
            """
            SELECT m.uuid, m.metric, m.value
            FROM metric_changes m
            WHERE m.ts = (
                SELECT MAX(ts) FROM metric_changes
                WHERE uuid = m.uuid AND metric = m.metric
            )
            """
        )
    }

    changed = [
        (now, uuid, metric, value)
        for (uuid, metric), value in current.items()
        if latest.get((uuid, metric)) != value
    ]
    # Minecraft's stats files cover every stat Plan doesn't provide, and are re-read each run so
    # those series keep updating. A stat Plan does provide is never read from the file, so the
    # two sources can't alternate.
    from_minecraft = [
        (now, uuid, metric, value)
        for (uuid, metric), value in read_minecraft_stats(known_uuids).items()
        if (uuid, metric) not in current and latest.get((uuid, metric)) != value
    ]
    snap.executemany(
        "INSERT INTO metric_changes (ts, uuid, metric, value) VALUES (?, ?, ?, ?)", changed + from_minecraft
    )
    # INSERT OR IGNORE keeps archived sessions even after Plan deletes them
    before = snap.total_changes
    snap.executemany(
        "INSERT OR IGNORE INTO sessions_archive "
        "(uuid, server_uuid, session_start, session_end, afk_time, deaths, mob_kills) VALUES (?, ?, ?, ?, ?, ?, ?)",
        sessions,
    )
    archived = snap.total_changes - before
    snap.execute("INSERT OR IGNORE INTO snapshot_runs (ts) VALUES (?)", (now,))
    snap.commit()
    snap.close()

    print(
        f"Snapshot at {now}: {len(current)} values read, {len(changed)} changed, "
        f"{len(from_minecraft)} from Minecraft stats, {archived} new sessions archived."
    )


if __name__ == "__main__":
    main()

import os
import sqlite3
import time

PLAN_DB = os.environ.get("PLAN_DB", "/opt/stacks/minecraft/data/plugins/Plan/database.db")
SNAPSHOT_DB = os.environ.get("SNAPSHOT_DB", "/opt/stacks/minecraft/data/plugins/Plan/metric_snapshots.db")

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
"""


def read_current_values():
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
    finally:
        plan.close()

    values = {}
    for uuid, metric, raw in rows:
        try:
            values[(uuid, metric)] = float(raw)
        except ValueError:
            continue
    return values


def main():
    now = int(time.time() * 1000)
    current = read_current_values()

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
    snap.executemany("INSERT INTO metric_changes (ts, uuid, metric, value) VALUES (?, ?, ?, ?)", changed)
    snap.execute("INSERT OR IGNORE INTO snapshot_runs (ts) VALUES (?)", (now,))
    snap.commit()
    snap.close()

    print(f"Snapshot at {now}: {len(current)} values read, {len(changed)} changed.")


if __name__ == "__main__":
    main()

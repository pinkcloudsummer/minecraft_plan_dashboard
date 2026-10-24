# Every source must also be listed in Tracked_player_placeholders in plan/config.yml.
# Editing SOURCES re-derives the whole history from the stored snapshots.
NAME = "dirt_miner_total"
LABEL = "🪓 Dirt Miner"

BLOCKS = [
    "dirt", "coarse_dirt", "podzol", "rooted_dirt",
    "grass_block", "mycelium", "mud",
]
SOURCES = [f"statistic_mine_block:{block}" for block in BLOCKS]


# Optional: receives the source values in SOURCES order. Defaults to sum when omitted.
def combine(values):
    return sum(values)
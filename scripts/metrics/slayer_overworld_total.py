# Every source must also be listed in Tracked_player_placeholders in plan/config.yml.
# Editing SOURCES re-derives the whole history from the stored snapshots.
NAME = "slayer_overworld_total"
LABEL = "🗡️ Overworld Slayer"

BLOCKS = [
    "zombie", "skeleton", "creeper", "spider", "cave_spider", "witch", "slime", 
    "phantom", "drowned", "husk", "stray", "silverfish", "endermite", "bogged", 
    "breeze", "creaking", "pillager", "vindicator", "evoker", "ravager", "vex"
]
SOURCES = [f"statistic_kill_entity:{block}" for block in BLOCKS]


# Optional: receives the source values in SOURCES order. Defaults to sum when omitted.
def combine(values):
    return sum(values)
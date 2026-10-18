# Every source must also be listed in Tracked_player_placeholders in plan/config.yml.
# Editing SOURCES re-derives the whole history from the stored snapshots.
NAME = "slayer_nether_total"
LABEL = "🗡️ Nether Slayer"

BLOCKS = [
    "ghast", "blaze", "magma_cube", "wither_skeleton", "piglin_brute", "hoglin", 
    "zoglin"
]
SOURCES = [f"statistic_kill_entity:{block}" for block in BLOCKS]


# Optional: receives the source values in SOURCES order. Defaults to sum when omitted.
def combine(values):
    return sum(values)
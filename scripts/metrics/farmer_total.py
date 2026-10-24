# Every source must also be listed in Tracked_player_placeholders in plan/config.yml.
# Editing SOURCES re-derives the whole history from the stored snapshots.
NAME = "farmer_total"
LABEL = "🌾 Farmer"

BLOCKS = [
    "wheat", "carrots", "potatoes", "beetroots", "nether_wart", "sweet_berries", 
    "pumpkins", "melons", "cocoa_beans","bamboo"
]
SOURCES = [f"statistic_mine_block:{block}" for block in BLOCKS]


# Optional: receives the source values in SOURCES order. Defaults to sum when omitted.
def combine(values):
    return sum(values)
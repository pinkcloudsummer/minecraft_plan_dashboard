# Every source must also be listed in Tracked_player_placeholders in plan/config.yml.
# Editing SOURCES re-derives the whole history from the stored snapshots.
NAME = "planter_of_forests_total"
LABEL = "🌳 Planter of Forests"

BLOCKS = [
    "oak_sapling", "spruce_sapling", "birch_sapling", "jungle_sapling",
    "acacia_sapling", "oak_sapling", "dark_oak_sapling", "mangrove_propagule", "pale_oak_sapling",
    "poplar_sapling", "cherry_sapling"
]
SOURCES = [f"statistic_use_item:{block}" for block in BLOCKS]


# Optional: receives the source values in SOURCES order. Defaults to sum when omitted.
def combine(values):
    return sum(values)
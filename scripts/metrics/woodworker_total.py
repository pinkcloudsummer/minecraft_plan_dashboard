# Every source must also be listed in Tracked_player_placeholders in plan/config.yml.
# Editing SOURCES re-derives the whole history from the stored snapshots.
NAME = "woodworker_total"
LABEL = "🌳 Worker of Wood"

BLOCKS = [
    "poplar_planks", "spruce_planks", "birch_planks", "jungle_planks",
    "acacia_planks", "dark_oak_planks", "mangrove_planks", "pale_oak_planks",
    "cherry_planks", "oak_planks", 
    "poplar_stairs", "spruce_stairs", "birch_stairs", "jungle_stairs",
    "acacia_stairs", "dark_oak_stairs", "mangrove_stairs", "pale_oak_stairs",
    "cherry_stairs", "oak_stairs",
    "poplar_slab", "spruce_slab", "birch_slab", "jungle_slab",
    "acacia_slab", "dark_oak_slab", "mangrove_slab", "pale_oak_slab",
    "cherry_slab", "oak_slab",
    "poplar_fence", "spruce_fence", "birch_fence", "jungle_fence",
    "acacia_fence", "dark_oak_fence", "mangrove_fence", "pale_oak_fence",
    "cherry_fence", "oak_fence",
    "poplar_door", "spruce_door", "birch_door", "jungle_door",
    "acacia_door", "dark_oak_door", "mangrove_door", "pale_oak_door",
    "cherry_door", "oak_door"
]
SOURCES = [f"statistic_craft_item:{block}" for block in BLOCKS]


# Optional: receives the source values in SOURCES order. Defaults to sum when omitted.
def combine(values):
    return sum(values)
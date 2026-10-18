# Every source must also be listed in Tracked_player_placeholders in plan/config.yml.
# Editing SOURCES re-derives the whole history from the stored snapshots.
NAME = "mason_total"
LABEL = "🪨 Worker of Stone"

BLOCKS = [
    "stone", "smooth_stone", "granite", "diorite",
    "andesite", "polished_granite", "polished_diorite", "polished_andesite",
    "polished_deepslate", "deepslate_bricks", "deepslate_tiles", "stone_bricks", 
    "sandstone","blackstone", "chiseled_blackstone", "gilded_blackstone",
    "polished_blackstone", 
]
SOURCES = [f"statistic_craft_item:{block}" for block in BLOCKS]


# Optional: receives the source values in SOURCES order. Defaults to sum when omitted.
def combine(values):
    return sum(values)
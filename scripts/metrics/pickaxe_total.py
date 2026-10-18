# Every source must also be listed in Tracked_player_placeholders in plan/config.yml.
# Editing SOURCES re-derives the whole history from the stored snapshots.
NAME = "pickaxe_total"
LABEL = "⛏️ Pickaxe Blocks"

BLOCKS = [
    "stone", "cobblestone", "deepslate", "cobbled_deepslate",
    "coal_ore", "deepslate_coal_ore", "iron_ore", "deepslate_iron_ore",
    "gold_ore", "deepslate_gold_ore", "diamond_ore", "deepslate_diamond_ore",
    "netherrack", "ancient_debris", "obsidian",
]
SOURCES = [f"statistic_mine_block:{block}" for block in BLOCKS]


# Optional: receives the source values in SOURCES order. Defaults to sum when omitted.
def combine(values):
    return sum(values)

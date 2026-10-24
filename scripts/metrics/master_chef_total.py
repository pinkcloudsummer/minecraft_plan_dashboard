# Every source must also be listed in Tracked_player_placeholders in plan/config.yml.
# Editing SOURCES re-derives the whole history from the stored snapshots.
NAME = "master_chef_total"
LABEL = "👨‍🍳 Master Chef"

BLOCKS = [
    "cooked_beef","cooked_chicken","cooked_mutton","cooked_rabbit","cooked_cod",
    "cooked_salmon","cooked_porkchop","cooked_trout","baked_potato", "rabbit_stew",
    "beetroot_soup","mushroom_stew","suspicious_stew",""
]
SOURCES = [f"statistic_craft_block:{block}" for block in BLOCKS]


# Optional: receives the source values in SOURCES order. Defaults to sum when omitted.
def combine(values):
    return sum(values)
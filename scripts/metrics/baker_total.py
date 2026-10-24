# Every source must also be listed in Tracked_player_placeholders in plan/config.yml.
# Editing SOURCES re-derives the whole history from the stored snapshots.
NAME = "baker_total"
LABEL = "🍞 Baker"

BLOCKS = [
    "bread","cake","cookie","pumpkin_pie"
]
SOURCES = [f"statistic_craft_block:{block}" for block in BLOCKS]


# Optional: receives the source values in SOURCES order. Defaults to sum when omitted.
def combine(values):
    return sum(values)
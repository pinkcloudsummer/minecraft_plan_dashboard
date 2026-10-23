# Every source must also be listed in Tracked_player_placeholders in plan/config.yml.
# Editing SOURCES re-derives the whole history from the stored snapshots.
NAME = "traveler_total"
LABEL = "🥾 Traveler of Blocks"

SOURCES = [
    "statistic_walk_one_cm",
    "statistic_sprint_one_cm",
    "statistic_swim_one_cm",
]


# Minecraft stores distance in centimetres; 100 cm is one block
COMPONENT_SCALE = 0.01


def combine(values):
    return sum(values) / 100

# Ratio metric: NUMERATOR / DENOMINATOR, each the sum of its listed sources.
# Every source must also be listed in Tracked_player_placeholders in plan/config.yml.
# Server totals are total numerator over total denominator, and the 24h/7d columns are the
# ratio of what was planted and harvested in that window, not a change in the ratio.
NAME = "wheat_plant_ratio"
LABEL = "🌾 Wheat Planted/Harvested"
KIND = "ratio"

NUMERATOR = ["statistic_use_item:wheat_seeds"]
DENOMINATOR = ["statistic_mine_block:wheat"]

import sqlite3

db_path = "/opt/stacks/minecraft/data/plugins/Plan/database.db"
conn = sqlite3.connect(db_path)

query = """
SELECT 
    p.text AS statistic,
    SUM(CAST(v.string_value AS INTEGER)) AS server_total,
    ROUND(AVG(CAST(v.string_value AS INTEGER)), 1) AS player_average,
    COUNT(DISTINCT v.uuid) AS contributing_players
FROM plan_extension_user_values v
JOIN plan_extension_providers p ON p.id = v.provider_id
WHERE v.string_value IS NOT NULL AND v.string_value GLOB '[0-9]*'
GROUP BY p.text
ORDER BY server_total DESC;
"""

print("=" * 72)
print(f"{'SERVER-WIDE PLAYER STATISTICS SUMMARY':^72}")
print("=" * 72)
print(f"{'Statistic Name':<35} | {'Server Total':<12} | {'Avg/Player':<10} | {'Players'}")
print("-" * 72)

for stat, total, avg, count in conn.execute(query).fetchall():
    clean_stat = stat.replace("statistic_mine_block:", "mine: ").replace("statistic_", "")
    print(f"{clean_stat:<35} | {total:<12,} | {avg:<10,} | {count}")

print("=" * 72)
conn.close()
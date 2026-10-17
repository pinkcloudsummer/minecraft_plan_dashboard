import sqlite3
import subprocess

db_path = "/opt/stacks/minecraft/data/plugins/Plan/database.db"
conn = sqlite3.connect(db_path)
cursor = conn.cursor()

# 1. Sum string_value per provider from player metrics
query = """
SELECT provider_id, SUM(CAST(string_value AS INTEGER))
FROM plan_extension_user_values
WHERE string_value IS NOT NULL AND string_value GLOB '[0-9]*'
GROUP BY provider_id;
"""
sums = cursor.execute(query).fetchall()

# 2. Upsert aggregated totals directly into plan_extension_server_values
updated = 0
for provider_id, total in sums:
    existing = cursor.execute(
        "SELECT id FROM plan_extension_server_values WHERE provider_id = ?",
        (provider_id,)
    ).fetchone()

    if existing:
        cursor.execute(
            "UPDATE plan_extension_server_values SET string_value = ? WHERE id = ?",
            (str(total), existing[0])
        )
    else:
        cursor.execute(
            "INSERT INTO plan_extension_server_values (string_value, provider_id) VALUES (?, ?)",
            (str(total), provider_id)
        )
    updated += 1

conn.commit()
conn.close()
print(f"Successfully updated {updated} server-level metrics in database.db.")

# 3. Export updated web views via RCON
subprocess.run(["docker", "exec", "-i", "minecraft-server", "rcon-cli", "plan", "export"], stdout=subprocess.DEVNULL)
print("Plan web export completed.")

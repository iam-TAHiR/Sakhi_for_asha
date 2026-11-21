import sqlite3
from pathlib import Path

db_path = Path(__file__).parent / "asha_data.db"

print("Database path:", db_path)
print("File exists:", db_path.exists())

if db_path.exists():
    conn = sqlite3.connect(str(db_path))

    tables = conn.execute("""
        SELECT name
        FROM sqlite_master
        WHERE type = 'table'
        ORDER BY name
    """).fetchall()

    print("\nTables found:")
    for table in tables:
        print("-", table[0])

    conn.close()
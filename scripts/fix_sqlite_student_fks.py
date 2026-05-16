"""Repair legacy SQLite foreign keys that still point at the old leads table."""

import sqlite3
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DB_PATH = ROOT / "crm.db"


TABLES = {
    "calls": """
        CREATE TABLE calls (
            id INTEGER NOT NULL,
            student_id INTEGER NOT NULL,
            agent_id INTEGER NOT NULL,
            duration_seconds INTEGER,
            recording_path VARCHAR(512),
            transcript TEXT,
            ai_intent VARCHAR(8),
            ai_reasons TEXT,
            ai_summary TEXT,
            ai_confidence FLOAT,
            analyzed_at DATETIME,
            created_at DATETIME NOT NULL,
            PRIMARY KEY (id),
            FOREIGN KEY(student_id) REFERENCES students (id),
            FOREIGN KEY(agent_id) REFERENCES users (id)
        )
    """,
    "notes": """
        CREATE TABLE notes (
            id INTEGER NOT NULL,
            student_id INTEGER NOT NULL,
            agent_id INTEGER NOT NULL,
            content TEXT NOT NULL,
            created_at DATETIME NOT NULL,
            PRIMARY KEY (id),
            FOREIGN KEY(student_id) REFERENCES students (id),
            FOREIGN KEY(agent_id) REFERENCES users (id)
        )
    """,
    "follow_ups": """
        CREATE TABLE follow_ups (
            id INTEGER NOT NULL,
            student_id INTEGER NOT NULL,
            agent_id INTEGER NOT NULL,
            follow_up_date DATETIME NOT NULL,
            is_notified BOOLEAN NOT NULL,
            created_at DATETIME NOT NULL,
            PRIMARY KEY (id),
            FOREIGN KEY(student_id) REFERENCES students (id),
            FOREIGN KEY(agent_id) REFERENCES users (id)
        )
    """,
    "lead_view_logs": """
        CREATE TABLE lead_view_logs (
            id INTEGER NOT NULL,
            student_id INTEGER NOT NULL,
            viewer_id INTEGER NOT NULL,
            viewed_at DATETIME NOT NULL,
            PRIMARY KEY (id),
            FOREIGN KEY(student_id) REFERENCES students (id),
            FOREIGN KEY(viewer_id) REFERENCES users (id)
        )
    """,
    "visits": """
        CREATE TABLE visits (
            id INTEGER NOT NULL,
            student_id INTEGER NOT NULL,
            agent_id INTEGER NOT NULL,
            visit_type VARCHAR(6) NOT NULL,
            scheduled_date DATETIME NOT NULL,
            status VARCHAR(9) NOT NULL,
            notes TEXT,
            created_at DATETIME NOT NULL,
            updated_at DATETIME NOT NULL,
            PRIMARY KEY (id),
            FOREIGN KEY(student_id) REFERENCES students (id),
            FOREIGN KEY(agent_id) REFERENCES users (id)
        )
    """,
}


def table_exists(cur: sqlite3.Cursor, table: str) -> bool:
    row = cur.execute(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?",
        (table,),
    ).fetchone()
    return row is not None


def needs_repair(cur: sqlite3.Cursor, table: str) -> bool:
    return any(row[2] == "leads" for row in cur.execute(f"PRAGMA foreign_key_list({table})"))


def columns(cur: sqlite3.Cursor, table: str) -> list[str]:
    return [row[1] for row in cur.execute(f"PRAGMA table_info({table})")]


def repair_table(cur: sqlite3.Cursor, table: str, create_sql: str) -> None:
    old_columns = columns(cur, table)
    tmp = f"{table}__new"
    cur.execute(f"DROP TABLE IF EXISTS {tmp}")
    cur.execute(create_sql.replace(f"CREATE TABLE {table}", f"CREATE TABLE {tmp}"))
    new_columns = columns(cur, tmp)
    shared = [col for col in old_columns if col in new_columns]
    cols = ", ".join(shared)
    cur.execute(f"INSERT INTO {tmp} ({cols}) SELECT {cols} FROM {table}")
    cur.execute(f"DROP TABLE {table}")
    cur.execute(f"ALTER TABLE {tmp} RENAME TO {table}")


def main() -> None:
    con = sqlite3.connect(DB_PATH)
    try:
      cur = con.cursor()
      cur.execute("PRAGMA foreign_keys=OFF")
      cur.execute("BEGIN")

      repaired = []
      for table, create_sql in TABLES.items():
          if table_exists(cur, table) and needs_repair(cur, table):
              repair_table(cur, table, create_sql)
              repaired.append(table)

      cur.execute("COMMIT")
      cur.execute("PRAGMA foreign_keys=ON")
      problems = cur.execute("PRAGMA foreign_key_check").fetchall()
      if problems:
          raise RuntimeError(f"foreign_key_check failed: {problems}")
      print("repaired:", ", ".join(repaired) if repaired else "none")
    except Exception:
      con.rollback()
      raise
    finally:
      con.close()


if __name__ == "__main__":
    main()

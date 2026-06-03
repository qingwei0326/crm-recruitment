"""一键修复 J1900 数据库迁移问题并启动服务"""
import sqlite3
import os
import re
import subprocess
import sys

ROOT = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(ROOT, "crm.db")
DB_PY = os.path.join(ROOT, "app", "database.py")

# 1. 加载 SECRET_KEY
secret_file = os.path.join(ROOT, ".secret_key")
if os.path.exists(secret_file):
    with open(secret_file, encoding="utf-8") as f:
        os.environ["SECRET_KEY"] = f.read().strip()
    print("[1/4] SECRET_KEY 已加载")
else:
    import secrets
    key = secrets.token_hex(32)
    with open(secret_file, "w", encoding="utf-8") as f:
        f.write(key)
    os.environ["SECRET_KEY"] = key
    print("[1/4] SECRET_KEY 已生成")

# 2. 清理残留表
print("[2/4] 清理残留表...")
conn = sqlite3.connect(DB_PATH)
conn.execute("DROP TABLE IF EXISTS operation_logs_new")
conn.commit()
conn.close()
print("  完成")

# 3. 修复 database.py
print("[3/4] 修复迁移代码...")
with open(DB_PY, encoding="utf-8") as f:
    content = f.read()

OLD = '''        sync_connection.execute(text("""
            CREATE TABLE operation_logs_new (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                operator_id INTEGER,
                operator_name VARCHAR(64) NOT NULL,
                target_student_id INTEGER,
                case_no VARCHAR(36) DEFAULT \'\',
                action VARCHAR(64) NOT NULL,
                details TEXT DEFAULT \'\',
                created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (operator_id) REFERENCES users(id)
            )
        """))

        sync_connection.execute(text(
            "INSERT INTO operation_logs_new SELECT * FROM operation_logs"
        ))'''

NEW = '''        col_names = [col["name"] for col in columns]
        col_defs = []
        for col in columns:
            if col["name"] == "operator_id":
                col_defs.append("operator_id INTEGER")
            else:
                ct = str(col["type"])
                nl = "NOT NULL" if not col.get("nullable", True) else ""
                df = ""
                if col.get("default") is not None:
                    dv = str(col["default"])
                    if "CURRENT_TIMESTAMP" in dv:
                        df = "DEFAULT CURRENT_TIMESTAMP"
                    elif "nextval" in dv:
                        df = ""
                    else:
                        df = "DEFAULT " + dv
                pk = " PRIMARY KEY AUTOINCREMENT" if col.get("primary_key") else ""
                col_defs.append(f"    {col['name']} {ct}{pk} {nl} {df}".strip())

        create_sql = "CREATE TABLE operation_logs_new (\\n" + ",\\n".join(col_defs) + ")"
        sync_connection.execute(text(create_sql))

        cols_str = ", ".join(col_names)
        sync_connection.execute(text(
            f"INSERT INTO operation_logs_new ({cols_str}) SELECT {cols_str} FROM operation_logs"
        ))'''

if "INSERT INTO operation_logs_new SELECT * FROM operation_logs" in content:
    content = content.replace(OLD, NEW)
    with open(DB_PY, "w", encoding="utf-8") as f:
        f.write(content)
    print("  database.py 已修复")
else:
    print("  已是最新版本")

# 4. 迁移数据库
print("[4/4] 迁移数据库...")
sys.path.insert(0, ROOT)
import asyncio
from app.database import init_db
asyncio.run(init_db())
print("  完成")

print()
print("=== 修复完成 ===")
print(f"访问: http://127.0.0.1:8000")
print(f"公网: https://crm.qing-wei.com")
print()
print("启动服务中...")
print()

subprocess.run([
    sys.executable, "-m", "uvicorn", "app.main:app",
    "--host", "127.0.0.1", "--port", "8000"
], cwd=ROOT)

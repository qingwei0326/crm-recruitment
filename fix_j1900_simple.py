"""
J1900 数据库一键修复脚本（纯 Python，无依赖）
修复 500 错误：添加缺失的数据库字段

使用方法：
  python fix_j1900_simple.py
"""
import sqlite3
import os
import sys
from datetime import datetime
from pathlib import Path

def find_project_dir():
    """自动查找项目目录"""
    possible_dirs = [
        r"D:\CRM",
        r"D:\招生系统",
        Path.home() / "招生系统",
        Path("/home/user/招生系统"),
    ]

    for dir_path in possible_dirs:
        dir_path = Path(dir_path)
        if dir_path.exists() and (dir_path / "crm.db").exists():
            return dir_path

    return None

def main():
    print("=" * 50)
    print("J1900 数据库修复脚本")
    print("=" * 50)
    print()

    # 查找项目目录
    project_dir = find_project_dir()
    if not project_dir:
        print("❌ 找不到项目目录或数据库文件")
        print("请在项目目录下运行此脚本，或手动指定：")
        print("  python fix_j1900_simple.py /path/to/project")
        sys.exit(1)

    print(f"项目目录: {project_dir}")

    db_path = project_dir / "crm.db"

    # 备份数据库
    print()
    print("[1/4] 备份数据库...")
    backup_file = project_dir / f"crm.db.backup_{datetime.now().strftime('%Y%m%d_%H%M%S')}"
    import shutil
    shutil.copy2(db_path, backup_file)
    print(f"✓ 备份完成: {backup_file.name}")

    # 连接数据库
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()

    print()
    print("[2/4] 检查字段是否已存在...")

    # 检查 users 表字段
    cursor.execute("PRAGMA table_info(users)")
    user_columns = {row[1] for row in cursor.fetchall()}

    has_token_version = "token_version" in user_columns
    has_login_device = "last_login_device" in user_columns
    has_login_ip = "last_login_ip" in user_columns

    if has_token_version and has_login_device and has_login_ip:
        print("✓ 所有字段已存在，无需迁移")
        conn.close()
        sys.exit(0)

    print()
    print("[3/4] 执行数据库迁移...")

    try:
        # 添加 token_version
        if not has_token_version:
            print("  添加 token_version...")
            cursor.execute("ALTER TABLE users ADD COLUMN token_version INTEGER NOT NULL DEFAULT 1")
            print("  ✓ token_version 已添加")
        else:
            print("  ✓ token_version 已存在")

        # 添加 last_login_device
        if not has_login_device:
            print("  添加 last_login_device...")
            cursor.execute("ALTER TABLE users ADD COLUMN last_login_device VARCHAR(512) DEFAULT '' NOT NULL")
            print("  ✓ last_login_device 已添加")
        else:
            print("  ✓ last_login_device 已存在")

        # 添加 last_login_ip
        if not has_login_ip:
            print("  添加 last_login_ip...")
            cursor.execute("ALTER TABLE users ADD COLUMN last_login_ip VARCHAR(64) DEFAULT '' NOT NULL")
            print("  ✓ last_login_ip 已添加")
        else:
            print("  ✓ last_login_ip 已存在")

        # 修改 operation_logs.operator_id 为 nullable
        print("  修改 operation_logs.operator_id 为 nullable...")

        cursor.execute("""
            CREATE TABLE operation_logs_new (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                operator_id INTEGER,
                operator_name VARCHAR(64) NOT NULL,
                target_student_id INTEGER,
                case_no VARCHAR(36) DEFAULT '',
                action VARCHAR(64) NOT NULL,
                details TEXT DEFAULT '',
                created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (operator_id) REFERENCES users(id)
            )
        """)

        cursor.execute("INSERT INTO operation_logs_new SELECT * FROM operation_logs")
        cursor.execute("DROP TABLE operation_logs")
        cursor.execute("ALTER TABLE operation_logs_new RENAME TO operation_logs")

        cursor.execute("CREATE INDEX IF NOT EXISTS ix_operation_logs_created_at ON operation_logs(created_at)")
        cursor.execute("CREATE INDEX IF NOT EXISTS ix_operation_logs_target_student_id ON operation_logs(target_student_id)")

        print("  ✓ operation_logs 表已更新")

        conn.commit()

    except Exception as e:
        print(f"\n❌ 迁移失败: {e}")
        conn.rollback()
        conn.close()
        print(f"\n可以恢复备份：")
        print(f"  cp {backup_file} {db_path}")
        sys.exit(1)

    print()
    print("[4/4] 验证迁移结果...")
    cursor.execute("PRAGMA table_info(users)")
    for row in cursor.fetchall():
        if row[1] in ["token_version", "last_login_device", "last_login_ip"]:
            print(f"  ✓ {row[1]}: {row[2]}")

    conn.close()

    print()
    print("=" * 50)
    print("✓ 数据库迁移完成！")
    print("=" * 50)
    print()
    print("现在重启服务：")
    print("  ./stop.sh && ./start.sh")
    print()
    print("如果出现问题，可以恢复备份：")
    print(f"  cp {backup_file.name} crm.db")
    print()

if __name__ == "__main__":
    main()

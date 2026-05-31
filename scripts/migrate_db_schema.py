"""
完整的数据库 schema 迁移脚本
修复 J1900 迁移后的 500 错误

包含所有最新的 schema 变更：
- User 表：token_version, last_login_device, last_login_ip
- OperationLog 表：operator_id 改为 nullable
"""
import os
import sys
from pathlib import Path

# 添加项目根目录到 Python 路径
sys.path.insert(0, str(Path(__file__).parent.parent))

# 设置临时 SECRET_KEY 用于迁移
if not os.getenv("SECRET_KEY"):
    os.environ["SECRET_KEY"] = "temp_key_for_migration"

from sqlalchemy import create_engine, text
from app.config import DATABASE_URL_SYNC

def migrate():
    engine = create_engine(DATABASE_URL_SYNC)

    print("=" * 50)
    print("开始数据库 schema 迁移...")
    print("=" * 50)

    with engine.begin() as conn:
        # 1. 检查 users 表字段
        print("\n[1/2] 检查 users 表...")
        result = conn.execute(text("PRAGMA table_info(users)"))
        user_columns = {row[1] for row in result}

        if "token_version" not in user_columns:
            print("  添加 token_version 字段...")
            conn.execute(text(
                "ALTER TABLE users ADD COLUMN token_version INTEGER NOT NULL DEFAULT 1"
            ))
            print("  ✓ token_version 字段已添加")
        else:
            print("  ✓ token_version 字段已存在")

        if "last_login_device" not in user_columns:
            print("  添加 last_login_device 字段...")
            conn.execute(text(
                "ALTER TABLE users ADD COLUMN last_login_device VARCHAR(512) DEFAULT '' NOT NULL"
            ))
            print("  ✓ last_login_device 字段已添加")
        else:
            print("  ✓ last_login_device 字段已存在")

        if "last_login_ip" not in user_columns:
            print("  添加 last_login_ip 字段...")
            conn.execute(text(
                "ALTER TABLE users ADD COLUMN last_login_ip VARCHAR(64) DEFAULT '' NOT NULL"
            ))
            print("  ✓ last_login_ip 字段已添加")
        else:
            print("  ✓ last_login_ip 字段已存在")

        # 2. 修改 operation_logs 表的 operator_id 为 nullable
        print("\n[2/2] 检查 operation_logs 表...")
        result = conn.execute(text("PRAGMA table_info(operation_logs)"))
        op_log_columns = {row[1]: row for row in result}

        if "operator_id" in op_log_columns:
            # 检查 operator_id 是否为 NOT NULL
            operator_id_info = op_log_columns["operator_id"]
            is_nullable = operator_id_info[3] == 0  # notnull 字段

            if not is_nullable:
                print("  修改 operator_id 为 nullable...")
                # SQLite 不支持直接 ALTER COLUMN，需要重建表
                conn.execute(text("""
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
                """))

                # 复制数据
                conn.execute(text("""
                    INSERT INTO operation_logs_new
                    SELECT * FROM operation_logs
                """))

                # 删除旧表，重命名新表
                conn.execute(text("DROP TABLE operation_logs"))
                conn.execute(text("ALTER TABLE operation_logs_new RENAME TO operation_logs"))

                # 重建索引
                conn.execute(text(
                    "CREATE INDEX IF NOT EXISTS ix_operation_logs_created_at ON operation_logs(created_at)"
                ))
                conn.execute(text(
                    "CREATE INDEX IF NOT EXISTS ix_operation_logs_target_student_id ON operation_logs(target_student_id)"
                ))

                print("  ✓ operator_id 已改为 nullable")
            else:
                print("  ✓ operator_id 已经是 nullable")
        else:
            print("  ⚠ operation_logs 表不存在 operator_id 字段")

    print("\n" + "=" * 50)
    print("数据库迁移完成！")
    print("=" * 50)
    print("\n现在可以重启服务：")
    print("  ./stop.sh && ./start.sh")
    print()

if __name__ == "__main__":
    try:
        migrate()
    except Exception as e:
        print(f"\n❌ 迁移失败: {e}")
        sys.exit(1)

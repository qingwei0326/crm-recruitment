"""一次性迁移脚本：将 SQLite 数据导入 PostgreSQL

用法:
    1. 确保 PostgreSQL 已启动且 DATABASE_URL 已设置
    2. python migrate_sqlite_to_pg.py --sqlite-path crm.db

迁移过程:
    1. 在 PostgreSQL 中建表（create_all）
    2. 从 SQLite 读取所有表数据
    3. 批量插入 PostgreSQL（跳过自增 ID，由序列生成）
    4. 重置 PostgreSQL 自增序列到最大值
    5. 验证各表行数一致
"""
import argparse
import asyncio
import os
import sys
from urllib.parse import urlparse

import sqlite3

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

# 确保 app 包可导入
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from app.database import Base, async_session, engine
from app.models import *  # noqa: F403 — 确保所有模型注册到 Base.metadata


# 需要迁移的表名（按依赖顺序，先父表后子表）
TABLES = [
    "users",
    "students",
    "calls",
    "notes",
    "follow_ups",
    "lead_view_logs",
    "visits",
    "operation_logs",
    "system_configs",
    "login_attempts",
    "dial_logs",
]


def read_sqlite_table(sqlite_path: str, table_name: str) -> tuple[list[str], list[tuple]]:
    """从 SQLite 读取指定表的列名和数据行。"""
    conn = sqlite3.connect(sqlite_path)
    conn.row_factory = sqlite3.Row
    try:
        cursor = conn.execute(f"SELECT * FROM {table_name}")
        rows = cursor.fetchall()
        if not rows:
            return [], []
        columns = list(rows[0].keys())
        data = [tuple(row[col] for col in columns) for row in rows]
        return columns, data
    except sqlite3.OperationalError:
        return [], []
    finally:
        conn.close()


async def insert_batch(session: AsyncSession, table_name: str, columns: list[str], data: list[tuple]):
    """批量插入数据到 PostgreSQL。"""
    if not data:
        return 0

    # 构建 INSERT 语句（不含 ID，让 PostgreSQL 自增序列生成）
    # 对于 system_configs 表（主键是 key），需要包含所有列
    if table_name == "system_configs":
        col_str = ", ".join(columns)
        placeholders = ", ".join(f":{col}" for col in columns)
        sql = f"INSERT INTO {table_name} ({col_str}) VALUES ({placeholders})"
    else:
        # 其他表：排除 id 列，让序列自动生成
        insert_cols = [c for c in columns if c != "id"]
        col_str = ", ".join(insert_cols)
        placeholders = ", ".join(f":{col}" for col in insert_cols)
        sql = f"INSERT INTO {table_name} ({col_str}) VALUES ({placeholders})"

    # 分批插入，每批 500 行
    batch_size = 500
    total = 0
    for i in range(0, len(data), batch_size):
        batch = data[i : i + batch_size]
        for row in batch:
            row_dict = dict(zip(columns, row))
            # 将 None 的 bytes 转换为 None
            for k, v in row_dict.items():
                if isinstance(v, bytes):
                    row_dict[k] = None
            await session.execute(text(sql), row_dict)
        total += len(batch)
        print(f"  [{table_name}] 已插入 {total}/{len(data)} 行")

    await session.commit()
    return total


async def reset_sequence(session: AsyncSession, table_name: str):
    """重置 PostgreSQL 自增序列为当前最大 ID + 1。"""
    if table_name == "system_configs":
        return  # system_configs 使用 text 主键，无序列
    try:
        result = await session.execute(text(f"SELECT MAX(id) FROM {table_name}"))
        max_id = result.scalar()
        if max_id is not None:
            seq_name = f"{table_name}_id_seq"
            await session.execute(text(f"ALTER SEQUENCE {seq_name} RESTART WITH {max_id + 1}"))
            await session.commit()
            print(f"  [{table_name}] 序列重置为 {max_id + 1}")
    except Exception as e:
        print(f"  [{table_name}] 序列重置跳过: {e}")


async def verify_counts(sqlite_path: str, pg_session: AsyncSession):
    """验证 SQLite 和 PostgreSQL 各表行数是否一致。"""
    print("\n=== 验证行数 ===")
    sqlite_conn = sqlite3.connect(sqlite_path)
    all_ok = True

    for table in TABLES:
        # SQLite 行数
        try:
            sqlite_count = sqlite_conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
        except sqlite3.OperationalError:
            sqlite_count = 0

        # PostgreSQL 行数
        result = await pg_session.execute(text(f"SELECT COUNT(*) FROM {table}"))
        pg_count = result.scalar() or 0

        status = "✓" if sqlite_count == pg_count else "✗"
        if sqlite_count != pg_count:
            all_ok = False
        print(f"  {status} {table}: SQLite={sqlite_count}, PostgreSQL={pg_count}")

    sqlite_conn.close()
    return all_ok


async def migrate(sqlite_path: str):
    """主迁移流程。"""
    if not os.path.isfile(sqlite_path):
        print(f"错误: SQLite 文件不存在: {sqlite_path}")
        sys.exit(1)

    print(f"=== SQLite → PostgreSQL 迁移 ===")
    print(f"源: {sqlite_path}")

    # 1. 在 PostgreSQL 中建表
    print("\n[1/4] 在 PostgreSQL 中建表...")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    print("  建表完成")

    # 2. 逐表迁移数据
    print("\n[2/4] 迁移数据...")
    async with async_session() as session:
        for table in TABLES:
            columns, data = read_sqlite_table(sqlite_path, table)
            if not data:
                print(f"  [{table}] 跳过（空表或不存在）")
                continue
            await insert_batch(session, table, columns, data)
            print(f"  [{table}] 完成: {len(data)} 行")

    # 3. 重置序列
    print("\n[3/4] 重置自增序列...")
    async with async_session() as session:
        for table in TABLES:
            await reset_sequence(session, table)

    # 4. 验证
    print("\n[4/4] 验证数据...")
    async with async_session() as session:
        ok = await verify_counts(sqlite_path, session)

    if ok:
        print("\n✅ 迁移完成！所有表行数一致。")
    else:
        print("\n⚠️  部分表行数不一致，请手动检查。")


def main():
    parser = argparse.ArgumentParser(description="将 SQLite 数据迁移到 PostgreSQL")
    parser.add_argument(
        "--sqlite-path",
        default="crm.db",
        help="SQLite 数据库文件路径（默认: crm.db）",
    )
    args = parser.parse_args()

    # 检查 DATABASE_URL 是否已设置
    if not os.getenv("DATABASE_URL"):
        print("错误: 请先设置 DATABASE_URL 环境变量")
        print("例如: export DATABASE_URL='postgresql+asyncpg://user:pass@localhost:5432/crm_recruitment'")
        sys.exit(1)

    asyncio.run(migrate(args.sqlite_path))


if __name__ == "__main__":
    main()

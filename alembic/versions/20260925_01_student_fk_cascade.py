"""student 关联外键补 ON DELETE CASCADE

实测 P0-2 根因：删除学生时，应用层已级联清理关联行，但数据库外键未设 ON DELETE CASCADE，
一旦任何代码路径直接 DELETE 学生行（或 ORM 行为变化），SQLite 会因外键约束报错。
本迁移为所有指向 students 的外键补 ON DELETE CASCADE，做到「库级自愈」，与应用层 delete_students_cascade 双保险。

实现要点（SQLite 不支持 ALTER FK，必须重建表）：
- 动态找出所有引用 students 的表（含遗留 tasks/today_tasks/personal_group_memberships）；
- 用正则在原 CREATE TABLE DDL 的 REFERENCES students (id) 后追加 ON DELETE CASCADE，
  其余 DDL（列、约束、CHECK、自增等）原样保留，避免漂移；
- 重建表并拷贝数据，并重建原表上的用户索引（autoindex/主键索引随表重建自动保留）；
- 不依赖外键约束名（SQLite 外键默认无名），因此对无名约束同样生效。
"""

from collections.abc import Sequence

import re

import sqlalchemy as sa
from alembic import op
from sqlalchemy import text

revision: str = "20260925_01"
down_revision: str | Sequence[str] | None = "20260823_01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | None = None

# 匹配 REFERENCES students (id)（容忍表名/列名引号与空格），且不重复追加 ON DELETE
FK_ADD_RE = re.compile(
    r"(REFERENCES\s+[\"']?students[\"']?\s*\(\s*[\"']?id[\"']?\s*\))"
    r"(?!\s+ON\s+DELETE)",
    re.IGNORECASE,
)
FK_DROP_RE = re.compile(
    r"(REFERENCES\s+[\"']?students[\"']?\s*\(\s*[\"']?id[\"']?\s*\))"
    r"\s+ON\s+DELETE\s+CASCADE",
    re.IGNORECASE,
)


def _swap_table_in_ddl(ddl: str, old: str, new: str) -> str:
    out = ddl.replace(f'CREATE TABLE "{old}"', f'CREATE TABLE "{new}"')
    if out == ddl:
        out = ddl.replace(f"CREATE TABLE {old}", f"CREATE TABLE {new}")
    return out


def _swap_table_in_index(idx_sql: str, old: str, new: str) -> str:
    return re.sub(
        r"ON\s+[\"']?{0}[\"']?\s*\(".format(re.escape(old)),
        f'ON "{new}" (',
        idx_sql,
        flags=re.IGNORECASE,
    )


def _rebuild_table(conn, table: str, *, add: bool) -> None:
    ddl = conn.execute(
        text("SELECT sql FROM sqlite_master WHERE type='table' AND name=:t"),
        {"t": table},
    ).scalar()
    if not ddl:
        return
    new_ddl = (FK_ADD_RE if add else FK_DROP_RE).sub(
        (r"\1 ON DELETE CASCADE" if add else r"\1"), ddl
    )
    if new_ddl == ddl:
        return  # 无需变更（如已带/已无 ON DELETE CASCADE）

    tmp = f"{table}__cascade_tmp"
    tmp_ddl = _swap_table_in_ddl(new_ddl, table, tmp)

    # 0) 先采集原表用户索引定义（origin=='c'），随后重建时需复用原名以保 alembic check 无漂移
    user_index_sql = []
    for r in conn.execute(text(f"PRAGMA index_list('{table}')")).fetchall():
        if r[3] != "c":  # 仅处理用户显式创建的索引；主键/唯一约束索引随表重建自动保留
            continue
        idx_sql = conn.execute(
            text("SELECT sql FROM sqlite_master WHERE type='index' AND name=:n"),
            {"n": r[1]},
        ).scalar()
        if idx_sql:
            user_index_sql.append(idx_sql)

    # 1) 创建新表（已带/去除 ON DELETE CASCADE）
    conn.execute(text(tmp_ddl))
    # 2) 拷贝数据（列序与原表一致）
    conn.execute(text(f'INSERT INTO "{tmp}" SELECT * FROM "{table}"'))

    # 3) 丢弃原表的用户索引，释放同名
    for idx_sql in user_index_sql:
        m = re.search(
            r"CREATE\s+(UNIQUE\s+)?INDEX\s+([^\s(]+)", idx_sql, re.IGNORECASE
        )
        name = m.group(2).strip('"').strip("'") if m else None
        if name:
            conn.execute(text(f'DROP INDEX IF EXISTS "{name}"'))

    # 4) 在新表上以原名重建用户索引
    for idx_sql in user_index_sql:
        conn.execute(text(_swap_table_in_index(idx_sql, table, tmp)))

    # 5) 替换旧表
    conn.execute(text(f'DROP TABLE "{table}"'))
    conn.execute(text(f'ALTER TABLE "{tmp}" RENAME TO "{table}"'))


def _target_tables(conn) -> list[str]:
    tables = [
        r[0]
        for r in conn.execute(
            text("SELECT name FROM sqlite_master WHERE type='table'")
        ).fetchall()
    ]
    out = []
    for t in tables:
        fks = conn.execute(text(f"PRAGMA foreign_key_list('{t}')")).fetchall()
        if any(fk[2] == "students" for fk in fks):
            out.append(t)
    return out


def upgrade() -> None:
    conn = op.get_bind()
    for t in _target_tables(conn):
        _rebuild_table(conn, t, add=True)


def downgrade() -> None:
    conn = op.get_bind()
    for t in _target_tables(conn):
        _rebuild_table(conn, t, add=False)

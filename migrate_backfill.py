"""按校名回填学生 region 字段的一次性脚本。

用法：放在招生系统项目根目录（与 crm.db、app/ 同级）运行：

    python migrate_backfill.py

做三件事：
1. 备份 crm.db 到 backups/
2. 对所有 region 为空、school_name 非空 的学生，按 app.region_extractor.extract_region 提取 region
3. 把仅匹配到「漳州市/漳州」前缀的学校，按 app.region_extractor.subdivide_zz 细分到 芗城区 / 龙文区 / 常山开发区

只动 region 字段，不会动 assigned_to / status / 任何业务字段。
"""

import datetime
import os
import shutil
import sqlite3
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from app.region_extractor import extract_region, subdivide_zz


def main():
    db_path = 'crm.db'
    if not os.path.exists(db_path):
        print(f'错误：找不到 {db_path}，请在项目根目录运行此脚本')
        return 1

    ts = datetime.datetime.now().strftime('%Y%m%d-%H%M%S')
    backup_dir = 'backups'
    os.makedirs(backup_dir, exist_ok=True)
    backup_path = os.path.join(backup_dir, f'crm.db.before-region-migrate.{ts}')
    shutil.copy(db_path, backup_path)
    print(f'已备份：{backup_path}')

    conn = sqlite3.connect(db_path)
    c = conn.cursor()

    print('建临时索引以加速 UPDATE...')
    c.execute("CREATE INDEX IF NOT EXISTS ix_students_school_name ON students(school_name)")
    c.execute("CREATE INDEX IF NOT EXISTS ix_students_region ON students(region)")
    conn.commit()

    c.execute("SELECT DISTINCT school_name FROM students WHERE school_name != ''")
    schools = [r[0] for r in c.fetchall()]
    print(f'\n阶段1：按校名提取 region —— 共 {len(schools)} 个不同学校')

    stage1_count = 0
    unmapped = []
    for i, s in enumerate(schools, 1):
        r = extract_region(s)
        if not r:
            unmapped.append(s)
            continue
        c.execute(
            "UPDATE students SET region = ? WHERE school_name = ? AND (region IS NULL OR region = '')",
            (r, s),
        )
        stage1_count += c.rowcount
        if i % 50 == 0:
            print(f'  进度 {i}/{len(schools)}（已回填 {stage1_count} 条）')
    conn.commit()
    print(f'  回填 {stage1_count} 条')
    if unmapped:
        print(f'  无法识别的学校（{len(unmapped)} 个）：')
        for s in unmapped[:20]:
            print(f'    - {s}')

    c.execute("SELECT DISTINCT school_name FROM students WHERE region IN ('漳州市', '漳州')")
    zz_schools = [r[0] for r in c.fetchall()]
    print(f'\n阶段2：细分"漳州市"桶 —— 涉及 {len(zz_schools)} 个学校')
    stage2_count = 0
    stage2_dist = {}
    for s in zz_schools:
        target = subdivide_zz(s)
        c.execute(
            "UPDATE students SET region = ? WHERE school_name = ? AND region IN ('漳州市', '漳州')",
            (target, s),
        )
        n = c.rowcount
        stage2_count += n
        stage2_dist[target] = stage2_dist.get(target, 0) + n
    conn.commit()
    print(f'  改动 {stage2_count} 条')
    for r, n in sorted(stage2_dist.items(), key=lambda x: -x[1]):
        print(f'    {n:>5}人 → {r}')

    print('\n=== 当前未分配学生的区县分布 ===')
    c.execute(
        "SELECT region, COUNT(*) FROM students "
        "WHERE school_name != '' AND assigned_to IS NULL AND region != '' "
        "GROUP BY region ORDER BY 2 DESC"
    )
    for r, n in c.fetchall():
        print(f'  {n:>6}人 | {r}')

    c.execute(
        "SELECT COUNT(*) FROM students "
        "WHERE school_name != '' AND assigned_to IS NULL AND (region IS NULL OR region = '')"
    )
    remaining = c.fetchone()[0]
    print(f'\nregion 仍为空的未分配学生：{remaining}')

    conn.close()
    return 0


if __name__ == '__main__':
    sys.exit(main())

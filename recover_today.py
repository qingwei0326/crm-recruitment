# -*- coding: utf-8 -*-
"""
一次性恢复脚本：把「今天(CST)拨过号、但因旧 bug 仍停在"未联系"的学生」补标为"已联系"。

依据 dial_logs —— 每次取号后端都会记一行(谁/给谁/几点)，与前端 bug 无关，
所以话务员今天拨过谁，库里都有；有没有写备注都不影响识别。

用法(放在 D:\\CRM 下，无需 cd)：
    & "D:\\CRM\\.venv-win\\Scripts\\python.exe" "D:\\CRM\\recover_today.py"
会先把今天拨过的人全列出来(含备注情况)，确认后输入 y 才改库。
只把"未联系"改成"已联系"，绝不动其它状态。
"""
import os
import sys
import sqlite3
import datetime as dt

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

DB = os.path.join(os.path.dirname(os.path.abspath(__file__)), "crm.db")
CST = dt.timezone(dt.timedelta(hours=8))

STATUS_CN = {
    "not_contacted": "未联系", "contacted": "已联系", "pending_visit": "待回访",
    "completed": "已完成", "invalid": "无效", "enrolled": "已报名",
    "rejected": "拒绝接听", "expired": "已过期",
}


def to_cst(s):
    try:
        return (dt.datetime.strptime(s[:19], "%Y-%m-%d %H:%M:%S")
                .replace(tzinfo=dt.timezone.utc).astimezone(CST).strftime("%H:%M"))
    except Exception:
        return s or "?"


now_cst = dt.datetime.now(CST)
midnight = now_cst.replace(hour=0, minute=0, second=0, microsecond=0)
cutoff = midnight.astimezone(dt.timezone.utc).replace(tzinfo=None).strftime("%Y-%m-%d %H:%M:%S")

if not os.path.exists(DB):
    print("找不到数据库：%s\n请把本脚本放到 D:\\CRM 目录下再运行。" % DB)
    sys.exit(1)

con = sqlite3.connect(DB)
con.row_factory = sqlite3.Row
rows = con.execute(
    """
    SELECT d.student_id AS sid, s.name AS sname, s.status AS status,
           u.name AS agent, COUNT(d.id) AS dials, MAX(d.dialed_at) AS last_dial,
           (SELECT COUNT(*) FROM notes n
              WHERE n.student_id = d.student_id AND n.created_at >= ?) AS notes_today
    FROM dial_logs d
    JOIN students s ON s.id = d.student_id
    LEFT JOIN users u ON u.id = d.agent_id
    WHERE d.dialed_at >= ?
    GROUP BY d.student_id
    ORDER BY agent, last_dial
    """,
    (cutoff, cutoff),
).fetchall()

print("\n今天（CST %s）有拨号记录的学生：%d 人\n%s" % (midnight.strftime("%Y-%m-%d"), len(rows), "-" * 64))
for r in rows:
    cur = STATUS_CN.get(r["status"], r["status"])
    note = ("备注%d条" % r["notes_today"]) if r["notes_today"] else "无备注"
    mark = "  ← 待补已联系" if r["status"] == "not_contacted" else ""
    print("[%s] %s  拨%d次 末%s  %s  现:%s%s"
          % (r["agent"] or "?", r["sname"], r["dials"], to_cst(r["last_dial"]), note, cur, mark))

todo = [r for r in rows if r["status"] == "not_contacted"]
with_note = sum(1 for r in todo if r["notes_today"])
print("-" * 64)
print("其中仍是「未联系」、需补成「已联系」的：%d 人（有备注 %d / 无备注 %d）"
      % (len(todo), with_note, len(todo) - with_note))

if not todo:
    print("没有需要补的，收工。")
    sys.exit(0)

ans = input("\n确认把这 %d 人全部标记为「已联系」？输入 y 回车确认，其它键取消：" % len(todo)).strip().lower()
if ans != "y":
    print("已取消，数据库未改动。")
    sys.exit(0)

stamp = dt.datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S")
con.executemany(
    "UPDATE students SET status='contacted', updated_at=? WHERE id=? AND status='not_contacted'",
    [(stamp, r["sid"]) for r in todo],
)
con.commit()
print("✓ 完成，已把 %d 人补标为「已联系」。刷新页面即可看到。" % con.total_changes)

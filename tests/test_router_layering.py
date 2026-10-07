"""Architecture ratchet: routers must not grow new direct database access.

Routers are meant to be thin: parse the request, call a service in app/services,
shape the response. Historically they ran SQL themselves; the B-2 refactor moved
the worst offenders out. This test counts direct session calls (``db.execute``,
``db.add``, ``db.commit`` ...) and SQL builders (``select(...)``) per router
module and pins the current counts, so the number can only go down.

- A count above its baseline fails: put the new query in a service instead.
- A count below its baseline also fails, with the new number to write down, so
  every reduction is locked in. A module absent from the table must stay at 0.
"""

import ast
from pathlib import Path

ROUTERS_DIR = Path(__file__).resolve().parent.parent / "app" / "routers"

DB_METHODS = {
    "execute",
    "scalar",
    "scalars",
    "get",
    "add",
    "add_all",
    "delete",
    "flush",
    "commit",
    "refresh",
    "merge",
    "rollback",
}
SQL_BUILDERS = {"select", "update", "insert", "delete"}

# Router module -> number of direct DB access calls. Only ever lower these numbers.
BASELINE = {
    "admin.py": 12,
    "admin_assignment.py": 20,
    "admin_assistant.py": 5,
    "admin_config.py": 11,
    "admin_daily.py": 2,
    "admin_handover.py": 33,
    "admin_invalid.py": 6,
    "admin_misc.py": 12,
    "admin_season_archive.py": 6,
    "admin_smart_assignment.py": 3,
    "admin_stale.py": 20,
    "admissions.py": 13,
    "admissions_campus_visits.py": 15,
    "admissions_enrollments.py": 15,
    "admissions_home_visits.py": 13,
    "admissions_work_items.py": 14,
    "auth.py": 18,
    "calls.py": 13,
    "follow_ups.py": 21,
    "lead_outcomes.py": 2,
    "notes.py": 18,
    "operation_logs.py": 22,
    "personal_groups.py": 48,
    "stats.py": 6,
    "stats_agents.py": 16,
    "stats_dashboard.py": 70,
    "stats_enrollment.py": 72,
    "students.py": 16,
    "students_assignment.py": 21,
    "students_enrollment.py": 11,
    "students_import.py": 11,
    "students_phone.py": 14,
    "students_query.py": 41,
    "visits.py": 27,
}


def count_direct_db_access(path: Path) -> int:
    total = 0
    for node in ast.walk(ast.parse(path.read_text(encoding="utf-8"))):
        if not isinstance(node, ast.Call):
            continue
        func = node.func
        if (
            isinstance(func, ast.Attribute)
            and isinstance(func.value, ast.Name)
            and func.value.id == "db"
            and func.attr in DB_METHODS
        ):
            total += 1
        elif isinstance(func, ast.Name) and func.id in SQL_BUILDERS:
            total += 1
    return total


def test_routers_do_not_add_direct_database_access():
    actual = {path.name: count_direct_db_access(path) for path in sorted(ROUTERS_DIR.glob("*.py"))}
    problems = []
    for name, count in actual.items():
        allowed = BASELINE.get(name, 0)
        if count > allowed:
            problems.append(
                f"{name}: {count} direct DB calls (baseline {allowed}) - "
                "move the new query into app/services"
            )
        elif count < allowed:
            problems.append(
                f"{name}: improved to {count} (baseline {allowed}) - "
                f"lower BASELINE[{name!r}] to {count} to lock it in"
            )
    for name in BASELINE.keys() - actual.keys():
        problems.append(f"{name}: listed in BASELINE but the router no longer exists - remove it")
    assert not problems, "\n".join(problems)

"""Shared task-count semantics for agent work queues.

A "task" is an active student workflow item, not every assigned lead.
Keep this contract in one place so admin, agent, and mobile endpoints do not
silently drift into different counting rules.
"""

from collections.abc import Iterable, Mapping

from app.models import StudentStatus
from app.status_policy import canonical_student_status, statuses_for_canonical

# 当前工作任务：话务员还需要继续处理的学生。包含旧状态，避免历史数据消失。
ACTIVE_TASK_STATUSES = statuses_for_canonical(
    StudentStatus.not_contacted,
    StudentStatus.contacted,
    StudentStatus.not_reached,
    StudentStatus.pending_visit,
)

# 任务池内的细分口径。
PENDING_TASK_STATUSES = (StudentStatus.not_contacted,)
DONE_TASK_STATUSES = (StudentStatus.contacted,)
FOLLOW_UP_TASK_STATUSES = (StudentStatus.not_reached, StudentStatus.pending_visit)

# 话务员端主任务列表只展示当前真正需要拨打的未联系学生。
AGENT_TODAY_TASK_STATUSES = statuses_for_canonical(StudentStatus.not_contacted)

# 话务员端待办列表展示已接通待确认，以及未接后需要再处理的学生。
AGENT_HANDLED_TASK_STATUSES = statuses_for_canonical(
    StudentStatus.contacted,
    StudentStatus.not_reached,
)

TERMINAL_STUDENT_STATUSES = statuses_for_canonical(
    StudentStatus.enrolled,
    StudentStatus.invalid,
)


def build_task_stats(
    counts: Mapping[StudentStatus, int],
    total_statuses: Iterable[StudentStatus] = ACTIVE_TASK_STATUSES,
) -> dict:
    """Return the shared task stats payload from status-count rows."""
    canonical_counts = _canonicalize_counts(counts)
    total = _sum_counts(canonical_counts, total_statuses)
    done = _sum_counts(canonical_counts, DONE_TASK_STATUSES)
    pending = _sum_counts(canonical_counts, PENDING_TASK_STATUSES)
    follow_up = _sum_counts(canonical_counts, FOLLOW_UP_TASK_STATUSES)
    return {
        "total": total,
        "done": done,
        "pending": pending,
        "follow_up": follow_up,
        "progress_pct": round((done + follow_up) / total * 100, 1) if total > 0 else 0,
    }


def _sum_counts(counts: Mapping[StudentStatus, int], statuses: Iterable[StudentStatus]) -> int:
    canonical_statuses = {
        canonical
        for status in statuses
        if (canonical := canonical_student_status(status)) is not None
    }
    return sum(int(counts.get(status, 0) or 0) for status in canonical_statuses)


def _canonicalize_counts(counts: Mapping[StudentStatus, int]) -> dict[StudentStatus, int]:
    result: dict[StudentStatus, int] = {}
    for status, count in counts.items():
        canonical = canonical_student_status(status)
        if canonical is None:
            continue
        result[canonical] = result.get(canonical, 0) + int(count or 0)
    return result


def is_terminal_status(status: StudentStatus | str | None) -> bool:
    """Return True when a student status should not be reopened by follow-up sync."""
    if status is None:
        return False
    canonical = canonical_student_status(status)
    return canonical in TERMINAL_STUDENT_STATUSES

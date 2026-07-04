from datetime import UTC, date, datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import case, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import (
    ADMIN_OP_ASSIGNMENT_ROLLBACK,
    ADMIN_PAGE_AUDIT_LOGS,
    ADMIN_PAGE_REPORT_CENTER,
    get_current_user,
    require_page_permission,
    user_has_operation_permission,
)
from app.database import get_db
from app.models import DialLog, OperationLog, Student, User
from app.permissions import get_accessible_student
from app.schemas import Response

router = APIRouter(prefix="/api/operation-logs", tags=["操作日志"])
_CST = timezone(timedelta(hours=8))

ACTION_CATEGORY = {
    "登录": "登录安全",
    "修改密码": "登录安全",
    "查看电话": "隐私访问",
    "查看明文电话": "隐私访问",
    "手动分配": "分配",
    "批量分配": "分配",
    "自动分配": "分配",
    "自动分配汇总": "分配",
    "区域分配": "分配",
    "区域分配汇总": "分配",
    "学校分配": "分配",
    "学校分配汇总": "分配",
    "多学校分发": "分配",
    "多学校分发汇总": "分配",
    "分配回滚": "分配",
    "分配回滚汇总": "分配",
    "线索回收": "线索治理",
    "回收无效线索": "线索治理",
    "分学校回收": "线索治理",
    "治理复核": "线索治理",
    "修改状态": "状态变更",
    "修改报名后状态": "状态变更",
    "手动评级": "状态变更",
    "AI分析": "状态变更",
    "标记协助": "状态变更",
    "取消协助": "状态变更",
    "修改信息": "状态变更",
    "写备注": "跟进记录",
    "修改备注": "跟进记录",
    "删除备注": "跟进记录",
    "报名登记": "报名",
    "Excel导入": "导入",
    "南海中学重新导入": "导入",
    "删除线索": "删除",
    "批量删除无效线索": "删除",
    "数据清理": "删除",
    "数据清理汇总": "数据维护",
    "数据修复": "数据维护",
    "数据还原": "数据维护",
    "手动备份": "数据维护",
    "前端错误": "系统异常",
    "修改系统配置": "系统配置",
    "删除用户": "用户管理",
    "离职用户": "用户管理",
    "创建用户": "用户管理",
    "修改用户": "用户管理",
    "重置密码": "用户管理",
    "解锁用户": "用户管理",
}

ASSIGNMENT_ROLLBACK_BATCH_ACTIONS = {
    "批量分配",
    "自动分配汇总",
    "区域分配汇总",
    "学校分配汇总",
    "多学校分发汇总",
}


def _category_for_action(action: str) -> str:
    return ACTION_CATEGORY.get(action or "", "其他")


def _actions_for_category(category: str) -> list[str]:
    return [action for action, cat in ACTION_CATEGORY.items() if cat == category]


def _parse_agent_ids(value: str) -> list[int]:
    ids = []
    for part in value.split(","):
        part = part.strip()
        if not part:
            continue
        try:
            ids.append(int(part))
        except ValueError:
            raise HTTPException(status_code=422, detail="agent_ids 必须是逗号分隔的数字")
    return ids


def _date_start_cst_as_utc(value: str) -> datetime:
    try:
        day = date.fromisoformat(value)
    except ValueError:
        raise HTTPException(status_code=422, detail="日期格式应为 YYYY-MM-DD")
    return datetime(day.year, day.month, day.day, tzinfo=_CST).astimezone(UTC).replace(tzinfo=None)


@router.get("")
async def list_operation_logs(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_page_permission(ADMIN_PAGE_AUDIT_LOGS)),
    start_date: str = Query(default=None),
    end_date: str = Query(default=None),
    operator_id: int | None = Query(default=None),
    action: str = Query(default=""),
    category: str = Query(default=""),
    batch_id: str = Query(default=""),
    q: str = Query(default=""),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
):
    """管理员操作记录总览：按北京时间日期、操作人、动作和关键字筛选。"""
    conditions = []
    category_conditions = []
    if start_date:
        condition = OperationLog.created_at >= _date_start_cst_as_utc(start_date)
        conditions.append(condition)
        category_conditions.append(condition)
    if end_date:
        condition = OperationLog.created_at < _date_start_cst_as_utc(end_date) + timedelta(days=1)
        conditions.append(condition)
        category_conditions.append(condition)
    if operator_id is not None:
        condition = OperationLog.operator_id == operator_id
        conditions.append(condition)
        category_conditions.append(condition)
    if action.strip():
        condition = OperationLog.action == action.strip()
        conditions.append(condition)
        category_conditions.append(condition)
    if batch_id.strip():
        condition = OperationLog.batch_id == batch_id.strip()
        conditions.append(condition)
        category_conditions.append(condition)
    if category.strip():
        category_value = category.strip()
        if category_value == "其他":
            mapped_actions = list(ACTION_CATEGORY.keys())
            conditions.append(
                or_(
                    OperationLog.action.is_(None),
                    OperationLog.action == "",
                    OperationLog.action.notin_(mapped_actions),
                )
            )
        else:
            actions_for_category = _actions_for_category(category_value)
            if actions_for_category:
                conditions.append(OperationLog.action.in_(actions_for_category))
            else:
                conditions.append(OperationLog.action == "__no_such_action__")
    if q.strip():
        keyword = f"%{q.strip()}%"
        condition = (
            OperationLog.content.like(keyword)
            | OperationLog.operator_name.like(keyword)
            | OperationLog.action.like(keyword)
            | OperationLog.batch_id.like(keyword)
            | OperationLog.case_no.like(keyword)
            | Student.name.like(keyword)
            | Student.school_name.like(keyword)
        )
        conditions.append(condition)
        category_conditions.append(condition)

    base_query = select(
        OperationLog,
        Student.name.label("student_name"),
        Student.school_name.label("student_school_name"),
    ).outerjoin(Student, Student.id == OperationLog.target_student_id)
    if conditions:
        base_query = base_query.where(*conditions)

    total = (await db.execute(select(func.count()).select_from(base_query.subquery()))).scalar()

    category_query = (
        select(OperationLog.action, func.count(OperationLog.id))
        .select_from(OperationLog)
        .outerjoin(Student, Student.id == OperationLog.target_student_id)
    )
    if category_conditions:
        category_query = category_query.where(*category_conditions)
    action_rows = await db.execute(
        category_query.group_by(OperationLog.action).order_by(
            func.count(OperationLog.id).desc(), OperationLog.action.asc()
        )
    )
    action_items = action_rows.all()
    actions = [{"action": action, "count": count} for action, count in action_items]
    category_counts: dict[str, int] = {}
    for action_name, count in action_items:
        cat = _category_for_action(action_name)
        category_counts[cat] = category_counts.get(cat, 0) + int(count or 0)
    categories = [
        {"category": cat, "count": count}
        for cat, count in sorted(category_counts.items(), key=lambda item: (-item[1], item[0]))
    ]

    rows_result = await db.execute(
        base_query.order_by(OperationLog.created_at.desc(), OperationLog.id.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    )
    rows = rows_result.all()

    data = []
    for idx, (log, student_name, student_school_name) in enumerate(rows):
        data.append(
            {
                "seq": (page - 1) * page_size + idx + 1,
                "id": log.id,
                "operator_id": log.operator_id,
                "operator_name": log.operator_name,
                "target_student_id": log.target_student_id,
                "student_id": log.target_student_id,
                "student_name": student_name or "",
                "student_school_name": student_school_name or "",
                "case_no": log.case_no or "",
                "action": log.action,
                "category": _category_for_action(log.action),
                "content": log.content or "",
                "old_status": log.old_status or "",
                "new_status": log.new_status or "",
                "note_content": log.note_content or "",
                "batch_id": log.batch_id or "",
                "can_rollback_assignment": bool(
                    user_has_operation_permission(current_user, ADMIN_OP_ASSIGNMENT_ROLLBACK)
                    and log.batch_id
                    and log.action in ASSIGNMENT_ROLLBACK_BATCH_ACTIONS
                ),
                "created_at": str(log.created_at),
            }
        )

    return Response.ok(
        {
            "total": total,
            "page": page,
            "page_size": page_size,
            "actions": actions,
            "categories": categories,
            "list": data,
        }
    )


@router.get("/call-volume")
async def call_volume_query(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_page_permission(ADMIN_PAGE_REPORT_CENTER)),
    start_date: str = Query(default=None),
    end_date: str = Query(default=None),
    agent_ids: str = Query(default=""),  # comma-separated
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
):
    """通电量查询：按北京时间日期+话务员筛选真实拨号记录。"""
    conditions = []

    if start_date:
        conditions.append(DialLog.dialed_at >= _date_start_cst_as_utc(start_date))
    if end_date:
        conditions.append(DialLog.dialed_at < _date_start_cst_as_utc(end_date) + timedelta(days=1))

    query = (
        select(DialLog, User.name.label("agent_name"), Student.name.label("student_name"))
        .join(User, User.id == DialLog.agent_id)
        .join(Student, Student.id == DialLog.student_id)
    )
    if conditions:
        query = query.where(*conditions)

    if agent_ids:
        ids = _parse_agent_ids(agent_ids)
        if ids:
            query = query.where(DialLog.agent_id.in_(ids))

    count_q = select(func.count()).select_from(query.subquery())
    total = (await db.execute(count_q)).scalar()

    summary_query = (
        select(
            func.count(DialLog.id).label("total_calls"),
            func.count(DialLog.id).filter(DialLog.duration_seconds > 0).label("recorded_calls"),
            func.coalesce(
                func.sum(
                    case(
                        (DialLog.duration_seconds > 0, DialLog.duration_seconds),
                        else_=0,
                    )
                ),
                0,
            ).label("total_recorded_duration_seconds"),
        )
        .join(User, User.id == DialLog.agent_id)
        .join(Student, Student.id == DialLog.student_id)
    )
    if conditions:
        summary_query = summary_query.where(*conditions)
    if agent_ids:
        ids = _parse_agent_ids(agent_ids)
        if ids:
            summary_query = summary_query.where(DialLog.agent_id.in_(ids))

    summary_row = (await db.execute(summary_query)).one()
    total_calls = int(summary_row.total_calls or 0)
    recorded_calls = int(summary_row.recorded_calls or 0)
    total_recorded_duration = int(summary_row.total_recorded_duration_seconds or 0)
    avg_recorded_duration = (
        round(total_recorded_duration / recorded_calls, 1) if recorded_calls else 0
    )

    query = (
        query.offset((page - 1) * page_size)
        .limit(page_size)
        .order_by(DialLog.dialed_at.desc(), DialLog.id.desc())
    )
    result = await db.execute(query)
    rows = result.all()

    data = []
    for i, (dial, agent_name, student_name) in enumerate(rows):
        data.append(
            {
                "seq": (page - 1) * page_size + i + 1,
                "id": dial.id,
                "agent_id": dial.agent_id,
                "agent_name": agent_name,
                "operator_name": agent_name,
                "student_id": dial.student_id,
                "student_name": student_name,
                "duration_seconds": dial.duration_seconds,
                "dialed_at": str(dial.dialed_at),
                "created_at": str(dial.dialed_at),
            }
        )

    return Response.ok(
        {
            "total": total,
            "page": page,
            "page_size": page_size,
            "summary": {
                "total_calls": total_calls,
                "recorded_calls": recorded_calls,
                "unrecorded_calls": total_calls - recorded_calls,
                "total_recorded_duration_seconds": total_recorded_duration,
                "avg_recorded_duration_seconds": avg_recorded_duration,
            },
            "list": data,
        }
    )


@router.get("/recent")
async def recent_logs(
    student_id: int = Query(...),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """某学生的最近操作记录"""
    await get_accessible_student(db, student_id, current_user)
    result = await db.execute(
        select(OperationLog)
        .where(OperationLog.target_student_id == student_id)
        .order_by(OperationLog.created_at.desc())
        .limit(30)
    )
    logs = result.scalars().all()
    return Response.ok(
        [
            {
                "id": log.id,
                "operator_name": log.operator_name,
                "action": log.action,
                "content": log.content,
                "old_status": log.old_status,
                "new_status": log.new_status,
                "note_content": log.note_content,
                "created_at": str(log.created_at),
            }
            for log in logs
        ]
    )

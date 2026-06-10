import os
from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.ai_analyzer import analyze_transcript
from app.auth import get_current_user
from app.database import get_db
from app.limiter import limiter
from app.models import Call, IntentLevel, Note, Student, SystemConfig, User, UserRole
from app.permissions import can_access_student
from app.pushplus import notify_a_level_change
from app.schemas import CallCreate, Response
from app.utils import make_operation_log, utcnow

router = APIRouter(prefix="/api/calls", tags=["通话"])


async def _get_config(db: AsyncSession, key: str) -> str:
    result = await db.execute(select(SystemConfig).where(SystemConfig.key == key))
    config = result.scalar_one_or_none()
    return config.value.strip() if config and config.value else ""


async def _resolve_ai_engine(db: AsyncSession) -> tuple[str | None, str | None, str]:
    """根据 SystemConfig 的 ai_provider 返回 (base, model, api_key)。

    deepseek（默认）/ mimo / custom 三套配置分开存，切换不丢。各自缺 key 时
    analyze_transcript 会回退到关键词匹配。
    """
    provider = (await _get_config(db, "ai_provider")) or "deepseek"

    if provider == "mimo":
        key = await _get_config(db, "mimo_api_key") or os.getenv("MIMO_API_KEY", "").strip()
        base = await _get_config(db, "mimo_base") or os.getenv("MIMO_BASE", "").strip()
        model = await _get_config(db, "mimo_model") or os.getenv("MIMO_MODEL", "").strip()
        return (base or None, model or None, key)

    if provider == "custom":
        key = await _get_config(db, "ai_custom_api_key")
        base = await _get_config(db, "ai_custom_base")
        model = await _get_config(db, "ai_custom_model")
        return (base or None, model or None, key)

    # deepseek（默认）
    key = await _get_config(db, "deepseek_api_key") or os.getenv("DEEPSEEK_API_KEY", "").strip()
    return (None, None, key)


def _agent_can_access_student(student: Student, user: User) -> bool:
    return can_access_student(user, student)


@router.get("/check")
async def check_today_call(
    student_id: int = Query(...),
    within_hours: int = Query(24, ge=1, le=168),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    student_result = await db.execute(select(Student).where(Student.id == student_id))
    student = student_result.scalar_one_or_none()
    if student is None:
        raise HTTPException(status_code=404, detail="学生不存在")
    if not _agent_can_access_student(student, current_user):
        raise HTTPException(status_code=403, detail="无权查看该学员的通话记录")

    since = utcnow() - timedelta(hours=within_hours)
    result = await db.execute(
        select(Call.created_at)
        .where(Call.student_id == student_id, Call.created_at >= since)
        .order_by(Call.created_at.desc())
    )
    rows = result.all()
    count = len(rows)
    last_call_at = str(rows[0][0]) if rows else None

    return Response.ok(
        {
            "count": count,
            "last_call_at": last_call_at,
            "within_hours": within_hours,
            "already_called": count > 0,
            "message": (
                f"{within_hours}h 内该学生已被通话 {count} 次（最近 {last_call_at}）"
                if count
                else ""
            ),
        }
    )


@router.post("/analyze")
@limiter.limit("10/hour")
async def create_call(
    request: Request,
    body: CallCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    student_result = await db.execute(select(Student).where(Student.id == body.student_id))
    student = student_result.scalar_one_or_none()
    if student is None:
        raise HTTPException(status_code=404, detail="学生不存在")
    if not _agent_can_access_student(student, current_user):
        raise HTTPException(status_code=403, detail="无权对该学员进行通话分析")

    base, model, api_key = await _resolve_ai_engine(db)
    result = await analyze_transcript(body.transcript, api_key, base, model)

    call = Call(
        student_id=body.student_id,
        agent_id=current_user.id,
        duration_seconds=body.duration_seconds,
        transcript=body.transcript,
        ai_intent=result["ai_intent"],
        ai_reasons=result["ai_reasons"],
        ai_summary=result["ai_summary"],
        ai_confidence=result["ai_confidence"],
        analyzed_at=utcnow(),
    )
    db.add(call)

    old_intent = student.intent_level
    if result["ai_intent"] != IntentLevel.none.value:
        student.intent_level = IntentLevel(result["ai_intent"])

    db.add(
        make_operation_log(
            current_user,
            student.id,
            student.case_no,
            "AI分析",
            content=f"意向{result['ai_intent']}(置信度{result['ai_confidence']})",
            old_status=str(old_intent),
            new_status=result["ai_intent"],
            note_content=body.transcript[:200],
        )
    )

    ai_note_lines = ["【AI 通话摘要】"]
    if result.get("ai_summary"):
        ai_note_lines.append(result["ai_summary"])
    ai_note_lines.append("")
    ai_note_lines.append(f"意向 {result['ai_intent']}（置信度 {result['ai_confidence']}）")
    if result.get("ai_reasons"):
        ai_note_lines.append(f"依据：{result['ai_reasons']}")
    db.add(
        Note(
            student_id=body.student_id,
            agent_id=current_user.id,
            content="\n".join(ai_note_lines),
            source="ai",
        )
    )

    await db.commit()
    await db.refresh(call)
    if old_intent != student.intent_level and student.intent_level == IntentLevel.A:
        await notify_a_level_change(db, student, current_user, "ai")

    return Response.ok(
        {
            "id": call.id,
            "ai_intent": result["ai_intent"],
            "ai_confidence": result["ai_confidence"],
            "ai_summary": result["ai_summary"],
            "ai_reasons": result["ai_reasons"],
            "analyzed_at": str(call.analyzed_at) if call.analyzed_at else None,
        }
    )


@router.get("")
async def list_calls(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    student_id: int = Query(None),
    agent_id: int = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    query = select(Call)
    if current_user.role == UserRole.agent:
        query = query.where(Call.agent_id == current_user.id)
        if agent_id is not None and agent_id != current_user.id:
            raise HTTPException(status_code=403, detail="无权查询其他坐席的通话")
    elif agent_id is not None:
        query = query.where(Call.agent_id == agent_id)

    if student_id is not None:
        query = query.where(Call.student_id == student_id)

    count_q = select(func.count()).select_from(query.subquery())
    total = (await db.execute(count_q)).scalar()
    query = query.offset((page - 1) * page_size).limit(page_size).order_by(Call.created_at.desc())
    result = await db.execute(query)
    calls = result.scalars().all()

    return Response.ok(
        {
            "total": total,
            "page": page,
            "page_size": page_size,
            "list": [
                {
                    "id": c.id,
                    "student_id": c.student_id,
                    "agent_id": c.agent_id,
                    "duration_seconds": c.duration_seconds,
                    "ai_intent": c.ai_intent,
                    "ai_confidence": c.ai_confidence,
                    "ai_summary": c.ai_summary,
                    "ai_reasons": c.ai_reasons,
                    "analyzed_at": str(c.analyzed_at) if c.analyzed_at else None,
                    "created_at": str(c.created_at),
                }
                for c in calls
            ],
        }
    )

import re
import uuid
from datetime import date, datetime, timedelta
from io import BytesIO

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from fastapi.responses import StreamingResponse
from openpyxl import Workbook, load_workbook
from pydantic import BaseModel
from sqlalchemy import func, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import get_current_user, require_admin
from app.database import get_db
from app.models import (
    IntentLevel,
    LeadViewLog,
    Student,
    StudentStage,
    StudentStatus,
    User,
    UserRole,
)
from app.permissions import apply_student_scope, get_accessible_student, get_student_or_404, is_admin
from app.schemas import EnrollInfo, Response, StageUpdate, StudentCreate, StudentUpdate
from app.utils import make_operation_log, mask_phone

router = APIRouter(prefix="/api/students", tags=["学生"])

# backward compat redirect
compat = APIRouter(prefix="/api/leads", tags=["兼容旧路径"])


STAGE_ORDER = ["初次联系", "有意向", "已送资料", "预约参观", "已来访", "已报名"]

# Excel import: limit memory DoS from huge uploads
MAX_STUDENT_IMPORT_BYTES = 10 * 1024 * 1024


def next_stage(current: str) -> str | None:
    try:
        idx = STAGE_ORDER.index(current)
        return STAGE_ORDER[idx + 1] if idx + 1 < len(STAGE_ORDER) else None
    except ValueError:
        return None


@router.post("/import")
async def import_students(
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    if not file.filename.endswith((".xlsx", ".xls")):
        return Response.error(code=1, msg="仅支持 .xlsx / .xls 文件")

    try:
        contents = await file.read()
        if len(contents) > MAX_STUDENT_IMPORT_BYTES:
            return Response.error(code=1, msg=f"文件过大，请小于 {MAX_STUDENT_IMPORT_BYTES // (1024 * 1024)}MB")

        wb = load_workbook(filename=BytesIO(contents), read_only=False)
        ws = wb.active

        headers = {}
        supported_headers = {
            "姓名",
            "电话",
            "成绩",
            "监护人姓名",
            "监护人电话",
            "学校名称",
            "学校地址",
            "地域",
        }
        for col_idx, cell in enumerate(ws[1], start=1):
            val = str(cell.value).strip() if cell.value else ""
            if val in supported_headers:
                headers[val] = col_idx

        if "姓名" not in headers or "电话" not in headers:
            return Response.error(code=1, msg="Excel必须包含「姓名」「电话」列")

        name_col = headers["姓名"]
        phone_col = headers["电话"]
        region_col = headers.get("地域")
        score_col = headers.get("成绩")
        guardian_name_col = headers.get("监护人姓名")
        guardian_phone_col = headers.get("监护人电话")
        school_name_col = headers.get("学校名称")
        school_address_col = headers.get("学校地址")

        existing_result = await db.execute(select(Student.phone))
        existing_phones = set(row[0] for row in existing_result.all())

        today = date.today()
        default_expire = today + timedelta(days=30)
        success = 0
        skipped = 0
        duplicates = []

        for row in ws.iter_rows(min_row=2, values_only=True):
            name_val = row[name_col - 1] if len(row) >= name_col else None
            phone_val = row[phone_col - 1] if len(row) >= phone_col else None
            region_val = row[region_col - 1] if region_col and len(row) >= region_col else ""
            score_val = row[score_col - 1] if score_col and len(row) >= score_col else None
            guardian_name_val = (
                row[guardian_name_col - 1]
                if guardian_name_col and len(row) >= guardian_name_col
                else ""
            )
            guardian_phone_val = (
                row[guardian_phone_col - 1]
                if guardian_phone_col and len(row) >= guardian_phone_col
                else ""
            )
            school_name_val = (
                row[school_name_col - 1] if school_name_col and len(row) >= school_name_col else ""
            )
            school_address_val = (
                row[school_address_col - 1]
                if school_address_col and len(row) >= school_address_col
                else ""
            )

            if not name_val or not phone_val:
                continue

            name = str(name_val).strip()
            phone = re.sub(r"\s+", "", str(phone_val)).strip()

            if not name or not phone:
                continue

            if phone in existing_phones:
                skipped += 1
                duplicates.append(phone)
                continue

            student = Student(
                name=name,
                phone=phone,
                region=str(region_val).strip() if region_val else "",
                score=float(score_val) if score_val not in (None, "") else None,
                guardian_name=str(guardian_name_val).strip() if guardian_name_val else "",
                guardian_phone=re.sub(r"\s+", "", str(guardian_phone_val)).strip()
                if guardian_phone_val
                else "",
                school_name=str(school_name_val).strip() if school_name_val else "",
                school_address=str(school_address_val).strip() if school_address_val else "",
                status=StudentStatus.not_contacted,
                intent_level=IntentLevel.none,
                stage=StudentStage.initial_contact,
                expired_at=default_expire,
                case_no=str(uuid.uuid4()),
            )
            db.add(student)
            existing_phones.add(phone)
            success += 1

        await db.commit()
        wb.close()
        return Response.ok(
            {
                "success": success,
                "skipped": skipped,
                "duplicates": duplicates,
            }
        )
    except Exception as e:
        return Response.error(code=1, msg=f"导入失败: {str(e)}")


@router.get("/template/download")
async def download_import_template():
    """Download Excel import template"""
    wb = Workbook()
    ws = wb.active
    ws.title = "导入模板"

    headers = ["姓名", "电话", "成绩", "监护人姓名", "监护人电话", "学校名称", "学校地址", "地域"]
    ws.append(headers)

    # Example data
    ws.append(["张三", "13800138000", "580", "张先生", "13900139000", "第一中学", "XX市XX区XX路1号", "福州"])

    for col in range(1, len(headers) + 1):
        ws.column_dimensions[chr(64 + col)].width = 16

    buf = BytesIO()
    wb.save(buf)
    buf.seek(0)
    return StreamingResponse(
        buf,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": "attachment; filename=import_template.xlsx"},
    )


@router.post("")
async def create_student(
    body: StudentCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    phone = re.sub(r"\s+", "", body.phone)
    result = await db.execute(select(Student).where(Student.phone == phone))
    if result.scalar_one_or_none():
        return Response.error(code=1, msg=f"电话 {phone} 已存在")

    student = Student(
        name=body.name,
        phone=phone,
        region=body.region,
        status=StudentStatus.not_contacted,
        intent_level=IntentLevel.none,
        stage=StudentStage.initial_contact,
        expired_at=Student.default_expired_at(),
        case_no=str(uuid.uuid4()),
    )
    db.add(student)
    await db.commit()
    await db.refresh(student)
    return Response.ok(
        {
            "id": student.id,
            "name": student.name,
            "phone": student.phone,
            "region": student.region,
            "status": student.status,
            "stage": student.stage,
            "created_at": str(student.created_at),
        }
    )


@router.get("")
async def list_students(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    q: str = Query(""),
    status: str = Query(""),
    intent_level: str = Query(""),
    assigned_to: int = Query(None),
    assignment: str = Query(""),
    region: str = Query(""),
    stage: str = Query(""),
    need_help: str = Query(""),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    query = apply_student_scope(select(Student), current_user)
    if q:
        query = query.where(or_(Student.name.contains(q), Student.phone.contains(q)))
    if status:
        query = query.where(Student.status == status)
    if intent_level:
        query = query.where(Student.intent_level == intent_level)
    if assignment == "unassigned" or assigned_to == 0:
        if not is_admin(current_user):
            raise HTTPException(status_code=403, detail="无权查看未分配学生")
        query = query.where(Student.assigned_to.is_(None))
    elif assigned_to is not None:
        if not is_admin(current_user) and assigned_to != current_user.id:
            raise HTTPException(status_code=403, detail="无权查看其他坐席的学生")
        query = query.where(Student.assigned_to == assigned_to)
    if region:
        query = query.where(Student.region == region)
    if stage:
        query = query.where(Student.stage == stage)
    if need_help == "1":
        query = query.where(Student.need_help)

    count_q = select(func.count()).select_from(query.subquery())
    total = (await db.execute(count_q)).scalar()

    query = (
        query.offset((page - 1) * page_size).limit(page_size).order_by(Student.created_at.desc())
    )
    result = await db.execute(query)
    students = result.scalars().all()

    return Response.ok(
        {
            "total": total,
            "page": page,
            "page_size": page_size,
            "list": [
                {
                    "id": s.id,
                    "name": s.name,
                    "phone": mask_phone(s.phone),
                    "region": s.region,
                    "assigned_to": s.assigned_to,
                    "status": s.status,
                    "intent_level": s.intent_level,
                    "stage": s.stage,
                    "join_reasons": s.join_reasons,
                    "case_no": s.case_no,
                    "need_help": s.need_help,
                    "score": s.score,
                    "guardian_name": s.guardian_name,
                    "guardian_phone": s.guardian_phone,
                    "school_name": s.school_name,
                    "school_address": s.school_address,
                    "enrolled_at": str(s.enrolled_at) if s.enrolled_at else None,
                    "program": s.program,
                    "deposit": s.deposit,
                    "expired_at": str(s.expired_at) if s.expired_at else None,
                    "created_at": str(s.created_at),
                    "updated_at": str(s.updated_at),
                }
                for s in students
            ],
        }
    )


@router.get("/enrolled")
async def enrolled_students(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """已报名学生列表（含报名信息）"""
    query = (
        select(Student)
        .where(Student.status == StudentStatus.enrolled)
        .order_by(Student.enrolled_at.desc().nullslast())
    )
    query = apply_student_scope(query, current_user)
    count_q = select(func.count()).select_from(query.subquery())
    total = (await db.execute(count_q)).scalar()
    query = query.offset((page - 1) * page_size).limit(page_size)
    result = await db.execute(query)
    students = result.scalars().all()

    # Batch load agent names
    agent_ids = list({s.assigned_to for s in students if s.assigned_to})
    agent_map = {}
    if agent_ids:
        agent_r = await db.execute(
            select(User.id, User.name).where(User.id.in_(agent_ids))
        )
        agent_map = dict(agent_r.all())

    data = [
        {
            "id": s.id,
            "name": s.name,
            "phone": mask_phone(s.phone),
            "region": s.region,
            "program": s.program,
            "deposit": s.deposit,
            "enrolled_at": str(s.enrolled_at) if s.enrolled_at else None,
            "agent_name": agent_map.get(s.assigned_to, ""),
        }
        for s in students
    ]

    deposit_query = apply_student_scope(
        select(func.sum(Student.deposit)).where(Student.status == StudentStatus.enrolled),
        current_user,
    )
    deposit_total = await db.execute(deposit_query)
    total_deposit = deposit_total.scalar() or 0

    return Response.ok(
        {
            "total": total,
            "total_deposit": total_deposit,
            "page": page,
            "page_size": page_size,
            "list": data,
        }
    )


@router.get("/{student_id}")
async def get_student(
    student_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    student = await get_accessible_student(db, student_id, current_user)

    log = LeadViewLog(student_id=student.id, viewer_id=current_user.id)
    db.add(log)
    await db.commit()

    return Response.ok(
        {
            "id": student.id,
            "name": student.name,
            "phone": mask_phone(student.phone),
            "region": student.region,
            "assigned_to": student.assigned_to,
            "status": student.status,
            "intent_level": student.intent_level,
            "stage": student.stage,
            "join_reasons": student.join_reasons,
            "case_no": student.case_no,
            "need_help": student.need_help,
            "score": student.score,
            "guardian_name": student.guardian_name,
            "guardian_phone": mask_phone(student.guardian_phone),
            "school_name": student.school_name,
            "school_address": student.school_address,
            "enrolled_at": str(student.enrolled_at) if student.enrolled_at else None,
            "program": student.program,
            "deposit": student.deposit,
            "expired_at": str(student.expired_at) if student.expired_at else None,
            "created_at": str(student.created_at),
            "updated_at": str(student.updated_at),
        }
    )


@router.put("/{student_id}")
async def update_student(
    student_id: int,
    body: StudentUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    student = await get_accessible_student(db, student_id, current_user)
    raw = body.model_dump(exclude_unset=True)
    if not raw:
        return Response.ok(
            {
                "id": student.id,
                "status": student.status,
                "stage": student.stage,
                "intent_level": student.intent_level,
                "assigned_to": student.assigned_to,
                "region": student.region,
                "join_reasons": student.join_reasons,
                "enrolled_at": str(student.enrolled_at) if student.enrolled_at else None,
                "program": student.program,
                "deposit": student.deposit,
                "updated_at": str(student.updated_at),
            }
        )

    admin_only_fields = {"assigned_to", "enrolled_at", "program", "deposit"}
    if not is_admin(current_user):
        forbidden = sorted(admin_only_fields.intersection(raw))
        if forbidden:
            raise HTTPException(status_code=403, detail=f"无权修改字段: {', '.join(forbidden)}")

    old_intent = student.intent_level
    for k, v in raw.items():
        if k == "intent_level" and v is not None:
            try:
                v = IntentLevel(v)
            except ValueError:
                return Response.error(code=1, msg=f"无效的意向等级: {v}")
        setattr(student, k, v)

    if "intent_level" in raw and old_intent != student.intent_level:
        db.add(
            make_operation_log(
                current_user,
                student.id,
                student.case_no or "",
                "手动评级",
                content=f"意向 {old_intent} → {student.intent_level}",
                old_status=str(old_intent),
                new_status=str(student.intent_level),
                note_content="",
            )
        )

    await db.commit()
    await db.refresh(student)
    return Response.ok(
        {
            "id": student.id,
            "status": student.status,
            "stage": student.stage,
            "intent_level": student.intent_level,
            "assigned_to": student.assigned_to,
            "region": student.region,
            "join_reasons": student.join_reasons,
            "enrolled_at": str(student.enrolled_at) if student.enrolled_at else None,
            "program": student.program,
            "deposit": student.deposit,
            "updated_at": str(student.updated_at),
        }
    )


@router.put("/{student_id}/stage")
async def update_stage(
    student_id: int,
    body: StageUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    student = await get_accessible_student(db, student_id, current_user)

    try:
        student.stage = StudentStage(body.stage)
    except ValueError:
        return Response.error(msg=f"无效的阶段值: {body.stage}")

    # Auto-update status when stage is "已报名"
    if body.stage == "已报名":
        student.status = StudentStatus.enrolled
        if not student.enrolled_at:
            student.enrolled_at = date.today()

    await db.commit()
    await db.refresh(student)
    return Response.ok({"stage": student.stage, "status": student.status})


@router.put("/{student_id}/enroll")
async def set_enroll_info(
    student_id: int,
    body: EnrollInfo,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if not is_admin(current_user):
        raise HTTPException(status_code=403, detail="无权设置报名信息")
    student = await get_student_or_404(db, student_id)

    student.enrolled_at = body.enrolled_at or date.today()
    student.program = body.program
    student.deposit = body.deposit
    student.status = StudentStatus.enrolled
    student.stage = StudentStage.enrolled

    await db.commit()
    await db.refresh(student)
    return Response.ok(
        {
            "enrolled_at": str(student.enrolled_at),
            "program": student.program,
            "deposit": student.deposit,
        }
    )


@router.put("/{student_id}/extend")
async def extend_expiry(
    student_id: int,
    days: int = Query(15, ge=1, le=90),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    student = await get_student_or_404(db, student_id)

    base = student.expired_at if student.expired_at else date.today()
    student.expired_at = base + timedelta(days=days)
    if student.status == StudentStatus.expired:
        student.status = StudentStatus.not_contacted

    await db.commit()
    return Response.ok({"expired_at": str(student.expired_at)})


class AssignReq(BaseModel):
    student_ids: list[int]
    agent_id: int


@router.post("/assign")
async def assign_students(
    body: AssignReq,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    if not body.student_ids:
        return Response.error(code=1, msg="student_ids不能为空")

    agent_result = await db.execute(select(User).where(User.id == body.agent_id, User.is_active))
    if not agent_result.scalar_one_or_none():
        return Response.error(code=1, msg="话务员不存在或已禁用")

    now = datetime.utcnow()
    await db.execute(
        update(Student)
        .where(Student.id.in_(body.student_ids))
        .values(assigned_to=body.agent_id, assigned_at=now)
    )
    await db.commit()

    count_result = await db.execute(
        select(func.count(Student.id)).where(Student.id.in_(body.student_ids))
    )
    count = count_result.scalar()
    return Response.ok({"assigned_count": count, "agent_id": body.agent_id})


@router.post("/auto-assign")
async def auto_assign(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    agent_result = await db.execute(select(User).where(User.is_active, User.role == UserRole.agent))
    agents = agent_result.scalars().all()
    if not agents:
        return Response.error(code=1, msg="没有可用的话务员")

    load = {}
    for a in agents:
        cnt = await db.execute(select(func.count(Student.id)).where(Student.assigned_to == a.id))
        load[a.id] = cnt.scalar() or 0

    unassigned_result = await db.execute(
        select(Student.id).where(Student.assigned_to.is_(None)).order_by(Student.created_at.asc())
    )
    unassigned_ids = [row[0] for row in unassigned_result.all()]
    if not unassigned_ids:
        return Response.ok({"message": "没有未分配的学生", "distribution": {}})

    distribution = {a.id: 0 for a in agents}
    now = datetime.utcnow()
    by_agent: dict[int, list[int]] = {}
    for sid in unassigned_ids:
        min_agent_id = min(load, key=load.get)
        by_agent.setdefault(min_agent_id, []).append(sid)
        load[min_agent_id] += 1
        distribution[min_agent_id] += 1

    for agent_id, ids in by_agent.items():
        if not ids:
            continue
        await db.execute(
            update(Student)
            .where(Student.id.in_(ids))
            .values(assigned_to=agent_id, assigned_at=now)
        )

    await db.commit()
    result = {}
    for a in agents:
        result[a.name] = distribution.get(a.id, 0)

    return Response.ok({"total_assigned": len(unassigned_ids), "distribution": result})


@router.post("/region-assign")
async def region_assign(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    agent_result = await db.execute(select(User).where(User.is_active, User.role == UserRole.agent))
    agents = agent_result.scalars().all()
    if not agents:
        return Response.error(code=1, msg="没有可用的话务员")

    region_map = {}
    for a in agents:
        if a.service_regions:
            for r in a.service_regions.replace("，", ",").split(","):
                r = r.strip()
                if r and r not in region_map:
                    region_map[r] = a

    unassigned_result = await db.execute(
        select(Student).where(Student.assigned_to.is_(None)).order_by(Student.created_at.asc())
    )
    unassigned = unassigned_result.scalars().all()

    distribution = {a.name: {"matched": 0, "fallback": 0} for a in agents}
    fallback_counts = {a.id: 0 for a in agents}
    now = datetime.utcnow()
    total_assigned = 0
    by_agent: dict[int, list[int]] = {}

    for student in unassigned:
        matched_agent = None
        if student.region and student.region in region_map:
            matched_agent = region_map[student.region]

        if matched_agent:
            agent_id = matched_agent.id
            distribution[matched_agent.name]["matched"] += 1
        else:
            min_agent_id = min(fallback_counts, key=fallback_counts.get)
            agent_id = min_agent_id
            name = next((a.name for a in agents if a.id == min_agent_id), "")
            if name:
                distribution[name]["fallback"] += 1

        by_agent.setdefault(agent_id, []).append(student.id)
        fallback_counts[agent_id] = fallback_counts.get(agent_id, 0) + 1
        total_assigned += 1

    for agent_id, ids in by_agent.items():
        if not ids:
            continue
        await db.execute(
            update(Student)
            .where(Student.id.in_(ids))
            .values(assigned_to=agent_id, assigned_at=now)
        )

    await db.commit()
    return Response.ok(
        {
            "total_assigned": total_assigned,
            "region_map_used": {k: v.name for k, v in region_map.items()},
            "distribution": distribution,
        }
    )


@router.post("/{student_id}/need-help")
async def toggle_need_help(
    student_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    student = await get_accessible_student(db, student_id, current_user)
    student.need_help = not student.need_help
    db.add(
        make_operation_log(
            current_user,
            student.id,
            student.case_no,
            "标记协助" if student.need_help else "取消协助",
            content="需要协助" if student.need_help else "取消协助标记",
        )
    )
    await db.commit()
    return Response.ok({"need_help": student.need_help})


@router.delete("/{student_id}")
async def delete_student(
    student_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    student = await get_student_or_404(db, student_id)
    await db.delete(student)
    await db.commit()
    return Response.ok(msg="删除成功")


# ── Backward compat redirects ──
@compat.get("/{path:path}")
async def compat_get(path: str, request=None):
    raise HTTPException(status_code=301, headers={"Location": f"/api/students/{path}"})


@compat.post("/{path:path}")
async def compat_post(path: str):
    raise HTTPException(status_code=308, headers={"Location": f"/api/students/{path}"})


@compat.put("/{path:path}")
async def compat_put(path: str):
    raise HTTPException(status_code=308, headers={"Location": f"/api/students/{path}"})

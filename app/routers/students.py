import re
import uuid
from datetime import date, timedelta
from io import BytesIO
from itertools import chain
from zipfile import BadZipFile

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from fastapi.responses import StreamingResponse
from openpyxl import Workbook, load_workbook
from openpyxl.utils.exceptions import InvalidFileException
from pydantic import BaseModel
from sqlalchemy import delete, func, insert, or_, select, update
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import get_current_user, require_admin
from app.database import get_db
from app.models import (
    Call,
    FollowUp,
    IntentLevel,
    LeadViewLog,
    Note,
    Student,
    StudentStage,
    StudentStatus,
    User,
    UserRole,
    Visit,
)
from app.permissions import (
    apply_student_scope,
    get_accessible_student,
    get_student_or_404,
    is_admin,
)
from app.pushplus import notify_a_level_change
from app.schemas import EnrollInfo, Response, StageUpdate, StudentCreate, StudentUpdate
from app.utils import make_operation_log, mask_phone, utcnow

router = APIRouter(prefix="/api/students", tags=["学生"])

# backward compat redirect
compat = APIRouter(prefix="/api/leads", tags=["兼容旧路径"])


STAGE_ORDER = ["初次联系", "有意向", "已送资料", "预约参观", "已来访", "已报名"]

# Excel import: limit memory DoS from huge uploads
MAX_STUDENT_IMPORT_BYTES = 10 * 1024 * 1024
IMPORT_COLUMN_ALIASES = {
    "name": {"name", "student", "student_name", "\u59d3\u540d", "\u5b66\u751f\u59d3\u540d"},
    "region": {"region", "area", "\u5730\u533a", "\u533a\u57df", "\u5730\u57df"},
    "score": {"score", "grade", "\u5206\u6570", "\u6210\u7ee9"},
    "guardian_name": {
        "guardian_name",
        "parent_name",
        "\u5bb6\u957f\u59d3\u540d",
        "\u76d1\u62a4\u4eba\u59d3\u540d",
    },
    "guardian_phone": {
        "phone",
        "mobile",
        "tel",
        "telephone",
        "guardian_phone",
        "parent_phone",
        "\u7535\u8bdd",
        "\u624b\u673a\u53f7",
        "\u8054\u7cfb\u7535\u8bdd",
        "\u5bb6\u957f\u7535\u8bdd",
        "\u76d1\u62a4\u4eba\u7535\u8bdd",
    },
    "guardian2_name": {
        "guardian2_name",
        "parent2_name",
        "\u7b2c\u4e8c\u76d1\u62a4\u4eba\u59d3\u540d",
        "\u76d1\u62a4\u4eba2\u59d3\u540d",
    },
    "guardian2_phone": {
        "guardian2_phone",
        "parent2_phone",
        "\u7b2c\u4e8c\u76d1\u62a4\u4eba\u7535\u8bdd",
        "\u76d1\u62a4\u4eba2\u7535\u8bdd",
    },
    "school_name": {
        "school",
        "school_name",
        "\u6bd5\u4e1a\u5b66\u6821",
        "\u5b66\u6821",
        "\u5b66\u6821\u540d\u79f0",
    },
    "school_address": {"school_address", "\u5b66\u6821\u5730\u5740"},
    "program": {"program", "\u4e13\u4e1a", "\u610f\u5411\u4e13\u4e1a", "\u8bfe\u7a0b"},
    "join_reasons": {
        "join_reasons",
        "reason",
        "\u62a5\u540d\u539f\u56e0",
        "\u54a8\u8be2\u539f\u56e0",
    },
}

ADMIN_STUDENT_UPDATE_FIELDS = {
    "name",
    "status",
    "intent_level",
    "assigned_to",
    "join_reasons",
    "region",
    "stage",
    "enrolled_at",
    "program",
    "deposit",
    "score",
    "guardian_name",
    "guardian_phone",
    "guardian2_name",
    "guardian2_phone",
    "school_name",
    "school_address",
    "need_help",
}
AGENT_STUDENT_UPDATE_FIELDS = {"status", "intent_level", "join_reasons", "stage", "need_help"}


def next_stage(current: str) -> str | None:
    try:
        idx = STAGE_ORDER.index(current)
        return STAGE_ORDER[idx + 1] if idx + 1 < len(STAGE_ORDER) else None
    except ValueError:
        return None


def _enum_or_error(enum_cls, value: str, label: str):
    try:
        return enum_cls(value)
    except ValueError:
        raise ValueError(f"无效的{label}: {value}")


def _student_payload(student: Student, full_phone: bool = False) -> dict:
    status = student.status.value if hasattr(student.status, "value") else student.status
    intent_level = (
        student.intent_level.value if hasattr(student.intent_level, "value") else student.intent_level
    )
    stage = student.stage.value if hasattr(student.stage, "value") else student.stage
    payload = {
        "id": student.id,
        "name": student.name,
        "region": student.region,
        "assigned_to": student.assigned_to,
        "status": status,
        "intent_level": intent_level,
        "stage": stage,
        "join_reasons": student.join_reasons,
        "case_no": student.case_no,
        "need_help": student.need_help,
        "score": student.score,
        "guardian_name": student.guardian_name,
        "guardian_phone": mask_phone(student.guardian_phone),
        "guardian2_name": student.guardian2_name,
        "guardian2_phone": mask_phone(student.guardian2_phone),
        "school_name": student.school_name,
        "school_address": student.school_address,
        "enrolled_at": str(student.enrolled_at) if student.enrolled_at else None,
        "program": student.program,
        "deposit": student.deposit,
        "expired_at": str(student.expired_at) if student.expired_at else None,
        "created_at": str(student.created_at),
        "updated_at": str(student.updated_at),
    }
    if full_phone:
        payload["guardian_phone_raw"] = student.guardian_phone
        payload["guardian2_phone_raw"] = student.guardian2_phone
    return payload


def _normalize_import_header(value) -> str:
    return re.sub(r"[\s_\-]+", "", str(value or "").strip().lower())


def _build_import_header_map(header_row) -> dict[str, int]:
    normalized_aliases = {
        field: {_normalize_import_header(alias) for alias in aliases}
        for field, aliases in IMPORT_COLUMN_ALIASES.items()
    }
    header_map = {}
    for idx, value in enumerate(header_row):
        normalized = _normalize_import_header(value)
        if not normalized:
            continue
        for field, aliases in normalized_aliases.items():
            if normalized in aliases and field not in header_map:
                header_map[field] = idx
                break
    return header_map


def _row_value(row, header_map: dict[str, int], field: str):
    idx = header_map.get(field)
    if idx is None or idx >= len(row):
        return None
    return row[idx]


def _clean_import_text(value) -> str:
    if value is None:
        return ""
    return str(value).strip()


def _clean_import_phone(value) -> str:
    return re.sub(r"\s+", "", _clean_import_text(value))


def _parse_import_float(value, field_label: str) -> float | None:
    text = _clean_import_text(value)
    if text == "":
        return None
    try:
        return float(text)
    except (TypeError, ValueError):
        raise ValueError(f"{field_label}格式无效: {value}")


def _is_empty_import_row(row) -> bool:
    return all(_clean_import_text(value) == "" for value in row)


def _looks_like_phone(value: str) -> bool:
    digits = re.sub(r"\D+", "", value)
    return len(digits) >= 7 and len(digits) <= 20


def _looks_like_score(value: str) -> bool:
    try:
        score = float(value)
    except ValueError:
        return False
    return 0 <= score <= 1000 and not _looks_like_phone(value)


def _looks_like_school(value: str) -> bool:
    return any(
        marker in value
        for marker in (
            "学校",
            "中学",
            "学院",
            "小学",
            "职校",
            "技校",
            "高中",
            "初中",
            "职专",
            "一中",
            "二中",
            "三中",
            "四中",
            "五中",
            "六中",
            "七中",
            "八中",
            "九中",
            "十中",
        )
    )


def _looks_like_region(value: str) -> bool:
    return any(marker in value for marker in ("区", "县", "市", "镇", "乡"))


def _looks_like_person_name(value: str) -> bool:
    return len(value) <= 16 and not _looks_like_school(value) and not _looks_like_region(value)


def _infer_import_row(row) -> dict:
    values = [_clean_import_text(value) for value in row]
    non_empty = [value for value in values if value]
    if not non_empty:
        return {}

    inferred = {
        "name": "",
        "region": "",
        "score": None,
        "guardian_name": "",
        "guardian_phone": "",
        "guardian2_name": "",
        "guardian2_phone": "",
        "school_name": "",
        "school_address": "",
        "program": "",
        "join_reasons": "",
    }

    text_values = []
    for value in non_empty:
        if not inferred["guardian_phone"] and _looks_like_phone(value):
            inferred["guardian_phone"] = _clean_import_phone(value)
        elif inferred["score"] is None and _looks_like_score(value):
            inferred["score"] = float(value)
        else:
            text_values.append(value)

    if text_values:
        inferred["name"] = text_values[0]
    for value in text_values[1:]:
        if not inferred["school_name"] and _looks_like_school(value):
            inferred["school_name"] = value
        elif not inferred["region"] and _looks_like_region(value):
            inferred["region"] = value
        elif not inferred["guardian_name"] and _looks_like_person_name(value):
            inferred["guardian_name"] = value
        elif not inferred["guardian2_name"] and _looks_like_person_name(value):
            inferred["guardian2_name"] = value
        elif not inferred["school_name"]:
            inferred["school_name"] = value
        elif not inferred["school_address"]:
            inferred["school_address"] = value
        else:
            inferred["join_reasons"] = (
                f"{inferred['join_reasons']} {value}".strip()
                if inferred["join_reasons"]
                else value
            )

    return inferred


def _parse_import_row(row, header_map: dict[str, int]) -> tuple[dict | None, str | None]:
    if header_map:
        name = _clean_import_text(_row_value(row, header_map, "name"))
        if not name:
            return None, "缺少姓名"
        try:
            score = _parse_import_float(_row_value(row, header_map, "score"), "score")
        except ValueError as exc:
            return None, str(exc)
        return {
            "name": name,
            "region": _clean_import_text(_row_value(row, header_map, "region")),
            "score": score,
            "guardian_name": _clean_import_text(_row_value(row, header_map, "guardian_name")),
            "guardian_phone": _clean_import_phone(_row_value(row, header_map, "guardian_phone")),
            "guardian2_name": _clean_import_text(_row_value(row, header_map, "guardian2_name")),
            "guardian2_phone": _clean_import_phone(_row_value(row, header_map, "guardian2_phone")),
            "school_name": _clean_import_text(_row_value(row, header_map, "school_name")),
            "school_address": _clean_import_text(_row_value(row, header_map, "school_address")),
            "program": _clean_import_text(_row_value(row, header_map, "program")),
            "join_reasons": _clean_import_text(_row_value(row, header_map, "join_reasons")),
        }, None

    inferred = _infer_import_row(row)
    if not inferred.get("name"):
        return None, "无法识别姓名"
    return inferred, None


@router.post("/import")
async def import_students_excel(
    file: UploadFile = File(...),
    default_agent_id: int | None = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    filename = file.filename or ""
    if not filename.lower().endswith(".xlsx"):
        return Response.error(code=1, msg="仅支持 .xlsx 文件")

    workbook = None
    try:
        contents = await file.read()
        if len(contents) > MAX_STUDENT_IMPORT_BYTES:
            max_mb = MAX_STUDENT_IMPORT_BYTES // (1024 * 1024)
            return Response.error(code=1, msg=f"文件过大，请小于 {max_mb}MB")
        if not contents:
            return Response.error(code=1, msg="上传文件为空")

        if default_agent_id is not None:
            agent_result = await db.execute(
                select(User.id).where(User.id == default_agent_id, User.is_active)
            )
            if not agent_result.scalar_one_or_none():
                return Response.error(code=1, msg="默认话务员不存在或已禁用")

        workbook = load_workbook(filename=BytesIO(contents), read_only=True, data_only=True)
        ws = workbook.active
        rows = ws.iter_rows(values_only=True)
        header_row = next(rows, None)
        if not header_row:
            return Response.error(code=1, msg="Excel 文件没有表头")

        header_map = _build_import_header_map(header_row)
        data_start_row = 2
        if "name" not in header_map:
            rows = chain([header_row], rows)
            header_map = {}
            data_start_row = 1

        parsed_rows = []  # (row_idx, parsed_dict)
        skipped_rows = []
        default_expire = Student.default_expired_at()
        assigned_at = utcnow() if default_agent_id is not None else None

        for row_idx, row in enumerate(rows, start=data_start_row):
            if _is_empty_import_row(row):
                continue

            parsed, error = _parse_import_row(row, header_map)
            if error:
                skipped_rows.append({"row": row_idx, "reason": error})
                continue

            parsed_rows.append((row_idx, parsed))

        # Batch-check for duplicate phone numbers against existing DB records
        phones_to_check = {p["guardian_phone"] for _, p in parsed_rows if p.get("guardian_phone")}
        existing_phones: set[str] = set()
        if phones_to_check:
            existing_r = await db.execute(
                select(Student.guardian_phone).where(Student.guardian_phone.in_(phones_to_check))
            )
            existing_phones = {row[0] for row in existing_r.all() if row[0]}

        seen_in_file: set[str] = set()
        student_rows = []
        for row_idx, parsed in parsed_rows:
            phone = parsed.get("guardian_phone", "")
            if phone:
                if phone in existing_phones:
                    skipped_rows.append({"row": row_idx, "reason": f"手机号已存在（库中已有该学员）: {phone}"})
                    continue
                if phone in seen_in_file:
                    skipped_rows.append({"row": row_idx, "reason": f"手机号在本次导入中重复: {phone}"})
                    continue
                seen_in_file.add(phone)
            student_rows.append(
                {
                    "name": parsed["name"],
                    "region": parsed["region"],
                    "assigned_to": default_agent_id,
                    "assigned_at": assigned_at,
                    "score": parsed["score"],
                    "guardian_name": parsed["guardian_name"],
                    "guardian_phone": phone,
                    "guardian2_name": parsed["guardian2_name"],
                    "guardian2_phone": parsed["guardian2_phone"],
                    "school_name": parsed["school_name"],
                    "school_address": parsed["school_address"],
                    "program": parsed["program"],
                    "join_reasons": parsed["join_reasons"],
                    "status": StudentStatus.not_contacted,
                    "intent_level": IntentLevel.none,
                    "stage": StudentStage.initial_contact,
                    "expired_at": default_expire,
                    "case_no": str(uuid.uuid4()),
                }
            )

        imported_count = len(student_rows)
        if student_rows:
            await db.execute(insert(Student), student_rows)

        db.add(
            make_operation_log(
                current_user,
                target_student_id=None,
                case_no="",
                action="Excel导入",
                content=f"导入 {imported_count} 条，跳过 {len(skipped_rows)} 条",
            )
        )
        await db.commit()
        return Response.ok(
            {
                "imported": imported_count,
                "success": imported_count,
                "skipped": len(skipped_rows),
                "skipped_rows": skipped_rows,
                "errors": skipped_rows,
            }
        )
    except (InvalidFileException, BadZipFile, OSError) as exc:
        await db.rollback()
        return Response.error(code=1, msg=f"文件解析失败: {exc}")
    except SQLAlchemyError as exc:
        await db.rollback()
        return Response.error(code=1, msg=f"数据库写入失败: {exc}")
    except Exception as exc:
        await db.rollback()
        return Response.error(code=1, msg=f"导入失败: {exc}")
    finally:
        if workbook is not None:
            workbook.close()


@router.get("/template/download")
async def download_import_template():
    """Download Excel import template"""
    wb = Workbook()
    ws = wb.active
    ws.title = "导入模板"

    headers = ["姓名", "成绩", "监护人姓名", "监护人电话", "监护人2姓名", "监护人2电话", "学校名称", "学校地址", "地域"]
    ws.append(headers)

    # Example data
    ws.append(
        [
            "张三",
            "580",
            "张先生",
            "13900139000",
            "李女士",
            "13700137000",
            "第一中学",
            "XX市XX区XX路1号",
            "福州",
        ]
    )

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
    current_user: User = Depends(get_current_user),
):
    raw = body.model_dump(exclude_unset=True)
    if not is_admin(current_user):
        agent_create_fields = {
            "name",
            "region",
            "score",
            "guardian_name",
            "guardian_phone",
            "guardian2_name",
            "guardian2_phone",
            "school_name",
            "school_address",
            "join_reasons",
        }
        forbidden = sorted(set(raw) - agent_create_fields)
        if forbidden:
            raise HTTPException(status_code=403, detail=f"无权设置字段: {', '.join(forbidden)}")

    status = StudentStatus.not_contacted
    intent_level = IntentLevel.none
    stage = StudentStage.initial_contact
    if is_admin(current_user):
        if body.status:
            try:
                status = _enum_or_error(StudentStatus, body.status, "状态")
            except ValueError as e:
                return Response.error(code=1, msg=str(e))
        if body.intent_level:
            try:
                intent_level = _enum_or_error(IntentLevel, body.intent_level, "意向等级")
            except ValueError as e:
                return Response.error(code=1, msg=str(e))
        if body.stage:
            try:
                stage = _enum_or_error(StudentStage, body.stage, "阶段")
            except ValueError as e:
                return Response.error(code=1, msg=str(e))

    assigned_to = body.assigned_to if is_admin(current_user) else current_user.id
    if assigned_to:
        agent_result = await db.execute(select(User.id).where(User.id == assigned_to, User.is_active))
        if not agent_result.scalar_one_or_none():
            return Response.error(code=1, msg="话务员不存在或已禁用")

    student = Student(
        name=body.name,
        region=body.region,
        assigned_to=assigned_to,
        assigned_at=utcnow() if assigned_to else None,
        status=status,
        intent_level=intent_level,
        stage=stage,
        join_reasons=body.join_reasons or "",
        enrolled_at=body.enrolled_at,
        program=body.program or "",
        deposit=body.deposit,
        score=body.score,
        guardian_name=body.guardian_name or "",
        guardian_phone=re.sub(r"\s+", "", body.guardian_phone or ""),
        guardian2_name=body.guardian2_name or "",
        guardian2_phone=re.sub(r"\s+", "", body.guardian2_phone or ""),
        school_name=body.school_name or "",
        school_address=body.school_address or "",
        need_help=body.need_help or False,
        expired_at=Student.default_expired_at(),
        case_no=str(uuid.uuid4()),
    )
    if student.stage == StudentStage.enrolled:
        student.status = StudentStatus.enrolled
        if not student.enrolled_at:
            student.enrolled_at = date.today()

    db.add(student)
    await db.commit()
    await db.refresh(student)
    if student.intent_level == IntentLevel.A:
        await notify_a_level_change(db, student, current_user, "create")
    return Response.ok(_student_payload(student, full_phone=is_admin(current_user)))


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
        query = query.where(
            or_(
                Student.name.contains(q),
                Student.region.contains(q),
                Student.school_name.contains(q),
                Student.guardian_name.contains(q),
            )
        )
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
            "list": [_student_payload(s, full_phone=is_admin(current_user)) for s in students],
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


@router.get("/schools")
async def list_schools(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """获取有未分配学生的学校列表及其未分配数量"""
    result = await db.execute(
        select(Student.school_name, func.count(Student.id))
        .where(Student.school_name != "", Student.assigned_to.is_(None))
        .group_by(Student.school_name)
        .order_by(func.count(Student.id).desc())
    )
    schools = [{"name": row[0], "count": row[1]} for row in result.all()]
    return Response.ok(schools)


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

    return Response.ok(_student_payload(student, full_phone=is_admin(current_user)))


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
        return Response.ok(_student_payload(student, full_phone=is_admin(current_user)))

    allowed_fields = (
        ADMIN_STUDENT_UPDATE_FIELDS if is_admin(current_user) else AGENT_STUDENT_UPDATE_FIELDS
    )
    forbidden = sorted(set(raw) - allowed_fields)
    if forbidden:
        raise HTTPException(status_code=403, detail=f"无权修改字段: {', '.join(forbidden)}")

    old_intent = student.intent_level
    for k, v in raw.items():
        if k == "status" and v is not None:
            try:
                v = _enum_or_error(StudentStatus, v, "状态")
            except ValueError as e:
                return Response.error(code=1, msg=str(e))
        elif k == "stage" and v is not None:
            try:
                v = _enum_or_error(StudentStage, v, "阶段")
            except ValueError as e:
                return Response.error(code=1, msg=str(e))
        elif k == "intent_level" and v is not None:
            try:
                v = _enum_or_error(IntentLevel, v, "意向等级")
            except ValueError as e:
                return Response.error(code=1, msg=str(e))
        elif k == "guardian_phone" and v is not None:
            v = re.sub(r"\s+", "", v)
        setattr(student, k, v)

    if student.stage == StudentStage.enrolled:
        student.status = StudentStatus.enrolled
        if not student.enrolled_at:
            student.enrolled_at = date.today()

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
    if "intent_level" in raw and old_intent != student.intent_level and student.intent_level == IntentLevel.A:
        await notify_a_level_change(db, student, current_user, "manual")
    return Response.ok(_student_payload(student, full_phone=True))


@router.put("/{student_id}/stage")
async def update_stage(
    student_id: int,
    body: StageUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    student = await get_accessible_student(db, student_id, current_user)

    try:
        student.stage = _enum_or_error(StudentStage, body.stage, "阶段")
    except ValueError as e:
        return Response.error(msg=str(e))

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

    now = utcnow()
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
    now = utcnow()
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
    now = utcnow()
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
            "distribution": distribution,
        }
    )


@router.post("/school-assign")
async def school_assign(
    body: dict,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """按学校分发：选学校、选多个话务员ID、轮询分配"""
    school = body.get("school_name", "").strip()
    agent_ids = body.get("agent_ids", [])
    if not school:
        return Response.error(code=1, msg="请选择学校")
    if not agent_ids or not isinstance(agent_ids, list):
        return Response.error(code=1, msg="请选择至少一个话务员")

    # 验证话务员存在
    agents_result = await db.execute(
        select(User).where(User.id.in_(agent_ids), User.is_active, User.role == UserRole.agent)
    )
    agents = agents_result.scalars().all()
    if not agents:
        return Response.error(code=1, msg="没有可用的话务员")

    # 查出该学校未分配的学生
    students_result = await db.execute(
        select(Student).where(
            Student.school_name == school,
            Student.assigned_to.is_(None),
        ).order_by(Student.created_at.asc())
    )
    students = students_result.scalars().all()
    if not students:
        return Response.error(code=1, msg="该学校没有未分配的学生")

    now = utcnow()
    by_agent: dict[int, list[int]] = {}
    agent_id_list = [a.id for a in agents]
    counts = {a_id: 0 for a_id in agent_id_list}

    for student in students:
        # 轮询：选当前分配数量最少的话务员
        min_agent_id = min(counts, key=counts.get)
        by_agent.setdefault(min_agent_id, []).append(student.id)
        counts[min_agent_id] += 1

    for agent_id, ids in by_agent.items():
        await db.execute(
            update(Student)
            .where(Student.id.in_(ids))
            .values(assigned_to=agent_id, assigned_at=now)
        )

    await db.commit()
    return Response.ok({
        "total_assigned": len(students),
        "distribution": {f"agent_{a_id}": len(ids) for a_id, ids in by_agent.items()},
    })



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


@router.get("/phone/{student_id}")
async def get_student_phone(
    student_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    student = await get_accessible_student(db, student_id, current_user)
    db.add(
        make_operation_log(
            current_user,
            student.id,
            student.case_no or "",
            "查看电话",
            content="查看明文电话号码",
        )
    )
    await db.commit()
    return Response.ok({
        "guardian_phone": student.guardian_phone,
        "guardian2_phone": student.guardian2_phone,
    })


@router.delete("/{student_id}")
async def delete_student(
    student_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    student = await get_student_or_404(db, student_id)
    for model in (Call, Note, FollowUp, LeadViewLog, Visit):
        await db.execute(delete(model).where(model.student_id == student_id))
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

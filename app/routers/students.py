import logging
import re
import uuid
from datetime import date, datetime, timedelta, timezone
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

from app.auth import get_current_user, require_admin, require_agent
from app.database import get_db
from app.models import (
    Call,
    DialLog,
    EnrollmentSubStage,
    FollowUp,
    IntentLevel,
    LeadViewLog,
    Note,
    Student,
    StudentStage,
    StudentStatus,
    SystemConfig,
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
from app.region_extractor import extract_region
from app.schemas import EnrollInfo, Response, StageUpdate, StudentCreate, StudentUpdate
from app.utils import make_operation_log, utcnow

router = APIRouter(prefix="/api/students", tags=["学生"])

logger = logging.getLogger(__name__)


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
AGENT_STUDENT_UPDATE_FIELDS = {"status", "intent_level", "join_reasons", "stage", "need_help", "score"}


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


def _student_payload(student: Student) -> dict:
    status = student.status.value
    intent_level = student.intent_level.value
    stage = student.stage.value
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
        "guardian_phone": student.guardian_phone,
        "guardian_phone_raw": student.guardian_phone,
        "guardian2_name": student.guardian2_name,
        "guardian2_phone": student.guardian2_phone,
        "guardian2_phone_raw": student.guardian2_phone,
        "school_name": student.school_name,
        "school_address": student.school_address,
        "enrolled_at": str(student.enrolled_at) if student.enrolled_at else None,
        "program": student.program,
        "deposit": student.deposit,
        "expired_at": str(student.expired_at) if student.expired_at else None,
        "enrollment_substage": student.enrollment_substage.value if student.enrollment_substage else None,
        "created_at": str(student.created_at),
        "updated_at": str(student.updated_at),
    }
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
        parsed = {
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
        }
    else:
        parsed = _infer_import_row(row)
        if not parsed.get("name"):
            return None, "无法识别姓名"

    if not parsed.get("region") and parsed.get("school_name"):
        parsed["region"] = extract_region(parsed["school_name"])
    return parsed, None


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

        # Batch-check for duplicate phone numbers against existing DB records.
        # 同一行的 guardian_phone / guardian2_phone 都纳入查重；库里命中任一字段视为已存在。
        phones_to_check: set[str] = set()
        for _, p in parsed_rows:
            for key in ("guardian_phone", "guardian2_phone"):
                val = p.get(key) or ""
                if val:
                    phones_to_check.add(val)

        existing_phones: set[str] = set()
        if phones_to_check:
            existing_r = await db.execute(
                select(Student.guardian_phone, Student.guardian2_phone).where(
                    or_(
                        Student.guardian_phone.in_(phones_to_check),
                        Student.guardian2_phone.in_(phones_to_check),
                    )
                )
            )
            for g1, g2 in existing_r.all():
                if g1:
                    existing_phones.add(g1)
                if g2:
                    existing_phones.add(g2)

        seen_in_file: set[str] = set()
        student_rows = []
        for row_idx, parsed in parsed_rows:
            phone = parsed.get("guardian_phone", "") or ""
            phone2 = parsed.get("guardian2_phone", "") or ""
            row_phones = [p for p in (phone, phone2) if p]

            dup_db = next((p for p in row_phones if p in existing_phones), None)
            if dup_db:
                skipped_rows.append({"row": row_idx, "reason": f"手机号已存在（库中已有该学员）: {dup_db}"})
                continue
            dup_file = next((p for p in row_phones if p in seen_in_file), None)
            if dup_file:
                skipped_rows.append({"row": row_idx, "reason": f"手机号在本次导入中重复: {dup_file}"})
                continue
            seen_in_file.update(row_phones)

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
                    "guardian2_phone": phone2,
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
        logger.warning("Excel import parse failed: %s", exc)
        return Response.error(code=1, msg=f"文件解析失败: {exc}")
    except SQLAlchemyError:
        await db.rollback()
        logger.exception("Excel import DB write failed")
        return Response.error(code=1, msg="数据库写入失败")
    except Exception:
        await db.rollback()
        logger.exception("Excel import failed (unexpected)")
        return Response.error(code=1, msg="导入失败，请检查文件格式")
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

    region_value = body.region
    if not region_value and body.school_name:
        region_value = extract_region(body.school_name)

    student = Student(
        name=body.name,
        region=region_value,
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
    return Response.ok(_student_payload(student))


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
    school_name: str = Query(""),
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
        # SAEnum 列存的是 enum.name（英文），前端传的是 value（中文）。
        # 转成 enum 实例后 SQLAlchemy 才会正确映射为 name 进 SQL。
        try:
            status_enum = StudentStatus(status)
        except ValueError:
            return Response.ok({"total": 0, "page": page, "page_size": page_size, "list": []})
        query = query.where(Student.status == status_enum)
    else:
        # 默认隐藏终态线索：已报名/已过期/未接通/无效。需要看时手动选状态筛选。
        query = query.where(
            Student.status.not_in(
                [
                    StudentStatus.enrolled,
                    StudentStatus.expired,
                    StudentStatus.rejected,
                    StudentStatus.invalid,
                ]
            )
        )
    if intent_level:
        try:
            intent_enum = IntentLevel(intent_level)
        except ValueError:
            return Response.ok({"total": 0, "page": page, "page_size": page_size, "list": []})
        query = query.where(Student.intent_level == intent_enum)
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
    if school_name:
        query = query.where(Student.school_name == school_name)
    if stage:
        try:
            stage_enum = StudentStage(stage)
        except ValueError:
            return Response.ok({"total": 0, "page": page, "page_size": page_size, "list": []})
        query = query.where(Student.stage == stage_enum)
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
            "list": [_student_payload(s) for s in students],
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


@router.get("/dispatch-regions")
async def list_dispatch_regions(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """获取「未分配且有学校名」学生的区县列表及其未分配人数。"""
    result = await db.execute(
        select(Student.region, func.count(Student.id))
        .where(
            Student.school_name != "",
            Student.region != "",
            Student.assigned_to.is_(None),
        )
        .group_by(Student.region)
        .order_by(func.count(Student.id).desc())
    )
    regions = [{"name": row[0], "count": row[1]} for row in result.all()]
    return Response.ok(regions)


@router.get("/schools")
async def list_schools(
    regions: list[str] = Query(default=[]),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """获取有未分配学生的学校列表及其未分配数量。

    可选 regions：仅统计属于这些区县的未分配学生。
    """
    cleaned_regions = [r.strip() for r in regions if r and r.strip()]
    conditions = [Student.school_name != "", Student.assigned_to.is_(None)]
    if cleaned_regions:
        conditions.append(Student.region.in_(cleaned_regions))
    result = await db.execute(
        select(Student.school_name, func.count(Student.id))
        .where(*conditions)
        .group_by(Student.school_name)
        .order_by(func.count(Student.id).desc())
    )
    schools = [{"name": row[0], "count": row[1]} for row in result.all()]
    return Response.ok(schools)


_CST = timezone(timedelta(hours=8))


async def _get_system_config(db: AsyncSession, key: str, default: str = "") -> str:
    result = await db.execute(select(SystemConfig.value).where(SystemConfig.key == key))
    value = result.scalar_one_or_none()
    return (value or "").strip() or default


def _parse_hhmm(value: str) -> tuple[int, int]:
    try:
        hh, mm = value.split(":")
        return int(hh), int(mm)
    except (ValueError, AttributeError):
        return 0, 0


@router.get("/phone/{student_id}")
async def get_student_phone(
    student_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    student = await get_accessible_student(db, student_id, current_user)

    # 1. 拨号窗口校验
    window_start = await _get_system_config(db, "dial_window_start", "08:00")
    window_end = await _get_system_config(db, "dial_window_end", "21:00")
    max_per_24h_str = await _get_system_config(db, "dial_max_per_24h", "3")
    try:
        max_per_24h = int(max_per_24h_str)
    except ValueError:
        max_per_24h = 3

    now_cst = datetime.now(_CST)
    start_h, start_m = _parse_hhmm(window_start)
    end_h, end_m = _parse_hhmm(window_end)
    cur_minutes = now_cst.hour * 60 + now_cst.minute
    start_minutes = start_h * 60 + start_m
    end_minutes = end_h * 60 + end_m
    if cur_minutes < start_minutes or cur_minutes >= end_minutes:
        raise HTTPException(
            status_code=403,
            detail=f"当前为禁拨时段（拨号窗口 {window_start}-{window_end}）",
        )

    # 2. 24h 防撞号校验（全局，任何坐席）
    since = utcnow() - timedelta(hours=24)
    count_r = await db.execute(
        select(func.count(DialLog.id)).where(
            DialLog.student_id == student.id,
            DialLog.dialed_at >= since,
        )
    )
    count_24h = count_r.scalar() or 0
    if count_24h >= max_per_24h:
        raise HTTPException(
            status_code=403,
            detail=f"该学生 24h 内已被拨打 {count_24h} 次，达到上限 {max_per_24h}",
        )

    # 3. 通过校验，写 DialLog 并记录操作日志
    db.add(DialLog(student_id=student.id, agent_id=current_user.id))
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


@router.get("/{student_id}/intent-timeline")
async def get_intent_timeline(
    student_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    student = await get_accessible_student(db, student_id, current_user)

    result = await db.execute(
        select(Call.id, Call.ai_intent, Call.ai_confidence, Call.agent_id, Call.created_at)
        .where(Call.student_id == student.id, Call.ai_intent != "", Call.ai_intent != "无")
        .order_by(Call.created_at.asc())
    )
    timeline = [
        {
            "call_id": call_id,
            "intent": ai_intent,
            "confidence": ai_confidence,
            "agent_id": agent_id,
            "at": str(created_at),
        }
        for call_id, ai_intent, ai_confidence, agent_id, created_at in result.all()
    ]

    return Response.ok(
        {
            "student_id": student.id,
            "current_intent": str(student.intent_level),
            "created_at": str(student.created_at),
            "timeline": timeline,
        }
    )


class EnrollmentSubStageBody(BaseModel):
    enrollment_substage: str | None = None


@router.put("/{student_id}/enrollment-substage")
async def update_enrollment_substage(
    student_id: int,
    body: EnrollmentSubStageBody,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if not is_admin(current_user):
        raise HTTPException(status_code=403, detail="无权修改报名后状态")
    student = await get_student_or_404(db, student_id)

    old_value = str(student.enrollment_substage) if student.enrollment_substage else ""
    if body.enrollment_substage is None or body.enrollment_substage == "":
        student.enrollment_substage = None
        new_value = ""
    else:
        try:
            student.enrollment_substage = EnrollmentSubStage(body.enrollment_substage)
        except ValueError:
            valid = [e.value for e in EnrollmentSubStage]
            raise HTTPException(
                status_code=400,
                detail=f"无效的报名后状态，合法值：{valid}",
            )
        new_value = body.enrollment_substage

    db.add(
        make_operation_log(
            current_user,
            student.id,
            student.case_no or "",
            "修改报名后状态",
            content=f"{old_value} → {new_value}",
            old_status=old_value,
            new_status=new_value,
        )
    )
    await db.commit()
    await db.refresh(student)
    return Response.ok(
        {
            "enrollment_substage": str(student.enrollment_substage)
            if student.enrollment_substage
            else None,
        }
    )


@router.get("/{student_id}/detail")
async def get_student_detail(
    student_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """聚合学生所有维度信息：基本资料 + 通话 + 备注 + 回访 + 到访 + 意向轨迹。"""
    student = await get_accessible_student(db, student_id, current_user)

    log = LeadViewLog(student_id=student.id, viewer_id=current_user.id)
    db.add(log)

    # 学生基本信息
    payload = _student_payload(student)
    payload["enrollment_substage"] = (
        str(student.enrollment_substage) if student.enrollment_substage else None
    )

    # 通话（最近 50）
    calls_r = await db.execute(
        select(Call, User.name)
        .outerjoin(User, Call.agent_id == User.id)
        .where(Call.student_id == student.id)
        .order_by(Call.created_at.desc())
        .limit(50)
    )
    calls = [
        {
            "id": c.id,
            "agent_id": c.agent_id,
            "agent_name": agent_name or "",
            "duration_seconds": c.duration_seconds,
            "ai_intent": c.ai_intent,
            "ai_confidence": c.ai_confidence,
            "ai_summary": c.ai_summary,
            "ai_reasons": c.ai_reasons,
            "created_at": str(c.created_at),
        }
        for c, agent_name in calls_r.all()
    ]

    # 备注（最近 50）
    notes_r = await db.execute(
        select(Note, User.name)
        .outerjoin(User, Note.agent_id == User.id)
        .where(Note.student_id == student.id)
        .order_by(Note.created_at.desc())
        .limit(50)
    )
    notes = [
        {
            "id": n.id,
            "content": n.content,
            "source": n.source,
            "agent_id": n.agent_id,
            "agent_name": agent_name or "",
            "created_at": str(n.created_at),
            "updated_at": str(n.updated_at),
        }
        for n, agent_name in notes_r.all()
    ]

    # 回访（全部）
    fu_r = await db.execute(
        select(FollowUp, User.name)
        .outerjoin(User, FollowUp.agent_id == User.id)
        .where(FollowUp.student_id == student.id)
        .order_by(FollowUp.follow_up_date.desc())
    )
    follow_ups = [
        {
            "id": f.id,
            "agent_id": f.agent_id,
            "agent_name": agent_name or "",
            "follow_up_date": str(f.follow_up_date),
            "follow_up_type": f.follow_up_type or "",
            "notes": f.notes or "",
            "is_completed": f.is_completed,
            "is_notified": f.is_notified,
            "created_at": str(f.created_at),
        }
        for f, agent_name in fu_r.all()
    ]

    # 到访（全部）
    visits_r = await db.execute(
        select(Visit, User.name)
        .outerjoin(User, Visit.agent_id == User.id)
        .where(Visit.student_id == student.id)
        .order_by(Visit.scheduled_date.desc())
    )
    visits = [
        {
            "id": v.id,
            "agent_id": v.agent_id,
            "agent_name": agent_name or "",
            "visit_type": str(v.visit_type),
            "scheduled_date": str(v.scheduled_date),
            "status": str(v.status),
            "notes": v.notes or "",
            "created_at": str(v.created_at),
        }
        for v, agent_name in visits_r.all()
    ]

    # 意向轨迹（复用 /intent-timeline 的查询逻辑）
    intent_r = await db.execute(
        select(Call.id, Call.ai_intent, Call.ai_confidence, Call.agent_id, Call.created_at)
        .where(Call.student_id == student.id, Call.ai_intent != "", Call.ai_intent != "无")
        .order_by(Call.created_at.asc())
    )
    intent_timeline = [
        {
            "call_id": cid,
            "intent": ai_intent,
            "confidence": ai_conf,
            "agent_id": aid,
            "at": str(created_at),
        }
        for cid, ai_intent, ai_conf, aid, created_at in intent_r.all()
    ]

    await db.commit()

    return Response.ok(
        {
            "student": payload,
            "calls": calls,
            "notes": notes,
            "follow_ups": follow_ups,
            "visits": visits,
            "intent_timeline": intent_timeline,
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

    return Response.ok(_student_payload(student))


@router.put("/{student_id}")
async def update_student(
    student_id: int,
    body: StudentUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    student = await get_accessible_student(db, student_id, current_user)
    raw = body.model_dump(exclude_unset=True)
    # invalid_reason 不写入 Student 表，仅用于在状态改为"无效"时附加到操作日志，作为审计依据
    invalid_reason = (raw.pop("invalid_reason", None) or "").strip()
    if not raw:
        return Response.ok(_student_payload(student))

    allowed_fields = (
        ADMIN_STUDENT_UPDATE_FIELDS if is_admin(current_user) else AGENT_STUDENT_UPDATE_FIELDS
    )
    forbidden = sorted(set(raw) - allowed_fields)
    if forbidden:
        raise HTTPException(status_code=403, detail=f"无权修改字段: {', '.join(forbidden)}")

    old_intent = student.intent_level
    old_status = student.status
    old_stage = student.stage
    old_assigned = student.assigned_to
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

    intent_changed = "intent_level" in raw and old_intent != student.intent_level
    status_changed = old_status != student.status
    stage_changed = old_stage != student.stage
    assigned_changed = "assigned_to" in raw and old_assigned != student.assigned_to

    if intent_changed:
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

    if status_changed or stage_changed or assigned_changed:
        parts = []
        if status_changed:
            parts.append(f"状态 {old_status} → {student.status}")
            # 改为"无效"时附加原因，留作管理员事后抽查
            if student.status == StudentStatus.invalid and invalid_reason:
                parts.append(f"无效原因：{invalid_reason}")
        if stage_changed:
            parts.append(f"阶段 {old_stage} → {student.stage}")
        if assigned_changed:
            parts.append(f"分配 {old_assigned} → {student.assigned_to}")
        db.add(
            make_operation_log(
                current_user,
                student.id,
                student.case_no or "",
                "修改状态" if status_changed else "修改信息",
                content="; ".join(parts),
                old_status=str(old_status) if status_changed else "",
                new_status=str(student.status) if status_changed else "",
                note_content=invalid_reason if (status_changed and student.status == StudentStatus.invalid) else "",
            )
        )

    await db.commit()
    await db.refresh(student)
    if intent_changed and student.intent_level == IntentLevel.A:
        await notify_a_level_change(db, student, current_user, "manual")
    return Response.ok(_student_payload(student))


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
    if student.enrollment_substage is None:
        student.enrollment_substage = EnrollmentSubStage.deposit_pending

    await db.commit()
    await db.refresh(student)
    return Response.ok(
        {
            "enrolled_at": str(student.enrolled_at),
            "program": student.program,
            "deposit": student.deposit,
            "enrollment_substage": str(student.enrollment_substage) if student.enrollment_substage else None,
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
        cnt = await db.execute(
            select(func.count(Student.id)).where(
                Student.assigned_to == a.id,
                Student.status.not_in(
                    [
                        StudentStatus.enrolled,
                        StudentStatus.expired,
                        StudentStatus.rejected,
                        StudentStatus.invalid,
                    ]
                ),
            )
        )
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

    # 一个地区可被多个话务员服务；命中地区时按当前活跃负载最小者分配
    region_map: dict[str, list[User]] = {}
    for a in agents:
        if a.service_regions:
            for r in a.service_regions.replace("，", ",").split(","):
                r = r.strip()
                if r:
                    region_map.setdefault(r, []).append(a)

    # 活跃负载基线（排除终态学生），避免历史已报名/已过期影响公平
    load = {}
    for a in agents:
        cnt = await db.execute(
            select(func.count(Student.id)).where(
                Student.assigned_to == a.id,
                Student.status.not_in(
                    [
                        StudentStatus.enrolled,
                        StudentStatus.expired,
                        StudentStatus.rejected,
                        StudentStatus.invalid,
                    ]
                ),
            )
        )
        load[a.id] = cnt.scalar() or 0
    agent_name_by_id = {a.id: a.name for a in agents}

    unassigned_result = await db.execute(
        select(Student).where(Student.assigned_to.is_(None)).order_by(Student.created_at.asc())
    )
    unassigned = unassigned_result.scalars().all()

    distribution = {a.name: {"matched": 0, "fallback": 0} for a in agents}
    now = utcnow()
    total_assigned = 0
    by_agent: dict[int, list[int]] = {}

    for student in unassigned:
        matched_candidates = region_map.get(student.region or "", [])
        if matched_candidates:
            # 同地区多话务员：选负载最小者
            chosen = min(matched_candidates, key=lambda a: load[a.id])
            agent_id = chosen.id
            distribution[chosen.name]["matched"] += 1
        else:
            agent_id = min(load, key=load.get)
            name = agent_name_by_id.get(agent_id, "")
            if name:
                distribution[name]["fallback"] += 1

        by_agent.setdefault(agent_id, []).append(student.id)
        load[agent_id] += 1
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
    """按学校分发：选学校、可选区县过滤、选多个话务员ID、轮询分配"""
    school = body.get("school_name", "").strip()
    agent_ids = body.get("agent_ids", [])
    regions_raw = body.get("regions", []) or []
    if not isinstance(regions_raw, list):
        return Response.error(code=1, msg="区县参数格式错误")
    regions = [r.strip() for r in regions_raw if isinstance(r, str) and r.strip()]
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

    # 查出该学校未分配的学生（可选按区县过滤）
    conditions = [
        Student.school_name == school,
        Student.assigned_to.is_(None),
    ]
    if regions:
        conditions.append(Student.region.in_(regions))
    students_result = await db.execute(
        select(Student).where(*conditions).order_by(Student.created_at.asc())
    )
    students = students_result.scalars().all()
    if not students:
        return Response.error(code=1, msg="该学校在所选区县下没有未分配的学生" if regions else "该学校没有未分配的学生")

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


@router.delete("/{student_id}")
async def delete_student(
    student_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    student = await get_student_or_404(db, student_id)
    db.add(
        make_operation_log(
            current_user,
            student.id,
            student.case_no or "",
            "删除线索",
            content=f"删除学生 {student.name}（含通话/备注/回访/到访/查看日志）",
        )
    )
    for model in (Call, Note, FollowUp, LeadViewLog, Visit, DialLog):
        await db.execute(delete(model).where(model.student_id == student_id))
    await db.delete(student)
    await db.commit()
    return Response.ok(msg="删除成功")


@router.get("/agent/settings")
async def agent_settings(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_agent),
):
    """返回话务员端需要的非敏感系统配置。"""
    from app.routers.admin import get_config_value
    dial_max_str = await get_config_value(db, "dial_max_per_24h", "3")
    try:
        dial_max = max(1, int(dial_max_str))
    except (ValueError, TypeError):
        dial_max = 3
    return Response.ok({"dial_max_per_24h": dial_max})


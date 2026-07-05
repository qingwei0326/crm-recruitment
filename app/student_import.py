import re

from app.region_extractor import extract_region
from app.utils import normalize_phone

MAX_STUDENT_IMPORT_BYTES = 10 * 1024 * 1024

IMPORT_COLUMN_ALIASES = {
    "name": {"name", "student", "student_name", "姓名", "学生姓名"},
    "region": {"region", "area", "地区", "区域", "地域"},
    "score": {"score", "grade", "分数", "成绩"},
    "guardian_name": {
        "guardian_name",
        "parent_name",
        "家长姓名",
        "监护人姓名",
    },
    "guardian_phone": {
        "phone",
        "mobile",
        "tel",
        "telephone",
        "guardian_phone",
        "parent_phone",
        "电话",
        "手机号",
        "联系电话",
        "家长电话",
        "监护人电话",
    },
    "guardian2_name": {
        "guardian2_name",
        "parent2_name",
        "第二监护人姓名",
        "监护人2姓名",
    },
    "guardian2_phone": {
        "guardian2_phone",
        "parent2_phone",
        "第二监护人电话",
        "监护人2电话",
    },
    "school_name": {
        "school",
        "school_name",
        "毕业学校",
        "学校",
        "学校名称",
    },
    "school_address": {"school_address", "学校地址"},
    "program": {"program", "专业", "意向专业", "课程"},
    "join_reasons": {
        "join_reasons",
        "reason",
        "报名原因",
        "咨询原因",
    },
}


def normalize_import_header(value) -> str:
    return re.sub(r"[\s_\-]+", "", str(value or "").strip().lower())


def build_import_header_map(header_row) -> dict[str, int]:
    normalized_aliases = {
        field: {normalize_import_header(alias) for alias in aliases}
        for field, aliases in IMPORT_COLUMN_ALIASES.items()
    }
    header_map = {}
    for idx, value in enumerate(header_row):
        normalized = normalize_import_header(value)
        if not normalized:
            continue
        for field, aliases in normalized_aliases.items():
            if normalized in aliases and field not in header_map:
                header_map[field] = idx
                break
    return header_map


def row_value(row, header_map: dict[str, int], field: str):
    idx = header_map.get(field)
    if idx is None or idx >= len(row):
        return None
    return row[idx]


def clean_import_text(value) -> str:
    if value is None:
        return ""
    return str(value).strip()


def clean_import_phone(value) -> str:
    return normalize_phone(value)


def parse_import_float(value, field_label: str) -> float | None:
    text = clean_import_text(value)
    if text == "":
        return None
    try:
        return float(text)
    except (TypeError, ValueError):
        raise ValueError(f"{field_label}格式无效: {value}")


def is_empty_import_row(row) -> bool:
    return all(clean_import_text(value) == "" for value in row)


def looks_like_phone(value: str) -> bool:
    digits = re.sub(r"\D+", "", value)
    return 7 <= len(digits) <= 20


def looks_like_score(value: str) -> bool:
    try:
        score = float(value)
    except ValueError:
        return False
    return 0 <= score <= 1000 and not looks_like_phone(value)


def looks_like_school(value: str) -> bool:
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


def looks_like_region(value: str) -> bool:
    return any(marker in value for marker in ("区", "县", "市", "镇", "乡"))


def looks_like_person_name(value: str) -> bool:
    return len(value) <= 16 and not looks_like_school(value) and not looks_like_region(value)


def dedupe_contact_phones(
    guardian_phone: str | None, guardian2_phone: str | None
) -> tuple[str, str]:
    phone = normalize_phone(guardian_phone)
    phone2 = normalize_phone(guardian2_phone)
    if phone and phone2 and phone == phone2:
        phone2 = ""
    return phone, phone2


def infer_import_row(row) -> dict:
    values = [clean_import_text(value) for value in row]
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
        if not inferred["guardian_phone"] and looks_like_phone(value):
            inferred["guardian_phone"] = clean_import_phone(value)
        elif inferred["score"] is None and looks_like_score(value):
            inferred["score"] = float(value)
        else:
            text_values.append(value)

    if text_values:
        inferred["name"] = text_values[0]
    for value in text_values[1:]:
        if not inferred["school_name"] and looks_like_school(value):
            inferred["school_name"] = value
        elif not inferred["region"] and looks_like_region(value):
            inferred["region"] = value
        elif not inferred["guardian_name"] and looks_like_person_name(value):
            inferred["guardian_name"] = value
        elif not inferred["guardian2_name"] and looks_like_person_name(value):
            inferred["guardian2_name"] = value
        elif not inferred["school_name"]:
            inferred["school_name"] = value
        elif not inferred["school_address"]:
            inferred["school_address"] = value
        else:
            inferred["join_reasons"] = (
                f"{inferred['join_reasons']} {value}".strip() if inferred["join_reasons"] else value
            )

    return inferred


def parse_import_row(row, header_map: dict[str, int]) -> tuple[dict | None, str | None]:
    if header_map:
        name = clean_import_text(row_value(row, header_map, "name"))
        if not name:
            return None, "缺少姓名"
        try:
            score = parse_import_float(row_value(row, header_map, "score"), "score")
        except ValueError as exc:
            return None, str(exc)
        parsed = {
            "name": name,
            "region": clean_import_text(row_value(row, header_map, "region")),
            "score": score,
            "guardian_name": clean_import_text(row_value(row, header_map, "guardian_name")),
            "guardian_phone": clean_import_phone(row_value(row, header_map, "guardian_phone")),
            "guardian2_name": clean_import_text(row_value(row, header_map, "guardian2_name")),
            "guardian2_phone": clean_import_phone(row_value(row, header_map, "guardian2_phone")),
            "school_name": clean_import_text(row_value(row, header_map, "school_name")),
            "school_address": clean_import_text(row_value(row, header_map, "school_address")),
            "program": clean_import_text(row_value(row, header_map, "program")),
            "join_reasons": clean_import_text(row_value(row, header_map, "join_reasons")),
        }
    else:
        parsed = infer_import_row(row)
        if not parsed.get("name"):
            return None, "无法识别姓名"

    if not parsed.get("region") and parsed.get("school_name"):
        parsed["region"] = extract_region(parsed["school_name"])
    parsed["guardian_phone"], parsed["guardian2_phone"] = dedupe_contact_phones(
        parsed.get("guardian_phone"),
        parsed.get("guardian2_phone"),
    )
    return parsed, None

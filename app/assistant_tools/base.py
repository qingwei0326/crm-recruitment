from __future__ import annotations

import hashlib
import json
import re
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import (
    Student,
    User,
)
from app.status_policy import (
    canonical_status_value,
)
from app.utils import mask_phone

RISK_READ = "read"
RISK_WRITE = "write"
RISK_DESTRUCTIVE = "destructive"

ToolHandler = Callable[[AsyncSession, BaseModel, User], Awaitable[dict[str, Any]]]


class AssistantToolError(ValueError):
    pass


class StrictArgs(BaseModel):
    model_config = ConfigDict(extra="forbid")


class StudentIdsArgs(StrictArgs):
    student_ids: list[int] = Field(min_length=1, max_length=100)

    @field_validator("student_ids")
    @classmethod
    def normalize_student_ids(cls, value: list[int]) -> list[int]:
        normalized = list(dict.fromkeys(value))
        if any(student_id <= 0 for student_id in normalized):
            raise ValueError("student_ids 必须是正整数")
        return normalized


@dataclass(frozen=True)
class AssistantToolDefinition:
    name: str
    label: str
    description: str
    risk_level: str
    args_model: type[BaseModel]
    execute: ToolHandler
    preview: ToolHandler | None = None
    requires_backup: bool = False
    sensitive_result_fields: tuple[str, ...] = ()

    def openai_schema(self) -> dict[str, Any]:
        schema = self.args_model.model_json_schema()
        schema["additionalProperties"] = False
        return {
            "type": "function",
            "function": {
                "name": self.name,
                "description": self.description,
                "parameters": schema,
            },
        }

    def parse_args(self, value: dict[str, Any]) -> BaseModel:
        try:
            return self.args_model.model_validate(value)
        except ValueError as exc:
            raise AssistantToolError(f"工具 {self.name} 参数无效：{exc}") from exc


def json_digest(value: Any) -> str:
    raw = json.dumps(value, ensure_ascii=True, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(raw.encode()).hexdigest()


def redact_phone_text(value: str) -> str:
    return re.sub(r"(?<!\d)(1\d{2})\d{4}(\d{4})(?!\d)", r"\1****\2", value or "")


def student_payload(student: Student, agent_name: str | None = None) -> dict[str, Any]:
    return {
        "id": student.id,
        "name": student.name,
        "status": canonical_status_value(student.status),
        "status_detail": student.status_detail or "",
        "stage": student.stage.value,
        "school_name": student.school_name or "",
        "region": student.region or "",
        "guardian_phone": mask_phone(student.guardian_phone or ""),
        "guardian2_phone": mask_phone(student.guardian2_phone or ""),
        "assigned_to": student.assigned_to,
        "agent_name": agent_name or "未分配",
        "enrolled_at": str(student.enrolled_at) if student.enrolled_at else None,
        "updated_at": str(student.updated_at),
    }


async def load_students_exact(
    db: AsyncSession,
    student_ids: list[int],
) -> list[Student]:
    result = await db.execute(select(Student).where(Student.id.in_(student_ids)))
    by_id = {student.id: student for student in result.scalars().all()}
    missing = [student_id for student_id in student_ids if student_id not in by_id]
    if missing:
        raise AssistantToolError(f"未找到学生 ID：{', '.join(map(str, missing[:10]))}")
    return [by_id[student_id] for student_id in student_ids]

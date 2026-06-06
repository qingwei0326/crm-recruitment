from datetime import date, datetime
from typing import Literal

from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field, field_validator

_VALID_STATUSES = {"未联系", "已联系", "待回访", "已完成", "无效", "已报名", "拒绝接听", "已过期"}
_VALID_INTENT_LEVELS = {"A", "B", "C", "无"}
_VALID_STAGES = {"初次联系", "有意向", "已送资料", "预约参观", "已来访", "已报名"}


class Response:
    """统一 API 响应格式，返回 JSONResponse 以确保类型安全。"""

    @staticmethod
    def ok(data=None, msg="ok") -> JSONResponse:
        return JSONResponse(content={"code": 0, "data": data, "msg": msg})

    @staticmethod
    def error(code=1, msg="error", data=None) -> JSONResponse:
        return JSONResponse(content={"code": code, "data": data, "msg": msg})


class LoginReq(BaseModel):
    username: str = Field(..., min_length=1, max_length=64)
    password: str = Field(..., min_length=1, max_length=128)


# ── Student ──────────────────────────────────────────────


class StudentCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=64)
    region: str = Field(default="")
    status: str | None = None
    intent_level: str | None = None
    assigned_to: int | None = None
    join_reasons: str | None = None
    stage: str | None = None
    enrolled_at: date | None = None
    program: str | None = None
    deposit: float | None = Field(default=None, ge=0)
    score: float | None = None
    guardian_name: str | None = None
    guardian_phone: str | None = None
    guardian2_name: str | None = None
    guardian2_phone: str | None = None
    school_name: str | None = None
    school_address: str | None = None
    need_help: bool | None = None

    @field_validator("status")
    @classmethod
    def validate_status(cls, v):
        if v is not None and v not in _VALID_STATUSES:
            raise ValueError(f"无效的状态: {v}，合法值: {sorted(_VALID_STATUSES)}")
        return v

    @field_validator("intent_level")
    @classmethod
    def validate_intent_level(cls, v):
        if v is not None and v not in _VALID_INTENT_LEVELS:
            raise ValueError(f"无效的意向等级: {v}，合法值: {sorted(_VALID_INTENT_LEVELS)}")
        return v

    @field_validator("stage")
    @classmethod
    def validate_stage(cls, v):
        if v is not None and v not in _VALID_STAGES:
            raise ValueError(f"无效的阶段: {v}，合法值: {sorted(_VALID_STAGES)}")
        return v


class StudentUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=64)
    status: str | None = None
    intent_level: str | None = None
    assigned_to: int | None = None
    join_reasons: str | None = None
    region: str | None = None
    stage: str | None = None
    enrolled_at: date | None = None
    program: str | None = None
    deposit: float | None = Field(default=None, ge=0)
    score: float | None = None
    guardian_name: str | None = None
    guardian_phone: str | None = None
    guardian2_name: str | None = None
    guardian2_phone: str | None = None
    school_name: str | None = None
    school_address: str | None = None
    need_help: bool | None = None
    # 仅当 status 改为"无效"时由前端传入，用于审计；不持久化到 students 表，记入 OperationLog
    invalid_reason: str | None = Field(default=None, max_length=200)

    @field_validator("status")
    @classmethod
    def validate_status(cls, v):
        if v is not None and v not in _VALID_STATUSES:
            raise ValueError(f"无效的状态: {v}，合法值: {sorted(_VALID_STATUSES)}")
        return v

    @field_validator("intent_level")
    @classmethod
    def validate_intent_level(cls, v):
        if v is not None and v not in _VALID_INTENT_LEVELS:
            raise ValueError(f"无效的意向等级: {v}，合法值: {sorted(_VALID_INTENT_LEVELS)}")
        return v

    @field_validator("stage")
    @classmethod
    def validate_stage(cls, v):
        if v is not None and v not in _VALID_STAGES:
            raise ValueError(f"无效的阶段: {v}，合法值: {sorted(_VALID_STAGES)}")
        return v


class StageUpdate(BaseModel):
    stage: str


class EnrollInfo(BaseModel):
    enrolled_at: date | None = None
    program: str = Field(default="")
    deposit: float | None = Field(default=None, ge=0)


# ── Call ──────────────────────────────────────────────────


class CallCreate(BaseModel):
    student_id: int
    duration_seconds: int = 0
    recording_path: str = ""
    transcript: str = Field(default="", max_length=10000)
    ai_intent: str = ""
    ai_reasons: str = ""
    ai_summary: str = ""
    ai_confidence: float = 0.0
    analyzed_at: datetime | None = None


# ── Note ──────────────────────────────────────────────────


class NoteCreate(BaseModel):
    student_id: int
    content: str = Field(..., min_length=1)


class NoteUpdate(BaseModel):
    content: str = Field(..., min_length=1)


# ── FollowUp ──────────────────────────────────────────────


class FollowUpCreate(BaseModel):
    student_id: int
    follow_up_date: datetime
    follow_up_type: Literal["电话", "短信", "家访", "其他"] = "电话"
    notes: str = ""


class FollowUpUpdate(BaseModel):
    follow_up_date: datetime | None = None
    is_notified: bool | None = None
    is_completed: bool | None = None
    follow_up_type: Literal["电话", "短信", "家访", "其他"] | None = None
    notes: str | None = None


class StaleReassignReq(BaseModel):
    student_ids: list[int]
    mode: Literal["auto", "manual", "recycle"]
    agent_id: int | None = None


# ── Visit ─────────────────────────────────────────────────


class VisitCreate(BaseModel):
    student_id: int
    visit_type: Literal["来校参观", "家访"]
    scheduled_date: datetime
    notes: str = Field(default="")


class VisitUpdate(BaseModel):
    visit_type: Literal["来校参观", "家访"] | None = None
    scheduled_date: datetime | None = None
    status: Literal["待确认", "已确认", "已完成", "已取消"] | None = None
    notes: str | None = None


# ── Student Response (API payload) ─────────────────────────

class StudentResponse(BaseModel):
    """学生信息 API 响应体，替代 _student_payload 的 dict。"""
    id: int
    name: str
    region: str = ""
    assigned_to: int | None = None
    status: str
    intent_level: str
    stage: str
    join_reasons: str = ""
    case_no: str | None = None
    need_help: bool = False
    score: float | None = None
    guardian_name: str = ""
    guardian_phone: str = ""  # masked
    guardian2_name: str = ""
    guardian2_phone: str = ""  # masked
    school_name: str = ""
    school_address: str = ""
    enrolled_at: str | None = None
    program: str = ""
    deposit: float | None = None
    expired_at: str | None = None
    enrollment_substage: str | None = None
    created_at: str = ""
    updated_at: str = ""
    guardian_phone_raw: str | None = None  # only when full_phone=True
    guardian2_phone_raw: str | None = None  # only when full_phone=True

    model_config = {'from_attributes': True}

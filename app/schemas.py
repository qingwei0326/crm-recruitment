from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, Field


class Response(BaseModel):
    code: int = 0
    data: object = None
    msg: str = "ok"

    @staticmethod
    def ok(data=None, msg="ok"):
        return {"code": 0, "data": data, "msg": msg}

    @staticmethod
    def error(code=1, msg="error", data=None):
        return {"code": code, "data": data, "msg": msg}


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
    deposit: float | None = None
    score: float | None = None
    guardian_name: str | None = None
    guardian_phone: str | None = None
    guardian2_name: str | None = None
    guardian2_phone: str | None = None
    school_name: str | None = None
    school_address: str | None = None
    need_help: bool | None = None


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
    deposit: float | None = None
    score: float | None = None
    guardian_name: str | None = None
    guardian_phone: str | None = None
    guardian2_name: str | None = None
    guardian2_phone: str | None = None
    school_name: str | None = None
    school_address: str | None = None
    need_help: bool | None = None


class StageUpdate(BaseModel):
    stage: str


class EnrollInfo(BaseModel):
    enrolled_at: date | None = None
    program: str = Field(default="")
    deposit: float | None = None


# ── Call ──────────────────────────────────────────────────


class CallCreate(BaseModel):
    student_id: int
    duration_seconds: int = 0
    recording_path: str = ""
    transcript: str = ""
    ai_intent: str = ""
    ai_reasons: str = ""
    ai_summary: str = ""
    ai_confidence: float = 0.0
    analyzed_at: datetime | None = None


class CallCheck(BaseModel):
    student_id: int


# ── Note ──────────────────────────────────────────────────


class NoteCreate(BaseModel):
    student_id: int
    content: str = Field(..., min_length=1)


# ── FollowUp ──────────────────────────────────────────────


class FollowUpCreate(BaseModel):
    student_id: int
    follow_up_date: datetime


class FollowUpUpdate(BaseModel):
    follow_up_date: datetime | None = None
    is_notified: bool | None = None


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


# ── Message Template ──────────────────────────────────────


class TemplateCreate(BaseModel):
    title: str = Field(..., min_length=1, max_length=128)
    content: str = Field(..., min_length=1)
    category: str = Field(default="通用")


class TemplateUpdate(BaseModel):
    title: str | None = None
    content: str | None = None
    category: str | None = None
    is_active: bool | None = None
    sort_order: int | None = None

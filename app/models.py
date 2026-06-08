import enum
from datetime import datetime, timedelta, timezone

from sqlalchemy import (
    Boolean,
    Column,
    Date,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    func,
)
from sqlalchemy import Enum as SAEnum
from sqlalchemy.orm import relationship

from app.database import Base


class UserRole(enum.StrEnum):
    admin = "admin"
    agent = "agent"


class StudentStatus(enum.StrEnum):
    not_contacted = "未联系"
    contacted = "已联系"
    pending_visit = "待回访"
    completed = "已完成"
    invalid = "无效"
    enrolled = "已报名"
    rejected = "拒绝接听"
    expired = "已过期"


class IntentLevel(enum.StrEnum):
    A = "A"
    B = "B"
    C = "C"
    none = "无"


class StudentStage(enum.StrEnum):
    initial_contact = "初次联系"
    interested = "有意向"
    materials_sent = "已送资料"
    visit_scheduled = "预约参观"
    visited = "已来访"
    enrolled = "已报名"


class VisitType(enum.StrEnum):
    campus = "来校参观"
    home = "家访"


class VisitStatus(enum.StrEnum):
    pending = "待确认"
    confirmed = "已确认"
    completed = "已完成"
    cancelled = "已取消"


class EnrollmentSubStage(enum.StrEnum):
    deposit_pending = "定金待缴"
    full_payment_pending = "全款待缴"
    full_payment_received = "已缴全款"
    registered = "入学注册"
    churned = "流失"


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, autoincrement=True)
    username = Column(String(64), unique=True, nullable=False, index=True)
    hashed_password = Column(String(256), nullable=False)
    role = Column(SAEnum(UserRole), nullable=False, default=UserRole.agent)
    name = Column(String(64), nullable=False)
    is_active = Column(Boolean, default=True, nullable=False)
    failed_login_attempts = Column(Integer, default=0, nullable=False)
    locked_until = Column(DateTime, nullable=True)
    # 递增式 token 版本号：改密码 / 禁用用户时 +1，旧 JWT 立即失效
    token_version = Column(Integer, default=1, nullable=False)
    service_regions = Column(String(512), default="", nullable=False)
    pushplus_token = Column(String(64), default="", nullable=False)
    last_login_device = Column(String(512), default="", nullable=False)
    last_login_ip = Column(String(64), default="", nullable=False)
    created_at = Column(DateTime, default=func.now(), nullable=False)

    students = relationship("Student", back_populates="assigned_agent", lazy="dynamic")
    calls = relationship("Call", back_populates="agent", lazy="dynamic")
    notes = relationship("Note", back_populates="agent", lazy="dynamic")
    follow_ups = relationship("FollowUp", back_populates="agent", lazy="dynamic")


class Student(Base):
    __tablename__ = "students"
    __table_args__ = (
        Index("ix_students_assigned_status", "assigned_to", "status"),
        Index("ix_students_status_school", "status", "school_name"),
        Index("ix_students_guardian_phone", "guardian_phone"),
    )

    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(String(64), nullable=False)
    region = Column(String(64), default="", nullable=False, index=True)
    assigned_to = Column(Integer, ForeignKey("users.id"), nullable=True)
    status = Column(SAEnum(StudentStatus), nullable=False, default=StudentStatus.not_contacted)
    intent_level = Column(SAEnum(IntentLevel), nullable=False, default=IntentLevel.none)
    stage = Column(SAEnum(StudentStage), nullable=False, default=StudentStage.initial_contact)
    join_reasons = Column(Text, default="")
    enrolled_at = Column(Date, nullable=True)
    program = Column(String(128), default="", nullable=False)
    deposit = Column(Float, nullable=True)
    score = Column(Float, nullable=True)
    guardian_name = Column(String(64), default="", nullable=False)
    guardian_phone = Column(String(20), default="", nullable=False)
    guardian2_name = Column(String(64), default="", nullable=False)
    guardian2_phone = Column(String(20), default="", nullable=False)
    school_name = Column(String(128), default="", nullable=False, index=True)
    school_address = Column(String(256), default="", nullable=False)
    case_no = Column(String(36), unique=True, nullable=True)
    need_help = Column(Boolean, default=False, nullable=False)
    expired_at = Column(Date, nullable=True)
    assigned_at = Column(DateTime, nullable=True)
    enrollment_substage = Column(SAEnum(EnrollmentSubStage), nullable=True)
    created_at = Column(DateTime, default=func.now(), nullable=False)
    updated_at = Column(DateTime, default=func.now(), onupdate=func.now(), nullable=False)

    assigned_agent = relationship("User", back_populates="students")
    calls = relationship("Call", back_populates="student", lazy="dynamic")
    notes = relationship("Note", back_populates="student", lazy="dynamic")
    follow_ups = relationship("FollowUp", back_populates="student", lazy="dynamic")

    @staticmethod
    def default_expired_at():
        return (datetime.now(timezone.utc) + timedelta(days=30)).date()


class Call(Base):
    __tablename__ = "calls"

    id = Column(Integer, primary_key=True, autoincrement=True)
    student_id = Column(Integer, ForeignKey("students.id"), nullable=False)
    agent_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    duration_seconds = Column(Integer, default=0)
    recording_path = Column(String(512), default="")
    transcript = Column(Text, default="")
    ai_intent = Column(String(8), default="")
    ai_reasons = Column(Text, default="")
    ai_summary = Column(Text, default="")
    ai_confidence = Column(Float, default=0.0)
    analyzed_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=func.now(), nullable=False)

    student = relationship("Student", back_populates="calls")
    agent = relationship("User", back_populates="calls")


class Note(Base):
    __tablename__ = "notes"

    id = Column(Integer, primary_key=True, autoincrement=True)
    student_id = Column(Integer, ForeignKey("students.id"), nullable=False)
    agent_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    content = Column(Text, nullable=False)
    source = Column(String(16), default="human", nullable=False)
    created_at = Column(DateTime, default=func.now(), nullable=False)
    updated_at = Column(DateTime, default=func.now(), onupdate=func.now(), nullable=False)

    student = relationship("Student", back_populates="notes")
    agent = relationship("User", back_populates="notes")


class FollowUp(Base):
    __tablename__ = "follow_ups"

    id = Column(Integer, primary_key=True, autoincrement=True)
    student_id = Column(Integer, ForeignKey("students.id"), nullable=False)
    agent_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    follow_up_date = Column(DateTime, nullable=False)
    follow_up_type = Column(String(16), nullable=True)
    notes = Column(Text, default="")
    is_notified = Column(Boolean, default=False, nullable=False)
    is_completed = Column(Boolean, default=False, nullable=False)
    created_at = Column(DateTime, default=func.now(), nullable=False)

    student = relationship("Student", back_populates="follow_ups")
    agent = relationship("User", back_populates="follow_ups")


class LeadViewLog(Base):
    __tablename__ = "lead_view_logs"

    id = Column(Integer, primary_key=True, autoincrement=True)
    student_id = Column(Integer, ForeignKey("students.id"), nullable=False)
    viewer_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    viewed_at = Column(DateTime, default=func.now(), nullable=False)


class Visit(Base):
    __tablename__ = "visits"

    id = Column(Integer, primary_key=True, autoincrement=True)
    student_id = Column(Integer, ForeignKey("students.id"), nullable=False)
    agent_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    visit_type = Column(SAEnum(VisitType), nullable=False)
    scheduled_date = Column(DateTime, nullable=False)
    status = Column(SAEnum(VisitStatus), nullable=False, default=VisitStatus.pending)
    notes = Column(Text, default="")
    created_at = Column(DateTime, default=func.now(), nullable=False)
    updated_at = Column(DateTime, default=func.now(), onupdate=func.now(), nullable=False)

    student = relationship("Student", backref="visits")
    agent = relationship("User", backref="visits")


class OperationLog(Base):
    __tablename__ = "operation_logs"

    id = Column(Integer, primary_key=True, autoincrement=True)
    operator_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    operator_name = Column(String(64), nullable=False)
    target_student_id = Column(Integer, nullable=True)
    case_no = Column(String(36), default="")
    action = Column(String(32), nullable=False)  # 登录/修改状态/写备注/分配/修改信息
    content = Column(Text, default="")
    old_status = Column(String(32), default="")
    new_status = Column(String(32), default="")
    note_content = Column(Text, default="")
    created_at = Column(DateTime, default=func.now(), nullable=False)

    operator = relationship("User", backref="operation_logs")


class SystemConfig(Base):
    __tablename__ = "system_configs"

    key = Column(String(64), primary_key=True, nullable=False)
    value = Column(Text, default="", nullable=False)
    updated_at = Column(DateTime, default=func.now(), onupdate=func.now(), nullable=False)


class LoginAttempt(Base):
    """登录尝试，用于跨进程共享 IP 限流。"""

    __tablename__ = "login_attempts"

    id = Column(Integer, primary_key=True, autoincrement=True)
    ip = Column(String(64), nullable=False, index=True)
    attempted_at = Column(DateTime, default=func.now(), nullable=False, index=True)


class DialLog(Base):
    """拨号记录，用于全局 24h 防撞号。每次成功获取明文电话即记录一行。"""

    __tablename__ = "dial_logs"

    id = Column(Integer, primary_key=True, autoincrement=True)
    student_id = Column(Integer, ForeignKey("students.id"), nullable=False, index=True)
    agent_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    dialed_at = Column(DateTime, default=func.now(), nullable=False, index=True)

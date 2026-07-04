import enum
from datetime import UTC, datetime, timedelta

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
    new_lead = "新线索"
    not_contacted = "未联系"
    # Historical DB rows may still store this enum name. SQLAlchemy stores enum
    # names by default, so keep it as an alias while startup migration normalizes.
    unassigned = "未联系"
    contacted = "已联系"
    pending_visit = "待回访"
    completed = "已完成"
    invalid = "无效"
    enrolled = "已报名"
    rejected = "拒绝接听"
    expired = "已过期"
    very_interested = "非常有意向"
    interested_add_wechat = "意向了解加微"
    not_reached = "未接"
    high_score = "高分段"
    not_interested = "无意向"
    no_intent = "无意向"
    child_not_want_study = "孩子不想读"
    child_not_interested = "孩子不想读"


class IntentLevel(enum.StrEnum):
    A = "A"
    B = "B"
    C = "C"
    none = "无"


class StudentStage(enum.StrEnum):
    initial_contact = "初次联系"
    interested = "有意向"
    materials_sent = "已送资料"
    home_visit_pending = "待家访"
    home_visit_scheduled = "家访已安排"
    home_visit_completed = "家访完成"
    campus_visit_pending = "待到校参观"
    campus_visit_scheduled = "到校参观已安排"
    campus_visit_arrived = "已到校参观"
    # Historical stages kept for existing rows and old clients. New admissions
    # workflow writes the more specific home/campus stages above.
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


class HomeVisitStatus(enum.StrEnum):
    pending = "待确认"
    confirmed = "已确认"
    scheduled = "已安排"
    completed = "已完成"
    cancelled = "已取消"
    postponed = "暂缓"


class HomeVisitResult(enum.StrEnum):
    success = "成功"
    considering = "考虑中"
    waiting_score = "等成绩"
    invalid = "无效"
    enrolled = "已报名"
    campus_visit = "安排到校参观"


class CampusVisitStatus(enum.StrEnum):
    pending = "待预约"
    scheduled = "已预约"
    arrived = "已到校"
    no_show = "未到校"
    rescheduled = "已改期"
    cancelled = "已取消"
    enrolled = "已报名"


class CampusVisitResult(enum.StrEnum):
    arrived = "已到校"
    no_show = "未到校"
    rescheduled = "改期"
    cancelled = "取消"
    enrolled = "现场报名"
    considering = "继续考虑"


class EnrollmentSource(enum.StrEnum):
    phone_call = "电话外呼"
    home_visit = "家访后"
    campus_visit = "到校参观后"
    admin = "管理员补录"


class AttributionMethod(enum.StrEnum):
    current_agent = "自动当前负责人"
    campus_visit_creator = "自动到校预约人"
    home_visit_creator = "自动家访申请人"
    manual = "手动指定"


class SettlementStatus(enum.StrEnum):
    unsettled = "未结算"
    settled = "已结算"
    postponed = "暂缓"
    disputed = "争议"


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
    is_super_admin = Column(Boolean, default=False, nullable=False)
    failed_login_attempts = Column(Integer, default=0, nullable=False)
    locked_until = Column(DateTime, nullable=True)
    # 首次登录 / 管理员重置密码后置 True，强制用户登录后自行设置新密码
    must_change_password = Column(Boolean, default=False, nullable=False)
    # 递增式 token 版本号：改密码 / 禁用用户时 +1，旧 JWT 立即失效
    token_version = Column(Integer, default=1, nullable=False)
    service_regions = Column(String(512), default="", nullable=False)
    pushplus_token = Column(String(64), default="", nullable=False)
    page_permissions = Column(String(512), default="", nullable=False)
    operation_permissions = Column(String(1024), default="", nullable=False)
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
        Index("ix_students_guardian2_phone", "guardian2_phone"),
    )

    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(String(64), nullable=False)
    region = Column(String(64), default="", nullable=False, index=True)
    assigned_to = Column(Integer, ForeignKey("users.id"), nullable=True)
    status = Column(
        SAEnum(StudentStatus, omit_aliases=False),
        nullable=False,
        default=StudentStatus.not_contacted,
    )
    status_detail = Column(String(64), default="", nullable=False)
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
    home_visit_tasks = relationship("HomeVisitTask", back_populates="student", lazy="dynamic")
    campus_visit_tasks = relationship("CampusVisitTask", back_populates="student", lazy="dynamic")
    enrollment_records = relationship("EnrollmentRecord", back_populates="student", lazy="dynamic")

    @staticmethod
    def default_expired_at():
        return (datetime.now(UTC) + timedelta(days=30)).date()


class Call(Base):
    __tablename__ = "calls"
    __table_args__ = (
        Index("ix_calls_student_id", "student_id"),
        Index("ix_calls_agent_id", "agent_id"),
        Index("ix_calls_created_at", "created_at"),
    )

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
    __table_args__ = (Index("ix_notes_student_id", "student_id"),)

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
    __table_args__ = (
        Index("ix_follow_ups_student_id", "student_id"),
        Index("ix_follow_ups_agent_id", "agent_id"),
    )

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
    __table_args__ = (Index("ix_lead_view_logs_student_id", "student_id"),)

    id = Column(Integer, primary_key=True, autoincrement=True)
    student_id = Column(Integer, ForeignKey("students.id"), nullable=False)
    viewer_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    viewed_at = Column(DateTime, default=func.now(), nullable=False)


class Visit(Base):
    __tablename__ = "visits"
    __table_args__ = (
        Index("ix_visits_student_id", "student_id"),
        Index("ix_visits_agent_id", "agent_id"),
    )

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


class HomeVisitTask(Base):
    __tablename__ = "home_visit_tasks"
    __table_args__ = (
        Index("ix_home_visit_tasks_student_id", "student_id"),
        Index("ix_home_visit_tasks_creator_agent_id", "creator_agent_id"),
        Index("ix_home_visit_tasks_status", "status"),
        Index("ix_home_visit_tasks_scheduled_at", "scheduled_at"),
        Index("ix_home_visit_tasks_region", "region_snapshot"),
    )

    id = Column(Integer, primary_key=True, autoincrement=True)
    student_id = Column(Integer, ForeignKey("students.id"), nullable=False)
    creator_agent_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    assigned_admin_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    status = Column(SAEnum(HomeVisitStatus), nullable=False, default=HomeVisitStatus.pending)
    result = Column(SAEnum(HomeVisitResult), nullable=True)
    priority = Column(String(8), default="中", nullable=False)
    student_name_snapshot = Column(String(64), default="", nullable=False)
    guardian_phone_snapshot = Column(String(20), default="", nullable=False)
    region_snapshot = Column(String(64), default="", nullable=False)
    school_name_snapshot = Column(String(128), default="", nullable=False)
    intent_program = Column(String(128), default="", nullable=False)
    exam_score = Column(Float, nullable=True)
    usual_score = Column(Float, nullable=True)
    parent_intent = Column(Text, default="", nullable=False)
    student_situation = Column(Text, default="", nullable=False)
    is_wechat_added = Column(Boolean, default=False, nullable=False)
    is_confirmed_with_guardian = Column(Boolean, default=False, nullable=False)
    requested_visit_time = Column(DateTime, nullable=True)
    scheduled_at = Column(DateTime, nullable=True)
    address = Column(String(256), default="", nullable=False)
    postpone_reason = Column(String(64), default="", nullable=False)
    guardian_attitude = Column(Text, default="", nullable=False)
    student_attitude = Column(Text, default="", nullable=False)
    concerns = Column(Text, default="", nullable=False)
    next_action = Column(String(64), default="", nullable=False)
    next_follow_up_at = Column(DateTime, nullable=True)
    notes = Column(Text, default="", nullable=False)
    result_notes = Column(Text, default="", nullable=False)
    created_at = Column(DateTime, default=func.now(), nullable=False)
    updated_at = Column(DateTime, default=func.now(), onupdate=func.now(), nullable=False)

    student = relationship("Student", back_populates="home_visit_tasks")
    creator_agent = relationship("User", foreign_keys=[creator_agent_id])
    assigned_admin = relationship("User", foreign_keys=[assigned_admin_id])


class CampusVisitTask(Base):
    __tablename__ = "campus_visit_tasks"
    __table_args__ = (
        Index("ix_campus_visit_tasks_student_id", "student_id"),
        Index("ix_campus_visit_tasks_creator_user_id", "creator_user_id"),
        Index("ix_campus_visit_tasks_status", "status"),
        Index("ix_campus_visit_tasks_appointment_at", "appointment_at"),
        Index("ix_campus_visit_tasks_region", "region_snapshot"),
    )

    id = Column(Integer, primary_key=True, autoincrement=True)
    student_id = Column(Integer, ForeignKey("students.id"), nullable=False)
    creator_user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    reception_admin_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    home_visit_task_id = Column(Integer, ForeignKey("home_visit_tasks.id"), nullable=True)
    status = Column(SAEnum(CampusVisitStatus), nullable=False, default=CampusVisitStatus.pending)
    result = Column(SAEnum(CampusVisitResult), nullable=True)
    source = Column(String(32), default="", nullable=False)
    student_name_snapshot = Column(String(64), default="", nullable=False)
    guardian_phone_snapshot = Column(String(20), default="", nullable=False)
    region_snapshot = Column(String(64), default="", nullable=False)
    school_name_snapshot = Column(String(128), default="", nullable=False)
    intent_program = Column(String(128), default="", nullable=False)
    appointment_at = Column(DateTime, nullable=True)
    needs_pickup = Column(Boolean, default=False, nullable=False)
    visitor_count = Column(Integer, default=1, nullable=False)
    current_concerns = Column(Text, default="", nullable=False)
    reception_content = Column(Text, default="", nullable=False)
    guardian_attitude = Column(Text, default="", nullable=False)
    student_attitude = Column(Text, default="", nullable=False)
    onsite_enrolled = Column(Boolean, default=False, nullable=False)
    not_enrolled_reason = Column(Text, default="", nullable=False)
    next_action = Column(String(64), default="", nullable=False)
    next_follow_up_at = Column(DateTime, nullable=True)
    notes = Column(Text, default="", nullable=False)
    result_notes = Column(Text, default="", nullable=False)
    created_at = Column(DateTime, default=func.now(), nullable=False)
    updated_at = Column(DateTime, default=func.now(), onupdate=func.now(), nullable=False)

    student = relationship("Student", back_populates="campus_visit_tasks")
    creator_user = relationship("User", foreign_keys=[creator_user_id])
    reception_admin = relationship("User", foreign_keys=[reception_admin_id])
    home_visit_task = relationship("HomeVisitTask")


class EnrollmentRecord(Base):
    __tablename__ = "enrollment_records"
    __table_args__ = (
        Index("ix_enrollment_records_student_id", "student_id"),
        Index("ix_enrollment_records_attributed_agent_id", "attributed_agent_id"),
        Index("ix_enrollment_records_enrolled_at", "enrolled_at"),
        Index("ix_enrollment_records_settlement_status", "settlement_status"),
    )

    id = Column(Integer, primary_key=True, autoincrement=True)
    student_id = Column(Integer, ForeignKey("students.id"), nullable=False)
    attributed_agent_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    confirmed_by_admin_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    first_assigned_agent_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    current_assigned_agent_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    last_effective_agent_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    home_visit_task_id = Column(Integer, ForeignKey("home_visit_tasks.id"), nullable=True)
    campus_visit_task_id = Column(Integer, ForeignKey("campus_visit_tasks.id"), nullable=True)
    student_name_snapshot = Column(String(64), default="", nullable=False)
    guardian_phone_snapshot = Column(String(20), default="", nullable=False)
    region_snapshot = Column(String(64), default="", nullable=False)
    school_name_snapshot = Column(String(128), default="", nullable=False)
    intent_program = Column(String(128), default="", nullable=False)
    enrolled_program = Column(String(128), default="", nullable=False)
    enrolled_at = Column(DateTime, default=func.now(), nullable=False)
    source = Column(SAEnum(EnrollmentSource), nullable=False, default=EnrollmentSource.admin)
    attribution_method = Column(
        SAEnum(AttributionMethod), nullable=False, default=AttributionMethod.current_agent
    )
    attribution_reason = Column(Text, default="", nullable=False)
    amount = Column(Float, nullable=True)
    settlement_status = Column(
        SAEnum(SettlementStatus), nullable=False, default=SettlementStatus.unsettled
    )
    settlement_notes = Column(Text, default="", nullable=False)
    created_at = Column(DateTime, default=func.now(), nullable=False)
    updated_at = Column(DateTime, default=func.now(), onupdate=func.now(), nullable=False)

    student = relationship("Student", back_populates="enrollment_records")
    attributed_agent = relationship("User", foreign_keys=[attributed_agent_id])
    confirmed_by_admin = relationship("User", foreign_keys=[confirmed_by_admin_id])
    first_assigned_agent = relationship("User", foreign_keys=[first_assigned_agent_id])
    current_assigned_agent = relationship("User", foreign_keys=[current_assigned_agent_id])
    last_effective_agent = relationship("User", foreign_keys=[last_effective_agent_id])
    home_visit_task = relationship("HomeVisitTask")
    campus_visit_task = relationship("CampusVisitTask")


class OperationLog(Base):
    __tablename__ = "operation_logs"
    __table_args__ = (
        Index("ix_operation_logs_target_student_id", "target_student_id"),
        Index("ix_operation_logs_action", "action"),
        Index("ix_operation_logs_batch_id", "batch_id"),
    )

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
    batch_id = Column(String(64), default="", nullable=False)
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
    duration_seconds = Column(Integer, default=0)

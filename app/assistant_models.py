from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Index, Integer, String, Text, func

from app.database import Base


class AssistantConfig(Base):
    __tablename__ = "assistant_configs"

    id = Column(Integer, primary_key=True, default=1)
    enabled = Column(Boolean, nullable=False, default=False)
    base_url = Column(String(512), nullable=False, default="https://api.openai.com/v1")
    model = Column(String(128), nullable=False, default="")
    api_key_ciphertext = Column(Text, nullable=False, default="")
    api_key_last4 = Column(String(8), nullable=False, default="")
    updated_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime, nullable=False, default=func.now())
    updated_at = Column(DateTime, nullable=False, default=func.now(), onupdate=func.now())


class AssistantSession(Base):
    __tablename__ = "assistant_sessions"
    __table_args__ = (Index("ix_assistant_sessions_owner_updated", "owner_id", "updated_at"),)

    id = Column(String(36), primary_key=True)
    owner_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    title = Column(String(120), nullable=False, default="新对话")
    status = Column(String(24), nullable=False, default="active")
    created_at = Column(DateTime, nullable=False, default=func.now())
    updated_at = Column(DateTime, nullable=False, default=func.now(), onupdate=func.now())


class AssistantRun(Base):
    __tablename__ = "assistant_runs"
    __table_args__ = (Index("ix_assistant_runs_session_created", "session_id", "created_at"),)

    id = Column(String(36), primary_key=True)
    session_id = Column(
        String(36),
        ForeignKey("assistant_sessions.id", ondelete="CASCADE"),
        nullable=False,
    )
    operator_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    status = Column(String(32), nullable=False, default="running")
    model = Column(String(128), nullable=False, default="")
    provider_request_id = Column(String(128), nullable=False, default="")
    prompt_tokens = Column(Integer, nullable=False, default=0)
    completion_tokens = Column(Integer, nullable=False, default=0)
    error_message = Column(Text, nullable=False, default="")
    created_at = Column(DateTime, nullable=False, default=func.now())
    completed_at = Column(DateTime, nullable=True)


class AssistantMessage(Base):
    __tablename__ = "assistant_messages"
    __table_args__ = (
        Index("ix_assistant_messages_session_created", "session_id", "created_at", "id"),
    )

    id = Column(Integer, primary_key=True, autoincrement=True)
    session_id = Column(
        String(36),
        ForeignKey("assistant_sessions.id", ondelete="CASCADE"),
        nullable=False,
    )
    run_id = Column(String(36), ForeignKey("assistant_runs.id", ondelete="SET NULL"), nullable=True)
    role = Column(String(16), nullable=False)
    content = Column(Text, nullable=False, default="")
    created_at = Column(DateTime, nullable=False, default=func.now())


class AssistantToolCall(Base):
    __tablename__ = "assistant_tool_calls"
    __table_args__ = (
        Index("ix_assistant_tool_calls_session_created", "session_id", "created_at"),
        Index("ix_assistant_tool_calls_status_expires", "status", "expires_at"),
    )

    id = Column(String(36), primary_key=True)
    run_id = Column(
        String(36),
        ForeignKey("assistant_runs.id", ondelete="CASCADE"),
        nullable=False,
    )
    session_id = Column(
        String(36),
        ForeignKey("assistant_sessions.id", ondelete="CASCADE"),
        nullable=False,
    )
    operator_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    tool_name = Column(String(64), nullable=False)
    risk_level = Column(String(24), nullable=False)
    status = Column(String(32), nullable=False)
    arguments_json = Column(Text, nullable=False, default="{}")
    preview_json = Column(Text, nullable=False, default="{}")
    preview_hash = Column(String(64), nullable=False, default="")
    confirmation_phrase = Column(String(128), nullable=False, default="")
    result_json = Column(Text, nullable=False, default="{}")
    error_message = Column(Text, nullable=False, default="")
    expires_at = Column(DateTime, nullable=True)
    approved_at = Column(DateTime, nullable=True)
    executed_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, nullable=False, default=func.now())

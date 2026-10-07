"""AI assistant tool registry.

Tools live in modules grouped by risk level (read / write / destructive); this
package assembles them into the single ``TOOLS`` registry the assistant service
uses. ``from app.assistant_tools import ...`` keeps working for all public names.
"""

from __future__ import annotations

from typing import Any

from app.assistant_tools import destructive_tools, read_tools, write_tools
from app.assistant_tools.base import (  # noqa: F401 - re-exported for callers/tests
    RISK_DESTRUCTIVE,
    RISK_READ,
    RISK_WRITE,
    AssistantToolDefinition,
    AssistantToolError,
    StrictArgs,
    StudentIdsArgs,
    json_digest,
)
from app.assistant_tools.read_tools import (  # noqa: F401 - re-exported for callers/tests
    LeadSummaryArgs,
    _lead_summary,
)
from app.assistant_tools.write_tools import (  # noqa: F401
    AssignSchoolStudentsArgs,
    _preview_assign_school_students,
)

TOOLS = read_tools.TOOLS + write_tools.TOOLS + destructive_tools.TOOLS

TOOL_BY_NAME = {tool.name: tool for tool in TOOLS}


def assistant_tool_schemas() -> list[dict[str, Any]]:
    return [tool.openai_schema() for tool in TOOLS]


def assistant_tool(name: str) -> AssistantToolDefinition:
    try:
        return TOOL_BY_NAME[name]
    except KeyError as exc:
        raise AssistantToolError(f"AI 请求了未授权工具：{name}") from exc


def public_preview(preview: dict[str, Any]) -> dict[str, Any]:
    return {
        key: value for key, value in preview.items() if not key.startswith("_") and key != "state"
    }


def preview_state_hash(preview: dict[str, Any]) -> str:
    return json_digest(preview.get("state"))


def redact_sensitive_result(
    tool: AssistantToolDefinition,
    result: dict[str, Any],
) -> dict[str, Any]:
    persisted = dict(result)
    for field in tool.sensitive_result_fields:
        if field in persisted:
            persisted[field] = "[仅在执行响应中显示一次]"
    return persisted

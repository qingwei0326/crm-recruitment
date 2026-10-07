import pytest
from sqlalchemy import select

from app.assistant_config_service import (
    AssistantConfigError,
    assistant_chat_endpoint,
    normalize_assistant_base_url,
)
from app.assistant_models import AssistantConfig, AssistantRun, AssistantToolCall
from app.assistant_provider import AssistantProviderResponse
from app.assistant_security import (
    AssistantSecretError,
    decrypt_assistant_secret,
    encrypt_assistant_secret,
)
from app.assistant_tools import (
    AssignSchoolStudentsArgs,
    AssistantToolError,
    LeadSummaryArgs,
    _lead_summary,
    _preview_assign_school_students,
    assistant_tool_schemas,
)
from app.auth import verify_password
from app.models import OperationLog, Student, StudentStatus


async def _enable_assistant(client, admin_headers):
    response = await client.put(
        "/api/admin/assistant/config",
        headers=admin_headers,
        json={
            "enabled": True,
            "base_url": "https://provider.example/v1",
            "model": "tool-model",
            "api_key": "provider-key",
        },
    )
    assert response.json()["code"] == 0


async def _create_session(client, admin_headers):
    response = await client.post("/api/admin/assistant/sessions", headers=admin_headers)
    assert response.json()["code"] == 0
    return response.json()["data"]["id"]


def _provider_tool_call(name, arguments, *, call_id="provider-call-1"):
    return AssistantProviderResponse(
        request_id="request-1",
        message={
            "role": "assistant",
            "content": None,
            "tool_calls": [
                {
                    "id": call_id,
                    "type": "function",
                    "function": {"name": name, "arguments": arguments},
                }
            ],
        },
        prompt_tokens=10,
        completion_tokens=5,
    )


def _provider_text(content):
    return AssistantProviderResponse(
        request_id="request-2",
        message={"role": "assistant", "content": content},
        prompt_tokens=8,
        completion_tokens=4,
    )


def _mock_provider_sequence(monkeypatch, responses):
    queue = list(responses)

    async def fake_call(*_args, **_kwargs):
        assert queue, "provider called more times than expected"
        return queue.pop(0)

    monkeypatch.setattr("app.assistant_service.call_openai_chat_completions", fake_call)


@pytest.mark.asyncio
async def test_assistant_config_requires_super_admin(client, normal_admin_headers):
    response = await client.get("/api/admin/assistant/config", headers=normal_admin_headers)
    assert response.status_code == 403


@pytest.mark.asyncio
async def test_assistant_config_defaults(client, admin_headers):
    response = await client.get("/api/admin/assistant/config", headers=admin_headers)
    assert response.status_code == 200
    assert response.json() == {
        "code": 0,
        "data": {
            "enabled": False,
            "base_url": "https://api.openai.com/v1",
            "endpoint": "https://api.openai.com/v1/chat/completions",
            "model": "",
            "api_key_configured": False,
            "api_key_last4": "",
            "protocol": "openai_chat_completions",
        },
        "msg": "ok",
    }


@pytest.mark.asyncio
async def test_assistant_config_encrypts_key_and_preserves_it_when_omitted(
    client,
    db,
    admin_headers,
):
    saved = await client.put(
        "/api/admin/assistant/config",
        headers=admin_headers,
        json={
            "enabled": True,
            "base_url": "https://example.test/v1/",
            "model": "tool-model",
            "api_key": "secret-assistant-key",
        },
    )
    assert saved.status_code == 200
    assert saved.json()["data"]["api_key_last4"] == "-key"
    assert saved.json()["data"]["endpoint"] == "https://example.test/v1/chat/completions"

    config = await db.get(AssistantConfig, 1)
    assert config is not None
    assert config.api_key_ciphertext.startswith("v1:")
    assert "secret-assistant-key" not in config.api_key_ciphertext
    assert decrypt_assistant_secret(config.api_key_ciphertext) == "secret-assistant-key"
    ciphertext = config.api_key_ciphertext

    updated = await client.put(
        "/api/admin/assistant/config",
        headers=admin_headers,
        json={
            "enabled": True,
            "base_url": "https://second.example/v1/chat/completions",
            "model": "second-model",
        },
    )
    assert updated.json()["code"] == 0
    await db.refresh(config)
    assert config.api_key_ciphertext == ciphertext

    log = (
        (
            await db.execute(
                select(OperationLog)
                .where(OperationLog.action == "修改AI助手配置")
                .order_by(OperationLog.id.desc())
            )
        )
        .scalars()
        .first()
    )
    assert log is not None
    assert "secret-assistant-key" not in log.content


@pytest.mark.asyncio
async def test_assistant_config_rejects_enabled_without_model_or_key(client, admin_headers):
    response = await client.put(
        "/api/admin/assistant/config",
        headers=admin_headers,
        json={
            "enabled": True,
            "base_url": "https://api.openai.com/v1",
            "model": "",
        },
    )
    assert response.status_code == 400
    assert response.json()["code"] == 1
    assert "Model" in response.json()["msg"]


@pytest.mark.asyncio
async def test_assistant_config_can_clear_key_when_disabled(client, db, admin_headers):
    await client.put(
        "/api/admin/assistant/config",
        headers=admin_headers,
        json={
            "enabled": False,
            "base_url": "https://api.openai.com/v1",
            "model": "model",
            "api_key": "temporary-key",
        },
    )
    response = await client.put(
        "/api/admin/assistant/config",
        headers=admin_headers,
        json={
            "enabled": False,
            "base_url": "https://api.openai.com/v1",
            "model": "model",
            "clear_api_key": True,
        },
    )
    assert response.json()["data"]["api_key_configured"] is False
    config = await db.get(AssistantConfig, 1)
    assert config.api_key_ciphertext == ""


@pytest.mark.asyncio
async def test_assistant_connection_test_uses_saved_runtime_config(
    client,
    admin_headers,
    monkeypatch,
):
    await client.put(
        "/api/admin/assistant/config",
        headers=admin_headers,
        json={
            "enabled": True,
            "base_url": "https://provider.example/v1",
            "model": "provider-model",
            "api_key": "provider-key",
        },
    )
    captured = {}

    async def fake_test(config):
        captured["config"] = config
        return {
            "ok": True,
            "model": config.model,
            "endpoint": config.endpoint,
            "tool_calling": True,
            "request_id": "req-test",
        }

    monkeypatch.setattr("app.routers.admin_assistant.test_openai_tool_call", fake_test)
    response = await client.post(
        "/api/admin/assistant/config/test",
        headers=admin_headers,
    )
    assert response.json()["code"] == 0
    assert captured["config"].api_key == "provider-key"
    assert captured["config"].endpoint == "https://provider.example/v1/chat/completions"


def test_assistant_url_normalization_and_endpoint_rules():
    assert normalize_assistant_base_url("https://example.test/v1/") == "https://example.test/v1"
    assert assistant_chat_endpoint("https://example.test") == (
        "https://example.test/v1/chat/completions"
    )
    assert assistant_chat_endpoint("https://example.test/custom/chat/completions") == (
        "https://example.test/custom/chat/completions"
    )
    with pytest.raises(AssistantConfigError):
        normalize_assistant_base_url("file:///etc/passwd")
    with pytest.raises(AssistantConfigError):
        normalize_assistant_base_url("http://169.254.169.254/latest")


def test_assistant_secret_round_trip_and_tamper_detection():
    encrypted = encrypt_assistant_secret("top-secret")
    assert encrypted != "top-secret"
    assert decrypt_assistant_secret(encrypted) == "top-secret"
    with pytest.raises(AssistantSecretError):
        decrypt_assistant_secret(f"{encrypted[:-2]}xx")


@pytest.mark.asyncio
async def test_assistant_session_endpoints_require_super_admin(client, normal_admin_headers):
    list_response = await client.get(
        "/api/admin/assistant/sessions",
        headers=normal_admin_headers,
    )
    create_response = await client.post(
        "/api/admin/assistant/sessions",
        headers=normal_admin_headers,
    )
    assert list_response.status_code == 403
    assert create_response.status_code == 403


@pytest.mark.asyncio
async def test_assistant_read_tool_runs_and_returns_final_answer(
    client,
    admin_headers,
    sample_student,
    monkeypatch,
):
    await _enable_assistant(client, admin_headers)
    session_id = await _create_session(client, admin_headers)
    _mock_provider_sequence(
        monkeypatch,
        [
            _provider_tool_call("search_students", '{"query":"张三","limit":10}'),
            _provider_text("找到 1 名张三。"),
        ],
    )
    response = await client.post(
        f"/api/admin/assistant/sessions/{session_id}/messages",
        headers=admin_headers,
        json={"content": "查一下张三", "context": {"route": "/admin/leads"}},
    )
    assert response.json()["code"] == 0
    data = response.json()["data"]
    assert data["messages"][-1]["content"] == "找到 1 名张三。"
    assert data["tool_calls"][0]["tool_name"] == "search_students"
    assert data["tool_calls"][0]["status"] == "executed"
    assert data["tool_calls"][0]["result"]["students"][0]["id"] == sample_student.id


@pytest.mark.asyncio
async def test_assistant_write_waits_for_confirmation_then_executes(
    client,
    db,
    admin_headers,
    sample_student,
    monkeypatch,
):
    await _enable_assistant(client, admin_headers)
    session_id = await _create_session(client, admin_headers)
    _mock_provider_sequence(
        monkeypatch,
        [
            _provider_tool_call(
                "mark_students_invalid",
                f'{{"student_ids":[{sample_student.id}],"reason":"上高中"}}',
            )
        ],
    )
    proposed = await client.post(
        f"/api/admin/assistant/sessions/{session_id}/messages",
        headers=admin_headers,
        json={"content": "把张三改成无效，原因上高中"},
    )
    assert proposed.json()["code"] == 0
    call = proposed.json()["data"]["tool_calls"][0]
    assert call["status"] == "pending_confirmation"
    assert call["preview"]["items"][0]["new_status"] == "无效"
    await db.refresh(sample_student)
    assert sample_student.status == StudentStatus.not_contacted

    approved = await client.post(
        f"/api/admin/assistant/tool-calls/{call['id']}/approve",
        headers=admin_headers,
        json={"approval_token": call["approval_token"]},
    )
    assert approved.json()["code"] == 0, approved.text
    await db.refresh(sample_student)
    assert sample_student.status == StudentStatus.invalid
    assert sample_student.status_detail == "上高中"
    assert approved.json()["data"]["result"]["changed_count"] == 1


@pytest.mark.asyncio
async def test_assistant_stale_preview_refuses_write(
    client,
    db,
    admin_headers,
    sample_student,
    monkeypatch,
):
    await _enable_assistant(client, admin_headers)
    session_id = await _create_session(client, admin_headers)
    _mock_provider_sequence(
        monkeypatch,
        [
            _provider_tool_call(
                "mark_students_invalid",
                f'{{"student_ids":[{sample_student.id}],"reason":"上高中"}}',
            )
        ],
    )
    proposed = await client.post(
        f"/api/admin/assistant/sessions/{session_id}/messages",
        headers=admin_headers,
        json={"content": "修改张三"},
    )
    call = proposed.json()["data"]["tool_calls"][0]
    sample_student.status_detail = "其他人刚刚修改"
    await db.commit()

    approved = await client.post(
        f"/api/admin/assistant/tool-calls/{call['id']}/approve",
        headers=admin_headers,
        json={"approval_token": call["approval_token"]},
    )
    assert approved.json()["code"] == 1
    assert "数据已发生变化" in approved.json()["msg"]
    await db.refresh(sample_student)
    assert sample_student.status == StudentStatus.not_contacted


@pytest.mark.asyncio
async def test_assistant_refuses_duplicate_confirmation_while_executing(
    client,
    db,
    admin_headers,
    agent_user,
    monkeypatch,
):
    await _enable_assistant(client, admin_headers)
    session_id = await _create_session(client, admin_headers)
    _mock_provider_sequence(
        monkeypatch,
        [
            _provider_tool_call(
                "reset_user_password",
                f'{{"user_id":{agent_user.id}}}',
            )
        ],
    )
    proposed = await client.post(
        f"/api/admin/assistant/sessions/{session_id}/messages",
        headers=admin_headers,
        json={"content": "重置测试坐席的密码"},
    )
    call = proposed.json()["data"]["tool_calls"][0]
    stored = await db.get(AssistantToolCall, call["id"])
    stored.status = "executing"
    await db.commit()

    repeated = await client.post(
        f"/api/admin/assistant/tool-calls/{call['id']}/approve",
        headers=admin_headers,
        json={"approval_token": call["approval_token"]},
    )

    assert repeated.json()["code"] == 1
    assert "正在执行" in repeated.json()["msg"]


@pytest.mark.asyncio
async def test_assistant_unexpected_provider_error_is_recorded_safely(
    client,
    db,
    admin_headers,
    monkeypatch,
):
    await _enable_assistant(client, admin_headers)
    session_id = await _create_session(client, admin_headers)

    async def fail_provider(*_args, **_kwargs):
        raise RuntimeError("raw-provider-internal-detail")

    monkeypatch.setattr(
        "app.assistant_service.call_openai_chat_completions",
        fail_provider,
    )
    response = await client.post(
        f"/api/admin/assistant/sessions/{session_id}/messages",
        headers=admin_headers,
        json={"content": "查询系统状态"},
    )

    assert response.json()["code"] == 1
    assert response.json()["msg"] == "AI 助手处理失败，请稍后重试"
    assert "raw-provider" not in response.text
    run = (
        (
            await db.execute(
                select(AssistantRun).where(AssistantRun.session_id == session_id)
            )
        )
        .scalars()
        .one()
    )
    assert run.status == "failed"
    assert run.error_message == "AI 助手处理失败，请稍后重试"


@pytest.mark.asyncio
async def test_assistant_password_is_returned_once_but_not_persisted(
    client,
    db,
    admin_headers,
    agent_user,
    monkeypatch,
):
    await _enable_assistant(client, admin_headers)
    session_id = await _create_session(client, admin_headers)
    _mock_provider_sequence(
        monkeypatch,
        [
            _provider_tool_call(
                "reset_user_password",
                f'{{"user_id":{agent_user.id}}}',
            )
        ],
    )
    proposed = await client.post(
        f"/api/admin/assistant/sessions/{session_id}/messages",
        headers=admin_headers,
        json={"content": "重置测试坐席的密码"},
    )
    call = proposed.json()["data"]["tool_calls"][0]
    approved = await client.post(
        f"/api/admin/assistant/tool-calls/{call['id']}/approve",
        headers=admin_headers,
        json={"approval_token": call["approval_token"]},
    )
    assert approved.json()["code"] == 0, approved.text
    new_password = approved.json()["data"]["result"]["new_password"]
    assert new_password
    await db.refresh(agent_user)
    assert verify_password(new_password, agent_user.hashed_password)
    stored_call = await db.get(AssistantToolCall, call["id"])
    assert new_password not in stored_call.result_json
    assert "仅在执行响应中显示一次" in stored_call.result_json

    repeated = await client.post(
        f"/api/admin/assistant/tool-calls/{call['id']}/approve",
        headers=admin_headers,
        json={"approval_token": call["approval_token"]},
    )
    assert repeated.json()["data"]["already_executed"] is True
    assert "result" not in repeated.json()["data"]


@pytest.mark.asyncio
async def test_destructive_cleanup_requires_exact_phrase_and_deletes_no_phone_rows(
    client,
    db,
    admin_headers,
    monkeypatch,
):
    students = [
        Student(
            name=f"重复学生{index}",
            guardian_phone="13800138000",
            guardian2_phone="",
            status=StudentStatus.not_contacted,
        )
        for index in range(3)
    ]
    db.add_all(students)
    await db.commit()
    await _enable_assistant(client, admin_headers)
    session_id = await _create_session(client, admin_headers)
    _mock_provider_sequence(
        monkeypatch,
        [
            _provider_tool_call(
                "cleanup_duplicate_phones",
                '{"minimum_students":3,"delete_without_numbers":true}',
            )
        ],
    )
    proposed = await client.post(
        f"/api/admin/assistant/sessions/{session_id}/messages",
        headers=admin_headers,
        json={"content": "清洗三人以上重复手机号，无号码直接删除"},
    )
    call = proposed.json()["data"]["tool_calls"][0]
    assert call["risk_level"] == "destructive"
    assert call["confirmation_phrase"]

    wrong = await client.post(
        f"/api/admin/assistant/tool-calls/{call['id']}/approve",
        headers=admin_headers,
        json={"approval_token": call["approval_token"], "confirmation_phrase": "确认"},
    )
    assert wrong.json()["code"] == 1
    assert "二次确认" in wrong.json()["msg"]

    approved = await client.post(
        f"/api/admin/assistant/tool-calls/{call['id']}/approve",
        headers=admin_headers,
        json={
            "approval_token": call["approval_token"],
            "confirmation_phrase": call["confirmation_phrase"],
        },
    )
    assert approved.json()["code"] == 0, approved.text
    assert approved.json()["data"]["result"]["deleted_count"] == 3
    remaining = (
        (await db.execute(select(Student).where(Student.name.like("重复学生%")))).scalars().all()
    )
    assert remaining == []


@pytest.mark.asyncio
async def test_assistant_lead_summary_excludes_terminal_unassigned_students(
    db,
    admin_user,
    sample_student,
):
    school = "助手口径测试学校"
    sample_student.school_name = school
    sample_student.status = StudentStatus.not_contacted
    sample_student.assigned_to = None
    db.add(
        Student(
            name="终态未分配学生",
            school_name=school,
            status=StudentStatus.invalid,
            assigned_to=None,
        )
    )
    await db.commit()

    summary = await _lead_summary(db, LeadSummaryArgs(school_name=school), admin_user)

    assert summary["raw_unassigned"] == 2
    assert summary["terminal_unassigned"] == 1
    assert summary["assignable_unassigned"] == 1
    assert summary["unassigned"] == 1


@pytest.mark.asyncio
async def test_assistant_can_preview_assignment_by_school_without_student_ids(
    db,
    admin_user,
    agent_user,
    sample_student,
):
    school = "助手整校分配测试学校"
    sample_student.school_name = school
    sample_student.status = StudentStatus.not_contacted
    sample_student.assigned_to = None
    db.add(
        Student(
            name="不可分配终态学生",
            school_name=school,
            status=StudentStatus.invalid,
            assigned_to=None,
        )
    )
    await db.commit()

    preview = await _preview_assign_school_students(
        db,
        AssignSchoolStudentsArgs(school_name=school, agent_names=[agent_user.name]),
        admin_user,
    )

    assert preview["student_count"] == 1
    assert preview["distribution"] == [
        {"agent_id": agent_user.id, "agent_name": agent_user.name, "count": 1}
    ]
    assert preview["_targets"] == [
        {"student_id": sample_student.id, "agent_id": agent_user.id}
    ]
    schemas = {schema["function"]["name"]: schema for schema in assistant_tool_schemas()}
    assert "assign_school_students" in schemas
    properties = schemas["assign_school_students"]["function"]["parameters"]["properties"]
    assert "agent_names" in properties


@pytest.mark.asyncio
async def test_assistant_school_assignment_rejects_terminal_only_school(
    db,
    admin_user,
    agent_user,
):
    school = "仅终态学校"
    db.add(
        Student(
            name="仅终态学生",
            school_name=school,
            status=StudentStatus.invalid,
            assigned_to=None,
        )
    )
    await db.commit()

    with pytest.raises(AssistantToolError, match="没有可分配"):
        await _preview_assign_school_students(
            db,
            AssignSchoolStudentsArgs(school_name=school, agent_names=[agent_user.name]),
            admin_user,
        )

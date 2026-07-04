import asyncio

import pytest

from app.pushplus import PUSHPLUS_TITLE, _build_a_level_content


@pytest.mark.asyncio
async def test_manual_a_level_triggers_pushplus(client, admin_headers, sample_student, monkeypatch):
    called = {}

    async def fake_notify(student_id, operator_name="system", source=""):
        called["student_id"] = student_id
        called["operator_name"] = operator_name
        called["source"] = source
        return True

    monkeypatch.setattr("app.routers.students.notify_a_level_change_background", fake_notify)

    resp = await client.put(
        f"/api/students/{sample_student.id}",
        json={"intent_level": "A"},
        headers=admin_headers,
    )
    await asyncio.sleep(0)

    assert resp.json()["code"] == 0
    assert called["student_id"] == sample_student.id
    assert called["operator_name"] == "测试管理员"
    assert called["source"] == "manual"


def test_a_level_pushplus_template_uses_chinese_copy():
    content = _build_a_level_content(
        student_name="张三",
        school_name="",
        region="龙海",
        agent_name="未分配",
        operator_name="系统",
        source="manual",
        changed_at="2026-07-02 17:30:00",
    )

    assert PUSHPLUS_TITLE == "招生系统 A级意向提醒"
    assert "## A级意向提醒" in content
    assert "- 学生姓名: 张三" in content
    assert "- 学校: 未填写" in content
    assert "- 区域: 龙海" in content
    assert "- 负责话务员: 未分配" in content
    assert "- 操作人: 系统" in content
    assert "- 来源: 手动标记" in content
    assert "Student:" not in content
    assert "A-level intent alert" not in content
    assert "unassigned" not in content

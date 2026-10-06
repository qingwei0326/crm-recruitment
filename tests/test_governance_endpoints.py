"""Pin the behaviour of the lead-governance endpoints moved into governance_service.

Covers /domain-consistency (previously untested) and the numbers / lifecycle of
/data-health, /governance-reviews, /risk-alerts and the duplicate-phone cleanup.
"""

from datetime import timedelta

import pytest

from app.models import (
    IntentLevel,
    OperationLog,
    Student,
    StudentStage,
    StudentStatus,
)
from app.utils import utcnow


def _student(name, **kw):
    kw.setdefault("status", StudentStatus.not_contacted)
    kw.setdefault("intent_level", IntentLevel.none)
    kw.setdefault("stage", StudentStage.initial_contact)
    return Student(name=name, **kw)


async def _seed(db, agent_user, assignment_baseline):
    old = utcnow() - timedelta(days=10)
    students = {
        "dup_a": _student("重复甲", school_name="一中", guardian_phone="13800001111"),
        "dup_b": _student("重复甲", school_name="一中", guardian_phone="13800001111"),
        "dup_c": _student("重复乙", school_name="二中", guardian_phone="13900002222",
                          guardian2_phone="13800001111"),
        "dup_d": _student("重复丙", school_name="三中", guardian_phone="13900002222"),
        "cleanable": _student("可清理", school_name="六中", guardian_phone="13800001111",
                              guardian2_phone="13600009999"),
        "no_phone": _student("无电话", guardian_phone="", guardian2_phone=None),
        "stale_a": _student("A超时", intent_level=IntentLevel.A,
                            status=StudentStatus.pending_visit, guardian_phone="13700000001",
                            created_at=old, assigned_at=old),
    }
    db.add_all(list(students.values()))
    await db.flush()
    for key in ("dup_a", "dup_c", "stale_a", "no_phone"):
        await assignment_baseline(students[key], agent_user, started_at=old)
    students["stale_a"].assigned_at = old
    await db.commit()
    return students


def _signals(response):
    return {item["key"]: item for item in response.json()["data"]["signals"]}


@pytest.mark.asyncio
async def test_domain_consistency_reports_checks_and_requires_admin(
    client, admin_headers, agent_headers
):
    denied = await client.get("/api/admin/domain-consistency", headers=agent_headers)
    assert denied.status_code == 403

    allowed = await client.get("/api/admin/domain-consistency", headers=admin_headers)
    data = allowed.json()["data"]
    assert data["status"] in {"ok", "warning"}
    assert isinstance(data["checks"], dict) and "ok" in data["checks"]
    assert data["failed_checks"] == [
        key for key, value in data["checks"].items() if key != "ok" and int(value or 0) > 0
    ]
    assert data["generated_at"]


@pytest.mark.asyncio
async def test_data_health_counts_and_review_lifecycle(
    client, db, agent_user, admin_headers, assignment_baseline
):
    await _seed(db, agent_user, assignment_baseline)

    health = await client.get("/api/admin/data-health", headers=admin_headers)
    signals = _signals(health)
    assert signals["duplicate_phone"]["count"] == 5
    assert signals["same_name_school_phone"]["count"] == 1
    assert signals["missing_phone"]["count"] == 1
    assert signals["stale_a"]["count"] == 1
    assert signals["assigned_no_call"]["count"] == 4
    assert signals["missing_phone"]["reviewed"] is False
    assert health.json()["data"]["status"] == "warning"

    token = signals["missing_phone"]["review_token"]
    empty = await client.post(
        "/api/admin/governance-reviews", json={"key": "  "}, headers=admin_headers
    )
    assert (empty.json()["code"], empty.json()["msg"]) == (1, "缺少复核项")
    wrong_key = await client.post(
        "/api/admin/governance-reviews",
        json={"key": "duplicate_phone", "review_token": token},
        headers=admin_headers,
    )
    assert wrong_key.json()["msg"] == "复核凭证已失效，请刷新页面后重试"

    ok = await client.post(
        "/api/admin/governance-reviews",
        json={"key": "missing_phone", "title": "无手机号线索", "detail": "已核对",
              "review_token": token},
        headers=admin_headers,
    )
    assert ok.json()["data"] == {"reviewed": True, "key": "missing_phone", "count": 1}

    after = _signals(await client.get("/api/admin/data-health", headers=admin_headers))
    assert after["missing_phone"]["reviewed"] is True
    assert after["missing_phone"]["count"] == 0
    assert after["duplicate_phone"]["count"] == 5  # other signals are untouched

    log = (
        await db.execute(
            OperationLog.__table__.select().where(OperationLog.action == "治理复核")
        )
    ).one()
    assert log.content == "确认复核 无手机号线索：已核对"
    assert log.batch_id == "governance-review:missing_phone"


@pytest.mark.asyncio
async def test_risk_alerts_window_follows_days_parameter(client, db, admin_user, admin_headers):
    now = utcnow()  # relative to "now": the alert window is [now - days, now]
    db.add_all([
        OperationLog(operator_id=admin_user.id, operator_name="管理员", case_no="",
                     action="删除线索", content="删除 X", created_at=now - timedelta(hours=5)),
        OperationLog(operator_id=admin_user.id, operator_name="管理员", case_no="",
                     action="自动分配汇总", content="自动分配",
                     created_at=now - timedelta(days=20)),
    ])
    await db.commit()

    def types(response):
        return {alert["type"] for alert in response.json()["data"]["alerts"]}

    assert types(await client.get("/api/admin/risk-alerts?days=1", headers=admin_headers)) == {
        "delete_leads"
    }
    assert types(await client.get("/api/admin/risk-alerts?days=30", headers=admin_headers)) == {
        "delete_leads",
        "batch_distribution",
    }


@pytest.mark.asyncio
async def test_duplicate_cleanup_only_changes_safe_rows(
    client, db, agent_user, admin_headers, assignment_baseline
):
    students = await _seed(db, agent_user, assignment_baseline)

    refused = await client.post(
        "/api/admin/lead-duplicates/cleanup", json={"confirm": False}, headers=admin_headers
    )
    assert (refused.json()["code"], refused.json()["msg"]) == (1, "需要确认后才能清理重复手机号")

    result = (
        await client.post(
            "/api/admin/lead-duplicates/cleanup", json={"confirm": True}, headers=admin_headers
        )
    ).json()["data"]
    assert result["changed"] is True
    assert result["cleared_count"] == 1
    assert result["manual_review_count"] == 4
    assert result["deleted_count"] == 0
    assert result["batch_id"].startswith("phone-dedupe-")

    await db.refresh(students["cleanable"])
    # The duplicated number is removed; the unique one stays in its own slot.
    assert students["cleanable"].guardian_phone == ""
    assert students["cleanable"].guardian2_phone == "13600009999"

    again = (
        await client.post(
            "/api/admin/lead-duplicates/cleanup", json={"confirm": True}, headers=admin_headers
        )
    ).json()["data"]
    assert again["changed"] is False
    assert again["batch_id"] == ""

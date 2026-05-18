"""Tests for student CRUD, stage management, assignment, and import."""

import pytest


@pytest.mark.asyncio
class TestCreateStudent:
    async def test_create_success(self, client, admin_headers):
        resp = await client.post("/api/students", json={
            "name": "李四", "region": "湖里区",
        }, headers=admin_headers)
        assert resp.status_code == 200
        body = resp.json()
        assert body["code"] == 0
        assert body["data"]["name"] == "李四"

    async def test_create_no_region(self, client, admin_headers):
        resp = await client.post("/api/students", json={
            "name": "王五",
        }, headers=admin_headers)
        assert resp.status_code == 200

    async def test_create_missing_name(self, client, admin_headers):
        resp = await client.post(
            "/api/students",
            json={"region": "测试"},
            headers=admin_headers,
        )
        assert resp.status_code == 422

    async def test_create_without_phone(self, client, admin_headers):
        resp = await client.post("/api/students", json={"name": "测试"}, headers=admin_headers)
        assert resp.status_code == 200

    async def test_create_empty_body(self, client, admin_headers):
        resp = await client.post("/api/students", json={}, headers=admin_headers)
        assert resp.status_code == 422

    async def test_create_unauthorized(self, client):
        resp = await client.post("/api/students", json={"name": "赵六"})
        assert resp.status_code == 403

    async def test_create_unicode_name(self, client, admin_headers):
        resp = await client.post("/api/students", json={
            "name": "𩷶测试", "region": "𩸽区",
        }, headers=admin_headers)
        assert resp.status_code == 200

    async def test_create_same_name_allowed_without_phone(self, client, admin_headers):
        """Students no longer require phone-based uniqueness."""
        resp1 = await client.post("/api/students", json={
            "name": "重复电话",
        }, headers=admin_headers)
        assert resp1.json()["code"] == 0

        resp2 = await client.post("/api/students", json={
            "name": "重复电话2",
        }, headers=admin_headers)
        assert resp2.json()["code"] == 0


@pytest.mark.asyncio
class TestListStudents:
    async def test_list_empty(self, client, admin_headers):
        resp = await client.get("/api/students", headers=admin_headers)
        body = resp.json()
        assert body["code"] == 0
        assert body["data"]["total"] == 0
        assert body["data"]["list"] == []

    async def test_list_with_data(self, client, admin_headers, sample_student):
        resp = await client.get("/api/students", headers=admin_headers)
        body = resp.json()
        assert body["data"]["total"] == 1
        assert body["data"]["list"][0]["name"] == "张三"

    async def test_list_pagination(self, client, admin_headers, db):
        from app.models import Student
        for i in range(15):
            db.add(Student(name=f"学生{i}", region="测试"))
        await db.commit()

        resp = await client.get("/api/students?page=1&page_size=10", headers=admin_headers)
        body = resp.json()
        assert len(body["data"]["list"]) == 10
        assert body["data"]["total"] == 15

        resp = await client.get("/api/students?page=2&page_size=10", headers=admin_headers)
        assert len(resp.json()["data"]["list"]) == 5

    async def test_list_filter_by_region(self, client, admin_headers, db):
        from app.models import Student
        db.add(Student(name="A", region="思明区"))
        db.add(Student(name="B", region="湖里区"))
        db.add(Student(name="C", region="思明区"))
        await db.commit()

        resp = await client.get("/api/students?region=思明区", headers=admin_headers)
        assert resp.json()["data"]["total"] == 2

    async def test_list_invalid_page(self, client, admin_headers):
        """Page has ge=1 validation, so -1 returns 422."""
        resp = await client.get("/api/students?page=-1", headers=admin_headers)
        assert resp.status_code == 422


@pytest.mark.asyncio
class TestGetStudent:
    async def test_get_success(self, client, admin_headers, sample_student):
        resp = await client.get(f"/api/students/{sample_student.id}", headers=admin_headers)
        assert resp.json()["data"]["name"] == "张三"

    async def test_get_not_found(self, client, admin_headers):
        """Backend raises HTTPException 404, not Response wrapper."""
        resp = await client.get("/api/students/99999", headers=admin_headers)
        assert resp.status_code == 404
        assert resp.json()["detail"] == "学生不存在"

    async def test_get_invalid_id(self, client, admin_headers):
        resp = await client.get("/api/students/abc", headers=admin_headers)
        assert resp.status_code in (404, 422)


@pytest.mark.asyncio
class TestUpdateStudent:
    async def test_update_status(self, client, admin_headers, sample_student):
        resp = await client.put(f"/api/students/{sample_student.id}", json={
            "status": "已联系",
        }, headers=admin_headers)
        assert resp.json()["code"] == 0

    async def test_manual_intent_writes_operation_log(
        self, client, admin_headers, sample_student, db
    ):
        from sqlalchemy import select

        from app.models import OperationLog

        resp = await client.put(
            f"/api/students/{sample_student.id}",
            json={"intent_level": "A"},
            headers=admin_headers,
        )
        assert resp.json()["code"] == 0
        r = await db.execute(
            select(OperationLog).where(
                OperationLog.target_student_id == sample_student.id,
                OperationLog.action == "手动评级",
            )
        )
        assert len(r.scalars().all()) >= 1

    async def test_update_invalid_intent(self, client, admin_headers, sample_student):
        resp = await client.put(
            f"/api/students/{sample_student.id}",
            json={"intent_level": "无效等级"},
            headers=admin_headers,
        )
        assert resp.json()["code"] == 1
        assert "意向" in resp.json()["msg"] or "无效" in resp.json()["msg"]

    async def test_update_stage(self, client, admin_headers, sample_student):
        """Historical bug: stage enum serialization."""
        resp = await client.put(f"/api/students/{sample_student.id}/stage", json={
            "stage": "有意向",
        }, headers=admin_headers)
        assert resp.json()["code"] == 0
        assert resp.json()["data"]["stage"] == "有意向"

    async def test_update_invalid_stage(self, client, admin_headers, sample_student):
        """Historical bug: invalid stage crashed with 500. Now returns code=1."""
        resp = await client.put(f"/api/students/{sample_student.id}/stage", json={
            "stage": "无效阶段",
        }, headers=admin_headers)
        assert resp.status_code == 200
        assert resp.json()["code"] == 1
        assert "无效" in resp.json()["msg"]

    async def test_update_not_found(self, client, admin_headers):
        resp = await client.put(
            "/api/students/99999",
            json={"name": "新名字"},
            headers=admin_headers,
        )
        assert resp.status_code == 404
        assert resp.json()["detail"] == "学生不存在"


@pytest.mark.asyncio
class TestDeleteStudent:
    async def test_delete_success(self, client, admin_headers, sample_student):
        resp = await client.delete(f"/api/students/{sample_student.id}", headers=admin_headers)
        assert resp.json()["code"] == 0

    async def test_delete_requires_admin(self, client, agent_headers, sample_student):
        resp = await client.delete(f"/api/students/{sample_student.id}", headers=agent_headers)
        assert resp.status_code == 403

    async def test_delete_not_found(self, client, admin_headers):
        resp = await client.delete("/api/students/99999", headers=admin_headers)
        assert resp.status_code == 404
        assert resp.json()["detail"] == "学生不存在"

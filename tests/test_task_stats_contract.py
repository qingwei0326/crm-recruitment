import pytest

from app.models import FollowUp, Student, StudentStatus
from app.task_stats import build_task_stats
from app.utils import utcnow


class TestTaskStatsContract:
    def test_build_task_stats_uses_active_task_contract(self):
        stats = build_task_stats(
            {
                StudentStatus.new_lead: 1,
                StudentStatus.very_interested: 2,
                StudentStatus.interested_add_wechat: 3,
                StudentStatus.completed: 99,
            }
        )

        assert stats == {
            "total": 6,
            "done": 2,
            "pending": 1,
            "follow_up": 3,
            "progress_pct": 83.3,
        }


@pytest.mark.asyncio
class TestAdminAgentTaskStats:
    async def test_agent_today_tasks_only_show_not_contacted_students(
        self, client, db, admin_headers, agent_headers, agent_user
    ):
        students = [
            Student(name="新线索", assigned_to=agent_user.id, status=StudentStatus.new_lead),
            Student(name="未联系", assigned_to=agent_user.id, status=StudentStatus.not_contacted),
            Student(
                name="非常有意向",
                assigned_to=agent_user.id,
                status=StudentStatus.very_interested,
            ),
            Student(
                name="意向了解加微",
                assigned_to=agent_user.id,
                status=StudentStatus.interested_add_wechat,
            ),
            Student(name="已报名", assigned_to=agent_user.id, status=StudentStatus.enrolled),
            Student(name="无意向", assigned_to=agent_user.id, status=StudentStatus.not_interested),
        ]
        db.add_all(students)
        await db.commit()

        today_resp = await client.get("/api/tasks/today", headers=agent_headers)
        today_data = today_resp.json()["data"]
        today_stats = today_data["stats"]
        assert today_stats == {
            "total": 2,
            "done": 0,
            "pending": 2,
            "follow_up": 0,
            "progress_pct": 0.0,
        }
        assert {item["status"] for item in today_data["list"]} == {"未联系"}

        list_resp = await client.get("/api/admin/agents", headers=admin_headers)
        agent_row = next(a for a in list_resp.json()["data"] if a["id"] == agent_user.id)
        assert agent_row["total_tasks"] == 4
        assert agent_row["done_tasks"] == 1
        assert agent_row["pending_tasks"] == 2
        assert agent_row["follow_up_tasks"] == 1
        assert agent_row["total_leads"] == 6

        detail_resp = await client.get(
            f"/api/admin/agents/{agent_user.id}/tasks",
            headers=admin_headers,
        )
        detail_data = detail_resp.json()["data"]
        assert detail_data["stats"]["total"] == 4
        assert detail_data["stats"]["done"] == 1
        assert detail_data["stats"]["pending"] == 2
        assert detail_data["stats"]["follow_up"] == 1
        assert detail_data["stats"]["total_leads"] == 6
        assert {item["status"] for item in detail_data["list"]} == {
            "未联系",
            "已联系",
            "待回访",
        }

    async def test_legacy_status_names_do_not_break_admin_or_student_lists(
        self, client, db, admin_headers, agent_user
    ):
        students = [
            Student(
                name="当前待联系",
                assigned_to=agent_user.id,
                status=StudentStatus.not_contacted,
            ),
            Student(name="旧未分配", assigned_to=agent_user.id, status="unassigned"),
            Student(name="旧无意向", assigned_to=agent_user.id, status="no_intent"),
            Student(name="旧孩子不想读", assigned_to=agent_user.id, status="child_not_interested"),
        ]
        db.add_all(students)
        await db.commit()
        db.expunge_all()

        list_resp = await client.get("/api/students?page_size=10", headers=admin_headers)
        assert list_resp.status_code == 200
        list_body = list_resp.json()
        assert list_body["code"] == 0
        statuses_by_name = {item["name"]: item["status"] for item in list_body["data"]["list"]}
        assert statuses_by_name["旧未分配"] == "未联系"

        invalid_resp = await client.get(
            "/api/students?page_size=10&status=无效",
            headers=admin_headers,
        )
        invalid_statuses_by_name = {
            item["name"]: item["status"] for item in invalid_resp.json()["data"]["list"]
        }
        assert invalid_statuses_by_name["旧无意向"] == "无效"
        assert invalid_statuses_by_name["旧孩子不想读"] == "无效"

        agents_resp = await client.get("/api/admin/agents", headers=admin_headers)
        assert agents_resp.status_code == 200
        agent_row = next(a for a in agents_resp.json()["data"] if a["id"] == agent_user.id)
        assert agent_row["total_tasks"] == 2
        assert agent_row["pending_tasks"] == 2
        assert agent_row["total_leads"] == 4

    async def test_agent_handled_tasks_show_contacted_not_reached_and_follow_up_students(
        self, client, db, agent_headers, agent_user
    ):
        students = [
            Student(name="已联系有效", assigned_to=agent_user.id, status=StudentStatus.contacted),
            Student(name="未接待办", assigned_to=agent_user.id, status=StudentStatus.not_reached),
            Student(name="旧拒接待办", assigned_to=agent_user.id, status=StudentStatus.rejected),
            Student(
                name="待回访待办",
                assigned_to=agent_user.id,
                status=StudentStatus.pending_visit,
            ),
            Student(
                name="未联系任务",
                assigned_to=agent_user.id,
                status=StudentStatus.not_contacted,
            ),
            Student(
                name="非常有意向",
                assigned_to=agent_user.id,
                status=StudentStatus.very_interested,
            ),
            Student(
                name="意向了解加微",
                assigned_to=agent_user.id,
                status=StudentStatus.interested_add_wechat,
            ),
            Student(name="无意向", assigned_to=agent_user.id, status=StudentStatus.not_interested),
        ]
        db.add_all(students)
        await db.commit()

        resp = await client.get("/api/tasks/handled", headers=agent_headers)
        data = resp.json()["data"]

        assert data["total"] == 6
        assert data["counts"] == {"已联系": 2, "未接": 2, "待回访": 2}
        assert {item["status"] for item in data["list"]} == {"已联系", "未接", "待回访"}

        filtered_resp = await client.get(
            "/api/tasks/handled?status=未接",
            headers=agent_headers,
        )
        filtered_data = filtered_resp.json()["data"]

        assert filtered_data["total"] == 6
        assert {item["status"] for item in filtered_data["list"]} == {"未接"}

        follow_up_resp = await client.get(
            "/api/tasks/handled?status=待回访",
            headers=agent_headers,
        )
        follow_up_data = follow_up_resp.json()["data"]

        assert follow_up_data["total"] == 6
        assert {item["status"] for item in follow_up_data["list"]} == {"待回访"}

    async def test_agent_today_search_matches_normalized_guardian2_phone(
        self, client, db, agent_headers, agent_user
    ):
        db.add(
            Student(
                name="第二电话任务",
                assigned_to=agent_user.id,
                status=StudentStatus.not_contacted,
                guardian2_phone="18960100618",
            )
        )
        db.add(
            Student(
                name="其他任务",
                assigned_to=agent_user.id,
                status=StudentStatus.not_contacted,
                guardian_phone="13800138000",
            )
        )
        await db.commit()

        resp = await client.get("/api/tasks/today?search=189 6010-0618", headers=agent_headers)
        data = resp.json()["data"]

        assert data["total"] == 2
        assert [item["name"] for item in data["list"]] == ["第二电话任务"]
        assert data["list"][0]["guardian2_phone"] == "18960100618"
        assert data["list"][0]["guardian2_phone_raw"] is None


@pytest.mark.asyncio
class TestFollowUpStatusSync:
    async def test_create_follow_up_moves_non_terminal_student_to_follow_up_task(
        self, client, db, agent_headers, agent_user
    ):
        student = Student(
            name="回访学生",
            assigned_to=agent_user.id,
            status=StudentStatus.contacted,
        )
        db.add(student)
        await db.commit()
        await db.refresh(student)

        resp = await client.post(
            "/api/follow-ups",
            json={"student_id": student.id, "follow_up_date": utcnow().isoformat()},
            headers=agent_headers,
        )

        assert resp.json()["code"] == 0
        await db.refresh(student)
        assert student.status == StudentStatus.pending_visit

    async def test_complete_last_follow_up_moves_student_back_to_done_task(
        self, client, db, agent_headers, agent_user
    ):
        student = Student(
            name="完成回访",
            assigned_to=agent_user.id,
            status=StudentStatus.interested_add_wechat,
        )
        db.add(student)
        await db.flush()
        follow_up = FollowUp(student_id=student.id, agent_id=agent_user.id, follow_up_date=utcnow())
        db.add(follow_up)
        await db.commit()
        await db.refresh(follow_up)

        resp = await client.put(
            f"/api/follow-ups/{follow_up.id}",
            json={"is_completed": True},
            headers=agent_headers,
        )

        assert resp.json()["code"] == 0
        await db.refresh(student)
        assert student.status == StudentStatus.contacted

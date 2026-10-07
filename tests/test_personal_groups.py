from sqlalchemy import select

from app.auth import create_access_token, hash_password
from app.domain_models import AgentEmployment, EmploymentStatus, PersonalGroupMembership
from app.models import OperationLog, Student, StudentStatus, User
from app.services.assignment_service import AssignmentTarget, apply_assignment_changes


async def _create_agent(db, username: str, name: str) -> tuple[User, dict[str, str]]:
    user = User(
        username=username,
        hashed_password=hash_password("agent123"),
        role="agent",
        name=name,
        is_active=True,
    )
    db.add(user)
    await db.flush()
    db.add(
        AgentEmployment(
            user_id=user.id,
            status=EmploymentStatus.active,
            updated_by=user.id,
        )
    )
    await db.commit()
    token = create_access_token({"sub": str(user.id), "role": user.role, "tv": user.token_version})
    return user, {"Authorization": f"Bearer {token}"}


class TestPersonalGroups:
    async def test_agent_creates_and_lists_only_own_groups(self, client, db, agent_headers):
        _other_agent, other_headers = await _create_agent(db, "other-agent", "其他坐席")

        created = await client.post(
            "/api/personal-groups",
            headers=agent_headers,
            json={"name": "今晚再打", "color": "cyan"},
        )
        assert created.status_code == 200
        group = created.json()["data"]
        assert group["name"] == "今晚再打"
        assert group["member_count"] == 0

        mine = await client.get("/api/personal-groups", headers=agent_headers)
        others = await client.get("/api/personal-groups", headers=other_headers)
        assert [item["id"] for item in mine.json()["data"]] == [group["id"]]
        assert others.json()["data"] == []

        forbidden = await client.patch(
            f"/api/personal-groups/{group['id']}",
            headers=other_headers,
            json={"name": "偷看分组"},
        )
        assert forbidden.status_code == 404

    async def test_agent_cannot_create_more_than_twenty_active_groups(self, client, agent_headers):
        for index in range(20):
            response = await client.post(
                "/api/personal-groups",
                headers=agent_headers,
                json={"name": f"分组{index + 1}"},
            )
            assert response.status_code == 200

        rejected = await client.post(
            "/api/personal-groups",
            headers=agent_headers,
            json={"name": "第21组"},
        )
        assert rejected.status_code == 409

    async def test_agent_adds_only_currently_assigned_students_and_filters_queue(
        self, client, db, agent_user, agent_headers, assignment_baseline
    ):
        own = Student(name="自己的学生", status=StudentStatus.pending_visit)
        own_ungrouped = Student(name="自己但未分组", status=StudentStatus.pending_visit)
        foreign = Student(name="别人的学生", status=StudentStatus.pending_visit)
        other_agent, _other_headers = await _create_agent(db, "group-other", "其他坐席")
        await assignment_baseline(own, agent_user)
        await assignment_baseline(own_ungrouped, agent_user)
        await assignment_baseline(foreign, other_agent)
        await db.commit()

        group = (
            await client.post(
                "/api/personal-groups",
                headers=agent_headers,
                json={"name": "优先推进"},
            )
        ).json()["data"]

        added = await client.post(
            f"/api/personal-groups/{group['id']}/members",
            headers=agent_headers,
            json={"student_ids": [own.id]},
        )
        assert added.status_code == 200
        assert added.json()["data"]["added_count"] == 1

        rejected = await client.post(
            f"/api/personal-groups/{group['id']}/members",
            headers=agent_headers,
            json={"student_ids": [foreign.id]},
        )
        assert rejected.status_code == 409

        filtered = await client.get(
            f"/api/tasks/handled?personal_group_id={group['id']}",
            headers=agent_headers,
        )
        assert filtered.status_code == 200
        filtered_list = filtered.json()["data"]["list"]
        assert [item["id"] for item in filtered_list] == [own.id]
        assert filtered_list[0]["personal_groups"] == [
            {"id": group["id"], "name": "优先推进", "color": "cyan"}
        ]

        ungrouped = await client.get(
            "/api/tasks/handled?ungrouped=true",
            headers=agent_headers,
        )
        assert ungrouped.status_code == 200
        assert [item["id"] for item in ungrouped.json()["data"]["list"]] == [own_ungrouped.id]

        conflicting = await client.get(
            f"/api/tasks/handled?personal_group_id={group['id']}&ungrouped=true",
            headers=agent_headers,
        )
        assert conflicting.status_code == 422

    async def test_private_group_filters_today_queue(
        self, client, db, agent_user, agent_headers, assignment_baseline
    ):
        grouped = Student(name="今日分组学生", status=StudentStatus.not_contacted)
        ungrouped = Student(name="今日未分组学生", status=StudentStatus.not_contacted)
        await assignment_baseline(grouped, agent_user)
        await assignment_baseline(ungrouped, agent_user)
        await db.commit()
        group = (
            await client.post(
                "/api/personal-groups",
                headers=agent_headers,
                json={"name": "今日重点"},
            )
        ).json()["data"]
        await client.post(
            f"/api/personal-groups/{group['id']}/members",
            headers=agent_headers,
            json={"student_ids": [grouped.id]},
        )

        response = await client.get(
            f"/api/tasks/today?personal_group_id={group['id']}",
            headers=agent_headers,
        )
        assert response.status_code == 200
        response_list = response.json()["data"]["list"]
        assert [item["id"] for item in response_list] == [grouped.id]
        assert response_list[0]["personal_groups"][0]["name"] == "今日重点"

        ungrouped_response = await client.get(
            "/api/tasks/today?ungrouped=true",
            headers=agent_headers,
        )
        assert ungrouped_response.status_code == 200
        assert [item["id"] for item in ungrouped_response.json()["data"]["list"]] == [ungrouped.id]

    async def test_deleting_student_cascades_private_group_membership(
        self,
        client,
        db,
        agent_user,
        agent_headers,
        admin_headers,
    ):
        student = Student(name="待删除学生", status=StudentStatus.pending_visit)
        db.add(student)
        await db.commit()
        await db.refresh(student)
        group = (
            await client.post(
                "/api/personal-groups",
                headers=agent_headers,
                json={"name": "删除清理"},
            )
        ).json()["data"]
        db.add(
            PersonalGroupMembership(
                group_id=group["id"],
                student_id=student.id,
                created_by=agent_user.id,
            )
        )
        await db.commit()

        deleted = await client.delete(f"/api/students/{student.id}", headers=admin_headers)
        assert deleted.json()["code"] == 0
        membership = await db.scalar(
            select(PersonalGroupMembership).where(
                PersonalGroupMembership.group_id == group["id"],
                PersonalGroupMembership.student_id == student.id,
            )
        )
        assert membership is None

    async def test_student_membership_view_and_remove_are_owner_scoped(
        self, client, db, agent_user, agent_headers, assignment_baseline
    ):
        student = Student(name="分组详情学生", status=StudentStatus.pending_visit)
        await assignment_baseline(student, agent_user)
        await db.commit()
        group = (
            await client.post(
                "/api/personal-groups",
                headers=agent_headers,
                json={"name": "等成绩"},
            )
        ).json()["data"]
        await client.post(
            f"/api/personal-groups/{group['id']}/members",
            headers=agent_headers,
            json={"student_ids": [student.id]},
        )

        memberships = await client.get(
            f"/api/personal-groups/student/{student.id}", headers=agent_headers
        )
        assert memberships.status_code == 200
        assert memberships.json()["data"]["group_ids"] == [group["id"]]

        removed = await client.delete(
            f"/api/personal-groups/{group['id']}/members/{student.id}",
            headers=agent_headers,
        )
        assert removed.status_code == 200
        memberships = await client.get(
            f"/api/personal-groups/student/{student.id}", headers=agent_headers
        )
        assert memberships.json()["data"]["group_ids"] == []

        readded = await client.post(
            f"/api/personal-groups/{group['id']}/members",
            headers=agent_headers,
            json={"student_ids": [student.id]},
        )
        assert readded.status_code == 200
        history = (
            (
                await db.execute(
                    select(PersonalGroupMembership)
                    .where(
                        PersonalGroupMembership.group_id == group["id"],
                        PersonalGroupMembership.student_id == student.id,
                    )
                    .order_by(PersonalGroupMembership.id)
                )
            )
            .scalars()
            .all()
        )
        assert len(history) == 2
        assert history[0].archive_reason == "removed_by_owner"
        assert history[0].archived_at is not None
        assert history[1].archived_at is None

    async def test_admin_can_audit_groups_but_agent_cannot(
        self,
        client,
        db,
        agent_user,
        agent_headers,
        admin_headers,
        normal_admin_headers,
        assignment_baseline,
    ):
        student = Student(name="审计学生", status=StudentStatus.pending_visit)
        await assignment_baseline(student, agent_user)
        await db.commit()
        group = (
            await client.post(
                "/api/personal-groups",
                headers=agent_headers,
                json={"name": "管理员默认隐藏"},
            )
        ).json()["data"]
        await client.post(
            f"/api/personal-groups/{group['id']}/members",
            headers=agent_headers,
            json={"student_ids": [student.id]},
        )

        denied = await client.get("/api/admin/personal-groups", headers=agent_headers)
        assert denied.status_code == 403
        restricted = await client.get("/api/admin/personal-groups", headers=normal_admin_headers)
        assert restricted.status_code == 403

        audited = await client.get("/api/admin/personal-groups", headers=admin_headers)
        assert audited.status_code == 200
        assert audited.json()["data"][0]["name"] == "管理员默认隐藏"
        assert audited.json()["data"][0]["owner_name"] == "测试坐席"

        members = await client.get(
            f"/api/admin/personal-groups/{group['id']}/members",
            headers=admin_headers,
        )
        assert members.status_code == 200
        assert members.json()["data"]["list"][0]["student_name"] == "审计学生"
        denied_members = await client.get(
            f"/api/admin/personal-groups/{group['id']}/members",
            headers=agent_headers,
        )
        assert denied_members.status_code == 403

    async def test_transfer_archives_old_agent_membership_and_writes_audit(
        self,
        client,
        db,
        admin_user,
        agent_user,
        agent_headers,
        assignment_baseline,
    ):
        student = Student(name="待转交学生", status=StudentStatus.pending_visit)
        target_agent, _target_headers = await _create_agent(db, "group-target", "新坐席")
        await assignment_baseline(student, agent_user)
        await db.commit()

        group = (
            await client.post(
                "/api/personal-groups",
                headers=agent_headers,
                json={"name": "旧坐席重点"},
            )
        ).json()["data"]
        await client.post(
            f"/api/personal-groups/{group['id']}/members",
            headers=agent_headers,
            json={"student_ids": [student.id]},
        )

        await apply_assignment_changes(
            db,
            [AssignmentTarget(student.id, target_agent.id)],
            operator=admin_user,
            reason="test_transfer",
            batch_id="personal-group-transfer",
        )
        await db.commit()

        membership = await db.scalar(
            select(PersonalGroupMembership).where(
                PersonalGroupMembership.group_id == group["id"],
                PersonalGroupMembership.student_id == student.id,
                PersonalGroupMembership.archived_at.is_not(None),
            )
        )
        assert membership.archived_at is not None
        assert membership.archive_reason == "assignment_changed"

        logs = await db.execute(
            OperationLog.__table__.select().where(
                OperationLog.target_student_id == student.id,
                OperationLog.action == "归档私人分组",
            )
        )
        assert len(logs.all()) == 1

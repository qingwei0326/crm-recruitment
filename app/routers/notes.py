from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import get_current_user
from app.database import get_db
from app.models import Note, Student, User, UserRole
from app.permissions import get_accessible_student
from app.schemas import NoteCreate, NoteUpdate, Response
from app.utils import make_operation_log

router = APIRouter(prefix="/api/notes", tags=["备注"])


@router.post("")
async def create_note(
    body: NoteCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    student = await get_accessible_student(db, body.student_id, current_user)

    note = Note(
        student_id=body.student_id,
        agent_id=current_user.id,
        content=body.content,
    )
    db.add(note)

    # Log to operation_logs
    db.add(
        make_operation_log(
            current_user,
            body.student_id,
            student.case_no if student else "",
            "写备注",
            content="添加联系记录",
            note_content=body.content,
        )
    )

    await db.commit()
    await db.refresh(note)

    return Response.ok(
        {
            "id": note.id,
            "student_id": note.student_id,
            "content": note.content,
            "created_at": str(note.created_at),
        }
    )


@router.get("")
async def list_notes(
    student_id: int = Query(...),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    await get_accessible_student(db, student_id, current_user)
    result = await db.execute(
        select(Note, User, Student)
        .outerjoin(User, Note.agent_id == User.id)
        .outerjoin(Student, Note.student_id == Student.id)
        .where(Note.student_id == student_id)
        .order_by(Note.created_at.desc())
    )
    rows = result.all()
    data = []
    for n, agent, student in rows:
        data.append(
            {
                "id": n.id,
                "content": n.content,
                "source": n.source,
                "agent_name": agent.name if agent else "",
                "created_at": str(n.created_at),
                "updated_at": str(n.updated_at),
            }
        )
    return Response.ok(data)


async def _get_note_for_modify(db: AsyncSession, note_id: int, user: User) -> Note:
    result = await db.execute(select(Note).where(Note.id == note_id))
    note = result.scalar_one_or_none()
    if not note:
        raise HTTPException(status_code=404, detail="备注不存在")
    if user.role != UserRole.admin and note.agent_id != user.id:
        raise HTTPException(status_code=403, detail="无权修改他人的备注")
    return note


@router.put("/{note_id}")
async def update_note(
    note_id: int,
    body: NoteUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    note = await _get_note_for_modify(db, note_id, current_user)
    student_r = await db.execute(select(Student).where(Student.id == note.student_id))
    student = student_r.scalar_one_or_none()

    old_content = note.content
    note.content = body.content

    db.add(
        make_operation_log(
            current_user,
            note.student_id,
            student.case_no if student else "",
            "修改备注",
            content=f"备注 #{note.id}",
            old_status="",
            new_status="",
            note_content=f"原: {old_content[:200]} | 新: {body.content[:200]}",
        )
    )
    await db.commit()
    await db.refresh(note)
    return Response.ok(
        {
            "id": note.id,
            "student_id": note.student_id,
            "content": note.content,
            "created_at": str(note.created_at),
        }
    )


@router.delete("/{note_id}")
async def delete_note(
    note_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    note = await _get_note_for_modify(db, note_id, current_user)
    student_r = await db.execute(select(Student).where(Student.id == note.student_id))
    student = student_r.scalar_one_or_none()

    db.add(
        make_operation_log(
            current_user,
            note.student_id,
            student.case_no if student else "",
            "删除备注",
            content=f"删除备注 #{note.id}",
            note_content=note.content[:200],
        )
    )
    await db.delete(note)
    await db.commit()
    return Response.ok({"deleted": note_id})

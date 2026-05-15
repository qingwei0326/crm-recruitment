from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import get_current_user
from app.database import get_db
from app.models import Note, Student, User
from app.permissions import get_accessible_student
from app.schemas import NoteCreate, Response
from app.utils import make_operation_log, mask_phone

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
                "agent_name": agent.name if agent else "",
                "student_phone": mask_phone(student.phone) if student else "",
                "created_at": str(n.created_at),
            }
        )
    return Response.ok(data)

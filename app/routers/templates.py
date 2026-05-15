from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import get_current_user, require_admin
from app.database import get_db
from app.models import MessageTemplate, User
from app.schemas import Response, TemplateCreate, TemplateUpdate

router = APIRouter(prefix="/api/templates", tags=["模板消息"])


@router.get("")
async def list_templates(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(MessageTemplate)
        .where(MessageTemplate.is_active)
        .order_by(MessageTemplate.sort_order, MessageTemplate.id)
    )
    templates = result.scalars().all()
    return Response.ok(
        [
            {
                "id": t.id,
                "title": t.title,
                "content": t.content,
                "category": t.category,
                "sort_order": t.sort_order,
            }
            for t in templates
        ]
    )


@router.get("/all")
async def list_all_templates(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    result = await db.execute(
        select(MessageTemplate).order_by(MessageTemplate.sort_order, MessageTemplate.id)
    )
    templates = result.scalars().all()
    return Response.ok(
        [
            {
                "id": t.id,
                "title": t.title,
                "content": t.content,
                "category": t.category,
                "is_active": t.is_active,
                "sort_order": t.sort_order,
                "created_at": str(t.created_at),
            }
            for t in templates
        ]
    )


@router.post("")
async def create_template(
    body: TemplateCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    t = MessageTemplate(
        title=body.title,
        content=body.content,
        category=body.category,
        created_by=current_user.id,
    )
    db.add(t)
    await db.commit()
    await db.refresh(t)
    return Response.ok({"id": t.id, "title": t.title})


@router.put("/{template_id}")
async def update_template(
    template_id: int,
    body: TemplateUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    result = await db.execute(select(MessageTemplate).where(MessageTemplate.id == template_id))
    t = result.scalar_one_or_none()
    if not t:
        return Response.error(code=1, msg="模板不存在")
    if body.title is not None:
        t.title = body.title
    if body.content is not None:
        t.content = body.content
    if body.category is not None:
        t.category = body.category
    if body.is_active is not None:
        t.is_active = body.is_active
    if body.sort_order is not None:
        t.sort_order = body.sort_order
    await db.commit()
    return Response.ok({"id": t.id, "title": t.title})


@router.delete("/{template_id}")
async def delete_template(
    template_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    result = await db.execute(select(MessageTemplate).where(MessageTemplate.id == template_id))
    t = result.scalar_one_or_none()
    if not t:
        return Response.error(code=1, msg="模板不存在")
    await db.delete(t)
    await db.commit()
    return Response.ok(msg="已删除")

"""Notification endpoints — task notifications raised by the workflow engine."""
from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import desc, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import get_current_user
from app.database import get_db
from app.models.notification import Notification
from app.models.user import User

router = APIRouter(prefix="/notifications", tags=["Notifications"])


class NotificationOut(BaseModel):
    id: str
    title: str
    message: str
    type: str
    read: bool
    related_item_id: str | None = None
    related_item_type: str | None = None
    related_item_url: str | None = None
    created_at: str


class NotificationListOut(BaseModel):
    items: list[NotificationOut]
    unread_count: int


@router.get("", response_model=NotificationListOut)
async def list_my_notifications(
    limit: int = 50,
    offset: int = 0,
    read: bool | None = None,
    type: str | None = None,  # noqa: A002
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    conditions = [Notification.user_id == user.id, Notification.is_deleted == False]  # noqa: E712
    if read is not None:
        conditions.append(Notification.read == read)
    if type:
        conditions.append(Notification.type == type)
    result = await db.execute(
        select(Notification)
        .where(*conditions)
        .order_by(desc(Notification.created_at))
        .offset(offset)
        .limit(limit)
    )
    items = result.scalars().all()
    unread_conditions = [c for c in conditions if c is not Notification.read] if read is not None else [
        Notification.user_id == user.id,
        Notification.is_deleted == False,  # noqa: E712
    ]
    unread = await db.execute(
        select(func.count(Notification.id)).where(
            *unread_conditions,
            Notification.read == False,  # noqa: E712
        )
    )
    return NotificationListOut(
        items=[
            NotificationOut(
                id=str(n.id),
                title=n.title,
                message=n.message,
                type=n.type,
                read=n.read,
                related_item_id=n.related_item_id,
                related_item_type=n.related_item_type,
                related_item_url=n.related_item_url,
                created_at=n.created_at.isoformat() if n.created_at else "",
            )
            for n in items
        ],
        unread_count=int(unread.scalar() or 0),
    )


@router.post("/{notification_id}/read")
async def mark_read(
    notification_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    result = await db.execute(select(Notification).where(Notification.id == notification_id))
    n = result.scalar_one_or_none()
    if not n or n.user_id != user.id:
        raise HTTPException(status_code=404, detail="通知不存在")
    n.read = True
    await db.commit()
    return {"ok": True}


@router.post("/read-all")
async def mark_all_read(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(Notification).where(
            Notification.user_id == user.id,
            Notification.read == False,  # noqa: E712
            Notification.is_deleted == False,  # noqa: E712
        )
    )
    for n in result.scalars().all():
        n.read = True
    await db.commit()
    return {"ok": True}


@router.delete("/{notification_id}")
async def delete_notification(
    notification_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    result = await db.execute(select(Notification).where(Notification.id == notification_id))
    n = result.scalar_one_or_none()
    if not n or n.user_id != user.id:
        raise HTTPException(status_code=404, detail="通知不存在")
    n.is_deleted = True
    await db.commit()
    return {"ok": True}

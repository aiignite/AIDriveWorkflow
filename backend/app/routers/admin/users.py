"""Admin user management API."""
from __future__ import annotations

from datetime import datetime
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import get_current_admin
from app.database import get_db
from app.models.user import User
from app.services.user_admin_service import UserAdminService

router = APIRouter(prefix="/admin/users", tags=["Admin Users"])


class AdminUserOut(BaseModel):
    id: str
    email: str
    name: str
    status: str
    role: str
    position: str | None = None
    role_id: str | None = None
    department_id: str | None = None
    manager_id: str | None = None
    created_at: datetime = Field(serialization_alias="createdAt")


class AdminUserListOut(BaseModel):
    items: list[AdminUserOut]
    total: int


class AdminUserUpdateRequest(BaseModel):
    name: str | None = None
    status: str | None = None
    role: str | None = None
    position: str | None = None
    role_id: str | None = None
    department_id: str | None = None
    manager_id: str | None = None


def _to_out(user: User) -> AdminUserOut:
    return AdminUserOut(
        id=str(user.id),
        email=user.email,
        name=user.name,
        status=user.status,
        role=user.role,
        position=user.position,
        role_id=str(user.role_id) if user.role_id else None,
        department_id=str(user.department_id) if user.department_id else None,
        manager_id=str(user.manager_id) if user.manager_id else None,
        created_at=user.created_at,
    )


@router.get("", response_model=AdminUserListOut)
async def list_users(
    q: str | None = Query(None),
    role: str | None = Query(None),
    status: str | None = Query(None),
    offset: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
    _admin: User = Depends(get_current_admin),
):
    users, total = await UserAdminService.list_users(
        db, q=q, role=role, status=status, offset=offset, limit=limit,
    )
    return AdminUserListOut(items=[_to_out(u) for u in users], total=total)


@router.patch("/{user_id}", response_model=AdminUserOut)
async def update_user(
    user_id: UUID,
    body: AdminUserUpdateRequest,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(get_current_admin),
):
    target = await UserAdminService.get_user(db, user_id)
    updated = await UserAdminService.update_user(
        db,
        target=target,
        actor=admin,
        name=body.name,
        status=body.status,
        role=body.role,
        position=body.position,
        role_id=body.role_id,
        department_id=body.department_id,
        manager_id=body.manager_id,
    )
    await db.commit()
    await db.refresh(updated)
    return _to_out(updated)

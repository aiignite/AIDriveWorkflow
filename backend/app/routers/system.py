"""System endpoints — users/roles/departments for workflow assignee pickers."""
from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import get_current_admin, get_current_user
from app.database import get_db
from app.models.org import Department, Role, UserRole
from app.models.user import User

router = APIRouter(prefix="/system", tags=["System"])


# ── 输出 ──────────────────────────────────────────────

class SystemUserOut(BaseModel):
    id: str
    name: str
    email: str
    position: str | None = None
    department_id: str | None = None
    role_id: str | None = None
    manager_id: str | None = None
    status: str
    signature_image: str | None = None


class SystemRoleOut(BaseModel):
    id: str
    name: str
    description: str | None = None
    is_default: bool = False


class SystemDepartmentOut(BaseModel):
    id: str
    name: str
    description: str | None = None
    parent_id: str | None = None
    manager_id: str | None = None
    level: int = 0
    sort_order: int = 0


# ── 输入 ──────────────────────────────────────────────

class RoleUpsert(BaseModel):
    name: str
    description: str | None = None
    is_default: bool = False


class DepartmentUpsert(BaseModel):
    name: str
    description: str | None = None
    parent_id: str | None = None
    manager_id: str | None = None
    sort_order: int = 0


class UserOrgUpdate(BaseModel):
    position: str | None = None
    role_id: str | None = None
    department_id: str | None = None
    manager_id: str | None = None
    status: str | None = None
    role: str | None = None  # admin/user 平台管理权限
    password: str | None = None


# ── 查询（所有登录用户可用，供设计器/筛选选择）─────────

@router.get("/users", response_model=list[SystemUserOut])
async def list_users(
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(User)
        .where(User.is_deleted == False, User.status == "Active")  # noqa: E712
        .order_by(User.name)
    )
    users = result.scalars().all()
    return [
        SystemUserOut(
            id=str(u.id),
            name=u.name,
            email=u.email,
            position=u.position,
            department_id=str(u.department_id) if u.department_id else None,
            role_id=str(u.role_id) if u.role_id else None,
            manager_id=str(u.manager_id) if u.manager_id else None,
            status=u.status,
            signature_image=u.signature_image,
        )
        for u in users
    ]


@router.get("/roles", response_model=list[SystemRoleOut])
async def list_roles(
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(Role).where(Role.is_deleted == False).order_by(Role.name)  # noqa: E712
    )
    return [
        SystemRoleOut(
            id=str(r.id), name=r.name, description=r.description, is_default=r.is_default,
        )
        for r in result.scalars().all()
    ]


@router.get("/departments", response_model=list[SystemDepartmentOut])
async def list_departments(
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(Department)
        .where(Department.is_deleted == False)  # noqa: E712
        .order_by(Department.level, Department.sort_order, Department.name)
    )
    return [
        SystemDepartmentOut(
            id=str(d.id),
            name=d.name,
            description=d.description,
            parent_id=str(d.parent_id) if d.parent_id else None,
            manager_id=str(d.manager_id) if d.manager_id else None,
            level=d.level,
            sort_order=d.sort_order,
        )
        for d in result.scalars().all()
    ]


# ── 角色管理（admin）──────────────────────────────────

@router.post("/roles", response_model=SystemRoleOut, status_code=201)
async def create_role(
    body: RoleUpsert,
    db: AsyncSession = Depends(get_db),
    _admin: User = Depends(get_current_admin),
):
    exists = await db.execute(
        select(Role).where(Role.name == body.name, Role.is_deleted == False)  # noqa: E712
    )
    if exists.scalar_one_or_none():
        raise HTTPException(status_code=409, detail="同名角色已存在")
    role = Role(name=body.name, description=body.description, is_default=body.is_default)
    db.add(role)
    await db.commit()
    await db.refresh(role)
    return SystemRoleOut(id=str(role.id), name=role.name, description=role.description, is_default=role.is_default)


@router.delete("/roles/{role_id}", status_code=204)
async def delete_role(
    role_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _admin: User = Depends(get_current_admin),
):
    result = await db.execute(select(Role).where(Role.id == role_id))
    role = result.scalar_one_or_none()
    if not role:
        raise HTTPException(status_code=404, detail="角色不存在")
    if role.is_default:
        raise HTTPException(status_code=400, detail="内置角色不可删除")
    role.is_deleted = True
    await db.commit()


# ── 部门管理（admin）──────────────────────────────────

@router.post("/departments", response_model=SystemDepartmentOut, status_code=201)
async def create_department(
    body: DepartmentUpsert,
    db: AsyncSession = Depends(get_db),
    _admin: User = Depends(get_current_admin),
):
    parent_level = 0
    parent_id = None
    if body.parent_id:
        parent = await db.execute(
            select(Department).where(Department.id == uuid.UUID(body.parent_id))
        )
        parent_row = parent.scalar_one_or_none()
        if not parent_row:
            raise HTTPException(status_code=404, detail="上级部门不存在")
        parent_level = parent_row.level
        parent_id = parent_row.id
    dept = Department(
        name=body.name,
        description=body.description,
        parent_id=parent_id,
        manager_id=uuid.UUID(body.manager_id) if body.manager_id else None,
        level=parent_level + 1,
        sort_order=body.sort_order,
    )
    db.add(dept)
    await db.commit()
    await db.refresh(dept)
    return SystemDepartmentOut(
        id=str(dept.id), name=dept.name, description=dept.description,
        parent_id=str(dept.parent_id) if dept.parent_id else None,
        manager_id=str(dept.manager_id) if dept.manager_id else None,
        level=dept.level, sort_order=dept.sort_order,
    )


@router.patch("/departments/{dept_id}", response_model=SystemDepartmentOut)
async def update_department(
    dept_id: uuid.UUID,
    body: DepartmentUpsert,
    db: AsyncSession = Depends(get_db),
    _admin: User = Depends(get_current_admin),
):
    result = await db.execute(select(Department).where(Department.id == dept_id))
    dept = result.scalar_one_or_none()
    if not dept:
        raise HTTPException(status_code=404, detail="部门不存在")
    if body.name is not None:
        dept.name = body.name
    if body.description is not None:
        dept.description = body.description
    if body.manager_id is not None:
        dept.manager_id = uuid.UUID(body.manager_id) if body.manager_id else None
    if body.sort_order is not None:
        dept.sort_order = body.sort_order
    await db.commit()
    await db.refresh(dept)
    return SystemDepartmentOut(
        id=str(dept.id), name=dept.name, description=dept.description,
        parent_id=str(dept.parent_id) if dept.parent_id else None,
        manager_id=str(dept.manager_id) if dept.manager_id else None,
        level=dept.level, sort_order=dept.sort_order,
    )


@router.delete("/departments/{dept_id}", status_code=204)
async def delete_department(
    dept_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _admin: User = Depends(get_current_admin),
):
    result = await db.execute(select(Department).where(Department.id == dept_id))
    dept = result.scalar_one_or_none()
    if not dept:
        raise HTTPException(status_code=404, detail="部门不存在")
    children = await db.execute(
        select(Department).where(
            Department.parent_id == dept_id, Department.is_deleted == False,  # noqa: E712
        )
    )
    if children.scalars().first():
        raise HTTPException(status_code=400, detail="存在子部门，不可删除")
    dept.is_deleted = True
    await db.commit()


# ── 用户组织信息（admin）──────────────────────────────

@router.patch("/users/{user_id}/org", response_model=SystemUserOut)
async def update_user_org(
    user_id: uuid.UUID,
    body: UserOrgUpdate,
    db: AsyncSession = Depends(get_db),
    _admin: User = Depends(get_current_admin),
):
    from app.services.auth_service import AuthService

    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="用户不存在")

    if body.position is not None:
        user.position = body.position or None
    if body.role_id is not None:
        user.role_id = uuid.UUID(body.role_id) if body.role_id else None
        # 同步 M2M（处理人解析双通道：role_id + user_roles）
        if body.role_id:
            existing = await db.execute(
                select(UserRole).where(UserRole.user_id == user.id, UserRole.role_id == user.role_id)
            )
            if not existing.scalar_one_or_none():
                db.add(UserRole(user_id=user.id, role_id=user.role_id))
    if body.department_id is not None:
        user.department_id = uuid.UUID(body.department_id) if body.department_id else None
    if body.manager_id is not None:
        user.manager_id = uuid.UUID(body.manager_id) if body.manager_id else None
    if body.status is not None:
        user.status = body.status
    if body.role is not None:
        user.role = body.role
    if body.password:
        user.password_hash = AuthService.hash_password(body.password)
    await db.commit()
    await db.refresh(user)
    return SystemUserOut(
        id=str(user.id), name=user.name, email=user.email, position=user.position,
        department_id=str(user.department_id) if user.department_id else None,
        role_id=str(user.role_id) if user.role_id else None,
        manager_id=str(user.manager_id) if user.manager_id else None,
        status=user.status, signature_image=user.signature_image,
    )

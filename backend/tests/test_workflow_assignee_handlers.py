"""工作流多处理人 handlers + 会签/或签测试。"""
from __future__ import annotations

import uuid

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.org import Role
from app.models.user import User
from app.models.workflow import WorkflowDefinition, WorkflowEdge, WorkflowInstance, WorkflowNode, WorkflowTask
from app.services.auth_service import AuthService
from app.services.workflow.workflow_service import (
    WorkflowEngine,
    _default_completion_condition,
    _iter_assignee_handlers,
)


async def _make_user(db: AsyncSession, email: str, name: str, *, role_id: uuid.UUID | None = None) -> User:
    user = User(
        email=email,
        password_hash=await AuthService.hash_password("UserPassword123!"),
        name=name,
        status="Active",
        role_id=role_id,
    )
    db.add(user)
    await db.flush()
    return user


async def _make_handlers_workflow(
    db: AsyncSession,
    *,
    assignee_config: dict,
) -> WorkflowDefinition:
    defn = WorkflowDefinition(
        key=f"handlers_test_{uuid.uuid4().hex[:8]}",
        name="多处理人审批",
        category="project",
        status="published",
        entity_type="prj_task_infos",
    )
    db.add(defn)
    await db.flush()

    start = WorkflowNode(
        definition_id=defn.id,
        node_key="start",
        name="开始",
        node_type="start",
        sort_order=0,
    )
    approve = WorkflowNode(
        definition_id=defn.id,
        node_key="approve",
        name="多处理人审批",
        node_type="approval",
        sort_order=1,
        assignee_config=assignee_config,
        approval_config={"reject_action": "terminate"},
    )
    end = WorkflowNode(
        definition_id=defn.id,
        node_key="end",
        name="结束",
        node_type="end",
        sort_order=2,
    )
    db.add_all([start, approve, end])
    await db.flush()

    db.add_all([
        WorkflowEdge(
            definition_id=defn.id,
            source_node_id=start.id,
            target_node_id=approve.id,
            sort_order=0,
        ),
        WorkflowEdge(
            definition_id=defn.id,
            source_node_id=approve.id,
            target_node_id=end.id,
            sort_order=1,
        ),
    ])
    await db.commit()
    return defn


def test_iter_handlers_legacy_single() -> None:
    handlers = _iter_assignee_handlers({
        "assignee_type": "role",
        "assignee_value": "质量工程师",
    })
    assert handlers == [{"type": "role", "value": "质量工程师"}]


def test_iter_handlers_prefers_list() -> None:
    handlers = _iter_assignee_handlers({
        "assigneeType": "user",
        "assigneeValue": "u1",
        "handlers": [
            {"type": "user", "value": "u1"},
            {"type": "role", "value": "r1"},
        ],
    })
    assert len(handlers) == 2
    assert handlers[1]["type"] == "role"


def test_default_completion_legacy_project_role_any() -> None:
    assert _default_completion_condition({
        "assignee_type": "project_role",
        "assignee_value": "pm",
    }) == "any"


def test_default_completion_handlers_all() -> None:
    assert _default_completion_condition({
        "assignee_type": "project_role",
        "handlers": [{"type": "project_role", "value": "pm"}],
    }) == "all"


@pytest.mark.asyncio
async def test_legacy_role_still_resolves(db: AsyncSession, test_user: User) -> None:
    role = Role(name=f"Reviewer-{uuid.uuid4().hex[:6]}")
    db.add(role)
    await db.flush()
    member = await _make_user(db, "legacy-role@example.com", "Legacy Role User", role_id=role.id)
    await db.commit()

    defn = await _make_handlers_workflow(db, assignee_config={
        "assignee_type": "role",
        "assignee_value": str(role.id),
    })
    engine = WorkflowEngine(db)
    instance = await engine.start_instance(
        definition_id=defn.id,
        title="旧角色解析",
        initiated_by_id=test_user.id,
    )

    result = await db.execute(select(WorkflowTask).where(WorkflowTask.instance_id == instance.id))
    tasks = list(result.scalars().all())
    assert len(tasks) == 1
    assert tasks[0].assignee_id == member.id


@pytest.mark.asyncio
async def test_handlers_mixed_user_and_role_dedupe(db: AsyncSession, test_user: User) -> None:
    role = Role(name=f"Mixed-{uuid.uuid4().hex[:6]}")
    db.add(role)
    await db.flush()
    user_a = await _make_user(db, "mix-a@example.com", "Mix A", role_id=role.id)
    user_b = await _make_user(db, "mix-b@example.com", "Mix B", role_id=role.id)
    await db.commit()

    defn = await _make_handlers_workflow(db, assignee_config={
        "handlers": [
            {"type": "user", "value": str(user_a.id)},
            {"type": "role", "value": str(role.id)},
        ],
        "multi_instance": True,
        "completion_condition": "all",
    })
    engine = WorkflowEngine(db)
    instance = await engine.start_instance(
        definition_id=defn.id,
        title="混合去重",
        initiated_by_id=test_user.id,
    )

    result = await db.execute(select(WorkflowTask).where(WorkflowTask.instance_id == instance.id))
    tasks = list(result.scalars().all())
    # user_a 同时在 handlers 与 role 中，应去重为 2 人
    assert {t.assignee_id for t in tasks} == {user_a.id, user_b.id}
    assert len(tasks) == 2


@pytest.mark.asyncio
async def test_all_requires_both_approvals(db: AsyncSession, test_user: User) -> None:
    user_a = await _make_user(db, "all-a@example.com", "All A")
    user_b = await _make_user(db, "all-b@example.com", "All B")
    await db.commit()

    defn = await _make_handlers_workflow(db, assignee_config={
        "handlers": [
            {"type": "user", "value": str(user_a.id)},
            {"type": "user", "value": str(user_b.id)},
        ],
        "multi_instance": True,
        "completion_condition": "all",
    })
    engine = WorkflowEngine(db)
    instance = await engine.start_instance(
        definition_id=defn.id,
        title="会签测试",
        initiated_by_id=test_user.id,
    )

    result = await db.execute(select(WorkflowTask).where(WorkflowTask.instance_id == instance.id))
    tasks = list(result.scalars().all())
    assert len(tasks) == 2

    task_a = next(t for t in tasks if t.assignee_id == user_a.id)
    await engine.complete_task(task_a, result="approved", actor_id=user_a.id)

    inst = await db.get(WorkflowInstance, instance.id)
    assert inst is not None
    assert inst.status == "running"

    refreshed = await db.execute(select(WorkflowTask).where(WorkflowTask.instance_id == instance.id))
    updated = list(refreshed.scalars().all())
    task_b = next(t for t in updated if t.assignee_id == user_b.id)
    assert task_b.status == "pending"

    await engine.complete_task(task_b, result="approved", actor_id=user_b.id)
    inst2 = await db.get(WorkflowInstance, instance.id)
    assert inst2 is not None
    assert inst2.status == "completed"


@pytest.mark.asyncio
async def test_all_reject_cancels_siblings(db: AsyncSession, test_user: User) -> None:
    user_a = await _make_user(db, "rej-a@example.com", "Rej A")
    user_b = await _make_user(db, "rej-b@example.com", "Rej B")
    await db.commit()

    defn = await _make_handlers_workflow(db, assignee_config={
        "handlers": [
            {"type": "user", "value": str(user_a.id)},
            {"type": "user", "value": str(user_b.id)},
        ],
        "multi_instance": True,
        "completion_condition": "all",
    })
    engine = WorkflowEngine(db)
    instance = await engine.start_instance(
        definition_id=defn.id,
        title="会签驳回",
        initiated_by_id=test_user.id,
    )

    result = await db.execute(select(WorkflowTask).where(WorkflowTask.instance_id == instance.id))
    tasks = list(result.scalars().all())
    task_a = next(t for t in tasks if t.assignee_id == user_a.id)
    await engine.complete_task(task_a, result="rejected", actor_id=user_a.id)

    refreshed = await db.execute(select(WorkflowTask).where(WorkflowTask.instance_id == instance.id))
    updated = list(refreshed.scalars().all())
    sibling = next(t for t in updated if t.assignee_id == user_b.id)
    assert sibling.status == "cancelled"

    inst = await db.get(WorkflowInstance, instance.id)
    assert inst is not None
    assert inst.status == "terminated"


@pytest.mark.asyncio
async def test_any_cancels_siblings_on_first_approve(db: AsyncSession, test_user: User) -> None:
    user_a = await _make_user(db, "any-h-a@example.com", "Any H A")
    user_b = await _make_user(db, "any-h-b@example.com", "Any H B")
    await db.commit()

    defn = await _make_handlers_workflow(db, assignee_config={
        "handlers": [
            {"type": "user", "value": str(user_a.id)},
            {"type": "user", "value": str(user_b.id)},
        ],
        "multi_instance": True,
        "completion_condition": "any",
    })
    engine = WorkflowEngine(db)
    instance = await engine.start_instance(
        definition_id=defn.id,
        title="或签测试",
        initiated_by_id=test_user.id,
    )

    result = await db.execute(select(WorkflowTask).where(WorkflowTask.instance_id == instance.id))
    tasks = list(result.scalars().all())
    task_a = next(t for t in tasks if t.assignee_id == user_a.id)
    await engine.complete_task(task_a, result="approved", actor_id=user_a.id)

    refreshed = await db.execute(select(WorkflowTask).where(WorkflowTask.instance_id == instance.id))
    updated = list(refreshed.scalars().all())
    sibling = next(t for t in updated if t.assignee_id == user_b.id)
    assert sibling.status == "cancelled"

    inst = await db.get(WorkflowInstance, instance.id)
    assert inst is not None
    assert inst.status == "completed"

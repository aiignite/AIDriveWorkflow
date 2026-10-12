"""Workflow Service – business logic for definitions, instances, tasks, and the engine."""
from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import func as sa_func
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.workflow import (
    WorkflowDefinition,
    WorkflowEdge,
    WorkflowInstance,
    WorkflowInstanceLog,
    WorkflowNode,
    WorkflowTask,
)

# ═══════════════════════════════════════════
#  Helper utilities
# ═══════════════════════════════════════════

async def _resolve_users_for_role(db: AsyncSession, role_ref: str) -> list[uuid.UUID]:
    """按角色 UUID 或角色名称解析审批人（含 sys_user_roles 多角色）。"""
    from app.models.org import Role, UserRole
    from app.models.user import User as UserModel

    role_ids: list[uuid.UUID] = []
    try:
        role_ids = [uuid.UUID(str(role_ref))]
    except ValueError:
        role_result = await db.execute(
            select(Role.id).where(
                Role.is_deleted == False,  # noqa: E712
                Role.name == str(role_ref),
            )
        )
        role_ids = list(role_result.scalars().all())

    if not role_ids:
        return []

    primary = await db.execute(
        select(UserModel.id).where(
            UserModel.role_id.in_(role_ids),
            UserModel.status == "Active",
            UserModel.is_deleted == False,  # noqa: E712
        )
    )
    assignee_ids = set(primary.scalars().all())

    secondary = await db.execute(
        select(UserRole.user_id).where(UserRole.role_id.in_(role_ids))
    )
    for uid in secondary.scalars().all():
        active = await db.execute(
            select(UserModel.id).where(
                UserModel.id == uid,
                UserModel.status == "Active",
                UserModel.is_deleted == False,  # noqa: E712
            )
        )
        found = active.scalar_one_or_none()
        if found:
            assignee_ids.add(found)

    return list(assignee_ids)


async def _resolve_superuser_assignees(db: AsyncSession) -> list[uuid.UUID]:
    """无角色人员时回退到超级管理员。"""
    from app.models.user import User as UserModel

    result = await db.execute(
        select(UserModel.id).where(
            UserModel.is_superuser == True,  # noqa: E712
            UserModel.status == "Active",
            UserModel.is_deleted == False,  # noqa: E712
        )
    )
    return list(result.scalars().all())


def _iter_assignee_handlers(assignee_config: dict) -> list[dict[str, Any]]:
    """从 assignee_config 取出 handlers 列表；无则把旧单条合成一条。

    显式 ``handlers: []`` 视为空（不回退旧字段）；仅当缺少 handlers 键时回退。
    """
    raw = _cfg_get(assignee_config, "handlers")
    if isinstance(raw, list):
        out: list[dict[str, Any]] = []
        for item in raw:
            if not isinstance(item, dict):
                continue
            h_type = item.get("type") or item.get("assignee_type") or item.get("assigneeType")
            if not h_type:
                continue
            value = item.get("value")
            if value is None:
                value = item.get("assignee_value") or item.get("assigneeValue")
            out.append({"type": str(h_type), "value": value})
        return out

    assignee_type = _cfg_get(assignee_config, "assignee_type", "initiator")
    assignee_value = _cfg_get(assignee_config, "assignee_value")
    return [{"type": str(assignee_type or "initiator"), "value": assignee_value}]


async def _resolve_handler_assignees(
    db: AsyncSession,
    instance: WorkflowInstance,
    handler_type: str,
    handler_value: Any,
    *,
    node_id: uuid.UUID | None = None,
) -> list[uuid.UUID]:
    """解析单条 handler 为 user_id 列表（不去重）。"""
    if handler_type == "user" and handler_value:
        raw = handler_value
        if isinstance(raw, list):
            return [uuid.UUID(str(v)) for v in raw if v]
        if "," in str(raw):
            return [uuid.UUID(v.strip()) for v in str(raw).split(",") if v.strip()]
        return [uuid.UUID(str(raw))]

    if handler_type == "initiator":
        return [instance.initiated_by_id]

    if handler_type == "role" and handler_value:
        ids = await _resolve_users_for_role(db, str(handler_value))
        if not ids:
            ids = await _resolve_superuser_assignees(db)
        return ids

    if handler_type == "department" and handler_value:
        from app.models.org import Department

        try:
            dept_uuid = uuid.UUID(str(handler_value))
            dept_stmt = select(Department.manager_id).where(
                Department.id == dept_uuid,
                Department.is_deleted == False,  # noqa: E712
            )
            dept_result = await db.execute(dept_stmt)
            mgr_id = dept_result.scalar_one_or_none()
            if mgr_id:
                return [mgr_id]
        except (ValueError, Exception):
            pass
        return []

    if handler_type == "manager":
        # 优先发起人 manager_id，否则回退发起人所在部门的负责人
        from app.models.org import Department
        from app.models.user import User as UserModel

        direct_result = await db.execute(
            select(UserModel.manager_id).where(
                UserModel.id == instance.initiated_by_id,
                UserModel.is_deleted == False,  # noqa: E712
            )
        )
        direct_mgr = direct_result.scalar_one_or_none()
        if direct_mgr:
            return [direct_mgr]

        user_stmt = select(UserModel.department_id).where(
            UserModel.id == instance.initiated_by_id,
            UserModel.is_deleted == False,  # noqa: E712
        )
        user_result = await db.execute(user_stmt)
        dept_id = user_result.scalar_one_or_none()
        if dept_id:
            dept_stmt = select(Department.manager_id).where(
                Department.id == dept_id,
                Department.is_deleted == False,  # noqa: E712
            )
            dept_result = await db.execute(dept_stmt)
            mgr_id = dept_result.scalar_one_or_none()
            if mgr_id:
                return [mgr_id]
        await _write_log(
            db,
            instance.id,
            "manager_unresolved",
            node_id=node_id,
            details={"fallback": "initiator"},
        )
        return []

    return []


def _default_completion_condition(assignee_config: dict) -> str:
    """默认完成条件：旧单条 project_role → any；有 handlers 或其它 → all。"""
    explicit = _cfg_get(assignee_config, "completion_condition")
    if explicit in ("all", "any", "percentage"):
        return str(explicit)

    handlers_raw = _cfg_get(assignee_config, "handlers")
    has_handlers = isinstance(handlers_raw, list) and len(handlers_raw) > 0
    if not has_handlers:
        assignee_type = _cfg_get(assignee_config, "assignee_type", "initiator")
        if assignee_type == "project_role":
            return "any"
    return "all"


def _is_multi_instance_node(assignee_config: dict, assignee_count: int = 0) -> bool:
    """是否走会签/或签。多人解析结果强制 multi_instance。"""
    if assignee_count > 1:
        return True
    if bool(_cfg_get(assignee_config, "multi_instance")):
        return True
    handlers = _iter_assignee_handlers(assignee_config)
    if len(handlers) > 1:
        return True
    # 旧单条 project_role 默认多实例
    if (
        not isinstance(_cfg_get(assignee_config, "handlers"), list)
        or not _cfg_get(assignee_config, "handlers")
    ):
        if _cfg_get(assignee_config, "assignee_type") == "project_role":
            return True
    return False


async def _gen_instance_number(db: AsyncSession) -> str:
    year = datetime.now(UTC).year
    prefix = f"WF-{year}-"
    result = await db.execute(
        select(sa_func.count())
        .select_from(WorkflowInstance)
        .where(WorkflowInstance.instance_number.like(f"{prefix}%"))
    )
    count = result.scalar() or 0
    return f"{prefix}{count + 1:05d}"


async def _gen_task_number(db: AsyncSession) -> str:
    year = datetime.now(UTC).year
    prefix = f"WT-{year}-"
    result = await db.execute(
        select(sa_func.count())
        .select_from(WorkflowTask)
        .where(WorkflowTask.task_number.like(f"{prefix}%"))
    )
    count = result.scalar() or 0
    return f"{prefix}{count + 1:05d}"


async def _write_log(
    db: AsyncSession,
    instance_id: uuid.UUID,
    event_type: str,
    *,
    node_id: uuid.UUID | None = None,
    task_id: uuid.UUID | None = None,
    actor_id: uuid.UUID | None = None,
    details: dict | None = None,
    comment: str | None = None,
) -> None:
    log = WorkflowInstanceLog(
        instance_id=instance_id,
        node_id=node_id,
        task_id=task_id,
        event_type=event_type,
        actor_id=actor_id,
        details=details,
        comment=comment,
    )
    db.add(log)


async def _send_task_notification(
    db: AsyncSession,
    *,
    task: WorkflowTask,
    instance: WorkflowInstance,
    assignee_id: uuid.UUID,
    node_name: str,
) -> None:
    """Create a notification record for a newly-assigned workflow task."""
    from app.models.notification import Notification

    entity_label = instance.title or "审批任务"
    notif = Notification(
        user_id=assignee_id,
        title=f"新审批任务: {node_name}",
        message=f"您有一条新的审批任务 [{entity_label}] 需要处理，任务编号 {task.task_number}。",
        type="warning",
        related_item_id=str(task.id),
        related_item_type="WorkflowTask",
        related_item_url=f"/workflows?tab=tasks&task={task.id}",
    )
    db.add(notif)


def _prune_active_design(defn: WorkflowDefinition) -> WorkflowDefinition:
    """Keep only active nodes/edges; dedupe repeated node_key revisions for corrupted templates."""
    all_nodes = [n for n in (defn.nodes or []) if not n.is_deleted]
    if not all_nodes:
        defn.nodes = []
        defn.edges = []
        return defn

    id_to_key = {n.id: n.node_key for n in all_nodes}
    by_key: dict[str, list[WorkflowNode]] = {}
    for node in all_nodes:
        by_key.setdefault(node.node_key, []).append(node)
    active_nodes = [
        min(group, key=lambda n: (n.sort_order, str(n.id)))
        for group in by_key.values()
    ]
    key_to_node = {n.node_key: n for n in active_nodes}

    pair_to_edge: dict[tuple[str, str], WorkflowEdge] = {}
    for edge in (defn.edges or []):
        if edge.is_deleted:
            continue
        source_key = id_to_key.get(edge.source_node_id)
        target_key = id_to_key.get(edge.target_node_id)
        if not source_key or not target_key:
            continue
        if source_key not in key_to_node or target_key not in key_to_node:
            continue
        pair = (source_key, target_key)
        prev = pair_to_edge.get(pair)
        if prev is None or edge.sort_order >= prev.sort_order:
            pair_to_edge[pair] = edge

    active_edges: list[WorkflowEdge] = []
    for edge in pair_to_edge.values():
        source_key = id_to_key[edge.source_node_id]
        target_key = id_to_key[edge.target_node_id]
        # Detached copies — avoid mutating persisted ORM edges in the session
        active_edges.append(
            WorkflowEdge(
                id=edge.id,
                definition_id=edge.definition_id,
                source_node_id=key_to_node[source_key].id,
                target_node_id=key_to_node[target_key].id,
                label=edge.label,
                condition=edge.condition,
                is_default=edge.is_default,
                sort_order=edge.sort_order,
                is_deleted=False,
            )
        )

    defn.nodes = active_nodes
    defn.edges = active_edges
    return defn


def _find_node_by_type(nodes: list[WorkflowNode], node_type: str) -> WorkflowNode | None:
    matches = [n for n in nodes if n.node_type == node_type]
    if not matches:
        return None
    return min(matches, key=lambda n: (n.sort_order, n.position_x or 0))


def _find_outgoing_edges(edges: list[WorkflowEdge], node_id: uuid.UUID) -> list[WorkflowEdge]:
    return [e for e in edges if e.source_node_id == node_id]


def _find_incoming_edges(edges: list[WorkflowEdge], node_id: uuid.UUID) -> list[WorkflowEdge]:
    return [e for e in edges if e.target_node_id == node_id]


def _find_node_by_id(nodes: list[WorkflowNode], node_id: uuid.UUID) -> WorkflowNode | None:
    for n in nodes:
        if n.id == node_id:
            return n
    return None


def _evaluate_single_condition(condition: dict, variables: dict) -> bool:
    if "expression" in condition:
        from app.services.workflow.workflow_expression import safe_eval_expression
        return safe_eval_expression(str(condition.get("expression") or ""), variables)

    if "logic" in condition:
        logic = condition["logic"]
        sub_conditions = condition.get("conditions", [])
        if logic == "and":
            return all(_evaluate_single_condition(c, variables) for c in sub_conditions)
        elif logic == "or":
            return any(_evaluate_single_condition(c, variables) for c in sub_conditions)
        return False

    field = condition.get("field", "")
    operator = condition.get("operator", "eq")
    expected = condition.get("value")
    actual = variables.get(field)

    if operator == "eq":
        return actual == expected
    elif operator == "neq":
        return actual != expected
    elif operator == "gt":
        return actual is not None and actual > expected
    elif operator == "gte":
        return actual is not None and actual >= expected
    elif operator == "lt":
        return actual is not None and actual < expected
    elif operator == "lte":
        return actual is not None and actual <= expected
    elif operator == "in":
        return actual in (expected if isinstance(expected, list) else [expected])
    elif operator == "contains":
        # 动态类型条件判断，运行时已保证类型安全
        return expected in (actual if actual else "")  # type: ignore[reportOperatorIssue]  动态类型条件判断
    return False


def _cfg_get(cfg: dict, snake_key: str, default: Any = None) -> Any:
    """Read from a JSON config dict, supporting both snake_case and camelCase keys.

    Seed data often stores camelCase keys (e.g. ``assigneeType``) while API-
    originated data goes through the recursive ``keysToSnake()`` converter and
    arrives as snake_case (``assignee_type``).  This helper checks snake_case
    first, then falls back to camelCase so both formats work transparently.
    """
    if snake_key in cfg:
        return cfg[snake_key]
    # Convert snake_case → camelCase: "reject_action" → "rejectAction"
    parts = snake_key.split("_")
    camel_key = parts[0] + "".join(p.capitalize() for p in parts[1:])
    return cfg.get(camel_key, default)


def _find_form_button(node: WorkflowNode, button_key: str | None) -> dict | None:
    """Locate a button definition in node.form_config.buttons by key."""
    if not button_key or not node.form_config:
        return None
    buttons = _cfg_get(node.form_config, "buttons") or []
    if not isinstance(buttons, list):
        return None
    for btn in buttons:
        if not isinstance(btn, dict):
            continue
        if _cfg_get(btn, "key") == button_key:
            return btn
    return None


def _normalize_button_action(action: str | None) -> str:
    if action in ("complete", "save"):
        return "route"
    if action == "reject":
        return "back_to_start"
    return action or "route"


def _resolve_button_result(btn: dict | None, fallback: str) -> str:
    if btn:
        explicit = _cfg_get(btn, "result")
        if explicit:
            return str(explicit)
        action = _normalize_button_action(_cfg_get(btn, "action"))
        if action == "terminate":
            return "void"
        if action == "back_to_start":
            return "returned"
        if _cfg_get(btn, "action") == "reject":
            return "rejected"
    return fallback or "approved"


async def _terminate_instance_with_result(
    db: AsyncSession,
    instance: WorkflowInstance,
    *,
    actor_id: uuid.UUID,
    result: str,
    reason: str,
) -> None:
    instance.status = "terminated"
    instance.completed_at = datetime.now(UTC)
    instance.current_node_ids = []
    await _write_log(
        db, instance.id, "instance_terminated",
        actor_id=actor_id, details={"reason": reason, "result": result},
    )
    if instance.entity_type and instance.entity_id:
        from app.services.workflow.workflow_integration import (
            handle_workflow_completion,
        )
        await handle_workflow_completion(db, instance, result=result)


# ═══════════════════════════════════════════
#  WorkflowEngine (lifecycle management)
# ═══════════════════════════════════════════

class WorkflowEngine:
    """Workflow engine that manages instance lifecycle."""

    def __init__(self, db: AsyncSession):
        self.db = db

    async def load_definition_full(self, definition_id: uuid.UUID) -> WorkflowDefinition:
        stmt = (
            select(WorkflowDefinition).where(WorkflowDefinition.is_deleted == False)  # noqa: E712  SQLAlchemy 查询表达式
            .options(
                selectinload(WorkflowDefinition.nodes),
                selectinload(WorkflowDefinition.edges),
            )
            .where(WorkflowDefinition.id == definition_id)
        )
        result = await self.db.execute(stmt)
        defn = result.scalar_one_or_none()
        if not defn:
            raise ValueError(f"Workflow definition {definition_id} not found")
        return _prune_active_design(defn)

    async def start_instance(
        self,
        definition_id: uuid.UUID,
        title: str,
        initiated_by_id: uuid.UUID,
        entity_type: str | None = None,
        entity_id: uuid.UUID | None = None,
        variables: dict | None = None,
        priority: str = "Medium",
    ) -> WorkflowInstance:
        defn = await self.load_definition_full(definition_id)
        if defn.status != "published":
            raise ValueError("Only published workflows can be started")

        instance_number = await _gen_instance_number(self.db)
        instance = WorkflowInstance(
            definition_id=definition_id,
            instance_number=instance_number,
            title=title,
            status="running",
            entity_type=entity_type or defn.entity_type,
            entity_id=entity_id,
            variables=variables or {},
            current_node_ids=[],
            priority=priority,
            initiated_by_id=initiated_by_id,
        )
        self.db.add(instance)
        await self.db.flush()

        await _write_log(
            self.db, instance.id, "instance_started",
            actor_id=initiated_by_id,
            details={"definition_key": defn.key, "title": title},
        )

        start_node = _find_node_by_type(defn.nodes, "start")
        if not start_node:
            raise ValueError("Workflow has no start node")

        await self._advance_from_node(instance, defn, start_node)
        return instance

    async def complete_task(
        self,
        task: WorkflowTask,
        result: str,
        actor_id: uuid.UUID,
        comment: str | None = None,
        form_data: dict | None = None,
        button_key: str | None = None,
        target_node_key: str | None = None,
    ) -> WorkflowTask:
        instance = task.instance
        if not instance:
            stmt = select(WorkflowInstance).where(WorkflowInstance.is_deleted == False).where(WorkflowInstance.id == task.instance_id)  # noqa: E712  SQLAlchemy 查询表达式
            res = await self.db.execute(stmt)
            instance = res.scalar_one()

        defn = await self.load_definition_full(instance.definition_id)
        assert defn is not None
        node = _find_node_by_id(defn.nodes, task.node_id)  # type: ignore[reportArgumentType]

        button_cfg = _find_form_button(node, button_key) if node else None
        if button_cfg:
            # Prefer button definition over client-supplied target (anti-tamper)
            configured_target = _cfg_get(button_cfg, "target_node_key")
            if configured_target:
                target_node_key = str(configured_target)
            result = _resolve_button_result(button_cfg, result)

        task.status = "completed"
        task.result = result
        task.comment = comment
        task.form_data = form_data
        task.completed_at = datetime.now(UTC)

        if form_data and instance.variables is not None:
            merged = dict(instance.variables)
            merged.update(form_data)
            instance.variables = merged

        # Gateway / branch conditions read from instance.variables
        variables = dict(instance.variables or {})
        variables["result"] = result
        if button_key:
            variables["button_key"] = button_key
        if target_node_key:
            variables["button_target_node_key"] = target_node_key
        instance.variables = variables

        await _write_log(
            self.db, instance.id, "task_completed",
            node_id=task.node_id, task_id=task.id, actor_id=actor_id,
            details={
                "result": result,
                "button_key": button_key,
                "target_node_key": target_node_key,
            },
            comment=comment,
        )

        from app.services.workflow.approval_signatures import record_task_signature

        await record_task_signature(
            self.db,
            instance=instance,
            task=task,
            node=node,
            result=result,
            actor_id=actor_id,
            comment=comment,
        )

        if not node:
            return task

        # Handle multi-instance (countersign / or-sign)
        assignee_cfg = node.assignee_config or {}
        sibling_tasks_stmt = select(WorkflowTask).where(WorkflowTask.is_deleted == False).where(  # noqa: E712  SQLAlchemy 查询表达式
            WorkflowTask.instance_id == instance.id,
            WorkflowTask.node_id == node.id,
        )
        sibling_result = await self.db.execute(sibling_tasks_stmt)
        siblings = list(sibling_result.scalars().all())
        multi_instance = _is_multi_instance_node(assignee_cfg, assignee_count=len(siblings))

        # 会签/或签驳回：任一人 rejected 立即结束，取消其余 pending
        if result == "rejected" and multi_instance and len(siblings) > 1:
            for sibling in siblings:
                if sibling.id != task.id and sibling.status in ("pending", "claimed"):
                    sibling.status = "cancelled"

        if multi_instance and node.assignee_config and result != "rejected":
            condition = _default_completion_condition(assignee_cfg)
            completed = [t for t in siblings if t.status == "completed"]

            if condition == "all" and len(completed) < len(siblings):
                return task
            elif condition == "any":
                for sibling in siblings:
                    if sibling.id != task.id and sibling.status in ("pending", "claimed"):
                        sibling.status = "cancelled"
            elif condition == "percentage":
                pct = _cfg_get(node.assignee_config, "completion_percentage", 100)
                if len(completed) / max(len(siblings), 1) * 100 < pct:
                    return task

        # Button-driven actions take precedence over legacy reject_action
        button_action = _normalize_button_action(_cfg_get(button_cfg, "action")) if button_cfg else None
        if button_action == "terminate":
            await _terminate_instance_with_result(
                self.db, instance, actor_id=actor_id, result=result, reason="button_terminate",
            )
            return task
        if button_action == "back_to_start":
            start_node = _find_node_by_type(defn.nodes, "start")
            if start_node:
                out_edges = _find_outgoing_edges(defn.edges, start_node.id)
                if out_edges:
                    first_node = _find_node_by_id(defn.nodes, out_edges[0].target_node_id)
                    if first_node:
                        await self._enter_node(instance, defn, first_node)
            return task

        # Legacy rejection (no button_key)
        if result == "rejected" and not button_cfg:
            from app.services.workflow.workflow_constants import normalize_reject_action

            reject_action = "terminate"
            if node.approval_config:
                reject_action = normalize_reject_action(
                    _cfg_get(node.approval_config, "reject_action", "terminate")
                )

            if reject_action == "terminate":
                await _terminate_instance_with_result(
                    self.db, instance, actor_id=actor_id, result="rejected", reason="rejected",
                )
                return task
            elif reject_action == "back_to_start":
                start_node = _find_node_by_type(defn.nodes, "start")
                if start_node:
                    out_edges = _find_outgoing_edges(defn.edges, start_node.id)
                    if out_edges:
                        first_node = _find_node_by_id(defn.nodes, out_edges[0].target_node_id)
                        if first_node:
                            await self._enter_node(instance, defn, first_node)
                return task
            elif reject_action == "back_to_previous":
                in_edges = _find_incoming_edges(defn.edges, node.id)
                if in_edges:
                    prev_node = _find_node_by_id(defn.nodes, in_edges[0].source_node_id)
                    if prev_node and prev_node.node_type in ("user_task", "approval"):
                        await self._enter_node(instance, defn, prev_node)
                return task

        await self._advance_from_node(instance, defn, node)
        return task

    async def delegate_task(
        self,
        task: WorkflowTask,
        target_user_id: uuid.UUID,
        actor_id: uuid.UUID,
        comment: str | None = None,
    ) -> WorkflowTask:
        task.status = "delegated"
        task.comment = comment

        await _write_log(
            self.db, task.instance_id, "task_delegated",
            node_id=task.node_id, task_id=task.id, actor_id=actor_id,
            details={"delegated_to": str(target_user_id)}, comment=comment,
        )

        new_task = WorkflowTask(
            instance_id=task.instance_id,
            node_id=task.node_id,
            task_number=await _gen_task_number(self.db),
            name=task.name,
            status="pending",
            assignee_id=target_user_id,
        )
        self.db.add(new_task)
        return task

    async def suspend_instance(self, instance: WorkflowInstance, actor_id: uuid.UUID) -> None:
        instance.status = "suspended"
        await _write_log(self.db, instance.id, "instance_suspended", actor_id=actor_id)

    async def resume_instance(self, instance: WorkflowInstance, actor_id: uuid.UUID) -> None:
        instance.status = "running"
        await _write_log(self.db, instance.id, "instance_resumed", actor_id=actor_id)

    async def terminate_instance(self, instance: WorkflowInstance, actor_id: uuid.UUID) -> None:
        instance.status = "terminated"
        instance.completed_at = datetime.now(UTC)
        instance.current_node_ids = []
        stmt = select(WorkflowTask).where(WorkflowTask.is_deleted == False).where(  # noqa: E712  SQLAlchemy 查询表达式
            WorkflowTask.instance_id == instance.id,
            WorkflowTask.status.in_(["pending", "claimed"]),
        )
        result = await self.db.execute(stmt)
        for t in result.scalars().all():
            t.status = "cancelled"
        await _write_log(self.db, instance.id, "instance_terminated", actor_id=actor_id)

    # ── Private ──

    async def _advance_from_node(
        self,
        instance: WorkflowInstance,
        defn: WorkflowDefinition,
        from_node: WorkflowNode,
    ) -> None:
        out_edges = _find_outgoing_edges(defn.edges, from_node.id)
        if not out_edges:
            return

        if from_node.node_type == "exclusive_gateway":
            variables = instance.variables or {}
            chosen_edge = None
            default_edge = None
            for edge in out_edges:
                if edge.is_default:
                    default_edge = edge
                    continue
                if edge.condition and _evaluate_single_condition(edge.condition, variables):
                    chosen_edge = edge
                    break
            if not chosen_edge:
                chosen_edge = default_edge
            if chosen_edge:
                target = _find_node_by_id(defn.nodes, chosen_edge.target_node_id)
                if target:
                    await _write_log(
                        self.db, instance.id, "gateway_evaluated",
                        node_id=from_node.id,
                        details={"chosen_edge": str(chosen_edge.id), "label": chosen_edge.label},
                    )
                    await self._enter_node(instance, defn, target)

        elif from_node.node_type == "parallel_gateway":
            in_edges = _find_incoming_edges(defn.edges, from_node.id)
            if len(out_edges) > 1 or len(in_edges) <= 1:
                for edge in out_edges:
                    target = _find_node_by_id(defn.nodes, edge.target_node_id)
                    if target:
                        await self._enter_node(instance, defn, target)
            else:
                all_done = True
                for ie in in_edges:
                    source = _find_node_by_id(defn.nodes, ie.source_node_id)
                    if source:
                        pending_stmt = select(sa_func.count()).select_from(WorkflowTask).where(
                            WorkflowTask.instance_id == instance.id,
                            WorkflowTask.node_id == source.id,
                            WorkflowTask.status.in_(["pending", "claimed"]),
                            WorkflowTask.is_deleted == False,  # noqa: E712
                        )
                        res = await self.db.execute(pending_stmt)
                        if (res.scalar() or 0) > 0:
                            all_done = False
                            break
                if all_done:
                    for edge in out_edges:
                        target = _find_node_by_id(defn.nodes, edge.target_node_id)
                        if target:
                            await self._enter_node(instance, defn, target)
        else:
            # user_task / approval / service / start: prefer single matching branch
            variables = instance.variables or {}
            target_key = variables.get("button_target_node_key") or variables.get("buttonTargetNodeKey")
            button_key = variables.get("button_key") or variables.get("buttonKey")

            chosen_edge = None
            default_edge = None
            if target_key or button_key or len(out_edges) > 1:
                for edge in out_edges:
                    if edge.is_default:
                        default_edge = edge
                    tgt = _find_node_by_id(defn.nodes, edge.target_node_id)
                    if target_key and tgt and tgt.node_key == str(target_key):
                        chosen_edge = edge
                        break
                    if button_key and edge.condition and _evaluate_single_condition(
                        edge.condition, variables,
                    ):
                        chosen_edge = edge
                        break
                if not chosen_edge and len(out_edges) == 1:
                    chosen_edge = out_edges[0]
                if not chosen_edge:
                    chosen_edge = default_edge
                if chosen_edge:
                    target = _find_node_by_id(defn.nodes, chosen_edge.target_node_id)
                    if target:
                        await self._enter_node(instance, defn, target)
                else:
                    await _write_log(
                        self.db, instance.id, "branch_unresolved",
                        node_id=from_node.id,
                        details={
                            "button_key": button_key,
                            "button_target_node_key": target_key,
                            "outgoing": len(out_edges),
                        },
                    )
            else:
                for edge in out_edges:
                    target = _find_node_by_id(defn.nodes, edge.target_node_id)
                    if target:
                        await self._enter_node(instance, defn, target)

    async def _enter_node(
        self,
        instance: WorkflowInstance,
        defn: WorkflowDefinition,
        node: WorkflowNode,
    ) -> None:
        await _write_log(self.db, instance.id, "node_entered", node_id=node.id)

        current = list(instance.current_node_ids or [])
        node_id_str = str(node.id)
        if node_id_str not in current:
            current.append(node_id_str)
        instance.current_node_ids = current

        if node.node_type == "end":
            instance.status = "completed"
            instance.completed_at = datetime.now(UTC)
            instance.current_node_ids = []
            await _write_log(self.db, instance.id, "instance_completed")

            if instance.entity_type and instance.entity_id:
                from app.services.workflow.workflow_integration import handle_workflow_completion
                last_task_stmt = (
                    select(WorkflowTask).where(WorkflowTask.is_deleted == False)  # noqa: E712  SQLAlchemy 查询表达式
                    .where(
                        WorkflowTask.instance_id == instance.id,
                        WorkflowTask.status == "completed",
                    )
                    .order_by(WorkflowTask.completed_at.desc())
                    .limit(1)
                )
                last_task_result = await self.db.execute(last_task_stmt)
                last_task = last_task_result.scalar_one_or_none()
                wf_result = last_task.result if last_task else "approved"
                await handle_workflow_completion(self.db, instance, result=wf_result)  # type: ignore[reportArgumentType]  类型修复
            return

        if node.node_type in ("user_task", "approval"):
            await self._create_tasks_for_node(instance, node)
            return

        if node.node_type == "service_task":
            await self._execute_service_task(instance, node)
            current = [nid for nid in (instance.current_node_ids or []) if nid != node_id_str]
            instance.current_node_ids = current
            await self._advance_from_node(instance, defn, node)
            return

        if node.node_type in ("exclusive_gateway", "parallel_gateway"):
            await self._advance_from_node(instance, defn, node)
            return

    async def _create_tasks_for_node(
        self,
        instance: WorkflowInstance,
        node: WorkflowNode,
    ) -> None:
        assignee_config = node.assignee_config or {}
        assignee_ids: list[uuid.UUID] = []
        seen: set[uuid.UUID] = set()

        # 审批节点：优先使用 approval_config 中的 approvers 列表（覆盖 handlers）
        if node.node_type == "approval" and node.approval_config:
            approvers = node.approval_config.get("approvers", [])
            if approvers:
                for a in approvers:
                    if not a.get("id"):
                        continue
                    try:
                        aid = uuid.UUID(str(a["id"]))
                    except ValueError:
                        continue
                    if aid not in seen:
                        seen.add(aid)
                        assignee_ids.append(aid)

        if not assignee_ids:
            for handler in _iter_assignee_handlers(assignee_config):
                resolved = await _resolve_handler_assignees(
                    self.db,
                    instance,
                    handler["type"],
                    handler.get("value"),
                    node_id=node.id,
                )
                for aid in resolved:
                    if aid not in seen:
                        seen.add(aid)
                        assignee_ids.append(aid)

        if not assignee_ids:
            # 最终回退：分配给发起人（确保任务可见）
            assignee_ids = [instance.initiated_by_id]

        for aid in assignee_ids:
            task = WorkflowTask(
                instance_id=instance.id,
                node_id=node.id,
                task_number=await _gen_task_number(self.db),
                name=node.name,
                status="pending",
                assignee_id=aid,
            )
            self.db.add(task)
            await self.db.flush()
            await _write_log(
                self.db, instance.id, "task_created",
                node_id=node.id, task_id=task.id,
                details={"assignee_id": str(aid) if aid else None},
            )

            # ── Send notification to assignee ──
            await _send_task_notification(
                self.db, task=task, instance=instance,
                assignee_id=aid, node_name=node.name,
            )

    async def _execute_service_task(
        self,
        instance: WorkflowInstance,
        node: WorkflowNode,
    ) -> None:
        action_config = node.action_config or {}
        action_type = _cfg_get(action_config, "action_type")

        if action_type == "update_field":
            config = _cfg_get(action_config, "action_config", {})
            field = _cfg_get(config, "entity_field")
            value = _cfg_get(config, "field_value")
            if field and instance.variables is not None:
                merged = dict(instance.variables)
                merged[field] = value
                instance.variables = merged

        await _write_log(
            self.db, instance.id, "service_task_executed",
            node_id=node.id,
            details={"action_type": action_type},
        )


# ═══════════════════════════════════════════
#  WorkflowService (CRUD queries)
# ═══════════════════════════════════════════

class WorkflowService:
    """Thin data-access layer for workflow definitions, instances, and tasks."""

    # ── Definitions ──

    @staticmethod
    async def list_definitions(
        db: AsyncSession,
        *,
        category: str | None = None,
        status_filter: str | None = None,
        skip: int = 0,
        limit: int = 50,
    ) -> list[WorkflowDefinition]:
        stmt = select(WorkflowDefinition).where(WorkflowDefinition.is_deleted == False).offset(skip).limit(limit).order_by(WorkflowDefinition.updated_at.desc())  # noqa: E712  SQLAlchemy 查询表达式
        if category:
            stmt = stmt.where(WorkflowDefinition.category == category)
        if status_filter:
            stmt = stmt.where(WorkflowDefinition.status == status_filter)
        result = await db.execute(stmt)
        return list(result.scalars().all())

    @staticmethod
    async def list_templates(db: AsyncSession) -> list[WorkflowDefinition]:
        stmt = select(WorkflowDefinition).where(WorkflowDefinition.is_deleted == False).where(WorkflowDefinition.is_builtin == True).order_by(WorkflowDefinition.name)  # noqa: E712
        result = await db.execute(stmt)
        return list(result.scalars().all())

    @staticmethod
    async def get_definition(db: AsyncSession, definition_id: uuid.UUID) -> WorkflowDefinition | None:
        stmt = (
            select(WorkflowDefinition).where(WorkflowDefinition.is_deleted == False)  # noqa: E712  SQLAlchemy 查询表达式
            .options(selectinload(WorkflowDefinition.nodes), selectinload(WorkflowDefinition.edges))
            .where(WorkflowDefinition.id == definition_id)
        )
        result = await db.execute(stmt)
        defn = result.scalar_one_or_none()
        return _prune_active_design(defn) if defn else None

    @staticmethod
    async def create_definition(db: AsyncSession, data: dict, created_by_id: uuid.UUID) -> WorkflowDefinition:
        defn = WorkflowDefinition(**data, created_by_id=created_by_id)
        db.add(defn)
        await db.commit()
        return await WorkflowService.get_definition(db, defn.id)  # type: ignore[reportReturnType]  类型修复

    @staticmethod
    async def update_definition(db: AsyncSession, definition_id: uuid.UUID, data: dict) -> WorkflowDefinition | None:
        result = await db.execute(select(WorkflowDefinition).where(WorkflowDefinition.is_deleted == False).where(WorkflowDefinition.id == definition_id))  # noqa: E712  SQLAlchemy 查询表达式
        defn = result.scalar_one_or_none()
        if not defn:
            return None
        for k, v in data.items():
            setattr(defn, k, v)
        await db.commit()
        return await WorkflowService.get_definition(db, definition_id)

    @staticmethod
    async def delete_definition(db: AsyncSession, definition_id: uuid.UUID) -> bool:
        result = await db.execute(select(WorkflowDefinition).where(WorkflowDefinition.id == definition_id))
        defn = result.scalar_one_or_none()
        if not defn:
            return False
        defn.is_deleted = True
        await db.commit()
        return True

    @staticmethod
    async def save_design(
        db: AsyncSession,
        definition_id: uuid.UUID,
        nodes_data: list,
        edges_data: list,
    ) -> WorkflowDefinition | None:
        stmt = (
            select(WorkflowDefinition)
            .options(selectinload(WorkflowDefinition.nodes), selectinload(WorkflowDefinition.edges))
            .where(WorkflowDefinition.is_deleted == False, WorkflowDefinition.id == definition_id)  # noqa: E712
        )
        result = await db.execute(stmt)
        defn = result.scalar_one_or_none()
        if not defn:
            return None

        # Delete old edges first (they reference nodes), then nodes
        # FK constraints use ON DELETE SET NULL, so instance logs/tasks
        # that reference these old nodes will have node_id set to NULL
        for edge in list(defn.edges):
            edge.is_deleted = True
        for node in list(defn.nodes):
            node.is_deleted = True
        await db.flush()

        node_key_to_id: dict[str, uuid.UUID] = {}
        for ndata in nodes_data:
            node = WorkflowNode(definition_id=definition_id, **ndata.model_dump())
            db.add(node)
            await db.flush()
            node_key_to_id[ndata.node_key] = node.id

        for edata in edges_data:
            source_id = node_key_to_id.get(edata.source_node_key)
            target_id = node_key_to_id.get(edata.target_node_key)
            if not source_id or not target_id:
                raise ValueError(
                    f"Invalid node key in edge: {edata.source_node_key} → {edata.target_node_key}"
                )
            edge = WorkflowEdge(
                definition_id=definition_id,
                source_node_id=source_id,
                target_node_id=target_id,
                label=edata.label,
                condition=edata.condition,
                is_default=edata.is_default,
                sort_order=edata.sort_order,
            )
            db.add(edge)

        await db.commit()
        result2 = await db.execute(
            select(WorkflowDefinition).where(WorkflowDefinition.is_deleted == False)  # noqa: E712  SQLAlchemy 查询表达式
            .options(selectinload(WorkflowDefinition.nodes), selectinload(WorkflowDefinition.edges))
            .where(WorkflowDefinition.id == definition_id)
        )
        return result2.scalar_one()

    @staticmethod
    async def publish_definition(db: AsyncSession, definition_id: uuid.UUID) -> WorkflowDefinition | None:
        result = await db.execute(
            select(WorkflowDefinition).where(WorkflowDefinition.is_deleted == False)  # noqa: E712  SQLAlchemy 查询表达式
            .options(selectinload(WorkflowDefinition.nodes))
            .where(WorkflowDefinition.id == definition_id)
        )
        defn = result.scalar_one_or_none()
        if not defn:
            return None
        node_types = [n.node_type for n in defn.nodes]
        if "start" not in node_types:
            raise ValueError("Workflow must have a start node")
        if "end" not in node_types:
            raise ValueError("Workflow must have an end node")
        defn.status = "published"
        await db.commit()
        return await WorkflowService.get_definition(db, definition_id)

    @staticmethod
    async def archive_definition(db: AsyncSession, definition_id: uuid.UUID) -> WorkflowDefinition | None:
        result = await db.execute(select(WorkflowDefinition).where(WorkflowDefinition.is_deleted == False).where(WorkflowDefinition.id == definition_id))  # noqa: E712  SQLAlchemy 查询表达式
        defn = result.scalar_one_or_none()
        if not defn:
            return None
        defn.status = "archived"
        await db.commit()
        return await WorkflowService.get_definition(db, definition_id)

    @staticmethod
    async def clone_definition(
        db: AsyncSession,
        definition_id: uuid.UUID,
        created_by_id: uuid.UUID,
    ) -> WorkflowDefinition | None:
        stmt = (
            select(WorkflowDefinition).where(WorkflowDefinition.is_deleted == False)  # noqa: E712  SQLAlchemy 查询表达式
            .options(selectinload(WorkflowDefinition.nodes), selectinload(WorkflowDefinition.edges))
            .where(WorkflowDefinition.id == definition_id)
        )
        result = await db.execute(stmt)
        original = result.scalar_one_or_none()
        if not original:
            return None

        new_defn = WorkflowDefinition(
            key=f"{original.key}_copy_{datetime.now(UTC).strftime('%Y%m%d%H%M%S')}",
            name=f"{original.name} (Copy)",
            description=original.description,
            category=original.category,
            version=1,
            status="draft",
            entity_type=original.entity_type,
            trigger_config=original.trigger_config,
            created_by_id=created_by_id,
        )
        db.add(new_defn)
        await db.flush()

        node_old_to_new: dict[uuid.UUID, uuid.UUID] = {}
        for node in original.nodes:
            new_node = WorkflowNode(
                definition_id=new_defn.id,
                node_key=node.node_key,
                name=node.name,
                description=node.description,
                node_type=node.node_type,
                sort_order=node.sort_order,
                position_x=node.position_x,
                position_y=node.position_y,
                assignee_config=node.assignee_config,
                approval_config=node.approval_config,
                form_config=node.form_config,
                action_config=node.action_config,
                gateway_config=node.gateway_config,
                timeout_config=node.timeout_config,
            )
            db.add(new_node)
            await db.flush()
            node_old_to_new[node.id] = new_node.id

        for edge in original.edges:
            new_edge = WorkflowEdge(
                definition_id=new_defn.id,
                source_node_id=node_old_to_new[edge.source_node_id],
                target_node_id=node_old_to_new[edge.target_node_id],
                label=edge.label,
                condition=edge.condition,
                is_default=edge.is_default,
                sort_order=edge.sort_order,
            )
            db.add(new_edge)

        await db.commit()
        return await WorkflowService.get_definition(db, new_defn.id)

    # ── Instances ──

    @staticmethod
    async def list_instances(
        db: AsyncSession,
        *,
        status_filter: str | None = None,
        definition_id: str | None = None,
        skip: int = 0,
        limit: int = 50,
    ) -> list[WorkflowInstance]:
        stmt = select(WorkflowInstance).where(WorkflowInstance.is_deleted == False).offset(skip).limit(limit).order_by(WorkflowInstance.created_at.desc())  # noqa: E712  SQLAlchemy 查询表达式
        if status_filter:
            stmt = stmt.where(WorkflowInstance.status == status_filter)
        if definition_id:
            stmt = stmt.where(WorkflowInstance.definition_id == uuid.UUID(definition_id))
        result = await db.execute(stmt)
        return list(result.scalars().all())

    @staticmethod
    async def get_instance(db: AsyncSession, instance_id: uuid.UUID) -> WorkflowInstance | None:
        stmt = (
            select(WorkflowInstance).where(WorkflowInstance.is_deleted == False)  # noqa: E712  SQLAlchemy 查询表达式
            .options(
                selectinload(WorkflowInstance.tasks).selectinload(WorkflowTask.node),
                selectinload(WorkflowInstance.tasks).selectinload(WorkflowTask.assignee),
                selectinload(WorkflowInstance.logs).selectinload(WorkflowInstanceLog.actor),
                selectinload(WorkflowInstance.logs).selectinload(WorkflowInstanceLog.node),
            )
            .where(WorkflowInstance.id == instance_id)
        )
        result = await db.execute(stmt)
        return result.scalar_one_or_none()

    @staticmethod
    async def get_instance_simple(db: AsyncSession, instance_id: uuid.UUID) -> WorkflowInstance | None:
        result = await db.execute(select(WorkflowInstance).where(WorkflowInstance.is_deleted == False).where(WorkflowInstance.id == instance_id))  # noqa: E712  SQLAlchemy 查询表达式
        return result.scalar_one_or_none()

    @staticmethod
    async def get_instance_logs(db: AsyncSession, instance_id: uuid.UUID) -> list[WorkflowInstanceLog]:
        stmt = (
            select(WorkflowInstanceLog).where(WorkflowInstanceLog.is_deleted == False)  # noqa: E712  SQLAlchemy 查询表达式
            .where(WorkflowInstanceLog.instance_id == instance_id)
            .order_by(WorkflowInstanceLog.created_at)
        )
        result = await db.execute(stmt)
        return list(result.scalars().all())

    # ── Tasks ──

    @staticmethod
    async def list_tasks(
        db: AsyncSession,
        *,
        status_filter: str | None = None,
        assignee_id: str | None = None,
        skip: int = 0,
        limit: int = 50,
    ) -> list[WorkflowTask]:
        stmt = (
            select(WorkflowTask).where(WorkflowTask.is_deleted == False)  # noqa: E712  SQLAlchemy 查询表达式
            .options(
                selectinload(WorkflowTask.node),
                selectinload(WorkflowTask.assignee),
                selectinload(WorkflowTask.instance).selectinload(WorkflowInstance.definition),
            )
            .offset(skip).limit(limit)
            .order_by(WorkflowTask.created_at.desc())
        )
        if status_filter:
            stmt = stmt.where(WorkflowTask.status == status_filter)
        if assignee_id:
            stmt = stmt.where(WorkflowTask.assignee_id == uuid.UUID(assignee_id))
        result = await db.execute(stmt)
        return list(result.scalars().all())

    @staticmethod
    async def my_tasks(db: AsyncSession, user_id: uuid.UUID) -> list[WorkflowTask]:
        stmt = (
            select(WorkflowTask).where(WorkflowTask.is_deleted == False)  # noqa: E712  SQLAlchemy 查询表达式
            .options(
                selectinload(WorkflowTask.node),
                selectinload(WorkflowTask.assignee),
                selectinload(WorkflowTask.instance).selectinload(WorkflowInstance.definition),
            )
            .where(
                WorkflowTask.assignee_id == user_id,
                WorkflowTask.status.in_(["pending", "claimed"]),
            )
            .order_by(WorkflowTask.created_at.desc())
        )
        result = await db.execute(stmt)
        return list(result.scalars().all())

    @staticmethod
    async def task_summary(db: AsyncSession, user_id: uuid.UUID) -> dict:
        base_where = [WorkflowTask.assignee_id == user_id, WorkflowTask.is_deleted == False]  # noqa: E712
        pending = await db.execute(
            select(sa_func.count()).select_from(WorkflowTask).where(*base_where, WorkflowTask.status == "pending")
        )
        claimed = await db.execute(
            select(sa_func.count()).select_from(WorkflowTask).where(*base_where, WorkflowTask.status == "claimed")
        )
        today_start = datetime.now(UTC).replace(hour=0, minute=0, second=0, microsecond=0)
        completed_today = await db.execute(
            select(sa_func.count()).select_from(WorkflowTask).where(
                *base_where, WorkflowTask.status == "completed",
                WorkflowTask.completed_at >= today_start,
            )
        )
        overdue = await db.execute(
            select(sa_func.count()).select_from(WorkflowTask).where(
                *base_where,
                WorkflowTask.status.in_(["pending", "claimed"]),
                WorkflowTask.due_date < datetime.now(UTC),
            )
        )
        total = await db.execute(
            select(sa_func.count()).select_from(WorkflowTask).where(*base_where)
        )
        return {
            "pending": pending.scalar() or 0,
            "claimed": claimed.scalar() or 0,
            "completed_today": completed_today.scalar() or 0,
            "overdue": overdue.scalar() or 0,
            "total": total.scalar() or 0,
        }

    @staticmethod
    async def get_task(db: AsyncSession, task_id: uuid.UUID) -> WorkflowTask | None:
        stmt = (
            select(WorkflowTask).where(WorkflowTask.is_deleted == False)  # noqa: E712  SQLAlchemy 查询表达式
            .options(
                selectinload(WorkflowTask.node),
                selectinload(WorkflowTask.assignee),
                selectinload(WorkflowTask.instance).selectinload(WorkflowInstance.definition),
            )
            .where(WorkflowTask.id == task_id)
        )
        result = await db.execute(stmt)
        return result.scalar_one_or_none()

    @staticmethod
    async def get_task_with_instance(db: AsyncSession, task_id: uuid.UUID) -> WorkflowTask | None:
        stmt = (
            select(WorkflowTask).where(WorkflowTask.is_deleted == False)  # noqa: E712  SQLAlchemy 查询表达式
            .options(
                selectinload(WorkflowTask.node),
                selectinload(WorkflowTask.assignee),
                selectinload(WorkflowTask.instance),
            )
            .where(WorkflowTask.id == task_id)
        )
        result = await db.execute(stmt)
        return result.scalar_one_or_none()

    @staticmethod
    async def claim_task(db: AsyncSession, task: WorkflowTask, user_id: uuid.UUID) -> WorkflowTask:
        task.status = "claimed"
        task.assignee_id = user_id
        task.claimed_at = datetime.now(UTC)
        await db.commit()
        return await WorkflowService.get_task(db, task.id)  # type: ignore[reportReturnType]  类型修复 
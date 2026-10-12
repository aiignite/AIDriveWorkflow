"""Workflow ↔ business-entity integration (AIDriveWorkflow standalone edition).

AIIgnitePLM kept a ~90-entry ENTITY_TYPE_REGISTRY that dynamically imported
business models. The standalone workflow app has no business modules, so the
registry ships empty and every hook degrades gracefully:

- entity status is NOT written back (no business tables exist);
- entity detail cards are rendered from the instance's variables;
- the API surface and response shapes are kept 1:1 with PLM so business
  integrations can be registered later by filling ENTITY_TYPE_REGISTRY.

Registry entry shape (for future integrations):
    {
        "display_name": "...",
        "module": "...",
        "model": "app.models.xxx.SomeModel",   # dynamic import target
        "status_field": "status",
        "review_status": "In Review",
        "completion_status": {"approved": "...", "rejected": "..."},
        "completion_handler": "app.services.xxx.handle_completion",  # optional
    }
"""
from __future__ import annotations

import uuid

from sqlalchemy import and_, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.workflow import (
    WorkflowDefinition,
    WorkflowInstance,
    WorkflowTask,
)
from app.services.workflow.workflow_service import WorkflowEngine

# Extensible registry — filled by future business integrations.
ENTITY_TYPE_REGISTRY: dict[str, dict] = {}

_LEGACY_NAME_TO_TABLE: dict[str, str] = {}

DETAIL_ROUTE_TEMPLATES: dict[str, str] = {}

# Generic fields offered by /workflow-integration/entity-fields when no
# business entity is registered for the requested type.
GENERIC_ENTITY_FIELDS = [
    {"key": "title", "label": "标题"},
    {"key": "instance_number", "label": "流程编号"},
    {"key": "status", "label": "流程状态"},
    {"key": "started_at", "label": "发起时间"},
    {"key": "initiator", "label": "发起人"},
]


# ─── Registry accessors ──────────────────────────────────────────────

def resolve_entity_type(entity_type: str) -> str:
    """Normalize legacy/short names to canonical table names (no-op while registry is empty)."""
    return _LEGACY_NAME_TO_TABLE.get(entity_type, entity_type)


def get_entity_config(entity_type: str) -> dict | None:
    return ENTITY_TYPE_REGISTRY.get(entity_type)


def _entity_type_aliases(canonical: str) -> list[str]:
    """All entity_type values that may appear on wfl_instances for a canonical table."""
    aliases = {canonical}
    for legacy, table in _LEGACY_NAME_TO_TABLE.items():
        if table == canonical:
            aliases.add(legacy)
    return list(aliases)


def list_entity_types() -> list[dict]:
    """Return all registered entity types for UI display."""
    result = []
    for table_name, config in ENTITY_TYPE_REGISTRY.items():
        result.append({
            "key": table_name,
            "display_name": config.get("display_name", table_name),
            "module": config.get("module", "通用"),
            "legacy_aliases": [],
        })
    return sorted(result, key=lambda x: x["module"])


# ─── Derived maps (kept for API compatibility with PLM integrations) ──

ENTITY_STATUS_MAP = {
    table_name: {"model": cfg["model"], "status_field": cfg["status_field"]}
    for table_name, cfg in ENTITY_TYPE_REGISTRY.items()
    if "model" in cfg and "status_field" in cfg
}

COMPLETION_STATUS_MAP = {
    table_name: cfg.get("completion_status", {})
    for table_name, cfg in ENTITY_TYPE_REGISTRY.items()
}


def _get_review_status(entity_type: str) -> str | None:
    canonical = resolve_entity_type(entity_type)
    config = get_entity_config(canonical) or get_entity_config(entity_type)
    return (config or {}).get("review_status")


async def resolve_detail_route_async(
    db: AsyncSession,
    entity_type: str,
    entity_id: str,
) -> str | None:
    """Resolve frontend path to open full business object detail (none while standalone)."""
    canonical = resolve_entity_type(entity_type)
    template = DETAIL_ROUTE_TEMPLATES.get(canonical)
    if not template:
        return None
    return template.format(entity_id=entity_id)


# ─── Workflow discovery ──────────────────────────────────────────────

async def find_workflow_for_entity(
    db: AsyncSession,
    entity_type: str,
    category: str | None = None,
) -> WorkflowDefinition | None:
    """Find a published workflow definition that handles this entity type.

    Lookup priority:
    1. Published workflow with matching entity_type
    2. Published workflow with matching category (only generic templates without entity_type)
    3. None (no workflow configured for this entity)
    """
    canonical = resolve_entity_type(entity_type)

    for candidate in dict.fromkeys([canonical, entity_type]):
        stmt = (
            select(WorkflowDefinition).where(WorkflowDefinition.is_deleted == False)  # noqa: E712
            .where(
                and_(
                    WorkflowDefinition.status == "published",
                    WorkflowDefinition.entity_type == candidate,
                )
            )
            .order_by(WorkflowDefinition.version.desc())
            .limit(1)
        )
        result = await db.execute(stmt)
        defn = result.scalar_one_or_none()
        if defn:
            return defn

    if category:
        stmt = (
            select(WorkflowDefinition).where(WorkflowDefinition.is_deleted == False)  # noqa: E712
            .where(
                and_(
                    WorkflowDefinition.status == "published",
                    WorkflowDefinition.category == category,
                    or_(
                        WorkflowDefinition.entity_type.is_(None),
                        WorkflowDefinition.entity_type == "",
                    ),
                )
            )
            .order_by(WorkflowDefinition.version.desc())
            .limit(1)
        )
        result = await db.execute(stmt)
        defn = result.scalar_one_or_none()
        if defn:
            return defn

    return None


async def check_workflow_configured(
    db: AsyncSession,
    entity_type: str,
    category: str | None = None,
) -> bool:
    """Check if a workflow is configured for this entity type."""
    defn = await find_workflow_for_entity(db, entity_type, category)
    return defn is not None


async def assert_builtin_action_allowed(
    db: AsyncSession,
    entity_type: str,
    action: str,
    *,
    category: str | None = None,
    message: str | None = None,
) -> None:
    """Block built-in state-machine actions when the external engine is configured."""
    from app.exceptions import ConflictException
    from app.services.workflow.workflow_constants import ENGINE_MANAGED_ACTIONS

    if action not in ENGINE_MANAGED_ACTIONS:
        return
    if await check_workflow_configured(db, entity_type, category):
        raise ConflictException(
            message or "该实体已接入工作流引擎，请通过工作流待办完成审批。",
        )


# ─── Start / complete ────────────────────────────────────────────────

async def start_entity_workflow(
    db: AsyncSession,
    entity_type: str,
    entity_id: str,
    title: str,
    initiator_id: uuid.UUID,
    variables: dict | None = None,
    category: str | None = None,
) -> WorkflowInstance | None:
    """Start a workflow for a business entity.

    Returns the created WorkflowInstance or None if no workflow is configured.
    """
    defn = await find_workflow_for_entity(db, entity_type, category)
    if not defn:
        return None

    stmt = (
        select(WorkflowDefinition).where(WorkflowDefinition.is_deleted == False)  # noqa: E712
        .where(WorkflowDefinition.id == defn.id)
        .options(
            selectinload(WorkflowDefinition.nodes),
            selectinload(WorkflowDefinition.edges),
        )
    )
    result = await db.execute(stmt)
    full_defn = result.scalar_one()

    wf_variables = {
        "entity_type": entity_type,
        "entity_id": entity_id,
        "title": title,
        **(variables or {}),
    }

    engine = WorkflowEngine(db)
    instance = await engine.start_instance(
        definition_id=full_defn.id,
        title=title,
        initiated_by_id=initiator_id,
        entity_type=entity_type,
        entity_id=uuid.UUID(entity_id) if isinstance(entity_id, str) else entity_id,
        variables=wf_variables,
    )

    from app.services.workflow.approval_signatures import record_prepared_signature

    await record_prepared_signature(db, instance=instance, initiator_id=initiator_id)

    # Update entity status to the configured review status (no-op while unregistered).
    await _update_entity_status(db, entity_type, entity_id, _get_review_status(entity_type))

    return instance


async def handle_workflow_completion(
    db: AsyncSession,
    instance: WorkflowInstance,
    result: str = "approved",
):
    """Called when a workflow instance completes.

    Updates the linked business entity's status based on the outcome.
    Unregistered entity types are skipped (standalone instances carry no entity).
    """
    if not instance.entity_type or not instance.entity_id:
        return

    entity_type = resolve_entity_type(instance.entity_type)
    status_map = COMPLETION_STATUS_MAP.get(entity_type, {})
    new_status = status_map.get(result)

    if new_status:
        await _update_entity_status(db, entity_type, str(instance.entity_id), new_status)

    await _run_completion_handler(
        db,
        entity_type=entity_type,
        entity_id=str(instance.entity_id),
        result=result,
        instance=instance,
    )


async def _run_completion_handler(
    db: AsyncSession,
    *,
    entity_type: str,
    entity_id: str,
    result: str,
    instance: WorkflowInstance,
) -> None:
    config = get_entity_config(entity_type) or {}
    handler_path = config.get("completion_handler")
    if not handler_path:
        return

    import importlib
    import inspect

    module_path, func_name = str(handler_path).rsplit(".", 1)
    module = importlib.import_module(module_path)
    handler = getattr(module, func_name)
    handler_result = handler(
        db=db,
        entity_id=uuid.UUID(entity_id),
        result=result,
        instance=instance,
    )
    if inspect.isawaitable(handler_result):
        await handler_result


# ─── Entity status write-back (no-op while registry is empty) ────────

async def _update_entity_field(
    db: AsyncSession,
    entity_type: str,
    entity_id: str,
    field: str,
    value: object,
) -> None:
    """Update a single field on a registered business entity."""
    canonical = resolve_entity_type(entity_type)
    config = ENTITY_STATUS_MAP.get(canonical) or ENTITY_STATUS_MAP.get(entity_type)
    if not config:
        return

    module_path, class_name = config["model"].rsplit(".", 1)
    import importlib

    module = importlib.import_module(module_path)
    model_class = getattr(module, class_name)

    stmt = select(model_class).where(
        model_class.is_deleted == False,  # noqa: E712
        model_class.id == uuid.UUID(entity_id),
    )
    result = await db.execute(stmt)
    entity = result.scalar_one_or_none()
    if entity and hasattr(entity, field):
        setattr(entity, field, value)


async def _update_entity_status(
    db: AsyncSession,
    entity_type: str,
    entity_id: str,
    new_status: str | None,
):
    """Update a business entity's status field."""
    if not new_status or not entity_id:
        return
    canonical = resolve_entity_type(entity_type)
    config = ENTITY_STATUS_MAP.get(canonical) or ENTITY_STATUS_MAP.get(entity_type)
    if not config:
        return

    module_path, class_name = config["model"].rsplit(".", 1)
    import importlib

    module = importlib.import_module(module_path)
    model_class = getattr(module, class_name)
    status_field = config["status_field"]

    stmt = select(model_class).where(model_class.is_deleted == False, model_class.id == uuid.UUID(entity_id))  # noqa: E712
    result = await db.execute(stmt)
    entity = result.scalar_one_or_none()
    if entity:
        setattr(entity, status_field, new_status)


# ─── Status queries ──────────────────────────────────────────────────

async def get_entity_workflow_status(
    db: AsyncSession,
    entity_type: str,
    entity_id: str,
) -> dict | None:
    """Get the current workflow status for a business entity."""
    try:
        parsed_entity_id = uuid.UUID(entity_id)
    except (ValueError, AttributeError):
        return None
    canonical = resolve_entity_type(entity_type)
    type_aliases = _entity_type_aliases(canonical)
    stmt = (
        select(WorkflowInstance).where(WorkflowInstance.is_deleted == False)  # noqa: E712
        .where(
            and_(
                WorkflowInstance.entity_type.in_(type_aliases),
                WorkflowInstance.entity_id == parsed_entity_id,
                WorkflowInstance.status.in_(["running", "suspended"]),
            )
        )
        .order_by(WorkflowInstance.created_at.desc())
        .limit(1)
    )
    result = await db.execute(stmt)
    instance = result.scalar_one_or_none()
    if not instance:
        return None

    task_stmt = (
        select(WorkflowTask).where(WorkflowTask.is_deleted == False)  # noqa: E712
        .where(
            and_(
                WorkflowTask.instance_id == instance.id,
                WorkflowTask.status.in_(["pending", "claimed"]),
            )
        )
    )
    task_result = await db.execute(task_stmt)
    pending_tasks = task_result.scalars().all()

    return {
        "instance_id": str(instance.id),
        "instance_number": instance.instance_number,
        "status": instance.status,
        "current_node_ids": instance.current_node_ids,
        "started_at": instance.started_at.isoformat() if instance.started_at else None,
        "pending_tasks": [
            {
                "id": str(t.id),
                "name": t.name,
                "status": t.status,
                "assignee_id": str(t.assignee_id) if t.assignee_id else None,
            }
            for t in pending_tasks
        ],
    }


async def get_entity_latest_workflow_instance(
    db: AsyncSession,
    entity_type: str,
    entity_id: str,
) -> dict | None:
    """Get the most recent workflow instance for an entity (any terminal status included)."""
    try:
        parsed_entity_id = uuid.UUID(entity_id)
    except (ValueError, AttributeError):
        return None

    canonical = resolve_entity_type(entity_type)
    type_aliases = _entity_type_aliases(canonical)
    stmt = (
        select(WorkflowInstance).where(WorkflowInstance.is_deleted == False)  # noqa: E712
        .where(
            WorkflowInstance.entity_type.in_(type_aliases),
            WorkflowInstance.entity_id == parsed_entity_id,
        )
        .order_by(WorkflowInstance.created_at.desc())
        .limit(1)
    )
    result = await db.execute(stmt)
    instance = result.scalar_one_or_none()
    if not instance:
        return None

    return {
        "instance_id": str(instance.id),
        "instance_number": instance.instance_number,
        "status": instance.status,
        "started_at": instance.started_at.isoformat() if instance.started_at else None,
        "completed_at": instance.completed_at.isoformat() if instance.completed_at else None,
        "variables": instance.variables if isinstance(instance.variables, dict) else {},
    }

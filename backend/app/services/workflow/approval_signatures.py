"""Workflow electronic signatures stored as JSONB ``approval_signatures``.

Any business entity with an ``approval_signatures`` column is recorded
automatically: prepared on workflow start, every human task on complete
(including countersign siblings). Unknown nodes are kept as role=other.
"""
from __future__ import annotations

import logging
import uuid
from copy import deepcopy
from datetime import datetime
from typing import Any
from zoneinfo import ZoneInfo

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.attributes import flag_modified

from app.models.user import User
from app.models.workflow import WorkflowInstance, WorkflowNode, WorkflowTask

logger = logging.getLogger(__name__)

APPROVAL_SIGNATURES_FIELD = "approval_signatures"
SCHEMA_VERSION = 1
BUSINESS_TZ = ZoneInfo("Asia/Shanghai")

SKIP_NODE_TYPES = frozenset(
    {
        "start",
        "end",
        "exclusive_gateway",
        "parallel_gateway",
        "inclusive_gateway",
        "service_task",
    }
)

REVIEW_NODE_KEYS = frozenset(
    {
        "qa_engineer_approval",
        "process_review",
        "tech_review",
        "design_review",
    }
)
APPROVAL_NODE_KEYS = frozenset(
    {
        "fmea_expert_approval",
        "quality_approval",
        "mgr_approve",
    }
)


def empty_document(instance_id: str | None = None) -> dict[str, Any]:
    return {"version": SCHEMA_VERSION, "instance_id": instance_id, "steps": []}


def infer_role(
    node_key: str | None,
    node_name: str | None,
    *,
    multi_instance: bool = False,
) -> str:
    key = (node_key or "").strip().lower()
    name = node_name or ""
    if key in {"prepared", "start"} or "编制" in name:
        return "prepared"
    if key in REVIEW_NODE_KEYS or "审核" in name:
        return "reviewed"
    if key in APPROVAL_NODE_KEYS or "批准" in name or "签批" in name:
        return "approved"
    if multi_instance or "会签" in name or "countersign" in key:
        return "countersign"
    if "review" in key:
        return "reviewed"
    if "approv" in key:
        return "approved"
    return "other"


def _iso(dt: datetime | None) -> str | None:
    if dt is None:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=BUSINESS_TZ)
    return dt.astimezone(BUSINESS_TZ).isoformat()


def _parse_dt(value: Any) -> datetime | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value
    text = str(value).strip()
    if not text:
        return None
    try:
        return datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError:
        return None


def upsert_step(doc: dict[str, Any] | None, step: dict[str, Any], instance_id: str | None) -> dict[str, Any]:
    payload = deepcopy(doc) if isinstance(doc, dict) else empty_document(instance_id)
    if instance_id and payload.get("instance_id") and payload.get("instance_id") != instance_id:
        payload = empty_document(instance_id)
    payload["version"] = SCHEMA_VERSION
    if instance_id:
        payload["instance_id"] = instance_id

    steps: list[dict[str, Any]] = list(payload.get("steps") or [])
    task_id = step.get("task_id")
    replaced = False
    if task_id:
        for i, existing in enumerate(steps):
            if existing.get("task_id") == task_id:
                steps[i] = {**existing, **step}
                replaced = True
                break
    else:
        node_key = step.get("node_key")
        for i, existing in enumerate(steps):
            if existing.get("node_key") == node_key and not existing.get("task_id"):
                steps[i] = {**existing, **step}
                replaced = True
                break
    if not replaced:
        steps.append(step)
    payload["steps"] = steps
    return payload


def _uuid_or_none(value: Any) -> uuid.UUID | None:
    if value is None:
        return None
    if isinstance(value, uuid.UUID):
        return value
    try:
        return uuid.UUID(str(value))
    except (ValueError, TypeError, AttributeError):
        return None


def apply_legacy_columns(entity: Any, step: dict[str, Any]) -> None:
    """Mirror known roles onto prepared/reviewed/approved columns when present."""
    role = step.get("role")
    uid = _uuid_or_none(step.get("user_id"))
    name = step.get("name")
    at = _parse_dt(step.get("at"))
    if role == "prepared":
        if uid and hasattr(entity, "prepared_by"):
            entity.prepared_by = uid
        if name and hasattr(entity, "prepared_by_name"):
            entity.prepared_by_name = name
    elif role == "reviewed":
        if uid and hasattr(entity, "reviewed_by"):
            entity.reviewed_by = uid
        if name and hasattr(entity, "reviewed_by_name"):
            entity.reviewed_by_name = name
        if at and hasattr(entity, "reviewed_at"):
            entity.reviewed_at = at
    elif role == "approved":
        if uid and hasattr(entity, "approved_by"):
            entity.approved_by = uid
        if name and hasattr(entity, "approved_by_name"):
            entity.approved_by_name = name
        if at and hasattr(entity, "approved_at"):
            entity.approved_at = at


def _slot_from_step(step: dict[str, Any]) -> dict[str, Any] | None:
    name = step.get("name")
    at = _parse_dt(step.get("at"))
    user_id = step.get("user_id")
    signature_url = step.get("signature_url")
    if not name and not at and not user_id:
        return None
    payload: dict[str, Any] = {"name": name, "at": at}
    if user_id:
        payload["user_id"] = str(user_id)
    if signature_url:
        payload["signature_url"] = signature_url
    return payload


def legacy_slots_from_steps(steps: list[dict[str, Any]]) -> dict[str, Any]:
    prepared = reviewed = approved = None
    for step in steps:
        slot = _slot_from_step(step)
        if not slot:
            continue
        role = step.get("role")
        if role == "prepared":
            prepared = slot
        elif role == "reviewed":
            reviewed = slot
        elif role == "approved":
            approved = slot
    return {"prepared": prepared, "reviewed": reviewed, "approved": approved}


async def _load_entity(db: AsyncSession, entity_type: str, entity_id: uuid.UUID) -> Any | None:
    from app.services.workflow.workflow_integration import get_entity_config

    config = get_entity_config(entity_type) or {}
    model_path = config.get("model")
    if not model_path:
        return None
    module_path, class_name = str(model_path).rsplit(".", 1)
    import importlib

    module = importlib.import_module(module_path)
    model_class = getattr(module, class_name)
    result = await db.execute(
        select(model_class).where(
            model_class.is_deleted == False,  # noqa: E712
            model_class.id == entity_id,
        )
    )
    return result.scalar_one_or_none()


async def _user_name(db: AsyncSession, user_id: uuid.UUID | None) -> str | None:
    if not user_id:
        return None
    from app.models.user import User

    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    return user.name if user else None


async def _signature_url(db: AsyncSession, user_id: uuid.UUID | None) -> str | None:
    """签名图存于 users.signature_image（uploads/signatures/），经 /files 端点回读。"""
    if not user_id:
        return None
    result = await db.execute(select(User.signature_image).where(User.id == user_id))
    stored = result.scalar_one_or_none()
    if not stored:
        return None
    return f"/api/v1/files/{stored}"


def _is_multi_instance(node: WorkflowNode | None) -> bool:
    if node is None or not node.assignee_config:
        return False
    cfg = node.assignee_config
    if bool(cfg.get("multi_instance") or cfg.get("multiInstance")):
        return True
    handlers = cfg.get("handlers")
    if isinstance(handlers, list) and len(handlers) > 1:
        return True
    return False


async def _persist_document(entity: Any, doc: dict[str, Any], step: dict[str, Any]) -> None:
    setattr(entity, APPROVAL_SIGNATURES_FIELD, doc)
    flag_modified(entity, APPROVAL_SIGNATURES_FIELD)
    apply_legacy_columns(entity, step)


async def record_prepared_signature(
    db: AsyncSession,
    *,
    instance: WorkflowInstance,
    initiator_id: uuid.UUID,
) -> None:
    """Append a synthetic prepared step when a workflow starts."""
    if not instance.entity_type or not instance.entity_id:
        return
    try:
        entity = await _load_entity(db, instance.entity_type, instance.entity_id)
        if entity is None or not hasattr(entity, APPROVAL_SIGNATURES_FIELD):
            return
        name = await _user_name(db, initiator_id)
        if not name and hasattr(entity, "prepared_by_name"):
            name = getattr(entity, "prepared_by_name", None)
        if not name and hasattr(entity, "created_by"):
            name = getattr(entity, "created_by", None)
        at = datetime.now(BUSINESS_TZ)
        step = {
            "task_id": None,
            "node_id": None,
            "node_key": "prepared",
            "node_name": "编制",
            "node_type": "start",
            "role": "prepared",
            "user_id": str(initiator_id) if initiator_id else None,
            "name": name,
            "at": _iso(at),
            "signature_url": await _signature_url(db, initiator_id),
            "comment": None,
            "result": "submitted",
            "multi_instance": False,
        }
        doc = upsert_step(
            getattr(entity, APPROVAL_SIGNATURES_FIELD, None),
            step,
            str(instance.id),
        )
        await _persist_document(entity, doc, step)
    except Exception:
        logger.exception(
            "Failed to record prepared signature: entity_type=%s entity_id=%s",
            instance.entity_type,
            instance.entity_id,
        )


async def record_task_signature(
    db: AsyncSession,
    *,
    instance: WorkflowInstance,
    task: WorkflowTask,
    node: WorkflowNode | None,
    result: str,
    actor_id: uuid.UUID,
    comment: str | None = None,
) -> None:
    """Append one step for a completed human task (including countersign)."""
    if not instance.entity_type or not instance.entity_id:
        return
    node_type = (node.node_type if node else "") or ""
    if node_type in SKIP_NODE_TYPES:
        return
    try:
        entity = await _load_entity(db, instance.entity_type, instance.entity_id)
        if entity is None or not hasattr(entity, APPROVAL_SIGNATURES_FIELD):
            return

        user_id = actor_id or task.assignee_id
        name = await _user_name(db, user_id)
        if not name:
            assignee = getattr(task, "assignee", None)
            name = getattr(assignee, "name", None) if assignee else None
        node_key = node.node_key if node else (task.name or "unknown")
        node_name = node.name if node else (task.name or node_key)
        multi = _is_multi_instance(node)
        at = task.completed_at or datetime.now(BUSINESS_TZ)
        step = {
            "task_id": str(task.id),
            "node_id": str(node.id) if node else None,
            "node_key": node_key,
            "node_name": node_name,
            "node_type": node_type or None,
            "role": infer_role(node_key, node_name, multi_instance=multi),
            "user_id": str(user_id) if user_id else None,
            "name": name,
            "at": _iso(at),
            "signature_url": await _signature_url(db, user_id),
            "comment": comment,
            "result": result,
            "multi_instance": multi,
        }
        doc = upsert_step(
            getattr(entity, APPROVAL_SIGNATURES_FIELD, None),
            step,
            str(instance.id),
        )
        await _persist_document(entity, doc, step)
    except Exception:
        logger.exception(
            "Failed to record task signature: entity_type=%s entity_id=%s task=%s",
            instance.entity_type,
            instance.entity_id,
            getattr(task, "id", None),
        )


async def _refresh_step_signature(db: AsyncSession, step: dict[str, Any]) -> dict[str, Any]:
    if step.get("signature_url"):
        return step
    uid = _uuid_or_none(step.get("user_id"))
    url = await _signature_url(db, uid)
    if url:
        return {**step, "signature_url": url}
    return step


async def reconstruct_steps_from_tasks(
    db: AsyncSession,
    instance: WorkflowInstance,
) -> list[dict[str, Any]]:
    stmt = (
        select(WorkflowTask)
        .where(
            WorkflowTask.instance_id == instance.id,
            WorkflowTask.is_deleted == False,  # noqa: E712
            WorkflowTask.status == "completed",
        )
        .order_by(WorkflowTask.completed_at.asc().nullslast(), WorkflowTask.updated_at.asc())
    )
    result = await db.execute(stmt)
    steps: list[dict[str, Any]] = []
    for task in result.scalars().all():
        node = getattr(task, "node", None)
        node_type = (node.node_type if node else "") or ""
        if node_type in SKIP_NODE_TYPES:
            continue
        user_id = task.assignee_id
        assignee = getattr(task, "assignee", None)
        name = getattr(assignee, "name", None) if assignee else None
        if not name:
            name = await _user_name(db, user_id)
        node_key = node.node_key if node else (task.name or "unknown")
        node_name = node.name if node else (task.name or node_key)
        multi = _is_multi_instance(node)
        steps.append(
            {
                "task_id": str(task.id),
                "node_id": str(node.id) if node else None,
                "node_key": node_key,
                "node_name": node_name,
                "node_type": node_type or None,
                "role": infer_role(node_key, node_name, multi_instance=multi),
                "user_id": str(user_id) if user_id else None,
                "name": name,
                "at": _iso(task.completed_at),
                "signature_url": await _signature_url(db, user_id),
                "comment": task.comment,
                "result": task.result,
                "multi_instance": multi,
            }
        )
    return steps


def _prepared_fallback_step(
    *,
    name: str | None,
    at: datetime | None,
    user_id: uuid.UUID | None,
    signature_url: str | None,
) -> dict[str, Any] | None:
    if not name and not at and not user_id:
        return None
    return {
        "task_id": None,
        "node_id": None,
        "node_key": "prepared",
        "node_name": "编制",
        "node_type": "start",
        "role": "prepared",
        "user_id": str(user_id) if user_id else None,
        "name": name,
        "at": _iso(at),
        "signature_url": signature_url,
        "comment": None,
        "result": "submitted",
        "multi_instance": False,
    }


async def build_approval_trail(
    db: AsyncSession,
    *,
    entity: Any,
    entity_type: str,
    entity_id: uuid.UUID,
    prepared_name: str | None = None,
    prepared_at: datetime | None = None,
    prepared_user_id: uuid.UUID | None = None,
) -> dict[str, Any]:
    """Build trail: JSON steps first, then workflow tasks + rigid columns."""
    from app.services.workflow.workflow_integration import resolve_entity_type

    canonical = resolve_entity_type(entity_type)
    instance: WorkflowInstance | None = None
    stmt = (
        select(WorkflowInstance)
        .where(
            WorkflowInstance.is_deleted == False,  # noqa: E712
            WorkflowInstance.entity_type == canonical,
            WorkflowInstance.entity_id == entity_id,
        )
        .order_by(WorkflowInstance.created_at.desc())
        .limit(1)
    )
    inst_result = await db.execute(stmt)
    instance = inst_result.scalar_one_or_none()

    doc = getattr(entity, APPROVAL_SIGNATURES_FIELD, None) if hasattr(entity, APPROVAL_SIGNATURES_FIELD) else None
    steps: list[dict[str, Any]] = []
    if isinstance(doc, dict) and doc.get("steps"):
        steps = [await _refresh_step_signature(db, dict(s)) for s in doc["steps"]]
    elif instance:
        steps = await reconstruct_steps_from_tasks(db, instance)

    has_prepared = any(s.get("role") == "prepared" or s.get("node_key") == "prepared" for s in steps)
    if not has_prepared:
        sig_url = await _signature_url(db, prepared_user_id)
        prepared_step = _prepared_fallback_step(
            name=prepared_name,
            at=prepared_at,
            user_id=prepared_user_id,
            signature_url=sig_url,
        )
        if prepared_step:
            steps = [prepared_step, *steps]

    slots = legacy_slots_from_steps(steps)
    if not slots["prepared"] and (prepared_name or prepared_user_id):
        slots["prepared"] = {
            "name": prepared_name,
            "at": prepared_at,
            "user_id": str(prepared_user_id) if prepared_user_id else None,
            "signature_url": await _signature_url(db, prepared_user_id),
        }
        slots["prepared"] = {k: v for k, v in slots["prepared"].items() if v is not None} or None

    return {
        "steps": steps,
        "prepared": slots["prepared"],
        "reviewed": slots["reviewed"],
        "approved": slots["approved"],
        "workflow_instance_id": str(instance.id) if instance else (
            str(doc.get("instance_id")) if isinstance(doc, dict) and doc.get("instance_id") else None
        ),
    }

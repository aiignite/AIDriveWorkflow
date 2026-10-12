"""Workflows router – thin HTTP layer delegating to WorkflowService & WorkflowEngine."""
from __future__ import annotations

import json
import uuid as uuid_mod
from uuid import UUID

from fastapi import APIRouter, Depends, Query, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.user import User
from app.schemas.workflow import (
    TaskCompleteRequest,
    TaskDelegateRequest,
    WorkflowDefinitionCreate,
    WorkflowDefinitionDetailOut,
    WorkflowDefinitionOut,
    WorkflowDefinitionUpdate,
    WorkflowDesignSave,
    WorkflowInstanceCreate,
    WorkflowInstanceDetailOut,
    WorkflowInstanceLogOut,
    WorkflowInstanceOut,
    WorkflowTaskOut,
    WorkflowTaskSummary,
)
from app.services.workflow.workflow_service import WorkflowEngine, WorkflowService
from app.auth import get_current_user
from app.exceptions import (
    BadRequestException,
    NotFoundException,
)

router = APIRouter(prefix="/workflows", tags=["Workflows"])
instance_router = APIRouter(prefix="/workflow-instances", tags=["Workflow Instances"])
task_router = APIRouter(prefix="/workflow-tasks", tags=["Workflow Tasks"])


# ═══════════════════════════════════════════
#  Workflow Definitions
# ═══════════════════════════════════════════

@router.get("", response_model=list[WorkflowDefinitionOut])
async def list_definitions(
    category: str | None = None,
    status_filter: str | None = Query(None, alias="status"),
    skip: int = 0,
    limit: int = 50,
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(get_current_user),
):
    return await WorkflowService.list_definitions(
        db, category=category, status_filter=status_filter, skip=skip, limit=limit,
    )


@router.get("/templates", response_model=list[WorkflowDefinitionOut])
async def list_templates(
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(get_current_user),
):
    return await WorkflowService.list_templates(db)


@router.get("/entity-types")
async def list_entity_types(
    _user: User = Depends(get_current_user),
):
    """Return all available entity types for workflow association.

    Each item contains:
    - key: database table name (canonical entity_type value)
    - display_name: Chinese display name
    - module: module group name
    """
    from app.services.workflow.workflow_integration import list_entity_types
    return list_entity_types()


@router.post("", response_model=WorkflowDefinitionOut, status_code=status.HTTP_201_CREATED)
async def create_definition(
    body: WorkflowDefinitionCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return await WorkflowService.create_definition(db, body.model_dump(), current_user.id)


@router.get("/{definition_id}", response_model=WorkflowDefinitionDetailOut)
async def get_definition(
    definition_id: UUID,
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(get_current_user),
):
    defn = await WorkflowService.get_definition(db, definition_id)
    if not defn:
        raise NotFoundException("Workflow definition")
    return defn


@router.patch("/{definition_id}", response_model=WorkflowDefinitionOut)
async def update_definition(
    definition_id: UUID,
    body: WorkflowDefinitionUpdate,
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(get_current_user),
):
    defn = await WorkflowService.update_definition(db, definition_id, body.model_dump(exclude_unset=True))
    if not defn:
        raise NotFoundException("Workflow definition")
    return defn


@router.delete("/{definition_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_definition(
    definition_id: UUID,
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(get_current_user),
):
    if not await WorkflowService.delete_definition(db, definition_id):
        raise NotFoundException("Workflow definition")


@router.put("/{definition_id}/design", response_model=WorkflowDefinitionDetailOut)
async def save_design(
    definition_id: UUID,
    body: WorkflowDesignSave,
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(get_current_user),
):
    try:
        defn = await WorkflowService.save_design(db, definition_id, body.nodes, body.edges)
    except ValueError as e:
        raise BadRequestException(str(e)) from e
    if not defn:
        raise NotFoundException("Workflow definition")
    return defn


@router.post("/{definition_id}/publish", response_model=WorkflowDefinitionOut)
async def publish_definition(
    definition_id: UUID,
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(get_current_user),
):
    try:
        defn = await WorkflowService.publish_definition(db, definition_id)
    except ValueError as e:
        raise BadRequestException(str(e)) from e
    if not defn:
        raise NotFoundException("Workflow definition")
    return defn


@router.post("/{definition_id}/archive", response_model=WorkflowDefinitionOut)
async def archive_definition(
    definition_id: UUID,
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(get_current_user),
):
    defn = await WorkflowService.archive_definition(db, definition_id)
    if not defn:
        raise NotFoundException("Workflow definition")
    return defn


@router.post("/{definition_id}/clone", response_model=WorkflowDefinitionOut, status_code=status.HTTP_201_CREATED)
async def clone_definition(
    definition_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    defn = await WorkflowService.clone_definition(db, definition_id, current_user.id)
    if not defn:
        raise NotFoundException("Workflow definition")
    return defn


# ═══════════════════════════════════════════
#  Workflow Instances
# ═══════════════════════════════════════════

@instance_router.get("", response_model=list[WorkflowInstanceOut])
async def list_instances(
    status_filter: str | None = Query(None, alias="status"),
    definition_id: str | None = None,
    skip: int = 0,
    limit: int = 50,
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(get_current_user),
):
    return await WorkflowService.list_instances(
        db, status_filter=status_filter, definition_id=definition_id, skip=skip, limit=limit,
    )


@instance_router.post("", response_model=WorkflowInstanceOut, status_code=status.HTTP_201_CREATED)
async def start_instance(
    body: WorkflowInstanceCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    engine = WorkflowEngine(db)
    try:
        entity_type = body.entity_type
        instance = await engine.start_instance(
            definition_id=body.definition_id,
            title=body.title,
            initiated_by_id=current_user.id,
            entity_type=body.entity_type,
            entity_id=body.entity_id,
            variables=body.variables,
            priority=body.priority,
        )
        await db.commit()
        return await WorkflowService.get_instance(db, instance.id)
    except ValueError as e:
        raise BadRequestException(str(e)) from e


@instance_router.get("/{instance_id}", response_model=WorkflowInstanceDetailOut)
async def get_instance(
    instance_id: UUID,
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(get_current_user),
):
    instance = await WorkflowService.get_instance(db, instance_id)
    if not instance:
        raise NotFoundException("Workflow instance")
    return instance


@instance_router.post("/{instance_id}/suspend", response_model=WorkflowInstanceOut)
async def suspend_instance(
    instance_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    instance = await WorkflowService.get_instance_simple(db, instance_id)
    if not instance:
        raise NotFoundException("Workflow instance")
    if instance.status != "running":
        raise BadRequestException("Only running instances can be suspended")
    engine = WorkflowEngine(db)
    await engine.suspend_instance(instance, current_user.id)
    await db.commit()
    return await WorkflowService.get_instance_simple(db, instance_id)


@instance_router.post("/{instance_id}/resume", response_model=WorkflowInstanceOut)
async def resume_instance(
    instance_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    instance = await WorkflowService.get_instance_simple(db, instance_id)
    if not instance:
        raise NotFoundException("Workflow instance")
    if instance.status != "suspended":
        raise BadRequestException("Only suspended instances can be resumed")
    engine = WorkflowEngine(db)
    await engine.resume_instance(instance, current_user.id)
    await db.commit()
    return await WorkflowService.get_instance_simple(db, instance_id)


@instance_router.post("/{instance_id}/terminate", response_model=WorkflowInstanceOut)
async def terminate_instance(
    instance_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    instance = await WorkflowService.get_instance_simple(db, instance_id)
    if not instance:
        raise NotFoundException("Workflow instance")
    if instance.status not in ("running", "suspended"):
        raise BadRequestException("Instance cannot be terminated")
    engine = WorkflowEngine(db)
    await engine.terminate_instance(instance, current_user.id)
    await db.commit()
    return await WorkflowService.get_instance_simple(db, instance_id)


@instance_router.get("/{instance_id}/logs", response_model=list[WorkflowInstanceLogOut])
async def get_instance_logs(
    instance_id: UUID,
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(get_current_user),
):
    return await WorkflowService.get_instance_logs(db, instance_id)


# ═══════════════════════════════════════════
#  Workflow Tasks
# ═══════════════════════════════════════════

@task_router.get("", response_model=list[WorkflowTaskOut])
async def list_tasks(
    status_filter: str | None = Query(None, alias="status"),
    assignee_id: str | None = None,
    skip: int = 0,
    limit: int = 50,
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(get_current_user),
):
    return await WorkflowService.list_tasks(
        db, status_filter=status_filter, assignee_id=assignee_id, skip=skip, limit=limit,
    )


@task_router.get("/my", response_model=list[WorkflowTaskOut])
async def my_tasks(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return await WorkflowService.my_tasks(db, current_user.id)


@task_router.get("/summary", response_model=WorkflowTaskSummary)
async def task_summary(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    data = await WorkflowService.task_summary(db, current_user.id)
    return WorkflowTaskSummary(**data)


@task_router.get("/{task_id}", response_model=WorkflowTaskOut)
async def get_task(
    task_id: UUID,
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(get_current_user),
):
    task = await WorkflowService.get_task(db, task_id)
    if not task:
        raise NotFoundException("Workflow task")
    return task


@task_router.post("/{task_id}/claim", response_model=WorkflowTaskOut)
async def claim_task(
    task_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    task = await WorkflowService.get_task(db, task_id)
    if not task:
        raise NotFoundException("Workflow task")
    if task.status != "pending":
        raise BadRequestException("Only pending tasks can be claimed")
    return await WorkflowService.claim_task(db, task, current_user.id)


@task_router.post("/{task_id}/complete", response_model=WorkflowTaskOut)
async def complete_task(
    task_id: UUID,
    body: TaskCompleteRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    task = await WorkflowService.get_task_with_instance(db, task_id)
    if not task:
        raise NotFoundException("Workflow task")
    if task.status not in ("pending", "claimed"):
        raise BadRequestException("Task cannot be completed")
    engine = WorkflowEngine(db)
    await engine.complete_task(
        task=task, result=body.result, actor_id=current_user.id,
        comment=body.comment, form_data=body.form_data,
        button_key=body.button_key, target_node_key=body.target_node_key,
    )
    await db.commit()
    return await WorkflowService.get_task(db, task_id)


@task_router.post("/{task_id}/reject", response_model=WorkflowTaskOut)
async def reject_task(
    task_id: UUID,
    body: TaskCompleteRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    task = await WorkflowService.get_task_with_instance(db, task_id)
    if not task:
        raise NotFoundException("Workflow task")
    if task.status not in ("pending", "claimed"):
        raise BadRequestException("Task cannot be rejected")
    engine = WorkflowEngine(db)
    await engine.complete_task(
        task=task, result="rejected", actor_id=current_user.id,
        comment=body.comment, form_data=body.form_data,
        button_key=body.button_key, target_node_key=body.target_node_key,
    )
    await db.commit()
    return await WorkflowService.get_task(db, task_id)


@task_router.post("/{task_id}/delegate", response_model=WorkflowTaskOut)
async def delegate_task(
    task_id: UUID,
    body: TaskDelegateRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    task = await WorkflowService.get_task(db, task_id)
    if not task:
        raise NotFoundException("Workflow task")
    if task.status not in ("pending", "claimed"):
        raise BadRequestException("Task cannot be delegated")
    engine = WorkflowEngine(db)
    await engine.delegate_task(
        task=task, target_user_id=body.target_user_id,
        actor_id=current_user.id, comment=body.comment,
    )
    await db.commit()
    return await WorkflowService.get_task(db, task_id)


# ═══════════════════════════════════════════
#  Workflow Integration (entity ↔ workflow)
# ═══════════════════════════════════════════

integration_router = APIRouter(prefix="/workflow-integration", tags=["Workflow Integration"])


@integration_router.post("/start")
async def start_entity_workflow_endpoint(
    entity_type: str = Query(..., description="Entity type, e.g. change_request, process_design"),
    entity_id: str = Query(..., description="UUID of the entity"),
    title: str = Query(..., description="Workflow instance title"),
    category: str | None = Query(None, description="Workflow category fallback"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    from app.services.workflow.workflow_integration import start_entity_workflow
    instance = await start_entity_workflow(
        db=db, entity_type=entity_type, entity_id=entity_id,
        title=title, initiator_id=current_user.id, category=category,
    )
    await db.commit()
    if not instance:
        raise NotFoundException(f"No published workflow found for entity type '{entity_type}'",)
    return {
        "instance_id": str(instance.id),
        "instance_number": instance.instance_number,
        "status": instance.status,
        "message": "Workflow started successfully",
    }


@integration_router.get("/status")
async def get_entity_workflow_status_endpoint(
    entity_type: str = Query(...),
    entity_id: str = Query(...),
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(get_current_user),
):
    from app.services.workflow.workflow_integration import get_entity_workflow_status
    result = await get_entity_workflow_status(db, entity_type, entity_id)
    if not result:
        return {"has_workflow": False}
    return {"has_workflow": True, **result}


@integration_router.get("/latest-instance")
async def get_entity_latest_workflow_instance_endpoint(
    entity_type: str = Query(...),
    entity_id: str = Query(...),
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(get_current_user),
):
    """Latest workflow instance for an entity (includes terminated/completed history)."""
    from app.services.workflow.workflow_integration import get_entity_latest_workflow_instance
    result = await get_entity_latest_workflow_instance(db, entity_type, entity_id)
    if not result:
        return {"has_workflow": False}
    return {"has_workflow": True, **result}


@integration_router.get("/check")
async def check_workflow_configured_endpoint(
    entity_type: str = Query(...),
    category: str | None = Query(None),
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(get_current_user),
):
    from app.services.workflow.workflow_integration import check_workflow_configured
    configured = await check_workflow_configured(db, entity_type, category)
    return {"configured": configured, "entity_type": entity_type}


class BatchCheckBody(BaseModel):
    entity_types: list[str]
    category: str | None = None


class BatchStatusItem(BaseModel):
    entity_type: str
    entity_id: str


class BatchStatusBody(BaseModel):
    items: list[BatchStatusItem]


@integration_router.post("/batch-check")
async def batch_check_workflow_configured(
    body: BatchCheckBody,
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(get_current_user),
):
    from app.services.workflow.workflow_integration import check_workflow_configured

    results: dict[str, bool] = {}
    for entity_type in body.entity_types:
        results[entity_type] = await check_workflow_configured(db, entity_type, body.category)
    return {"results": {k: {"configured": v} for k, v in results.items()}}


@integration_router.post("/batch-status")
async def batch_get_entity_workflow_status(
    body: BatchStatusBody,
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(get_current_user),
):
    from app.services.workflow.workflow_integration import get_entity_workflow_status

    results: list[dict] = []
    for item in body.items:
        status = await get_entity_workflow_status(db, item.entity_type, item.entity_id)
        if status:
            results.append({
                "entity_type": item.entity_type,
                "entity_id": item.entity_id,
                "has_workflow": True,
                **status,
            })
        else:
            results.append({
                "entity_type": item.entity_type,
                "entity_id": item.entity_id,
                "has_workflow": False,
            })
    return {"results": results}


@integration_router.get("/entity-detail")
async def get_entity_detail_endpoint(
    entity_type: str = Query(..., description="Entity type key"),
    entity_id: str = Query(..., description="UUID of the entity"),
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(get_current_user),
):
    """Fetch entity details for display in the approval interface.

    The standalone app has no business tables — the card is rendered from the
    latest workflow instance's variables for this entity. If a future
    integration registers the entity type in ENTITY_TYPE_REGISTRY, the
    registered model is read instead.
    """
    import importlib

    from app.services.workflow.workflow_integration import (
        GENERIC_ENTITY_FIELDS,
        get_entity_config,
        resolve_detail_route_async,
        resolve_entity_type,
    )

    canonical = resolve_entity_type(entity_type)
    config = get_entity_config(canonical)
    detail: dict = {}

    entity_uuid = UUID(entity_id)

    if config and config.get("model"):
        model_path = config["model"]
        module_path, class_name = model_path.rsplit(".", 1)
        module = importlib.import_module(module_path)
        model_cls = getattr(module, class_name)
        from sqlalchemy import inspect as sa_inspect
        mapper = sa_inspect(model_cls)
        query = select(model_cls).where(model_cls.id == entity_uuid)
        if "is_deleted" in mapper.columns:
            query = query.where(model_cls.is_deleted == False)  # noqa: E712
        result = await db.execute(query)
        entity = result.scalar_one_or_none()
        if not entity:
            raise NotFoundException("Entity")

        skip_fields = {"id", "created_by", "updated_by", "is_deleted"}
        for col in mapper.columns:
            key = col.key
            if key in skip_fields or key.endswith("_id") or key.endswith("_uuid"):
                continue
            val = getattr(entity, key, None)
            if val is None:
                continue
            if isinstance(val, uuid_mod.UUID):
                val = str(val)
            elif hasattr(val, "isoformat"):
                val = val.isoformat()
            detail[key] = val
    else:
        # 通用详情：取该实体最近一次流程实例的变量
        from app.models.workflow import WorkflowInstance as WfInstance
        inst_result = await db.execute(
            select(WfInstance).where(
                WfInstance.is_deleted == False,  # noqa: E712
                WfInstance.entity_type == canonical,
                WfInstance.entity_id == entity_uuid,
            ).order_by(WfInstance.created_at.desc()).limit(1)
        )
        inst = inst_result.scalar_one_or_none()
        if inst:
            detail["title"] = inst.title
            detail["instance_number"] = inst.instance_number
            detail["status"] = inst.status
            detail["started_at"] = inst.started_at.isoformat() if inst.started_at else None
            detail["initiator"] = inst.initiated_by.name if inst.initiated_by else None
            variables = inst.variables or {}
            for k, v in variables.items():
                if k not in detail and v is not None:
                    detail[str(k)] = v if isinstance(v, (str, int, float, bool)) else json.dumps(v, ensure_ascii=False)

    # 应用流程定义的视图配置过滤
    from app.models.workflow import WorkflowDefinition as WfDef
    def_result = await db.execute(
        select(WfDef.entity_view_config).where(
            WfDef.entity_type == canonical,
            WfDef.status == "published",
            WfDef.entity_view_config.isnot(None),
        ).limit(1)
    )
    view_config = def_result.scalar_one_or_none()
    if view_config and isinstance(view_config, dict) and view_config.get("fields"):
        allowed = [f.get("key") for f in view_config["fields"] if isinstance(f, dict) and f.get("key")]
        detail = {k: v for k, v in detail.items() if k in allowed}

    return {
        "entity_type": canonical,
        "entity_id": entity_id,
        "display_name": (config or {}).get("display_name", canonical),
        "module": (config or {}).get("module", "通用"),
        "detail": {k: v for k, v in detail.items() if v is not None},
        "view_config": view_config,
        "detail_route": await resolve_detail_route_async(db, canonical, entity_id),
    }


@integration_router.get("/entity-fields")
async def list_entity_fields_endpoint(
    entity_type: str = Query(..., description="Entity type, e.g. mat_brands"),
    _db: AsyncSession = Depends(get_db),
    _user: User = Depends(get_current_user),
):
    """Return available columns for an entity type, to populate the
    view-config editor in the workflow designer.
    """
    import importlib

    from sqlalchemy import inspect as sa_inspect

    from app.services.workflow.workflow_integration import get_entity_config, resolve_entity_type

    canonical = resolve_entity_type(entity_type)
    config = get_entity_config(canonical)
    if not config:
        raise NotFoundException("Entity type", str(entity_type))

    model_path = config["model"]
    module_path, class_name = model_path.rsplit(".", 1)
    module = importlib.import_module(module_path)
    model_cls = getattr(module, class_name)
    mapper = sa_inspect(model_cls)

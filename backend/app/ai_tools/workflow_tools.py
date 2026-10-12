"""Workflow tools — 流程定义/实例/任务查询与审批操作 for AI assistants.

写操作（start_workflow_instance / complete_task）不直接执行：返回
requires_confirmation 预览 + confirm_action，由前端确认后调用普通 REST
端点落库（与 AIDriveNote 的 update_note 确认模式一致）。
"""
from __future__ import annotations

from typing import Any
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.ai_tools.registry import ToolRegistry
from app.models.workflow import WorkflowDefinition, WorkflowInstance, WorkflowTask
from app.services.workflow.workflow_service import WorkflowEngine, WorkflowService

CATEGORY = "workflow"


# ---------- helpers ----------

def _parse_uuid(raw: str, label: str = "id") -> UUID | dict:
    """Return UUID or error dict."""
    try:
        return UUID(raw)
    except (ValueError, TypeError):
        return {"success": False, "error": f"{label} 必须是有效的 UUID 格式，'{raw}' 无效"}


def _defn_summary(d: WorkflowDefinition) -> dict[str, Any]:
    return {
        "id": str(d.id),
        "key": d.key,
        "name": d.name,
        "description": d.description,
        "category": d.category,
        "version": d.version,
        "status": d.status,
        "entity_type": d.entity_type,
        "is_builtin": d.is_builtin,
        "node_count": len([n for n in (d.nodes or []) if not n.is_deleted]) if d.nodes else None,
    }


# ---------- query tools ----------

async def _list_workflow_definitions(
    db: AsyncSession, user_id: UUID, *,
    status: str | None = None,
    category: str | None = None,
    search: str | None = None,
    limit: int = 50,
) -> dict[str, Any]:
    result = await db.execute(
        select(WorkflowDefinition)
        .options(selectinload(WorkflowDefinition.nodes))
        .where(WorkflowDefinition.is_deleted == False)  # noqa: E712
        .order_by(WorkflowDefinition.updated_at.desc())
        .limit(500)
    )
    defs = result.scalars().all()
    if status:
        defs = [d for d in defs if d.status == status]
    if category:
        defs = [d for d in defs if d.category == category]
    if search:
        kw = search.lower()
        defs = [d for d in defs if kw in (d.name or "").lower() or kw in (d.key or "").lower()]
    items = [_defn_summary(d) for d in defs[:limit]]
    return {"success": True, "total": len(defs), "items": items}


async def _get_workflow_definition(
    db: AsyncSession, user_id: UUID, *,
    definition_id: str,
) -> dict[str, Any]:
    parsed = _parse_uuid(definition_id, "definition_id")
    if isinstance(parsed, dict):
        return parsed
    defn = await WorkflowService.get_definition(db, parsed)
    if not defn:
        return {"success": False, "error": f"未找到流程定义 (id={definition_id})"}
    nodes = [
        {
            "node_key": n.node_key, "name": n.name, "node_type": n.node_type,
            "assignee_config": n.assignee_config, "approval_config": n.approval_config,
        }
        for n in (defn.nodes or []) if not n.is_deleted
    ]
    out = _defn_summary(defn)
    out["nodes"] = nodes
    return {"success": True, **out}


async def _list_my_instances(
    db: AsyncSession, user_id: UUID, *,
    status: str | None = None,
    limit: int = 30,
) -> dict[str, Any]:
    result = await db.execute(
        select(WorkflowInstance)
        .options(selectinload(WorkflowInstance.definition))
        .where(
            WorkflowInstance.initiated_by_id == user_id,
            WorkflowInstance.is_deleted == False,  # noqa: E712
        )
        .order_by(WorkflowInstance.created_at.desc())
        .limit(200)
    )
    instances = result.scalars().all()
    if status:
        instances = [i for i in instances if i.status == status]
    return {
        "success": True,
        "total": len(instances),
        "items": [
            {
                "id": str(i.id),
                "instance_number": i.instance_number,
                "title": i.title,
                "status": i.status,
                "workflow": i.definition.name if i.definition else None,
                "priority": i.priority,
                "started_at": str(i.started_at) if i.started_at else None,
                "completed_at": str(i.completed_at) if i.completed_at else None,
            }
            for i in instances[:limit]
        ],
    }


async def _get_instance_status(
    db: AsyncSession, user_id: UUID, *,
    instance_id: str,
) -> dict[str, Any]:
    parsed = _parse_uuid(instance_id, "instance_id")
    if isinstance(parsed, dict):
        return parsed
    instance = await WorkflowService.get_instance(db, parsed)
    if not instance:
        return {"success": False, "error": f"未找到流程实例 (id={instance_id})"}
    tasks = [
        {
            "id": str(t.id), "task_number": t.task_number, "name": t.name,
            "status": t.status, "result": t.result,
            "assignee_id": str(t.assignee_id) if t.assignee_id else None,
            "completed_at": str(t.completed_at) if t.completed_at else None,
        }
        for t in (instance.tasks or [])
    ]
    logs = [
        {
            "event_type": l.event_type,
            "node_name": l.node_name,
            "comment": l.comment,
            "created_at": str(l.created_at) if l.created_at else None,
        }
        for l in (instance.logs or [])[-20:]
    ]
    return {
        "success": True,
        "id": str(instance.id),
        "instance_number": instance.instance_number,
        "title": instance.title,
        "status": instance.status,
        "workflow": instance.definition.name if instance.definition else None,
        "priority": instance.priority,
        "variables": instance.variables,
        "current_node_ids": instance.current_node_ids,
        "tasks": tasks,
        "recent_logs": logs,
    }


async def _list_my_tasks(
    db: AsyncSession, user_id: UUID, *,
    limit: int = 50,
) -> dict[str, Any]:
    tasks = await WorkflowService.my_tasks(db, user_id)
    return {
        "success": True,
        "total": len(tasks),
        "items": [
            {
                "id": str(t.id),
                "task_number": t.task_number,
                "name": t.name,
                "status": t.status,
                "instance_title": t.instance_title,
                "instance_id": str(t.instance_id),
                "definition_name": t.definition_name,
                "entity_type": t.entity_type,
                "created_at": str(t.created_at) if t.created_at else None,
            }
            for t in tasks[:limit]
        ],
    }


# ---------- write tools (preview + confirmation) ----------

async def _start_workflow_instance(
    db: AsyncSession, user_id: UUID, *,
    definition_id: str,
    title: str,
    variables: dict[str, Any] | None = None,
    priority: str = "Medium",
    confirmed: bool = False,
) -> dict[str, Any]:
    parsed = _parse_uuid(definition_id, "definition_id")
    if isinstance(parsed, dict):
        return parsed
    defn = await WorkflowService.get_definition(db, parsed)
    if not defn:
        return {"success": False, "error": f"未找到流程定义 (id={definition_id})"}
    if defn.status != "published":
        return {"success": False, "error": f"流程「{defn.name}」未发布，无法发起"}

    if not confirmed:
        return {
            "success": True,
            "preview": True,
            "requires_confirmation": True,
            "confirm_action": {
                "type": "start_instance",
                "definition_id": str(defn.id),
                "title": title,
                "variables": variables or {},
                "priority": priority,
            },
            "summary": {
                "workflow": defn.name,
                "title": title,
                "variables": variables or {},
                "priority": priority,
            },
            "message": "已生成交付预览，请用户在确认卡片中点击「确认发起」后才会真正发起流程",
        }

    engine = WorkflowEngine(db)
    instance = await engine.start_instance(
        definition_id=defn.id,
        title=title,
        initiated_by_id=user_id,
        variables=variables or {},
        priority=priority,
    )
    return {
        "success": True,
        "instance_id": str(instance.id),
        "instance_number": instance.instance_number,
        "status": instance.status,
        "message": f"流程已发起：{instance.instance_number}",
    }


async def _complete_workflow_task(
    db: AsyncSession, user_id: UUID, *,
    task_id: str,
    result: str = "approved",
    comment: str | None = None,
    form_data: dict[str, Any] | None = None,
    confirmed: bool = False,
) -> dict[str, Any]:
    parsed = _parse_uuid(task_id, "task_id")
    if isinstance(parsed, dict):
        return parsed
    stmt = (
        select(WorkflowTask)
        .options(selectinload(WorkflowTask.instance))
        .where(WorkflowTask.id == parsed, WorkflowTask.is_deleted == False)  # noqa: E712
    )
    res = await db.execute(stmt)
    task = res.scalar_one_or_none()
    if not task:
        return {"success": False, "error": f"未找到任务 (id={task_id})"}
    if task.assignee_id and task.assignee_id != user_id:
        return {"success": False, "error": "无权处理他人的审批任务"}
    if task.status not in ("pending", "claimed"):
        return {"success": False, "error": f"任务状态为 {task.status}，无法处理"}

    if not confirmed:
        return {
            "success": True,
            "preview": True,
            "requires_confirmation": True,
            "confirm_action": {
                "type": "complete_task",
                "task_id": str(task.id),
                "result": result,
                "comment": comment,
                "form_data": form_data or {},
            },
            "summary": {
                "task": task.name,
                "task_number": task.task_number,
                "instance_title": task.instance.title if task.instance else None,
                "result": result,
                "comment": comment,
            },
            "message": "已生成审批预览，请用户在确认卡片中点击「确认提交」后才会真正提交审批结果",
        }

    engine = WorkflowEngine(db)
    await engine.complete_task(
        task=task, result=result, actor_id=user_id,
        comment=comment, form_data=form_data,
    )
    return {
        "success": True,
        "task_id": str(task.id),
        "task_number": task.task_number,
        "message": f"任务 {task.task_number} 已提交（{result}）",
    }


# ---------- registration ----------

ToolRegistry.register("list_workflow_definitions", {
    "name": "list_workflow_definitions",
    "description": "查询流程定义（模板）列表，支持按状态/分类/关键词筛选。",
    "parameters": {"type": "object", "properties": {
        "status": {"type": "string", "enum": ["draft", "published", "archived"], "description": "状态筛选（可选）"},
        "category": {"type": "string", "description": "分类筛选（可选）"},
        "search": {"type": "string", "description": "按名称/编码搜索（可选）"},
        "limit": {"type": "integer", "description": "返回数量，默认 50"},
    }},
}, _list_workflow_definitions, CATEGORY, "查询流程定义")

ToolRegistry.register("get_workflow_definition", {
    "name": "get_workflow_definition",
    "description": "获取流程定义详情，包含节点列表（节点类型/处理人配置/审批配置）。",
    "parameters": {"type": "object", "properties": {
        "definition_id": {"type": "string", "description": "流程定义 UUID"},
    }, "required": ["definition_id"]},
}, _get_workflow_definition, CATEGORY, "查询流程定义详情")

ToolRegistry.register("list_my_instances", {
    "name": "list_my_instances",
    "description": "查询当前用户发起的流程实例列表，支持按状态筛选。",
    "parameters": {"type": "object", "properties": {
        "status": {"type": "string", "enum": ["running", "suspended", "completed", "terminated"], "description": "状态筛选（可选）"},
        "limit": {"type": "integer", "description": "返回数量，默认 30"},
    }},
}, _list_my_instances, CATEGORY, "查询我发起的流程")

ToolRegistry.register("get_instance_status", {
    "name": "get_instance_status",
    "description": "查询流程实例的详细状态：当前节点、任务列表、流程变量、最近日志。",
    "parameters": {"type": "object", "properties": {
        "instance_id": {"type": "string", "description": "流程实例 UUID"},
    }, "required": ["instance_id"]},
}, _get_instance_status, CATEGORY, "查询流程实例状态")

ToolRegistry.register("list_my_tasks", {
    "name": "list_my_tasks",
    "description": "查询分配给当前用户的待办审批任务列表。",
    "parameters": {"type": "object", "properties": {
        "limit": {"type": "integer", "description": "返回数量，默认 50"},
    }},
}, _list_my_tasks, CATEGORY, "查询我的待办任务")

ToolRegistry.register("start_workflow_instance", {
    "name": "start_workflow_instance",
    "description": "为用户发起一个流程实例。先生成预览等待用户确认，不会直接发起。",
    "parameters": {"type": "object", "properties": {
        "definition_id": {"type": "string", "description": "流程定义 UUID"},
        "title": {"type": "string", "description": "流程实例标题"},
        "variables": {"type": "object", "description": "流程变量（可选）"},
        "priority": {"type": "string", "enum": ["Low", "Medium", "High", "Urgent"], "description": "优先级，默认 Medium"},
        "confirmed": {"type": "boolean", "description": "用户确认后置为 true 才会真正发起"},
    }, "required": ["definition_id", "title"]},
}, _start_workflow_instance, CATEGORY, "发起流程实例")

ToolRegistry.register("complete_workflow_task", {
    "name": "complete_workflow_task",
    "description": "代表用户提交审批任务的处理结果（approved/rejected 等）。先生成预览等待用户确认，不会直接提交。",
    "parameters": {"type": "object", "properties": {
        "task_id": {"type": "string", "description": "任务 UUID"},
        "result": {"type": "string", "enum": ["approved", "rejected"], "description": "审批结果，默认 approved"},
        "comment": {"type": "string", "description": "审批意见（可选）"},
        "form_data": {"type": "object", "description": "表单数据（可选）"},
        "confirmed": {"type": "boolean", "description": "用户确认后置为 true 才会真正提交"},
    }, "required": ["task_id"]},
}, _complete_workflow_task, CATEGORY, "提交审批任务")

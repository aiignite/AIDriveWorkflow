"""Workflow schemas."""
from __future__ import annotations

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, Field

# ── 节点 ──

class WorkflowNodeCreate(BaseModel):
    node_key: str
    name: str
    description: str | None = None
    node_type: str
    sort_order: int = 0
    position_x: float = 0
    position_y: float = 0
    assignee_config: dict | None = None
    approval_config: dict | None = None
    form_config: dict | None = None
    action_config: dict | None = None
    gateway_config: dict | None = None
    timeout_config: dict | None = None


class WorkflowNodeOut(BaseModel):
    id: UUID
    definition_id: UUID
    node_key: str
    name: str
    description: str | None = None
    node_type: str
    sort_order: int
    position_x: float
    position_y: float
    assignee_config: dict | None = None
    approval_config: dict | None = None
    form_config: dict | None = None
    action_config: dict | None = None
    gateway_config: dict | None = None
    timeout_config: dict | None = None
    model_config = {"from_attributes": True}


# ── 连接线 ──

class WorkflowEdgeCreate(BaseModel):
    source_node_key: str
    target_node_key: str
    label: str | None = None
    condition: dict | None = None
    is_default: bool = False
    sort_order: int = 0


class WorkflowEdgeOut(BaseModel):
    id: UUID
    definition_id: UUID
    source_node_id: UUID
    target_node_id: UUID
    label: str | None = None
    condition: dict | None = None
    is_default: bool
    sort_order: int
    model_config = {"from_attributes": True}


# ── 工作流定义 ──

class WorkflowDefinitionCreate(BaseModel):
    key: str = Field(..., max_length=100)
    name: str = Field(..., max_length=255)
    description: str | None = None
    category: str = "custom"
    entity_type: str | None = None
    entity_view_config: dict | None = None
    trigger_config: dict | None = None


class WorkflowDefinitionUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    category: str | None = None
    entity_type: str | None = None
    entity_view_config: dict | None = None
    trigger_config: dict | None = None


class WorkflowDesignSave(BaseModel):
    nodes: list[WorkflowNodeCreate]
    edges: list[WorkflowEdgeCreate]


class UserBrief(BaseModel):
    id: UUID
    name: str
    image: str | None = None
    model_config = {"from_attributes": True}


class WorkflowDefinitionOut(BaseModel):
    id: UUID
    key: str
    name: str
    description: str | None = None
    category: str
    version: int
    status: str
    entity_type: str | None = None
    entity_view_config: dict | None = None
    is_builtin: bool
    trigger_config: dict | None = None
    created_by: UserBrief | None = None
    created_at: datetime
    updated_at: datetime
    model_config = {"from_attributes": True}


class WorkflowDefinitionDetailOut(WorkflowDefinitionOut):
    nodes: list[WorkflowNodeOut] = []
    edges: list[WorkflowEdgeOut] = []


# ── 工作流实例 ──

class WorkflowInstanceCreate(BaseModel):
    definition_id: UUID
    title: str
    entity_type: str | None = None
    entity_id: UUID | None = None
    variables: dict | None = None
    priority: str = "Medium"


class WorkflowInstanceOut(BaseModel):
    id: UUID
    definition_id: UUID
    definition_name: str | None = None
    instance_number: str
    title: str
    status: str
    entity_type: str | None = None
    entity_id: UUID | None = None
    variables: dict | None = None
    current_node_ids: list | None = None
    priority: str
    initiated_by: UserBrief | None = None
    started_at: datetime
    completed_at: datetime | None = None
    created_at: datetime
    updated_at: datetime
    model_config = {"from_attributes": True}


class WorkflowInstanceDetailOut(WorkflowInstanceOut):
    tasks: list[WorkflowTaskOut] = []
    logs: list[WorkflowInstanceLogOut] = []


# ── 工作流任务 ──

class WorkflowTaskOut(BaseModel):
    id: UUID
    instance_id: UUID
    node_id: UUID | None = None
    task_number: str
    name: str
    status: str
    assignee: UserBrief | None = None
    candidate_ids: list | None = None
    result: str | None = None
    comment: str | None = None
    form_data: dict | None = None
    due_date: datetime | None = None
    claimed_at: datetime | None = None
    completed_at: datetime | None = None
    created_at: datetime
    updated_at: datetime
    node: WorkflowNodeOut | None = None
    instance_title: str | None = None
    definition_name: str | None = None
    entity_type: str | None = None
    entity_id: UUID | None = None
    model_config = {"from_attributes": True}


class TaskCompleteRequest(BaseModel):
    result: str
    comment: str | None = None
    form_data: dict | None = None
    button_key: str | None = None
    target_node_key: str | None = None


class TaskDelegateRequest(BaseModel):
    target_user_id: UUID
    comment: str | None = None


# ── 日志 ──

class WorkflowInstanceLogOut(BaseModel):
    id: UUID
    instance_id: UUID
    node_id: UUID | None = None
    node_name: str | None = None
    task_id: UUID | None = None
    event_type: str
    actor: UserBrief | None = None
    details: dict | None = None
    comment: str | None = None
    created_at: datetime
    model_config = {"from_attributes": True}


# ── 统计 ──

class WorkflowTaskSummary(BaseModel):
    pending: int = 0
    claimed: int = 0
    completed_today: int = 0
    overdue: int = 0
    total: int = 0

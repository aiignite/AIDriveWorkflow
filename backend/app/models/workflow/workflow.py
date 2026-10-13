"""Workflow engine models."""
from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Index, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base

# ── 工作流定义（模板）──────────────────────────────────

class WorkflowDefinition(Base):
    """工作流模板/定义 - 描述一个可复用的流程"""
    __tablename__ = "wfl_definitions"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    key: Mapped[str] = mapped_column(String(100), unique=True, nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    category: Mapped[str] = mapped_column(String(50), nullable=False, default="custom")
    version: Mapped[int] = mapped_column(Integer, default=1)
    status: Mapped[str] = mapped_column(String(20), default="draft")
    entity_type: Mapped[str | None] = mapped_column(String(50))
    entity_view_config: Mapped[dict | None] = mapped_column(JSONB)
    is_builtin: Mapped[bool] = mapped_column(Boolean, default=False)
    trigger_config: Mapped[dict | None] = mapped_column(JSONB)
    created_by_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"))
    is_deleted: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    nodes: Mapped[list[WorkflowNode]] = relationship(
        back_populates="definition", cascade="all, delete-orphan",
        order_by="WorkflowNode.sort_order"
    )
    edges: Mapped[list[WorkflowEdge]] = relationship(
        back_populates="definition", cascade="all, delete-orphan"
    )
    instances: Mapped[list[WorkflowInstance]] = relationship(
        back_populates="definition"
    )
    created_by = relationship("User", foreign_keys=[created_by_id], lazy="selectin")


class WorkflowNode(Base):
    """工作流节点 - 流程图中的一个步骤"""
    __tablename__ = "wfl_nodes"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    definition_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("wfl_definitions.id", ondelete="CASCADE"), nullable=False
    )
    node_key: Mapped[str] = mapped_column(String(100), nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    node_type: Mapped[str] = mapped_column(String(30), nullable=False)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    position_x: Mapped[float] = mapped_column(Float, default=0)
    position_y: Mapped[float] = mapped_column(Float, default=0)
    assignee_config: Mapped[dict | None] = mapped_column(JSONB)
    approval_config: Mapped[dict | None] = mapped_column(JSONB)
    form_config: Mapped[dict | None] = mapped_column(JSONB)
    action_config: Mapped[dict | None] = mapped_column(JSONB)
    gateway_config: Mapped[dict | None] = mapped_column(JSONB)
    timeout_config: Mapped[dict | None] = mapped_column(JSONB)

    definition: Mapped[WorkflowDefinition] = relationship(back_populates="nodes")
    is_deleted: Mapped[bool] = mapped_column(Boolean, default=False)


class WorkflowEdge(Base):
    """工作流连接线 - 节点间的转移关系"""
    __tablename__ = "wfl_edges"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    definition_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("wfl_definitions.id", ondelete="CASCADE"), nullable=False
    )
    source_node_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("wfl_nodes.id", ondelete="CASCADE"), nullable=False
    )
    target_node_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("wfl_nodes.id", ondelete="CASCADE"), nullable=False
    )
    label: Mapped[str | None] = mapped_column(String(100))
    condition: Mapped[dict | None] = mapped_column(JSONB)
    is_default: Mapped[bool] = mapped_column(Boolean, default=False)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)

    definition: Mapped[WorkflowDefinition] = relationship(back_populates="edges")
    source_node: Mapped[WorkflowNode] = relationship(foreign_keys=[source_node_id])
    target_node: Mapped[WorkflowNode] = relationship(foreign_keys=[target_node_id])
    is_deleted: Mapped[bool] = mapped_column(Boolean, default=False)


# ── 工作流实例（运行时）──────────────────────────────────

class WorkflowInstance(Base):
    """工作流实例 - 一个已启动的流程运行"""
    __tablename__ = "wfl_instances"
    # 热路径索引：状态过滤、按发起人查实例、按定义聚合统计
    __table_args__ = (
        Index("ix_wfl_instances_definition_id", "definition_id"),
        Index("ix_wfl_instances_initiated_by_id", "initiated_by_id"),
        Index("ix_wfl_instances_status", "status"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    definition_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("wfl_definitions.id"), nullable=False
    )
    instance_number: Mapped[str] = mapped_column(String(50), unique=True, nullable=False, index=True)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    status: Mapped[str] = mapped_column(String(20), default="running")
    entity_type: Mapped[str | None] = mapped_column(String(50))
    entity_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    variables: Mapped[dict | None] = mapped_column(JSONB, default=dict)
    current_node_ids: Mapped[list | None] = mapped_column(JSONB, default=list)
    priority: Mapped[str] = mapped_column(String(20), default="Medium")
    initiated_by_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=False
    )
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    is_deleted: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    definition: Mapped[WorkflowDefinition] = relationship(back_populates="instances", lazy="selectin")
    initiated_by = relationship("User", foreign_keys=[initiated_by_id], lazy="selectin")
    tasks: Mapped[list[WorkflowTask]] = relationship(
        back_populates="instance", cascade="all, delete-orphan",
        order_by="WorkflowTask.created_at"
    )
    logs: Mapped[list[WorkflowInstanceLog]] = relationship(
        back_populates="instance", cascade="all, delete-orphan",
        order_by="WorkflowInstanceLog.created_at"
    )

    @property
    def definition_name(self) -> str | None:
        """Computed field for Pydantic serialization."""
        return self.definition.name if self.definition else None


class WorkflowTask(Base):
    """工作流任务 - 分配给具体用户的待办"""
    __tablename__ = "wfl_tasks"
    # 热路径索引：「我的待办」按 assignee_id + status 过滤是最频繁查询；instance_id 供实例详情/级联查询
    __table_args__ = (
        Index("ix_wfl_tasks_assignee_status", "assignee_id", "status"),
        Index("ix_wfl_tasks_instance_id", "instance_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    instance_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("wfl_instances.id", ondelete="CASCADE"), nullable=False
    )
    node_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("wfl_nodes.id", ondelete="SET NULL")
    )
    task_number: Mapped[str] = mapped_column(String(50), unique=True, nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    status: Mapped[str] = mapped_column(String(20), default="pending")
    assignee_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"))
    candidate_ids: Mapped[list | None] = mapped_column(JSONB)
    result: Mapped[str | None] = mapped_column(String(30))
    comment: Mapped[str | None] = mapped_column(Text)
    form_data: Mapped[dict | None] = mapped_column(JSONB)
    due_date: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    claimed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    is_deleted: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    instance: Mapped[WorkflowInstance] = relationship(back_populates="tasks")
    node: Mapped[WorkflowNode] = relationship(lazy="selectin")
    assignee = relationship("User", foreign_keys=[assignee_id], lazy="selectin")

    @property
    def instance_title(self) -> str | None:
        """Computed: title of the parent workflow instance."""
        return self.instance.title if self.instance else None

    @property
    def definition_name(self) -> str | None:
        """Computed: name of the workflow definition via instance."""
        if self.instance and self.instance.definition:
            return self.instance.definition.name
        return None

    @property
    def entity_type(self) -> str | None:
        """Computed: entity type from parent instance."""
        return self.instance.entity_type if self.instance else None

    @property
    def entity_id(self) -> uuid.UUID | None:
        """Computed: entity id from parent instance."""
        return self.instance.entity_id if self.instance else None


class WorkflowInstanceLog(Base):
    """工作流执行日志 - 完整的审计轨迹"""
    __tablename__ = "wfl_instance_logs"
    # 热路径索引：日志时间线按实例/任务过滤查询
    __table_args__ = (
        Index("ix_wfl_instance_logs_instance_id", "instance_id"),
        Index("ix_wfl_instance_logs_task_id", "task_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    instance_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("wfl_instances.id", ondelete="CASCADE"), nullable=False
    )
    node_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("wfl_nodes.id", ondelete="SET NULL"))
    task_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("wfl_tasks.id"))
    event_type: Mapped[str] = mapped_column(String(50), nullable=False)
    actor_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"))
    details: Mapped[dict | None] = mapped_column(JSONB)
    comment: Mapped[str | None] = mapped_column(Text)
    is_deleted: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    instance: Mapped[WorkflowInstance] = relationship(back_populates="logs")
    node: Mapped[WorkflowNode] = relationship(lazy="selectin")
    actor = relationship("User", foreign_keys=[actor_id], lazy="selectin")

    @property
    def node_name(self) -> str | None:
        """Computed field for Pydantic serialization."""
        return self.node.name if self.node else None


# ── 工作流 SLA 配置 ───────────────────────────────────

class WorkflowSLAConfig(Base):
    """工作流 SLA 配置 — 定义流程和节点的服务等级协议。"""
    __tablename__ = "wfl_sla_configs"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    definition_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("wfl_definitions.id", ondelete="CASCADE"), nullable=True, index=True,
    )
    node_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("wfl_nodes.id", ondelete="CASCADE"), nullable=True, index=True,
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    max_duration_minutes: Mapped[int] = mapped_column(Integer, nullable=False, comment="最大执行时长(分钟)")
    warning_threshold_pct: Mapped[int] = mapped_column(
        Integer, default=80, comment="预警百分比（如80%时发通知）",
    )
    escalation_action: Mapped[str] = mapped_column(
        String(30), default="notify", comment="超时动作: notify/reassign/auto_complete/terminate",
    )
    escalation_target_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True,
        comment="升级目标用户（reassign时）",
    )
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    is_deleted: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class WorkflowScheduleQueue(Base):
    """工作流调度队列 — 优先级队列管理待处理任务。"""
    __tablename__ = "wfl_schedule_queues"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    instance_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("wfl_instances.id", ondelete="CASCADE"), nullable=False, index=True,
    )
    task_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("wfl_tasks.id", ondelete="CASCADE"), nullable=True, index=True,
    )
    priority_score: Mapped[float] = mapped_column(Float, nullable=False, comment="优先级评分")
    scheduled_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    picked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), comment="被领取时间")
    status: Mapped[str] = mapped_column(String(20), default="pending", comment="pending/picked/completed")
    is_deleted: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class WorkflowRetryPolicy(Base):
    """工作流重试策略 — 定义服务任务的失败重试规则。"""
    __tablename__ = "wfl_retry_policies"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    definition_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("wfl_definitions.id", ondelete="CASCADE"), nullable=False, index=True,
    )
    node_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("wfl_nodes.id", ondelete="CASCADE"), nullable=True, index=True,
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    max_retries: Mapped[int] = mapped_column(Integer, default=3, comment="最大重试次数")
    retry_delay_seconds: Mapped[int] = mapped_column(Integer, default=5, comment="重试间隔(秒)")
    backoff_multiplier: Mapped[float] = mapped_column(Float, default=2.0, comment="指数退避系数")
    retry_on_results: Mapped[list] = mapped_column(
        JSONB, default=list, comment="触发重试的结果/异常类型列表",
    )
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    is_deleted: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

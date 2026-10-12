"""Workflow page-context builder for the AI assistant.

AIDriveWorkflow has no document corpus, so "RAG" here means enriching the
system prompt with live data of the workflow entities referenced by the
current page (instance / task cards passed via page_context.selectedEntities).
"""
from __future__ import annotations

import json
from typing import Any
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.workflow import WorkflowInstance, WorkflowTask


class RagService:
    @staticmethod
    async def build_context(
        db: AsyncSession,
        user_id: UUID,
        message: str,
        *,
        top_k: int = 5,
        page_context: dict[str, Any] | None = None,
    ) -> str | None:
        entities = (page_context or {}).get("selectedEntities") or []
        sections: list[str] = []
        for ent in entities:
            if not isinstance(ent, dict):
                continue
            ent_type = str(ent.get("type") or "")
            raw_id = ent.get("id")
            if not raw_id:
                continue
            try:
                ent_id = UUID(str(raw_id))
            except ValueError:
                continue

            if ent_type == "workflow_instance":
                section = await RagService._instance_section(db, ent_id)
                if section:
                    sections.append(section)
            elif ent_type == "workflow_task":
                section = await RagService._task_section(db, ent_id)
                if section:
                    sections.append(section)

        if not sections:
            return None
        return "## 当前打开的工作流对象\n" + "\n\n".join(sections)

    @staticmethod
    async def _instance_section(db: AsyncSession, instance_id: UUID) -> str | None:
        result = await db.execute(
            select(WorkflowInstance)
            .options(selectinload(WorkflowInstance.definition))
            .where(
                WorkflowInstance.id == instance_id,
                WorkflowInstance.is_deleted == False,  # noqa: E712
            )
        )
        inst = result.scalar_one_or_none()
        if not inst:
            return None
        task_rows = await db.execute(
            select(WorkflowTask).where(
                WorkflowTask.instance_id == inst.id,
                WorkflowTask.status == "pending",
                WorkflowTask.is_deleted == False,  # noqa: E712
            )
        )
        pending = [
            {"task": t.name, "status": t.status}
            for t in task_rows.scalars().all()
        ]
        return (
            f"### 流程实例 {inst.instance_number}：{inst.title}\n"
            f"- 所属流程：{inst.definition.name if inst.definition else '-'}\n"
            f"- 状态：{inst.status}；优先级：{inst.priority}\n"
            f"- 当前节点：{json.dumps(inst.current_node_ids or [], ensure_ascii=False)}\n"
            f"- 流程变量：{json.dumps(inst.variables or {}, ensure_ascii=False)}\n"
            f"- 待办任务：{json.dumps(pending, ensure_ascii=False)}"
        )

    @staticmethod
    async def _task_section(db: AsyncSession, task_id: UUID) -> str | None:
        result = await db.execute(
            select(WorkflowTask)
            .options(selectinload(WorkflowTask.instance))
            .where(WorkflowTask.id == task_id, WorkflowTask.is_deleted == False)  # noqa: E712
        )
        task = result.scalar_one_or_none()
        if not task:
            return None
        inst = task.instance
        return (
            f"### 待办任务 {task.task_number}：{task.name}\n"
            f"- 所属实例：{inst.title if inst else '-'}（{inst.instance_number if inst else '-'}，状态 {inst.status if inst else '-'}）\n"
            f"- 任务状态：{task.status}\n"
            f"- 实例变量：{json.dumps(inst.variables or {}, ensure_ascii=False) if inst else '{}'}"
        )

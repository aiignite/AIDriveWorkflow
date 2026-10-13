"""Seed default AI models, the workflow assistant, and builtin skills."""
from __future__ import annotations

import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

import app.ai_tools  # noqa: F401
from app.ai_tools.registry import ToolRegistry
from app.config import get_settings
from app.models.ai import (
    AIAssistant,
    AIAssistantSkillBinding,
    AIModel,
    AISkill,
    PageSkillBinding,
)

WORKFLOW_ASSISTANT_PROMPT = """你是 AIDriveWorkflow 工作流助手，帮助用户查询、发起和处理审批流程。

## 可用工具
- list_workflow_definitions — 查询流程定义（模板）列表
- get_workflow_definition — 获取流程定义详情（节点/处理人/审批配置）
- list_my_instances — 查询我发起的流程实例
- get_instance_status — 查询实例状态（当前节点/任务/变量/日志）
- list_my_tasks — 查询我的待办审批任务
- start_workflow_instance — 发起流程（生成预览，需用户确认）
- complete_workflow_task — 提交审批结果（生成预览，需用户确认）

## 写操作确认（重要）
start_workflow_instance 和 complete_workflow_task 不会直接执行，会先返回预览，
需用户在对话框确认卡片中点击确认后才真正发起/提交。

## 交互规则
1. 用户问"有什么流程" → list_workflow_definitions
2. 用户要发起流程 → 先 list_workflow_definitions 找到对应定义，再 start_workflow_instance
3. 用户问流程进度 → get_instance_status
4. 用户要处理待办 → list_my_tasks 找到任务，确认结果与意见后 complete_workflow_task
5. 回答用中文，简洁准确
"""

BUILTIN_SKILLS = [
    {
        "code": "workflow_query_flow",
        "name": "流程查询",
        "keywords": ["流程状态", "查询流程", "流程进度", "实例状态", "走到哪了", "流程到哪"],
        "prompt_template": (
            "用户想查询流程进度/状态。若上下文含实例 ID 直接 get_instance_status；"
            "否则先 list_my_instances 定位实例（可问用户标题），再 get_instance_status，"
            "用简洁中文说明当前节点、待办人与下一步。"
        ),
        "tool_names": ["list_my_instances", "get_instance_status"],
        "priority": 85,
        "extra_config": {},
    },
    {
        "code": "workflow_query_tasks",
        "name": "待办查询",
        "keywords": ["我的待办", "待审批", "待办任务", "要审什么", "任务列表"],
        "prompt_template": (
            "用户想查看待办。调用 list_my_tasks 返回任务列表（名称/流程/编号），"
            "并提示可让 AI 代为预览审批。"
        ),
        "tool_names": ["list_my_tasks"],
        "priority": 84,
        "extra_config": {},
    },
    {
        "code": "workflow_start",
        "name": "发起流程",
        "keywords": ["发起流程", "提交审批", "启动流程", "新建流程", "走个流程", "申请审批"],
        "prompt_template": (
            "用户想发起流程。先 list_workflow_definitions 找到匹配的已发布定义；"
            "不确定时列出候选让用户选择。确定后调用 start_workflow_instance 生成预览，"
            "并告知用户需在确认卡片中点击「确认发起」。"
        ),
        "tool_names": ["list_workflow_definitions", "start_workflow_instance"],
        "priority": 90,
        "extra_config": {},
    },
    {
        "code": "workflow_approve",
        "name": "审批处理",
        "keywords": ["同意", "批准", "驳回", "拒绝", "通过", "审批", "处理待办"],
        "prompt_template": (
            "用户想处理审批任务。先 list_my_tasks 定位任务（上下文含任务 ID 时直接使用）；"
            "与用户确认审批结果（approved/rejected）与意见后调用 complete_workflow_task，"
            "并告知用户需在确认卡片中点击「确认提交」。"
        ),
        "tool_names": ["list_my_tasks", "complete_workflow_task"],
        "priority": 92,
        "extra_config": {},
    },
    {
        "code": "workflow_design",
        "name": "流程设计辅助",
        "keywords": ["设计流程", "怎么建流程", "流程模板", "流程怎么配", "节点配置"],
        "prompt_template": (
            "用户想了解/设计流程。可调用 list_workflow_definitions/get_workflow_definition "
            "查看现有模板结构，讲解节点类型（start/approval/gateway/end）、处理人配置、"
            "网关条件表达式的写法；建议用户到流程定义页用可视化设计器编辑。"
        ),
        "tool_names": ["list_workflow_definitions", "get_workflow_definition"],
        "priority": 70,
        "extra_config": {},
    },
]


class AISeedService:
    @staticmethod
    async def ensure_platform_seed(db: AsyncSession) -> None:
        settings = get_settings()
        model_name = f"Ollama/{settings.OLLAMA_MODEL}"

        result = await db.execute(
            select(AIModel).where(AIModel.name == model_name, AIModel.is_deleted == False)  # noqa: E712
        )
        ai_model = result.scalar_one_or_none()
        if not ai_model:
            ai_model = AIModel(
                id=uuid.uuid4(),
                name=model_name,
                model_id=settings.OLLAMA_MODEL,
                provider="OLLAMA",
                endpoint=settings.OLLAMA_BASE_URL,
                description="默认本地 Ollama 模型",
                is_public=True,
            )
            db.add(ai_model)
            await db.flush()

        result = await db.execute(
            select(AIAssistant).where(AIAssistant.name == "工作流助手", AIAssistant.is_deleted == False)  # noqa: E712
        )
        assistant = result.scalar_one_or_none()
        workflow_tools = ToolRegistry.get_tools_by_category("workflow")
        if assistant:
            # 仅同步工具列表与系统标记，保留用户在 UI 中修改的模型/提示词/参数
            assistant.tools = workflow_tools
            assistant.is_system = True
            if not assistant.model:
                assistant.model = model_name
            if assistant.temperature is None:
                assistant.temperature = 0.4
            if assistant.max_tokens is None:
                assistant.max_tokens = 16384
            if not assistant.system_prompt:
                assistant.system_prompt = WORKFLOW_ASSISTANT_PROMPT
            if not assistant.description:
                assistant.description = "辅助查询流程、发起审批、处理待办任务的工作流助手。"
            if not assistant.avatar:
                assistant.avatar = "🔀"
            if not assistant.role:
                assistant.role = "工作流助手"
            if not assistant.category:
                assistant.category = "System"
        else:
            assistant = AIAssistant(
                name="工作流助手",
                description="辅助查询流程、发起审批、处理待办任务的工作流助手。",
                avatar="🔀",
                role="工作流助手",
                category="System",
                system_prompt=WORKFLOW_ASSISTANT_PROMPT,
                model=model_name,
                temperature=0.4,
                max_tokens=16384,
                is_system=True,
                is_default=True,
                tools=workflow_tools,
            )
            db.add(assistant)
            await db.flush()

        for item in BUILTIN_SKILLS:
            res = await db.execute(
                select(AISkill).where(AISkill.code == item["code"], AISkill.is_deleted == False)  # noqa: E712
            )
            skill = res.scalar_one_or_none()
            if skill:
                if item.get("extra_config") and not (skill.extra_config or {}):
                    skill.extra_config = item["extra_config"]
                if skill.is_builtin and skill.prompt_template != item["prompt_template"]:
                    skill.prompt_template = item["prompt_template"]
            else:
                skill = AISkill(
                    code=item["code"],
                    name=item["name"],
                    keywords=item["keywords"],
                    prompt_template=item["prompt_template"],
                    tool_names=item["tool_names"],
                    priority=item["priority"],
                    extra_config=item.get("extra_config") or {},
                    is_enabled=True,
                    is_builtin=True,
                )
                db.add(skill)
                await db.flush()

            pb_res = await db.execute(
                select(PageSkillBinding).where(
                    PageSkillBinding.page_name == "workflows",
                    PageSkillBinding.skill_id == skill.id,
                    PageSkillBinding.is_deleted == False,  # noqa: E712
                )
            )
            if not pb_res.scalar_one_or_none():
                db.add(PageSkillBinding(page_name="workflows", skill_id=skill.id, weight=skill.priority))

            ab_res = await db.execute(
                select(AIAssistantSkillBinding).where(
                    AIAssistantSkillBinding.assistant_id == assistant.id,
                    AIAssistantSkillBinding.skill_id == skill.id,
                    AIAssistantSkillBinding.is_deleted == False,  # noqa: E712
                )
            )
            if not ab_res.scalar_one_or_none():
                db.add(AIAssistantSkillBinding(
                    assistant_id=assistant.id, skill_id=skill.id, weight=skill.priority,
                ))

        await db.commit()

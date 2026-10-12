"""Seed workflow templates for engineering change management.

Creates built-in workflow definitions with pre-designed nodes and edges
for common automotive PLM change processes (IATF 16949 / VDA 6.3).

Usage:
    cd backend
    python -m app.seed_workflows
"""
from __future__ import annotations

import asyncio
import hashlib
import json
from typing import Any
from uuid import uuid4

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.database import AsyncSessionLocal
from app.models.workflow import (  # noqa: E402  FastAPI 惯例：app 初始化后再导入路由
    WorkflowDefinition,
    WorkflowEdge,
    WorkflowInstance,
    WorkflowNode,
)


def _normalize_for_fingerprint(value: Any) -> Any:
    """归一化 JSON 可比较结构（float 整型、None 等），避免库内 float 与模板 int 指纹不一致。"""
    if isinstance(value, float):
        return int(value) if value.is_integer() else value
    if isinstance(value, dict):
        return {k: _normalize_for_fingerprint(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_normalize_for_fingerprint(v) for v in value]
    return value


def _workflow_template_fingerprint(tmpl: dict[str, Any]) -> str:
    """结构指纹：用于判断内置模板是否需要重写节点/边（避免每次启动全量重建）。"""
    payload = {
        "name": tmpl.get("name"),
        "description": tmpl.get("description"),
        "category": tmpl.get("category"),
        "entity_type": tmpl.get("entity_type"),
        "entity_view_config": tmpl.get("entity_view_config"),
        "nodes": [
            {
                "node_key": n.get("node_key"),
                "name": n.get("name"),
                "node_type": n.get("node_type"),
                "sort_order": n.get("sort_order", 0),
                "position_x": n.get("position_x", 0),
                "position_y": n.get("position_y", 0),
                "assignee_config": n.get("assignee_config"),
                "approval_config": n.get("approval_config"),
                "form_config": n.get("form_config"),
                "action_config": n.get("action_config"),
                "gateway_config": n.get("gateway_config"),
                "timeout_config": n.get("timeout_config"),
            }
            for n in sorted(tmpl.get("nodes") or [], key=lambda x: x.get("node_key") or "")
        ],
        "edges": [
            {
                "source": e.get("source"),
                "target": e.get("target"),
                "label": e.get("label"),
                "condition": e.get("condition"),
                "is_default": bool(e.get("is_default", False)),
            }
            for e in sorted(
                tmpl.get("edges") or [],
                key=lambda x: (
                    x.get("source") or "",
                    x.get("target") or "",
                    x.get("label") or "",
                ),
            )
        ],
    }
    raw = json.dumps(
        _normalize_for_fingerprint(payload),
        ensure_ascii=False,
        sort_keys=True,
        default=str,
    )
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def _existing_workflow_fingerprint(defn: WorkflowDefinition) -> str:
    """从已落库定义重建指纹（仅未软删节点/边）。"""
    nodes = [n for n in (defn.nodes or []) if not n.is_deleted]
    node_id_to_key = {str(n.id): n.node_key for n in nodes}
    edges = [e for e in (defn.edges or []) if not e.is_deleted]
    tmpl_like = {
        "name": defn.name,
        "description": defn.description,
        "category": defn.category,
        "entity_type": defn.entity_type,
        "entity_view_config": defn.entity_view_config,
        "nodes": [
            {
                "node_key": n.node_key,
                "name": n.name,
                "node_type": n.node_type,
                "sort_order": n.sort_order or 0,
                "position_x": n.position_x or 0,
                "position_y": n.position_y or 0,
                "assignee_config": n.assignee_config,
                "approval_config": n.approval_config,
                "form_config": n.form_config,
                "action_config": n.action_config,
                "gateway_config": n.gateway_config,
                "timeout_config": n.timeout_config,
            }
            for n in sorted(nodes, key=lambda x: x.node_key or "")
        ],
        "edges": [
            {
                "source": node_id_to_key.get(str(e.source_node_id)),
                "target": node_id_to_key.get(str(e.target_node_id)),
                "label": e.label,
                "condition": e.condition,
                "is_default": bool(e.is_default),
            }
            for e in sorted(
                edges,
                key=lambda x: (
                    node_id_to_key.get(str(x.source_node_id)) or "",
                    node_id_to_key.get(str(x.target_node_id)) or "",
                    x.label or "",
                ),
            )
        ],
    }
    return _workflow_template_fingerprint(tmpl_like)


SYNCABLE_BUILTIN_WORKFLOW_KEYS = {
    "req_elicitation_confirm_workflow",
    "sys_req_review_workflow",
    "sys_int_test_review_workflow",
    "sys_qual_test_review_workflow",
    "swe_req_review_workflow",
    "swe_arch_review_workflow",
    "swe_detail_review_workflow",
    "swe_unit_review_workflow",
    "swe_integration_review_workflow",
    "swe_qualification_review_workflow",
    "prb_problem_intake_workflow",
    "prb_problem_triage_workflow",
    "prb_problem_fix_workflow",
    "prb_problem_verify_workflow",
    "prb_problem_close_workflow",
    "prc_designs_approval",
    "prc_control_plan_approval",
    "prc_work_instruction_approval",
    "prc_pfmea_master_approval",
    "pdd_dfmea_metadata_approval",
    "bgt_budget_approval",
    "bgt_budget_adjustment_approval",
    "fn_bank_approval",
    "eqd_fn_bank_approval",
    "hwe_modbank_approval",
    "dfmea_bank_approval",
    "feasibility_document_review",
    "closure_document_review",
    "ai_skill_prompt_change_approval",
    "mat_bom_header_approval",
    "eqp_bom_header_approval",
    "mat_material_approval",
    "mfg_master_plan_approval",
    "eqd_control_design_approval",
    "eqd_structural_design_doc_approval",
    "qlt_qa_plan_approval",
    "qlt_ncr_close_approval",
    "prc_fmea_approval",
    "eqp_maintenance_order_completion",
    "eqp_min_stock_adjustment_approval",
    "fs_hazard_review_workflow",
    "fs_safety_goal_review_workflow",
    "fs_requirement_review_workflow",
    "fs_confirmation_review_workflow",
    "fs_safety_case_review_workflow",
    "fs_item_definition_review_workflow",
    "fs_safety_analysis_review_workflow",
    "fs_fsc_review_workflow",
    "fs_tsc_review_workflow",
    "fs_hsi_review_workflow",
    "fs_safety_mechanism_review_workflow",
    "fs_safety_plan_review_workflow",
    "fs_assessment_review_workflow",
    "fs_product_release_review_workflow",
    "fs_production_control_review_workflow",
    "fs_field_event_review_workflow",
    "fs_fta_review_workflow",
    "fs_tool_qualification_review_workflow",
    "fs_test_case_review_workflow",
    # Task A3：生产需求审批
    "sch_production_demand_approval",
    # Task 8：工程变更管理工作流（变更 type|classification|category → workflow_key 映射所用）
    # 复用已有 seed：ECR/ECO/Deviation/设计/工艺/供应链/紧急变更
    "ecr_approval",
    "design_change_approval",
    "process_change_approval",
    "supply_chain_change_approval",
    "eco_implementation",
    "deviation_handling",
    "emergency_change_approval",
    # CM002 / CM001 合同
    "contract_internal_review",
    "contract_huayu_approval",
    "contract_template_review",
    "gov_strategy_plan_approval",
    "sim_factory_plan_approval",
    "qlt_ppap_submission_approval",
    "ehs_work_permit_approval",
    "aig_go_live_review_approval",
}


# ── Template definitions ──────────────────────────────────

WORKFLOW_TEMPLATES = [
    # ── Brand Approval ──
    {
        "key": "brand_approval",
        "name": "品牌审核审批",
        "description": "品牌信息的审核审批流程：提交→审批→通过/驳回",
        "category": "material",
        "entity_type": "mat_brands",
        "nodes": [
            {"node_key": "start", "node_type": "start", "name": "开始", "position_x": 60, "position_y": 200, "sort_order": 0},
            {"node_key": "approval", "node_type": "approval", "name": "品牌审批", "position_x": 350, "position_y": 200, "sort_order": 1,
             "assignee_config": {"assignee_type": "initiator"},
             "approval_config": {"reject_action": "terminate"}},
            {"node_key": "end_ok", "node_type": "end", "name": "审批通过", "position_x": 650, "position_y": 200, "sort_order": 2},
        ],
        "edges": [
            {"source": "start", "target": "approval"},
            {"source": "approval", "target": "end_ok"},
        ],
    },
    # ── Material Master Approval ──
    {
        "key": "mat_material_approval",
        "name": "物料清单审批",
        "description": "物料新增/变更的审核审批流程：提交→主管审批→通过/驳回",
        "category": "material",
        "entity_type": "mat_materials",
        "nodes": [
            {"node_key": "start", "node_type": "start", "name": "开始", "position_x": 60, "position_y": 200, "sort_order": 0},
            {"node_key": "approval", "node_type": "approval", "name": "主管审批", "position_x": 350, "position_y": 200, "sort_order": 1,
             "assignee_config": {"assignee_type": "initiator"},
             "approval_config": {"reject_action": "back_to_start"}},
            {"node_key": "end_ok", "node_type": "end", "name": "审批通过", "position_x": 650, "position_y": 200, "sort_order": 2},
        ],
        "edges": [
            {"source": "start", "target": "approval"},
            {"source": "approval", "target": "end_ok"},
        ],
    },
    # ── Change Request Approval ──
    {
        "key": "ecr_approval",
        "name": "ECR 变更请求审批",
        "description": "工程变更请求的标准审批流程：提交→技术评审→管理层审批→实施",
        "category": "change_management",
        "entity_type": "chg_requests",
        "nodes": [
            {"node_key": "start", "node_type": "start", "name": "开始", "position_x": 60, "position_y": 200, "sort_order": 0},
            {"node_key": "submit", "node_type": "user_task", "name": "提交变更请求", "position_x": 260, "position_y": 200, "sort_order": 1,
             "assignee_config": {"assigneeType": "initiator"}},
            {"node_key": "tech_review", "node_type": "approval", "name": "技术评审", "position_x": 480, "position_y": 200, "sort_order": 2,
             "assignee_config": {"assigneeType": "role", "assigneeValue": "技术评审员"}},
            {"node_key": "gw1", "node_type": "exclusive_gateway", "name": "评审结果", "position_x": 700, "position_y": 200, "sort_order": 3},
            {"node_key": "mgr_approve", "node_type": "approval", "name": "管理层审批", "position_x": 920, "position_y": 140, "sort_order": 4,
             "assignee_config": {"assigneeType": "role", "assigneeValue": "部门经理"}},
            {"node_key": "revise", "node_type": "user_task", "name": "修改补充", "position_x": 920, "position_y": 280, "sort_order": 5,
             "assignee_config": {"assigneeType": "initiator"}},
            {"node_key": "end_ok", "node_type": "end", "name": "审批通过", "position_x": 1140, "position_y": 140, "sort_order": 6},
            {"node_key": "end_no", "node_type": "end", "name": "关闭", "position_x": 1140, "position_y": 280, "sort_order": 7},
        ],
        "edges": [
            {"source": "start", "target": "submit"},
            {"source": "submit", "target": "tech_review"},
            {"source": "tech_review", "target": "gw1"},
            {"source": "gw1", "target": "mgr_approve", "label": "通过", "condition": {"expression": 'result=="approved"'}},
            {"source": "gw1", "target": "revise", "label": "退回", "condition": {"expression": 'result=="rejected"'}},
            {"source": "mgr_approve", "target": "end_ok"},
            {"source": "revise", "target": "end_no"},
        ],
    },
    # ── Domain-specific change workflows (Phase 4) ──
    {
        "key": "design_change_approval",
        "name": "设计变更审批",
        "description": "设计变更：申请→影响分析→设计评审→CCB→实施",
        "category": "change_management",
        "entity_type": "chg_requests",
        "nodes": [
            {"node_key": "start", "node_type": "start", "name": "开始", "position_x": 60, "position_y": 200, "sort_order": 0},
            {"node_key": "submit", "node_type": "user_task", "name": "提交设计变更", "position_x": 260, "position_y": 200, "sort_order": 1,
             "assignee_config": {"assigneeType": "initiator"}},
            {"node_key": "impact", "node_type": "user_task", "name": "物料/设计影响分析", "position_x": 480, "position_y": 200, "sort_order": 2,
             "assignee_config": {"assigneeType": "role", "assigneeValue": "设计工程师"}},
            {"node_key": "design_review", "node_type": "approval", "name": "设计评审", "position_x": 700, "position_y": 200, "sort_order": 3,
             "assignee_config": {"assigneeType": "role", "assigneeValue": "技术评审员"}},
            {"node_key": "end_ok", "node_type": "end", "name": "通过", "position_x": 920, "position_y": 200, "sort_order": 4},
        ],
        "edges": [
            {"source": "start", "target": "submit"},
            {"source": "submit", "target": "impact"},
            {"source": "impact", "target": "design_review"},
            {"source": "design_review", "target": "end_ok"},
        ],
    },
    {
        "key": "process_change_approval",
        "name": "工艺变更审批",
        "description": "工艺变更：申请→工艺影响→培训上线→验证",
        "category": "change_management",
        "entity_type": "chg_requests",
        "nodes": [
            {"node_key": "start", "node_type": "start", "name": "开始", "position_x": 60, "position_y": 200, "sort_order": 0},
            {"node_key": "submit", "node_type": "user_task", "name": "提交工艺变更", "position_x": 260, "position_y": 200, "sort_order": 1,
             "assignee_config": {"assigneeType": "initiator"}},
            {"node_key": "process_impact", "node_type": "user_task", "name": "SOP/PFMEA 影响", "position_x": 480, "position_y": 200, "sort_order": 2,
             "assignee_config": {"assigneeType": "role", "assigneeValue": "工艺工程师"}},
            {"node_key": "approve", "node_type": "approval", "name": "工艺审批", "position_x": 700, "position_y": 200, "sort_order": 3,
             "assignee_config": {"assigneeType": "role", "assigneeValue": "部门经理"}},
            {"node_key": "end_ok", "node_type": "end", "name": "通过", "position_x": 920, "position_y": 200, "sort_order": 4},
        ],
        "edges": [
            {"source": "start", "target": "submit"},
            {"source": "submit", "target": "process_impact"},
            {"source": "process_impact", "target": "approve"},
            {"source": "approve", "target": "end_ok"},
        ],
    },
    {
        "key": "supply_chain_change_approval",
        "name": "供应链变更审批",
        "description": "供应链变更：供应商评估→物料切换→库存处置→PPAP",
        "category": "change_management",
        "entity_type": "chg_requests",
        "nodes": [
            {"node_key": "start", "node_type": "start", "name": "开始", "position_x": 60, "position_y": 200, "sort_order": 0},
            {"node_key": "submit", "node_type": "user_task", "name": "提交供应链变更", "position_x": 260, "position_y": 200, "sort_order": 1,
             "assignee_config": {"assigneeType": "initiator"}},
            {"node_key": "supplier", "node_type": "user_task", "name": "供应商评估", "position_x": 480, "position_y": 200, "sort_order": 2,
             "assignee_config": {"assigneeType": "role", "assigneeValue": "采购工程师"}},
            {"node_key": "approve", "node_type": "approval", "name": "供应链审批", "position_x": 700, "position_y": 200, "sort_order": 3,
             "assignee_config": {"assigneeType": "role", "assigneeValue": "部门经理"}},
            {"node_key": "end_ok", "node_type": "end", "name": "通过", "position_x": 920, "position_y": 200, "sort_order": 4},
        ],
        "edges": [
            {"source": "start", "target": "submit"},
            {"source": "submit", "target": "supplier"},
            {"source": "supplier", "target": "approve"},
            {"source": "approve", "target": "end_ok"},
        ],
    },
    # ── Emergency Change Approval（紧急变更：先行放行 + 事后补签）──
    {
        "key": "emergency_change_approval",
        "name": "紧急变更审批",
        "description": "紧急变更流程：紧急放行→影响评估→事后补签审批→关闭/转正式",
        "category": "change_management",
        "entity_type": "chg_requests",
        "nodes": [
            {"node_key": "start", "node_type": "start", "name": "开始", "position_x": 60, "position_y": 220, "sort_order": 0},
            # 紧急放行：先行实施（电话/邮件授权），系统记录放行理由与授权人
            {"node_key": "emergency_release", "node_type": "user_task", "name": "紧急放行", "position_x": 260, "position_y": 220, "sort_order": 1,
             "assignee_config": {"assigneeType": "role", "assigneeValue": "变更经理"},
             "form_config": {"fields": ["emergency_reason", "authorized_by", "release_scope", "temporary_duration"]}},
            # 影响评估：放行后补做影响分析
            {"node_key": "impact_assess", "node_type": "user_task", "name": "影响评估", "position_x": 460, "position_y": 220, "sort_order": 2,
             "assignee_config": {"assigneeType": "role", "assigneeValue": "技术专家"},
             "form_config": {"fields": ["impact_scope", "affected_parts", "safety_risk", "quality_risk"]}},
            # 事后补签审批：CCB/管理层事后确认（核心补签节点）
            {"node_key": "post_signoff", "node_type": "approval", "name": "事后补签审批", "position_x": 660, "position_y": 220, "sort_order": 3,
             "assignee_config": {"assigneeType": "role", "assigneeValue": "CCB 委员会"},
             "approval_config": {"approvalType": "countersign", "minApprovers": 2}},
            {"node_key": "gw_signoff", "node_type": "exclusive_gateway", "name": "补签结果", "position_x": 860, "position_y": 220, "sort_order": 4},
            # 补签通过：直接关闭
            {"node_key": "close", "node_type": "service_task", "name": "关闭变更", "position_x": 1060, "position_y": 140, "sort_order": 5,
             "action_config": {"actions": [{"type": "update_field", "config": {"entityType": "change_request", "field": "status", "value": "closed"}}]}},
            {"node_key": "end_ok", "node_type": "end", "name": "补签通过", "position_x": 1260, "position_y": 140, "sort_order": 6},
            # 补签驳回：转正式 ECO/ECR 流程
            {"node_key": "convert_formal", "node_type": "user_task", "name": "转正式变更流程", "position_x": 1060, "position_y": 320, "sort_order": 7,
             "assignee_config": {"assigneeType": "initiator"},
             "form_config": {"fields": ["formal_change_type", "formal_change_id", "rollback_action"]}},
            {"node_key": "end_convert", "node_type": "end", "name": "转入正式流程", "position_x": 1260, "position_y": 320, "sort_order": 8},
        ],
        "edges": [
            {"source": "start", "target": "emergency_release"},
            {"source": "emergency_release", "target": "impact_assess"},
            {"source": "impact_assess", "target": "post_signoff"},
            {"source": "post_signoff", "target": "gw_signoff"},
            {"source": "gw_signoff", "target": "close", "label": "补签通过", "condition": {"expression": 'result=="approved"'}},
            {"source": "close", "target": "end_ok"},
            {"source": "gw_signoff", "target": "convert_formal", "label": "补签驳回", "condition": {"expression": 'result=="rejected"'}},
            {"source": "convert_formal", "target": "end_convert"},
        ],
    },
    {
        "key": "eco_implementation",
        "name": "ECO 变更实施",
        "description": "工程变更单的完整实施流程：方案评估→影响分析→多方审批→实施验证",
        "category": "change_management",
        "entity_type": "chg_requests",
        "nodes": [
            {"node_key": "start", "node_type": "start", "name": "开始", "position_x": 60, "position_y": 240, "sort_order": 0},
            {"node_key": "plan_review", "node_type": "approval", "name": "方案评估", "position_x": 260, "position_y": 240, "sort_order": 1,
             "assignee_config": {"assigneeType": "role", "assigneeValue": "变更工程师"},
             "form_config": {"fields": ["implementation_plan", "affected_items", "timeline"]}},
            {"node_key": "pg_fork", "node_type": "parallel_gateway", "name": "并行评估", "position_x": 460, "position_y": 240, "sort_order": 2,
             "gateway_config": {"gatewayType": "fork"}},
            {"node_key": "impact_analysis", "node_type": "user_task", "name": "影响分析", "position_x": 660, "position_y": 120, "sort_order": 3,
             "assignee_config": {"assigneeType": "role", "assigneeValue": "技术专家"},
             "form_config": {"fields": ["impact_scope", "affected_parts", "affected_processes"]}},
            {"node_key": "cost_analysis", "node_type": "user_task", "name": "成本评估", "position_x": 660, "position_y": 360, "sort_order": 4,
             "assignee_config": {"assigneeType": "role", "assigneeValue": "财务分析员"},
             "form_config": {"fields": ["tooling_cost", "material_cost", "labor_cost", "total_estimate"]}},
            {"node_key": "pg_join", "node_type": "parallel_gateway", "name": "汇总", "position_x": 860, "position_y": 240, "sort_order": 5,
             "gateway_config": {"gatewayType": "join"}},
            {"node_key": "ccb_review", "node_type": "approval", "name": "CCB 会签审批", "position_x": 1060, "position_y": 240, "sort_order": 6,
             "assignee_config": {"assigneeType": "role", "assigneeValue": "CCB 委员会"},
             "approval_config": {"approvalType": "countersign", "minApprovers": 3}},
            {"node_key": "gw_ccb", "node_type": "exclusive_gateway", "name": "CCB 决议", "position_x": 1260, "position_y": 240, "sort_order": 7},
            {"node_key": "implement", "node_type": "user_task", "name": "实施变更", "position_x": 1460, "position_y": 160, "sort_order": 8,
             "assignee_config": {"assigneeType": "role", "assigneeValue": "实施负责人"},
             "form_config": {"fields": ["implementation_record", "completion_date"]}},
            {"node_key": "verify", "node_type": "approval", "name": "验证确认", "position_x": 1660, "position_y": 160, "sort_order": 9,
             "assignee_config": {"assigneeType": "role", "assigneeValue": "质量工程师"},
             "form_config": {"fields": ["verification_result", "test_report"]}},
            {"node_key": "end_ok", "node_type": "end", "name": "变更完成", "position_x": 1860, "position_y": 160, "sort_order": 10},
            {"node_key": "revise", "node_type": "user_task", "name": "退回修改", "position_x": 1460, "position_y": 340, "sort_order": 11,
             "assignee_config": {"assigneeType": "initiator"}},
            {"node_key": "end_reject", "node_type": "end", "name": "变更驳回", "position_x": 1660, "position_y": 340, "sort_order": 12},
        ],
        "edges": [
            {"source": "start", "target": "plan_review"},
            {"source": "plan_review", "target": "pg_fork"},
            {"source": "pg_fork", "target": "impact_analysis"},
            {"source": "pg_fork", "target": "cost_analysis"},
            {"source": "impact_analysis", "target": "pg_join"},
            {"source": "cost_analysis", "target": "pg_join"},
            {"source": "pg_join", "target": "ccb_review"},
            {"source": "ccb_review", "target": "gw_ccb"},
            {"source": "gw_ccb", "target": "implement", "label": "批准实施", "condition": {"expression": 'result=="approved"'}},
            {"source": "gw_ccb", "target": "revise", "label": "驳回", "condition": {"expression": 'result=="rejected"'}},
            {"source": "implement", "target": "verify"},
            {"source": "verify", "target": "end_ok"},
            {"source": "revise", "target": "end_reject"},
        ],
    },
    {
        "key": "doc_review",
        "name": "文档评审发布",
        "description": "技术文档的评审与发布流程：编写→部门评审→批准→发布",
        "category": "document",
        "entity_type": "doc_documents",
        "nodes": [
            {"node_key": "start", "node_type": "start", "name": "开始", "position_x": 60, "position_y": 200, "sort_order": 0},
            {"node_key": "dept_review", "node_type": "approval", "name": "部门评审", "position_x": 280, "position_y": 200, "sort_order": 1,
             "assignee_config": {"assigneeType": "role", "assigneeValue": "文档评审员"}},
            {"node_key": "gw1", "node_type": "exclusive_gateway", "name": "评审决定", "position_x": 500, "position_y": 200, "sort_order": 2},
            {"node_key": "approve", "node_type": "approval", "name": "审批发布", "position_x": 720, "position_y": 140, "sort_order": 3,
             "assignee_config": {"assigneeType": "role", "assigneeValue": "文控经理"}},
            {"node_key": "reject", "node_type": "user_task", "name": "退回修改", "position_x": 720, "position_y": 280, "sort_order": 4,
             "assignee_config": {"assigneeType": "initiator"}},
            {"node_key": "publish", "node_type": "service_task", "name": "自动发布", "position_x": 940, "position_y": 140, "sort_order": 5,
             "action_config": {"actions": [{"type": "update_field", "config": {"entityType": "document", "field": "status", "value": "published"}}]}},
            {"node_key": "end", "node_type": "end", "name": "结束", "position_x": 1140, "position_y": 200, "sort_order": 6},
        ],
        "edges": [
            {"source": "start", "target": "dept_review"},
            {"source": "dept_review", "target": "gw1"},
            {"source": "gw1", "target": "approve", "label": "通过", "condition": {"expression": 'result=="approved"'}},
            {"source": "gw1", "target": "reject", "label": "退回", "condition": {"expression": 'result=="rejected"'}},
            {"source": "approve", "target": "publish"},
            {"source": "publish", "target": "end"},
            {"source": "reject", "target": "end"},
        ],
    },
    {
        "key": "feasibility_document_review",
        "name": "可行性分析文档审批",
        "description": "项目立项阶段可行性分析报告的评审与发布（doc_documents）",
        "category": "document",
        "entity_type": "doc_documents",
        "nodes": [
            {"node_key": "start", "node_type": "start", "name": "开始", "position_x": 60, "position_y": 200, "sort_order": 0},
            {"node_key": "pm_review", "node_type": "approval", "name": "项目经理评审", "position_x": 280, "position_y": 200, "sort_order": 1,
             "assignee_config": {"assigneeType": "role", "assigneeValue": "项目经理"}},
            {"node_key": "gw1", "node_type": "exclusive_gateway", "name": "评审决定", "position_x": 500, "position_y": 200, "sort_order": 2},
            {"node_key": "approve", "node_type": "approval", "name": "管理层批准", "position_x": 720, "position_y": 140, "sort_order": 3,
             "assignee_config": {"assigneeType": "role", "assigneeValue": "部门经理"}},
            {"node_key": "reject", "node_type": "user_task", "name": "退回修改", "position_x": 720, "position_y": 280, "sort_order": 4,
             "assignee_config": {"assigneeType": "initiator"}},
            {"node_key": "publish", "node_type": "service_task", "name": "自动发布", "position_x": 940, "position_y": 140, "sort_order": 5,
             "action_config": {"actions": [{"type": "update_field", "config": {"entityType": "document", "field": "status", "value": "published"}}]}},
            {"node_key": "end", "node_type": "end", "name": "结束", "position_x": 1140, "position_y": 200, "sort_order": 6},
        ],
        "edges": [
            {"source": "start", "target": "pm_review"},
            {"source": "pm_review", "target": "gw1"},
            {"source": "gw1", "target": "approve", "label": "通过", "condition": {"expression": 'result=="approved"'}},
            {"source": "gw1", "target": "reject", "label": "退回", "condition": {"expression": 'result=="rejected"'}},
            {"source": "approve", "target": "publish"},
            {"source": "publish", "target": "end"},
            {"source": "reject", "target": "end"},
        ],
    },
    {
        "key": "closure_document_review",
        "name": "项目结项文档审批",
        "description": "项目结项报告的评审与归档发布（doc_documents）",
        "category": "document",
        "entity_type": "doc_documents",
        "nodes": [
            {"node_key": "start", "node_type": "start", "name": "开始", "position_x": 60, "position_y": 200, "sort_order": 0},
            {"node_key": "pm_review", "node_type": "approval", "name": "项目经理确认", "position_x": 280, "position_y": 200, "sort_order": 1,
             "assignee_config": {"assigneeType": "role", "assigneeValue": "项目经理"}},
            {"node_key": "gw1", "node_type": "exclusive_gateway", "name": "确认结果", "position_x": 500, "position_y": 200, "sort_order": 2},
            {"node_key": "qa_review", "node_type": "approval", "name": "质量代表评审", "position_x": 720, "position_y": 140, "sort_order": 3,
             "assignee_config": {"assigneeType": "role", "assigneeValue": "质量工程师"}},
            {"node_key": "reject", "node_type": "user_task", "name": "退回修改", "position_x": 720, "position_y": 280, "sort_order": 4,
             "assignee_config": {"assigneeType": "initiator"}},
            {"node_key": "archive", "node_type": "service_task", "name": "归档发布", "position_x": 940, "position_y": 140, "sort_order": 5,
             "action_config": {"actions": [{"type": "update_field", "config": {"entityType": "document", "field": "status", "value": "published"}}]}},
            {"node_key": "end", "node_type": "end", "name": "结束", "position_x": 1140, "position_y": 200, "sort_order": 6},
        ],
        "edges": [
            {"source": "start", "target": "pm_review"},
            {"source": "pm_review", "target": "gw1"},
            {"source": "gw1", "target": "qa_review", "label": "通过", "condition": {"expression": 'result=="approved"'}},
            {"source": "gw1", "target": "reject", "label": "退回", "condition": {"expression": 'result=="rejected"'}},
            {"source": "qa_review", "target": "archive"},
            {"source": "archive", "target": "end"},
            {"source": "reject", "target": "end"},
        ],
    },
    {
        "key": "design_review",
        "name": "设计评审",
        "description": "产品设计阶段评审：概念评审→详细设计评审→原型验证→量产确认",
        "category": "design_review",
        "entity_type": "dsg_reviews",
        "nodes": [
            {"node_key": "start", "node_type": "start", "name": "开始", "position_x": 60, "position_y": 200, "sort_order": 0},
            {"node_key": "concept_review", "node_type": "approval", "name": "概念评审", "position_x": 280, "position_y": 200, "sort_order": 1,
             "assignee_config": {"assigneeType": "role", "assigneeValue": "设计评审组"},
             "approval_config": {"approvalType": "countersign", "minApprovers": 2},
             "form_config": {"fields": ["design_concept", "feasibility", "risk_items"]}},
            {"node_key": "gw_concept", "node_type": "exclusive_gateway", "name": "概念评审结果", "position_x": 480, "position_y": 200, "sort_order": 2},
            {"node_key": "detail_review", "node_type": "approval", "name": "详细设计评审", "position_x": 680, "position_y": 140, "sort_order": 3,
             "assignee_config": {"assigneeType": "role", "assigneeValue": "高级工程师"},
             "form_config": {"fields": ["design_specs", "dfmea", "design_verification_plan"]}},
            {"node_key": "gw_detail", "node_type": "exclusive_gateway", "name": "详设评审结果", "position_x": 880, "position_y": 140, "sort_order": 4},
            {"node_key": "prototype", "node_type": "user_task", "name": "原型验证", "position_x": 1080, "position_y": 80, "sort_order": 5,
             "assignee_config": {"assigneeType": "role", "assigneeValue": "测试工程师"},
             "form_config": {"fields": ["test_results", "dvp_report", "issues_found"]}},
            {"node_key": "production_confirm", "node_type": "approval", "name": "量产确认", "position_x": 1280, "position_y": 80, "sort_order": 6,
             "assignee_config": {"assigneeType": "role", "assigneeValue": "生产经理"},
             "approval_config": {"approvalType": "sequential"},
             "form_config": {"fields": ["production_readiness", "ppap_status", "capacity_plan"]}},
            {"node_key": "end_approved", "node_type": "end", "name": "评审通过", "position_x": 1480, "position_y": 80, "sort_order": 7},
            {"node_key": "rework", "node_type": "user_task", "name": "返工修改", "position_x": 680, "position_y": 300, "sort_order": 8,
             "assignee_config": {"assigneeType": "initiator"}},
            {"node_key": "end_rejected", "node_type": "end", "name": "评审终止", "position_x": 880, "position_y": 300, "sort_order": 9},
        ],
        "edges": [
            {"source": "start", "target": "concept_review"},
            {"source": "concept_review", "target": "gw_concept"},
            {"source": "gw_concept", "target": "detail_review", "label": "通过", "condition": {"expression": 'result=="approved"'}},
            {"source": "gw_concept", "target": "rework", "label": "不通过", "condition": {"expression": 'result=="rejected"'}},
            {"source": "detail_review", "target": "gw_detail"},
            {"source": "gw_detail", "target": "prototype", "label": "通过", "condition": {"expression": 'result=="approved"'}},
            {"source": "gw_detail", "target": "rework", "label": "退回", "condition": {"expression": 'result=="rejected"'}},
            {"source": "prototype", "target": "production_confirm"},
            {"source": "production_confirm", "target": "end_approved"},
            {"source": "rework", "target": "end_rejected"},
        ],
    },
    {
        "key": "deviation_handling",
        "name": "偏差处理",
        "description": "生产偏差处理流程：偏差报告→影响评估→处置决定→跟踪关闭",
        "category": "deviation",
        "entity_type": "chg_requests",
        "nodes": [
            {"node_key": "start", "node_type": "start", "name": "开始", "position_x": 60, "position_y": 220, "sort_order": 0},
            {"node_key": "report", "node_type": "user_task", "name": "偏差报告", "position_x": 260, "position_y": 220, "sort_order": 1,
             "assignee_config": {"assigneeType": "initiator"},
             "form_config": {"fields": ["deviation_description", "detection_point", "affected_quantity", "containment_action"]}},
            {"node_key": "pg_fork", "node_type": "parallel_gateway", "name": "并行评估", "position_x": 460, "position_y": 220, "sort_order": 2,
             "gateway_config": {"gatewayType": "fork"}},
            {"node_key": "safety_assess", "node_type": "approval", "name": "安全影响评估", "position_x": 660, "position_y": 120, "sort_order": 3,
             "assignee_config": {"assigneeType": "role", "assigneeValue": "安全工程师"},
             "form_config": {"fields": ["safety_impact", "asil_level", "iso26262_relevant"]}},
            {"node_key": "quality_assess", "node_type": "approval", "name": "质量影响评估", "position_x": 660, "position_y": 320, "sort_order": 4,
             "assignee_config": {"assigneeType": "role", "assigneeValue": "质量工程师"},
             "form_config": {"fields": ["quality_impact", "customer_impact", "recall_risk"]}},
            {"node_key": "pg_join", "node_type": "parallel_gateway", "name": "汇总", "position_x": 860, "position_y": 220, "sort_order": 5,
             "gateway_config": {"gatewayType": "join"}},
            {"node_key": "disposition", "node_type": "approval", "name": "处置决定", "position_x": 1060, "position_y": 220, "sort_order": 6,
             "assignee_config": {"assigneeType": "role", "assigneeValue": "质量经理"},
             "form_config": {"fields": ["disposition_type", "justification"]}},
            {"node_key": "gw_disp", "node_type": "exclusive_gateway", "name": "处置类型", "position_x": 1260, "position_y": 220, "sort_order": 7},
            {"node_key": "corrective", "node_type": "user_task", "name": "纠正措施", "position_x": 1460, "position_y": 140, "sort_order": 8,
             "assignee_config": {"assigneeType": "role", "assigneeValue": "工艺工程师"},
             "form_config": {"fields": ["root_cause", "corrective_action", "preventive_action", "target_date"]}},
            {"node_key": "effectiveness", "node_type": "approval", "name": "效果验证", "position_x": 1660, "position_y": 140, "sort_order": 9,
             "assignee_config": {"assigneeType": "role", "assigneeValue": "质量工程师"},
             "form_config": {"fields": ["verification_method", "verification_result", "effectiveness_confirmed"]}},
            {"node_key": "direct_close", "node_type": "user_task", "name": "直接关闭(照用)", "position_x": 1460, "position_y": 320, "sort_order": 10,
             "assignee_config": {"assigneeType": "role", "assigneeValue": "质量经理"},
             "form_config": {"fields": ["use_as_is_justification", "customer_approval"]}},
            {"node_key": "close", "node_type": "service_task", "name": "关闭偏差", "position_x": 1860, "position_y": 220, "sort_order": 11,
             "action_config": {"actions": [{"type": "update_field", "config": {"entityType": "change_request", "field": "status", "value": "closed"}}]}},
            {"node_key": "end", "node_type": "end", "name": "结束", "position_x": 2040, "position_y": 220, "sort_order": 12},
        ],
        "edges": [
            {"source": "start", "target": "report"},
            {"source": "report", "target": "pg_fork"},
            {"source": "pg_fork", "target": "safety_assess"},
            {"source": "pg_fork", "target": "quality_assess"},
            {"source": "safety_assess", "target": "pg_join"},
            {"source": "quality_assess", "target": "pg_join"},
            {"source": "pg_join", "target": "disposition"},
            {"source": "disposition", "target": "gw_disp"},
            {"source": "gw_disp", "target": "corrective", "label": "需纠正措施",
             "condition": {"expression": 'disposition_type!="use_as_is"'}},
            {"source": "gw_disp", "target": "direct_close", "label": "照用处置",
             "condition": {"expression": 'disposition_type=="use_as_is"'}},
            {"source": "corrective", "target": "effectiveness"},
            {"source": "effectiveness", "target": "close"},
            {"source": "direct_close", "target": "close"},
            {"source": "close", "target": "end"},
        ],
    },
    # ── SYS.1 Requirement Elicitation ──
    {
        "key": "req_elicitation_confirm_workflow",
        "name": "需求挖掘确认审批",
        "description": "SYS.1 需求挖掘条目确认流程：发起审批→需求确认→通过/驳回。",
        "category": "req_elicitation_confirm",
        "entity_type": "pdd_req_elicitation_items",
        "entity_view_config": {
            "fields": [
                {"key": "title", "label": "需求标题"},
                {"key": "category_label", "label": "分类"},
                {"key": "priority_label", "label": "优先级"},
                {"key": "status_label", "label": "状态"},
                {"key": "content", "label": "需求内容"},
                {"key": "source_chapter", "label": "来源章节"},
                {"key": "program_name", "label": "所属项目"},
            ],
        },
        "nodes": [
            {"node_key": "start", "node_type": "start", "name": "开始", "position_x": 60, "position_y": 180, "sort_order": 0},
            {"node_key": "review", "node_type": "approval", "name": "需求确认审批", "position_x": 320, "position_y": 180, "sort_order": 1,
             "assignee_config": {"assigneeType": "initiator"},
             "approval_config": {"approvalType": "sequential"}},
            {"node_key": "gw_review", "node_type": "exclusive_gateway", "name": "审批结果", "position_x": 580, "position_y": 180, "sort_order": 2},
            {"node_key": "end_ok", "node_type": "end", "name": "确认通过", "position_x": 840, "position_y": 100, "sort_order": 3},
            {"node_key": "end_reject", "node_type": "end", "name": "确认驳回", "position_x": 840, "position_y": 260, "sort_order": 4},
        ],
        "edges": [
            {"source": "start", "target": "review"},
            {"source": "review", "target": "gw_review"},
            {"source": "gw_review", "target": "end_ok", "label": "通过", "condition": {"expression": 'result=="approved"'}},
            {"source": "gw_review", "target": "end_reject", "label": "驳回", "condition": {"expression": 'result=="rejected"'}},
        ],
    },
    # ── SYS.2 System Requirement Review ──
    {
        "key": "sys_req_review_workflow",
        "name": "系统需求评审审批",
        "description": "SYS.2 系统需求评审流程：提交评审→系统需求确认→通过/驳回。",
        "category": "sys_req_review",
        "entity_type": "pdd_sys_requirements",
        "nodes": [
            {"node_key": "start", "node_type": "start", "name": "开始", "position_x": 60, "position_y": 180, "sort_order": 0},
            {"node_key": "review", "node_type": "approval", "name": "系统需求评审", "position_x": 320, "position_y": 180, "sort_order": 1,
             "assignee_config": {"assigneeType": "initiator"},
             "approval_config": {"approvalType": "sequential"}},
            {"node_key": "gw_review", "node_type": "exclusive_gateway", "name": "评审结果", "position_x": 580, "position_y": 180, "sort_order": 2},
            {"node_key": "end_ok", "node_type": "end", "name": "评审通过", "position_x": 840, "position_y": 100, "sort_order": 3},
            {"node_key": "end_reject", "node_type": "end", "name": "评审驳回", "position_x": 840, "position_y": 260, "sort_order": 4},
        ],
        "edges": [
            {"source": "start", "target": "review"},
            {"source": "review", "target": "gw_review"},
            {"source": "gw_review", "target": "end_ok", "label": "通过", "condition": {"expression": 'result=="approved"'}},
            {"source": "gw_review", "target": "end_reject", "label": "驳回", "condition": {"expression": 'result=="rejected"'}},
        ],
    },
    # ── SYS.4 System Integration Test Review ──
    {
        "key": "sys_int_test_review_workflow",
        "name": "系统集成测试计划评审审批",
        "description": "SYS.4 系统集成测试计划评审流程：提交评审→测试计划确认→通过/驳回。",
        "category": "sys_int_test_review",
        "entity_type": "pdd_sys_int_test_plans",
        "nodes": [
            {"node_key": "start", "node_type": "start", "name": "开始", "position_x": 60, "position_y": 180, "sort_order": 0},
            {"node_key": "review", "node_type": "approval", "name": "系统集成测试计划评审", "position_x": 320, "position_y": 180, "sort_order": 1,
             "assignee_config": {"assigneeType": "initiator"},
             "approval_config": {"approvalType": "sequential"}},
            {"node_key": "gw_review", "node_type": "exclusive_gateway", "name": "评审结果", "position_x": 580, "position_y": 180, "sort_order": 2},
            {"node_key": "end_ok", "node_type": "end", "name": "评审通过", "position_x": 840, "position_y": 100, "sort_order": 3},
            {"node_key": "end_reject", "node_type": "end", "name": "评审驳回", "position_x": 840, "position_y": 260, "sort_order": 4},
        ],
        "edges": [
            {"source": "start", "target": "review"},
            {"source": "review", "target": "gw_review"},
            {"source": "gw_review", "target": "end_ok", "label": "通过", "condition": {"expression": 'result=="approved"'}},
            {"source": "gw_review", "target": "end_reject", "label": "驳回", "condition": {"expression": 'result=="rejected"'}},
        ],
    },
    # ── SYS.5 System Qualification Test Review ──
    {
        "key": "sys_qual_test_review_workflow",
        "name": "系统合格性测试计划评审审批",
        "description": "SYS.5 系统合格性测试计划评审流程：提交评审→合格性测试计划确认→通过/驳回。",
        "category": "sys_qual_test_review",
        "entity_type": "pdd_sys_qual_test_plans",
        "nodes": [
            {"node_key": "start", "node_type": "start", "name": "开始", "position_x": 60, "position_y": 180, "sort_order": 0},
            {"node_key": "review", "node_type": "approval", "name": "系统合格性测试计划评审", "position_x": 320, "position_y": 180, "sort_order": 1,
             "assignee_config": {"assigneeType": "initiator"},
             "approval_config": {"approvalType": "sequential"}},
            {"node_key": "gw_review", "node_type": "exclusive_gateway", "name": "评审结果", "position_x": 580, "position_y": 180, "sort_order": 2},
            {"node_key": "end_ok", "node_type": "end", "name": "评审通过", "position_x": 840, "position_y": 100, "sort_order": 3},
            {"node_key": "end_reject", "node_type": "end", "name": "评审驳回", "position_x": 840, "position_y": 260, "sort_order": 4},
        ],
        "edges": [
            {"source": "start", "target": "review"},
            {"source": "review", "target": "gw_review"},
            {"source": "gw_review", "target": "end_ok", "label": "通过", "condition": {"expression": 'result=="approved"'}},
            {"source": "gw_review", "target": "end_reject", "label": "驳回", "condition": {"expression": 'result=="rejected"'}},
        ],
    },
    # ── SWE.1 Software Requirement Review ──
    {
        "key": "swe_req_review_workflow",
        "name": "软件需求评审审批",
        "description": "SWE.1 软件需求评审流程：提交评审→软件需求确认→通过/驳回。",
        "category": "swe_req_review",
        "entity_type": "pdd_swe_requirements",
        "nodes": [
            {"node_key": "start", "node_type": "start", "name": "开始", "position_x": 60, "position_y": 180, "sort_order": 0},
            {"node_key": "review", "node_type": "approval", "name": "软件需求评审", "position_x": 320, "position_y": 180, "sort_order": 1,
             "assignee_config": {"assigneeType": "initiator"},
             "approval_config": {"approvalType": "sequential"}},
            {"node_key": "gw_review", "node_type": "exclusive_gateway", "name": "评审结果", "position_x": 580, "position_y": 180, "sort_order": 2},
            {"node_key": "end_ok", "node_type": "end", "name": "评审通过", "position_x": 840, "position_y": 100, "sort_order": 3},
            {"node_key": "end_reject", "node_type": "end", "name": "评审驳回", "position_x": 840, "position_y": 260, "sort_order": 4},
        ],
        "edges": [
            {"source": "start", "target": "review"},
            {"source": "review", "target": "gw_review"},
            {"source": "gw_review", "target": "end_ok", "label": "通过", "condition": {"expression": 'result=="approved"'}},
            {"source": "gw_review", "target": "end_reject", "label": "驳回", "condition": {"expression": 'result=="rejected"'}},
        ],
    },
    # ── SWE.2 Software Architecture Review ──
    {
        "key": "swe_arch_review_workflow",
        "name": "软件架构评审审批",
        "description": "SWE.2 软件架构评审流程：提交评审→软件架构确认→通过/驳回。",
        "category": "swe_arch_review",
        "entity_type": "pdd_sw_architectures",
        "nodes": [
            {"node_key": "start", "node_type": "start", "name": "开始", "position_x": 60, "position_y": 180, "sort_order": 0},
            {"node_key": "review", "node_type": "approval", "name": "软件架构评审", "position_x": 320, "position_y": 180, "sort_order": 1,
             "assignee_config": {"assigneeType": "initiator"},
             "approval_config": {"approvalType": "sequential"}},
            {"node_key": "gw_review", "node_type": "exclusive_gateway", "name": "评审结果", "position_x": 580, "position_y": 180, "sort_order": 2},
            {"node_key": "end_ok", "node_type": "end", "name": "评审通过", "position_x": 840, "position_y": 100, "sort_order": 3},
            {"node_key": "end_reject", "node_type": "end", "name": "评审驳回", "position_x": 840, "position_y": 260, "sort_order": 4},
        ],
        "edges": [
            {"source": "start", "target": "review"},
            {"source": "review", "target": "gw_review"},
            {"source": "gw_review", "target": "end_ok", "label": "通过", "condition": {"expression": 'result=="approved"'}},
            {"source": "gw_review", "target": "end_reject", "label": "驳回", "condition": {"expression": 'result=="rejected"'}},
        ],
    },
    # ── SWE.3 Software Detail Review ──
    {
        "key": "swe_detail_review_workflow",
        "name": "软件详细设计评审审批",
        "description": "SWE.3 软件详细设计评审流程：提交评审→详细设计确认→通过/驳回。",
        "category": "swe_detail_review",
        "entity_type": "pdd_sw_functions",
        "nodes": [
            {"node_key": "start", "node_type": "start", "name": "开始", "position_x": 60, "position_y": 180, "sort_order": 0},
            {"node_key": "review", "node_type": "approval", "name": "软件详细设计评审", "position_x": 320, "position_y": 180, "sort_order": 1,
             "assignee_config": {"assigneeType": "initiator"},
             "approval_config": {"approvalType": "sequential"}},
            {"node_key": "gw_review", "node_type": "exclusive_gateway", "name": "评审结果", "position_x": 580, "position_y": 180, "sort_order": 2},
            {"node_key": "end_ok", "node_type": "end", "name": "评审通过", "position_x": 840, "position_y": 100, "sort_order": 3},
            {"node_key": "end_reject", "node_type": "end", "name": "评审驳回", "position_x": 840, "position_y": 260, "sort_order": 4},
        ],
        "edges": [
            {"source": "start", "target": "review"},
            {"source": "review", "target": "gw_review"},
            {"source": "gw_review", "target": "end_ok", "label": "通过", "condition": {"expression": 'result=="approved"'}},
            {"source": "gw_review", "target": "end_reject", "label": "驳回", "condition": {"expression": 'result=="rejected"'}},
        ],
    },
    # ── SWE.4 Software Unit Verification Review ──
    {
        "key": "swe_unit_review_workflow",
        "name": "软件单元验证评审审批",
        "description": "SWE.4 软件单元验证评审流程：提交评审→验证计划确认→通过/驳回。",
        "category": "swe_unit_review",
        "entity_type": "pdd_sw_unit_ver_plans",
        "nodes": [
            {"node_key": "start", "node_type": "start", "name": "开始", "position_x": 60, "position_y": 180, "sort_order": 0},
            {"node_key": "review", "node_type": "approval", "name": "软件单元验证评审", "position_x": 320, "position_y": 180, "sort_order": 1,
             "assignee_config": {"assigneeType": "initiator"},
             "approval_config": {"approvalType": "sequential"}},
            {"node_key": "gw_review", "node_type": "exclusive_gateway", "name": "评审结果", "position_x": 580, "position_y": 180, "sort_order": 2},
            {"node_key": "end_ok", "node_type": "end", "name": "评审通过", "position_x": 840, "position_y": 100, "sort_order": 3},
            {"node_key": "end_reject", "node_type": "end", "name": "评审驳回", "position_x": 840, "position_y": 260, "sort_order": 4},
        ],
        "edges": [
            {"source": "start", "target": "review"},
            {"source": "review", "target": "gw_review"},
            {"source": "gw_review", "target": "end_ok", "label": "通过", "condition": {"expression": 'result=="approved"'}},
            {"source": "gw_review", "target": "end_reject", "label": "驳回", "condition": {"expression": 'result=="rejected"'}},
        ],
    },
    # ── SWE.5 Software Integration Review ──
    {
        "key": "swe_integration_review_workflow",
        "name": "软件集成测试评审审批",
        "description": "SWE.5 软件集成测试评审流程：提交评审→集成测试计划确认→通过/驳回。",
        "category": "swe_integration_review",
        "entity_type": "pdd_sw_int_test_plans",
        "nodes": [
            {"node_key": "start", "node_type": "start", "name": "开始", "position_x": 60, "position_y": 180, "sort_order": 0},
            {"node_key": "review", "node_type": "approval", "name": "软件集成测试评审", "position_x": 320, "position_y": 180, "sort_order": 1,
             "assignee_config": {"assigneeType": "initiator"},
             "approval_config": {"approvalType": "sequential"}},
            {"node_key": "gw_review", "node_type": "exclusive_gateway", "name": "评审结果", "position_x": 580, "position_y": 180, "sort_order": 2},
            {"node_key": "end_ok", "node_type": "end", "name": "评审通过", "position_x": 840, "position_y": 100, "sort_order": 3},
            {"node_key": "end_reject", "node_type": "end", "name": "评审驳回", "position_x": 840, "position_y": 260, "sort_order": 4},
        ],
        "edges": [
            {"source": "start", "target": "review"},
            {"source": "review", "target": "gw_review"},
            {"source": "gw_review", "target": "end_ok", "label": "通过", "condition": {"expression": 'result=="approved"'}},
            {"source": "gw_review", "target": "end_reject", "label": "驳回", "condition": {"expression": 'result=="rejected"'}},
        ],
    },
    # ── SWE.6 Software Qualification Review ──
    {
        "key": "swe_qualification_review_workflow",
        "name": "软件合格性测试评审审批",
        "description": "SWE.6 软件合格性测试评审流程：提交评审→合格性测试计划确认→通过/驳回。",
        "category": "swe_qualification_review",
        "entity_type": "pdd_sw_qual_test_plans",
        "nodes": [
            {"node_key": "start", "node_type": "start", "name": "开始", "position_x": 60, "position_y": 180, "sort_order": 0},
            {"node_key": "review", "node_type": "approval", "name": "软件合格性测试评审", "position_x": 320, "position_y": 180, "sort_order": 1,
             "assignee_config": {"assigneeType": "initiator"},
             "approval_config": {"approvalType": "sequential"}},
            {"node_key": "gw_review", "node_type": "exclusive_gateway", "name": "评审结果", "position_x": 580, "position_y": 180, "sort_order": 2},
            {"node_key": "end_ok", "node_type": "end", "name": "评审通过", "position_x": 840, "position_y": 100, "sort_order": 3},
            {"node_key": "end_reject", "node_type": "end", "name": "评审驳回", "position_x": 840, "position_y": 260, "sort_order": 4},
        ],
        "edges": [
            {"source": "start", "target": "review"},
            {"source": "review", "target": "gw_review"},
            {"source": "gw_review", "target": "end_ok", "label": "通过", "condition": {"expression": 'result=="approved"'}},
            {"source": "gw_review", "target": "end_reject", "label": "驳回", "condition": {"expression": 'result=="rejected"'}},
        ],
    },
    # ── Problem Management (SUP.9) ──
    {
        "key": "prb_problem_intake_workflow",
        "name": "问题获取审批",
        "description": "SUP.9 问题获取阶段流程：问题登记→完整性检查→立项受理→进入已记录状态。",
        "category": "problem_management",
        "entity_type": "prb_problem_intake",
        "nodes": [
            {"node_key": "start", "node_type": "start", "name": "开始", "position_x": 60, "position_y": 180, "sort_order": 0},
            {"node_key": "record", "node_type": "user_task", "name": "问题登记", "position_x": 260, "position_y": 180, "sort_order": 1,
             "assignee_config": {"assigneeType": "initiator"},
             "form_config": {"fields": ["title", "description", "category", "urgency", "reported_by", "problem_object", "evidence_files", "introduction_process"]}},
            {"node_key": "review", "node_type": "approval", "name": "完整性检查", "position_x": 520, "position_y": 180, "sort_order": 2,
             "assignee_config": {"assigneeType": "role", "assigneeValue": "质量工程师"},
             "form_config": {"fields": ["containment_action", "severity", "triage_required", "customer_visible"]}},
            {"node_key": "gw_review", "node_type": "exclusive_gateway", "name": "检查结果", "position_x": 760, "position_y": 180, "sort_order": 3},
            {"node_key": "supplement", "node_type": "user_task", "name": "补充资料", "position_x": 980, "position_y": 320, "sort_order": 4,
             "assignee_config": {"assigneeType": "initiator"},
             "form_config": {"fields": ["supplement_notes", "updated_evidence"]}},
            {"node_key": "accept", "node_type": "approval", "name": "立项受理", "position_x": 980, "position_y": 80, "sort_order": 5,
             "assignee_config": {"assigneeType": "role", "assigneeValue": "项目经理"},
             "form_config": {"fields": ["assigned_to", "target_response_date", "cross_function_team"]},
             "approval_config": {"approvalType": "sequential"}},
            {"node_key": "end", "node_type": "end", "name": "完成", "position_x": 1220, "position_y": 180, "sort_order": 6},
        ],
        "edges": [
            {"source": "start", "target": "record"},
            {"source": "record", "target": "review"},
            {"source": "review", "target": "gw_review"},
            {"source": "gw_review", "target": "accept", "label": "通过", "condition": {"expression": 'result=="approved"'}},
            {"source": "gw_review", "target": "supplement", "label": "补充", "condition": {"expression": 'result=="rejected"'}},
            {"source": "accept", "target": "end"},
            {"source": "supplement", "target": "end"},
        ],
    },
    {
        "key": "prb_problem_triage_workflow",
        "name": "问题分析追溯",
        "description": "SUP.9 分析追溯阶段流程：分派责任→并行影响评估→跨部门评审→形成分析结论。",
        "category": "problem_management",
        "entity_type": "prb_problem_triage",
        "nodes": [
            {"node_key": "start", "node_type": "start", "name": "开始", "position_x": 60, "position_y": 220, "sort_order": 0},
            {"node_key": "assign", "node_type": "user_task", "name": "分派责任人", "position_x": 260, "position_y": 220, "sort_order": 1,
             "assignee_config": {"assigneeType": "role", "assigneeValue": "项目经理"},
             "form_config": {"fields": ["assigned_to", "planned_completion_date", "introduction_process"]}},
            {"node_key": "pg_fork", "node_type": "parallel_gateway", "name": "并行分析", "position_x": 500, "position_y": 220, "sort_order": 2,
             "gateway_config": {"gatewayType": "fork"}},
            {"node_key": "analysis", "node_type": "user_task", "name": "根因分析", "position_x": 720, "position_y": 120, "sort_order": 3,
             "assignee_config": {"assigneeType": "role", "assigneeValue": "技术负责人"},
             "form_config": {"fields": ["root_cause", "affected_modules", "traceability_notes"]}},
            {"node_key": "impact", "node_type": "approval", "name": "影响评估", "position_x": 720, "position_y": 320, "sort_order": 4,
             "assignee_config": {"assigneeType": "role", "assigneeValue": "质量工程师"},
             "form_config": {"fields": ["impact", "severity", "customer_risk", "safety_risk"]}},
            {"node_key": "pg_join", "node_type": "parallel_gateway", "name": "分析汇总", "position_x": 940, "position_y": 220, "sort_order": 5,
             "gateway_config": {"gatewayType": "join"}},
            {"node_key": "triage_board", "node_type": "approval", "name": "跨部门评审", "position_x": 1160, "position_y": 220, "sort_order": 6,
             "assignee_config": {"assigneeType": "role", "assigneeValue": "问题评审组"},
             "approval_config": {"approvalType": "countersign", "minApprovers": 2},
             "form_config": {"fields": ["resolution_path", "required_actions", "change_needed"]}},
            {"node_key": "gw_triage", "node_type": "exclusive_gateway", "name": "评审结论", "position_x": 1380, "position_y": 220, "sort_order": 7},
            {"node_key": "rework", "node_type": "user_task", "name": "补充分析", "position_x": 1600, "position_y": 320, "sort_order": 8,
             "assignee_config": {"assigneeType": "role", "assigneeValue": "技术负责人"},
             "form_config": {"fields": ["rework_reason", "followup_owner"]}},
            {"node_key": "end", "node_type": "end", "name": "完成", "position_x": 1600, "position_y": 120, "sort_order": 9},
        ],
        "edges": [
            {"source": "start", "target": "assign"},
            {"source": "assign", "target": "pg_fork"},
            {"source": "pg_fork", "target": "analysis"},
            {"source": "pg_fork", "target": "impact"},
            {"source": "analysis", "target": "pg_join"},
            {"source": "impact", "target": "pg_join"},
            {"source": "pg_join", "target": "triage_board"},
            {"source": "triage_board", "target": "gw_triage"},
            {"source": "gw_triage", "target": "end", "label": "通过", "condition": {"expression": 'result=="approved"'}},
            {"source": "gw_triage", "target": "rework", "label": "补充", "condition": {"expression": 'result=="rejected"'}},
            {"source": "rework", "target": "end"},
        ],
    },
    {
        "key": "prb_problem_fix_workflow",
        "name": "问题决策与修复",
        "description": "SUP.9 决策与计划阶段流程：制定措施→实施修复→配置留痕→修复闸口审批。",
        "category": "problem_management",
        "entity_type": "prb_problem_fix",
        "nodes": [
            {"node_key": "start", "node_type": "start", "name": "开始", "position_x": 60, "position_y": 220, "sort_order": 0},
            {"node_key": "plan", "node_type": "user_task", "name": "制定修复计划", "position_x": 260, "position_y": 220, "sort_order": 1,
             "assignee_config": {"assigneeType": "role", "assigneeValue": "责任工程师"},
             "form_config": {"fields": ["corrective_action", "preventive_action", "output_artifacts", "planned_completion_date", "rollback_plan"]}},
            {"node_key": "decision", "node_type": "approval", "name": "修复方案审批", "position_x": 520, "position_y": 220, "sort_order": 2,
             "assignee_config": {"assigneeType": "role", "assigneeValue": "部门经理"},
             "form_config": {"fields": ["decision_comment", "resource_commitment", "implementation_owner"]}},
            {"node_key": "pg_fork", "node_type": "parallel_gateway", "name": "并行执行", "position_x": 760, "position_y": 220, "sort_order": 3,
             "gateway_config": {"gatewayType": "fork"}},
            {"node_key": "implement_fix", "node_type": "user_task", "name": "实施修复", "position_x": 980, "position_y": 120, "sort_order": 4,
             "assignee_config": {"assigneeType": "role", "assigneeValue": "实施负责人"},
             "form_config": {"fields": ["implementation_record", "actual_completion_date", "changed_items"]}},
            {"node_key": "capture_baseline", "node_type": "user_task", "name": "配置留痕", "position_x": 980, "position_y": 320, "sort_order": 5,
             "assignee_config": {"assigneeType": "role", "assigneeValue": "配置管理员"},
             "form_config": {"fields": ["baseline_impacted", "artifact_links", "release_note"]}},
            {"node_key": "pg_join", "node_type": "parallel_gateway", "name": "执行汇总", "position_x": 1200, "position_y": 220, "sort_order": 6,
             "gateway_config": {"gatewayType": "join"}},
            {"node_key": "fix_gate", "node_type": "approval", "name": "修复闸口审批", "position_x": 1420, "position_y": 220, "sort_order": 7,
             "assignee_config": {"assigneeType": "role", "assigneeValue": "技术负责人"},
             "form_config": {"fields": ["execution_summary", "residual_risk"]}},
            {"node_key": "gw_fix", "node_type": "exclusive_gateway", "name": "审批结果", "position_x": 1640, "position_y": 220, "sort_order": 8},
            {"node_key": "replan", "node_type": "user_task", "name": "重新规划", "position_x": 1860, "position_y": 320, "sort_order": 9,
             "assignee_config": {"assigneeType": "role", "assigneeValue": "责任工程师"},
             "form_config": {"fields": ["replan_reason", "new_target_date"]}},
            {"node_key": "end", "node_type": "end", "name": "完成", "position_x": 1860, "position_y": 120, "sort_order": 10},
        ],
        "edges": [
            {"source": "start", "target": "plan"},
            {"source": "plan", "target": "decision"},
            {"source": "decision", "target": "pg_fork"},
            {"source": "pg_fork", "target": "implement_fix"},
            {"source": "pg_fork", "target": "capture_baseline"},
            {"source": "implement_fix", "target": "pg_join"},
            {"source": "capture_baseline", "target": "pg_join"},
            {"source": "pg_join", "target": "fix_gate"},
            {"source": "fix_gate", "target": "gw_fix"},
            {"source": "gw_fix", "target": "end", "label": "通过", "condition": {"expression": 'result=="approved"'}},
            {"source": "gw_fix", "target": "replan", "label": "重做", "condition": {"expression": 'result=="rejected"'}},
            {"source": "replan", "target": "end"},
        ],
    },
    {
        "key": "prb_problem_verify_workflow",
        "name": "问题修复验证",
        "description": "SUP.9 修复验证阶段流程：准备验证→执行验证→回归评审→放行确认。",
        "category": "problem_management",
        "entity_type": "prb_problem_verify",
        "nodes": [
            {"node_key": "start", "node_type": "start", "name": "开始", "position_x": 60, "position_y": 220, "sort_order": 0},
            {"node_key": "prepare_verify", "node_type": "user_task", "name": "准备验证", "position_x": 260, "position_y": 220, "sort_order": 1,
             "assignee_config": {"assigneeType": "role", "assigneeValue": "测试工程师"},
             "form_config": {"fields": ["verification_method", "test_scope", "entry_criteria"]}},
            {"node_key": "execute_verify", "node_type": "user_task", "name": "执行验证", "position_x": 520, "position_y": 220, "sort_order": 2,
             "assignee_config": {"assigneeType": "role", "assigneeValue": "测试工程师"},
             "form_config": {"fields": ["verification_result", "actual_completion_date", "defect_escape_check"]}},
            {"node_key": "regression_review", "node_type": "approval", "name": "回归评审", "position_x": 780, "position_y": 220, "sort_order": 3,
             "assignee_config": {"assigneeType": "role", "assigneeValue": "质量经理"},
             "form_config": {"fields": ["regression_result", "customer_retest_required"]}},
            {"node_key": "release_confirm", "node_type": "approval", "name": "放行确认", "position_x": 1040, "position_y": 220, "sort_order": 4,
             "assignee_config": {"assigneeType": "role", "assigneeValue": "项目经理"},
             "approval_config": {"approvalType": "sequential"},
             "form_config": {"fields": ["release_readiness", "remaining_risks"]}},
            {"node_key": "gw_verify", "node_type": "exclusive_gateway", "name": "确认结果", "position_x": 1300, "position_y": 220, "sort_order": 5},
            {"node_key": "rework", "node_type": "user_task", "name": "重新修复", "position_x": 1520, "position_y": 320, "sort_order": 6,
             "assignee_config": {"assigneeType": "role", "assigneeValue": "责任工程师"},
             "form_config": {"fields": ["reopen_reason", "followup_owner"]}},
            {"node_key": "end", "node_type": "end", "name": "完成", "position_x": 1520, "position_y": 120, "sort_order": 7},
        ],
        "edges": [
            {"source": "start", "target": "prepare_verify"},
            {"source": "prepare_verify", "target": "execute_verify"},
            {"source": "execute_verify", "target": "regression_review"},
            {"source": "regression_review", "target": "release_confirm"},
            {"source": "release_confirm", "target": "gw_verify"},
            {"source": "gw_verify", "target": "end", "label": "通过", "condition": {"expression": 'result=="approved"'}},
            {"source": "gw_verify", "target": "rework", "label": "返工", "condition": {"expression": 'result=="rejected"'}},
            {"source": "rework", "target": "end"},
        ],
    },
    {
        "key": "prb_problem_close_workflow",
        "name": "问题关闭归档",
        "description": "SUP.9 关闭阶段流程：关闭评审→归档确认→度量沉淀→最终关闭批准。",
        "category": "problem_management",
        "entity_type": "prb_problem_close",
        "nodes": [
            {"node_key": "start", "node_type": "start", "name": "开始", "position_x": 60, "position_y": 220, "sort_order": 0},
            {"node_key": "close_review", "node_type": "approval", "name": "关闭评审", "position_x": 280, "position_y": 220, "sort_order": 1,
             "assignee_config": {"assigneeType": "role", "assigneeValue": "项目经理"},
             "form_config": {"fields": ["close_date", "remarks", "related_change_ids", "lessons_summary"]}},
            {"node_key": "archive", "node_type": "user_task", "name": "归档确认", "position_x": 560, "position_y": 220, "sort_order": 2,
             "assignee_config": {"assigneeType": "role", "assigneeValue": "配置管理员"},
             "form_config": {"fields": ["output_artifacts", "archive_location"]}},
            {"node_key": "metrics", "node_type": "user_task", "name": "度量沉淀", "position_x": 840, "position_y": 220, "sort_order": 3,
             "assignee_config": {"assigneeType": "role", "assigneeValue": "质量工程师"},
             "form_config": {"fields": ["closure_code", "lead_time_days", "recurrence_prevention"]}},
            {"node_key": "final_approval", "node_type": "approval", "name": "最终关闭批准", "position_x": 1120, "position_y": 220, "sort_order": 4,
             "assignee_config": {"assigneeType": "role", "assigneeValue": "部门经理"},
             "approval_config": {"approvalType": "sequential"},
             "form_config": {"fields": ["customer_notification", "knowledge_base_sync"]}},
            {"node_key": "gw_close", "node_type": "exclusive_gateway", "name": "批准结果", "position_x": 1380, "position_y": 220, "sort_order": 5},
            {"node_key": "reopen", "node_type": "user_task", "name": "重新打开", "position_x": 1600, "position_y": 320, "sort_order": 6,
             "assignee_config": {"assigneeType": "role", "assigneeValue": "项目经理"},
             "form_config": {"fields": ["reopen_reason", "followup_owner"]}},
            {"node_key": "end", "node_type": "end", "name": "完成", "position_x": 1600, "position_y": 120, "sort_order": 7},
        ],
        "edges": [
            {"source": "start", "target": "close_review"},
            {"source": "close_review", "target": "archive"},
            {"source": "archive", "target": "metrics"},
            {"source": "metrics", "target": "final_approval"},
            {"source": "final_approval", "target": "gw_close"},
            {"source": "gw_close", "target": "end", "label": "通过", "condition": {"expression": 'result=="approved"'}},
            {"source": "gw_close", "target": "reopen", "label": "重开", "condition": {"expression": 'result=="rejected"'}},
            {"source": "reopen", "target": "end"},
        ],
    },
    {
        "key": "product_demand_approval",
        "name": "样件需求审批",
        "description": "样件需求的审批确认流程：提交→审批→通过/退回",
        "category": "product_demand",
        "entity_type": "prj_product_demands",
        "nodes": [
            {"node_key": "start", "node_type": "start", "name": "开始", "position_x": 60, "position_y": 200, "sort_order": 0},
            {"node_key": "demand_approval", "node_type": "approval", "name": "样件需求审批", "position_x": 300, "position_y": 200, "sort_order": 1,
             "assignee_config": {"assignee_type": "initiator"},
             "approval_config": {"reject_action": "terminate"}},
            {"node_key": "end_ok", "node_type": "end", "name": "审批通过", "position_x": 550, "position_y": 200, "sort_order": 2}
        ],
        "edges": [
            {"source": "start", "target": "demand_approval"},
            {"source": "demand_approval", "target": "end_ok"}
        ]
    },
    # ── P5-T08: 工艺设计审批模板（单步审批） ──
    {
        "key": "prc_designs_approval",
        "name": "工艺设计审批",
        "description": "工艺设计发布审批流程：提交→工艺审批人审批→通过/退回。审批通过后自动将旧版本标记为作废，并触发关联控制计划联动。",
        "category": "process",
        "entity_type": "prc_designs",
        "nodes": [
            {"node_key": "start", "node_type": "start", "name": "开始", "position_x": 60, "position_y": 200, "sort_order": 0},
            {"node_key": "review", "node_type": "approval", "name": "工艺审批", "position_x": 300, "position_y": 200, "sort_order": 1,
             "assignee_config": {"assigneeType": "role", "assigneeValue": "process_manager"},
             "approval_config": {"approvalType": "sequential", "reject_action": "back_to_start"},
             "form_config": {"fields": ["review_comment", "approval_result"]}},
            {"node_key": "gw_result", "node_type": "exclusive_gateway", "name": "审批结果", "position_x": 560, "position_y": 200, "sort_order": 2},
            {"node_key": "end_approved", "node_type": "end", "name": "审批通过", "position_x": 800, "position_y": 120, "sort_order": 3},
            {"node_key": "end_rejected", "node_type": "end", "name": "退回修改", "position_x": 800, "position_y": 300, "sort_order": 4},
        ],
        "edges": [
            {"source": "start", "target": "review"},
            {"source": "review", "target": "gw_result"},
            {"source": "gw_result", "target": "end_approved", "label": "通过", "condition": {"expression": 'result=="approved"'}},
            {"source": "gw_result", "target": "end_rejected", "label": "退回", "condition": {"expression": 'result=="rejected"'}},
        ],
    },
    # ── P5-T09: 控制计划审批模板（双步审批） ──
    {
        "key": "prc_control_plan_approval",
        "name": "控制计划审批",
        "description": "控制计划审批流程：提交→质量工程师评审→工艺审批人批准→通过/退回。审批通过后状态变为 Approved，需手动发布为 Released。",
        "category": "process",
        "entity_type": "prc_control_plans",
        "nodes": [
            {"node_key": "start", "node_type": "start", "name": "开始", "position_x": 60, "position_y": 200, "sort_order": 0},
            {"node_key": "quality_review", "node_type": "approval", "name": "质量评审", "position_x": 280, "position_y": 200, "sort_order": 1,
             "assignee_config": {"assigneeType": "role", "assigneeValue": "quality_engineer"},
             "approval_config": {"approvalType": "sequential"},
             "form_config": {"fields": ["quality_review_comment", "kpc_kcc_check_result"]}},
            {"node_key": "process_approval", "node_type": "approval", "name": "工艺批准", "position_x": 560, "position_y": 200, "sort_order": 2,
             "assignee_config": {"assigneeType": "role", "assigneeValue": "process_manager"},
             "approval_config": {"approvalType": "sequential", "reject_action": "back_to_start"},
             "form_config": {"fields": ["approval_comment", "approval_result"]}},
            {"node_key": "gw_result", "node_type": "exclusive_gateway", "name": "审批结果", "position_x": 840, "position_y": 200, "sort_order": 3},
            {"node_key": "end_approved", "node_type": "end", "name": "审批通过", "position_x": 1100, "position_y": 120, "sort_order": 4},
            {"node_key": "end_rejected", "node_type": "end", "name": "退回修改", "position_x": 1100, "position_y": 300, "sort_order": 5},
        ],
        "edges": [
            {"source": "start", "target": "quality_review"},
            {"source": "quality_review", "target": "process_approval"},
            {"source": "process_approval", "target": "gw_result"},
            {"source": "gw_result", "target": "end_approved", "label": "通过", "condition": {"expression": 'result=="approved"'}},
            {"source": "gw_result", "target": "end_rejected", "label": "退回", "condition": {"expression": 'result=="rejected"'}},
        ],
    },
    # ── 作业指导书审批 ──
    {
        "key": "prc_work_instruction_approval",
        "name": "作业指导书审批",
        "description": "作业指导书正式审批：提交→工艺审核→质量批准→通过/退回。审批通过后状态变为 Approved，需手动发布为 Released。",
        "category": "process",
        "entity_type": "prc_work_instructions",
        "entity_view_config": {
            "fields": [
                {"key": "wi_number", "label": "文件编号"},
                {"key": "title", "label": "标题"},
                {"key": "version", "label": "版本"},
                {"key": "design_name", "label": "所属工艺"},
                {"key": "status_label", "label": "状态"},
                {"key": "prepared_by_name", "label": "编制人"},
            ],
        },
        "nodes": [
            {"node_key": "start", "node_type": "start", "name": "开始", "position_x": 60, "position_y": 200, "sort_order": 0},
            {"node_key": "process_review", "node_type": "approval", "name": "工艺审核", "position_x": 280, "position_y": 200, "sort_order": 1,
             "assignee_config": {"assigneeType": "role", "assigneeValue": "process_manager"},
             "approval_config": {"approvalType": "sequential"},
             "form_config": {"fields": ["review_comment", "process_check_result"]}},
            {"node_key": "quality_approval", "node_type": "approval", "name": "质量批准", "position_x": 560, "position_y": 200, "sort_order": 2,
             "assignee_config": {"assigneeType": "role", "assigneeValue": "quality_engineer"},
             "approval_config": {"approvalType": "sequential", "reject_action": "back_to_start"},
             "form_config": {"fields": ["approval_comment", "approval_result"]}},
            {"node_key": "gw_result", "node_type": "exclusive_gateway", "name": "审批结果", "position_x": 840, "position_y": 200, "sort_order": 3},
            {"node_key": "end_approved", "node_type": "end", "name": "审批通过", "position_x": 1100, "position_y": 120, "sort_order": 4},
            {"node_key": "end_rejected", "node_type": "end", "name": "退回修改", "position_x": 1100, "position_y": 300, "sort_order": 5},
        ],
        "edges": [
            {"source": "start", "target": "process_review"},
            {"source": "process_review", "target": "quality_approval"},
            {"source": "quality_approval", "target": "gw_result"},
            {"source": "gw_result", "target": "end_approved", "label": "通过", "condition": {"expression": 'result=="approved"'}},
            {"source": "gw_result", "target": "end_rejected", "label": "退回", "condition": {"expression": 'result=="rejected"'}},
        ],
    },
    # ── PFMEA 主表审批（对齐作业指导书） ──
    {
        "key": "prc_pfmea_master_approval",
        "name": "PFMEA主表审批",
        "description": "PFMEA 主表正式审批：提交→工艺审核→质量批准→通过/退回。审批通过后状态变为 approved，需手动发布为 released。",
        "category": "process",
        "entity_type": "prc_pfmea_masters",
        "entity_view_config": {
            "fields": [
                {"key": "pfmea_no", "label": "PFMEA编号"},
                {"key": "title", "label": "标题"},
                {"key": "version", "label": "版本"},
                {"key": "design_name", "label": "所属工艺"},
                {"key": "status_label", "label": "状态"},
                {"key": "prepared_by_name", "label": "编制人"},
                {"key": "fmea_count", "label": "FMEA条数"},
            ],
        },
        "nodes": [
            {"node_key": "start", "node_type": "start", "name": "开始", "position_x": 60, "position_y": 200, "sort_order": 0},
            {"node_key": "process_review", "node_type": "approval", "name": "工艺审核", "position_x": 280, "position_y": 200, "sort_order": 1,
             "assignee_config": {"assigneeType": "role", "assigneeValue": "process_manager"},
             "approval_config": {"approvalType": "sequential"},
             "form_config": {"fields": ["review_comment", "process_check_result"]}},
            {"node_key": "quality_approval", "node_type": "approval", "name": "质量批准", "position_x": 560, "position_y": 200, "sort_order": 2,
             "assignee_config": {"assigneeType": "role", "assigneeValue": "quality_engineer"},
             "approval_config": {"approvalType": "sequential", "reject_action": "back_to_start"},
             "form_config": {"fields": ["approval_comment", "approval_result"]}},
            {"node_key": "gw_result", "node_type": "exclusive_gateway", "name": "审批结果", "position_x": 840, "position_y": 200, "sort_order": 3},
            {"node_key": "end_approved", "node_type": "end", "name": "审批通过", "position_x": 1100, "position_y": 120, "sort_order": 4},
            {"node_key": "end_rejected", "node_type": "end", "name": "退回修改", "position_x": 1100, "position_y": 300, "sort_order": 5},
        ],
        "edges": [
            {"source": "start", "target": "process_review"},
            {"source": "process_review", "target": "quality_approval"},
            {"source": "quality_approval", "target": "gw_result"},
            {"source": "gw_result", "target": "end_approved", "label": "通过", "condition": {"expression": 'result=="approved"'}},
            {"source": "gw_result", "target": "end_rejected", "label": "退回", "condition": {"expression": 'result=="rejected"'}},
        ],
    },
    # ── 项目预算审批 ──
    {
        "key": "bgt_budget_approval",
        "name": "项目预算审批",
        "description": "项目预算正式审批：部门经理审批 → 财务审批 → 通过/退回",
        "category": "project",
        "entity_type": "bgt_budgets",
        "entity_view_config": {
            "fields": [
                {"key": "name", "label": "预算名称"},
                {"key": "project_name", "label": "所属项目"},
                {"key": "budget_type_label", "label": "预算类型"},
                {"key": "category_label", "label": "费用分类"},
                {"key": "fiscal_year", "label": "财年"},
                {"key": "total_budget", "label": "预算总额"},
                {"key": "currency", "label": "币种"},
                {"key": "department", "label": "使用部门"},
                {"key": "prepared_by_name", "label": "编制人"},
                {"key": "status_label", "label": "状态"},
                {"key": "notes", "label": "备注"},
            ],
        },
        "nodes": [
            {"node_key": "start", "node_type": "start", "name": "开始", "position_x": 60, "position_y": 200, "sort_order": 0},
            {"node_key": "dept_approval", "node_type": "approval", "name": "部门经理审批", "position_x": 280, "position_y": 200, "sort_order": 1,
             "assignee_config": {"assigneeType": "role", "assigneeValue": "project_manager"},
             "approval_config": {"approvalType": "sequential", "reject_action": "terminate"},
             "form_config": {"fields": ["approval_comment"]}},
            {"node_key": "finance_approval", "node_type": "approval", "name": "财务审批", "position_x": 560, "position_y": 200, "sort_order": 2,
             "assignee_config": {"assigneeType": "role", "assigneeValue": "finance_manager"},
             "approval_config": {"approvalType": "sequential", "reject_action": "terminate"},
             "form_config": {"fields": ["approval_comment", "approval_result"]}},
            {"node_key": "gw_result", "node_type": "exclusive_gateway", "name": "审批结果", "position_x": 840, "position_y": 200, "sort_order": 3},
            {"node_key": "end_approved", "node_type": "end", "name": "审批通过", "position_x": 1100, "position_y": 120, "sort_order": 4},
            {"node_key": "end_rejected", "node_type": "end", "name": "退回修改", "position_x": 1100, "position_y": 300, "sort_order": 5},
        ],
        "edges": [
            {"source": "start", "target": "dept_approval"},
            {"source": "dept_approval", "target": "finance_approval"},
            {"source": "finance_approval", "target": "gw_result"},
            {"source": "gw_result", "target": "end_approved", "label": "通过", "condition": {"expression": 'result=="approved"'}},
            {"source": "gw_result", "target": "end_rejected", "label": "退回", "condition": {"expression": 'result=="rejected"'}},
        ],
    },
    # ── 预算调整审批 ──
    {
        "key": "bgt_budget_adjustment_approval",
        "name": "预算调整审批",
        "description": "预算调整申请审批：部门负责人审批 → 财务总监审批 → 通过/退回",
        "category": "project",
        "entity_type": "bgt_adjustments",
        "entity_view_config": {
            "fields": [
                {"key": "budget_name", "label": "关联预算"},
                {"key": "project_name", "label": "所属项目"},
                {"key": "adjustment_type_label", "label": "调整类型"},
                {"key": "original_amount", "label": "原金额"},
                {"key": "adjusted_amount", "label": "调整后金额"},
                {"key": "reason", "label": "调整原因"},
                {"key": "requested_by_name", "label": "申请人"},
                {"key": "status_label", "label": "状态"},
            ],
        },
        "nodes": [
            {"node_key": "start", "node_type": "start", "name": "开始", "position_x": 60, "position_y": 200, "sort_order": 0},
            {"node_key": "dept_approval", "node_type": "approval", "name": "部门负责人审批", "position_x": 280, "position_y": 200, "sort_order": 1,
             "assignee_config": {"assigneeType": "role", "assigneeValue": "project_manager"},
             "approval_config": {"approvalType": "sequential"},
             "form_config": {"fields": ["approval_comment"]}},
            {"node_key": "finance_approval", "node_type": "approval", "name": "财务总监审批", "position_x": 560, "position_y": 200, "sort_order": 2,
             "assignee_config": {"assigneeType": "role", "assigneeValue": "finance_manager"},
             "approval_config": {"approvalType": "sequential", "reject_action": "terminate"},
             "form_config": {"fields": ["approval_comment"]}},
            {"node_key": "gw_result", "node_type": "exclusive_gateway", "name": "审批结果", "position_x": 840, "position_y": 200, "sort_order": 3},
            {"node_key": "end_approved", "node_type": "end", "name": "调整通过", "position_x": 1100, "position_y": 120, "sort_order": 4},
            {"node_key": "end_rejected", "node_type": "end", "name": "调整驳回", "position_x": 1100, "position_y": 300, "sort_order": 5},
        ],
        "edges": [
            {"source": "start", "target": "dept_approval"},
            {"source": "dept_approval", "target": "finance_approval"},
            {"source": "finance_approval", "target": "gw_result"},
            {"source": "gw_result", "target": "end_approved", "label": "通过", "condition": {"expression": 'result=="approved"'}},
            {"source": "gw_result", "target": "end_rejected", "label": "退回", "condition": {"expression": 'result=="rejected"'}},
        ],
    },
    # ── 备品备件最低库存调整审批 ──
    {
        "key": "eqp_min_stock_adjustment_approval",
        "name": "备件调整工作流",
        "description": "备品备件/易耗品安全库存调整审批：设备负责人确认 → 备品备件管理员审批",
        "category": "equipment",
        "entity_type": "eqp_stock_adjustments",
        "entity_view_config": {
            "fields": [
                {"key": "item_type_label", "label": "物料类型"},
                {"key": "item_name", "label": "物料名称"},
                {"key": "adjustment_type_label", "label": "调整类型"},
                {"key": "original_value", "label": "原值"},
                {"key": "adjusted_value", "label": "调整后值"},
                {"key": "reason", "label": "调整原因"},
                {"key": "requested_by_name", "label": "申请人"},
                {"key": "status_label", "label": "状态"},
            ],
        },
        "nodes": [
            {"node_key": "start", "node_type": "start", "name": "开始", "position_x": 60, "position_y": 200, "sort_order": 0},
            {"node_key": "owner_approval", "node_type": "approval", "name": "设备负责人确认", "position_x": 280, "position_y": 200, "sort_order": 1,
             "assignee_config": {"assigneeType": "role", "assigneeValue": "project_manager"},
             "approval_config": {"approvalType": "sequential"},
             "form_config": {"fields": ["approval_comment"]}},
            {"node_key": "spare_admin_approval", "node_type": "approval", "name": "备品备件管理员审批", "position_x": 560, "position_y": 200, "sort_order": 2,
             "assignee_config": {"assigneeType": "role", "assigneeValue": "备品备件管理员"},
             "approval_config": {"approvalType": "sequential", "reject_action": "terminate"},
             "form_config": {"fields": ["approval_comment"]}},
            {"node_key": "gw_result", "node_type": "exclusive_gateway", "name": "审批结果", "position_x": 840, "position_y": 200, "sort_order": 3},
            {"node_key": "end_approved", "node_type": "end", "name": "调整通过", "position_x": 1100, "position_y": 120, "sort_order": 4},
            {"node_key": "end_rejected", "node_type": "end", "name": "调整驳回", "position_x": 1100, "position_y": 300, "sort_order": 5},
        ],
        "edges": [
            {"source": "start", "target": "owner_approval"},
            {"source": "owner_approval", "target": "spare_admin_approval"},
            {"source": "spare_admin_approval", "target": "gw_result"},
            {"source": "gw_result", "target": "end_approved", "label": "通过", "condition": {"expression": 'result=="approved"'}},
            {"source": "gw_result", "target": "end_rejected", "label": "退回", "condition": {"expression": 'result=="rejected"'}},
        ],
    },
    # ── 项目报告审批 ──
    {
        "key": "project_report_approval",
        "name": "项目报告审批",
        "description": "项目报告正式审批：项目经理审核 → QA 会签（可选）→ 通过/退回",
        "category": "project",
        "entity_type": "prj_project_reports",
        "entity_view_config": {
            "fields": [
                {"key": "report_number", "label": "报告编号"},
                {"key": "title", "label": "报告标题"},
                {"key": "category_label", "label": "报告分类"},
                {"key": "report_type_label", "label": "结构类型"},
                {"key": "project_name", "label": "所属项目"},
                {"key": "status_label", "label": "状态"},
            ],
        },
        "nodes": [
            {"node_key": "start", "node_type": "start", "name": "开始", "position_x": 60, "position_y": 200, "sort_order": 0},
            {"node_key": "pm_review", "node_type": "approval", "name": "项目经理审核", "position_x": 280, "position_y": 200, "sort_order": 1,
             "assignee_config": {"assigneeType": "role", "assigneeValue": "project_manager"},
             "approval_config": {"approvalType": "sequential", "reject_action": "terminate"},
             "form_config": {"fields": ["approval_comment"]}},
            {"node_key": "qa_review", "node_type": "approval", "name": "QA 会签", "position_x": 560, "position_y": 200, "sort_order": 2,
             "assignee_config": {"assigneeType": "role", "assigneeValue": "quality_manager"},
             "approval_config": {"approvalType": "sequential", "reject_action": "terminate"},
             "form_config": {"fields": ["approval_comment"]}},
            {"node_key": "gw_result", "node_type": "exclusive_gateway", "name": "审批结果", "position_x": 840, "position_y": 200, "sort_order": 3},
            {"node_key": "end_approved", "node_type": "end", "name": "审批通过", "position_x": 1100, "position_y": 120, "sort_order": 4},
            {"node_key": "end_rejected", "node_type": "end", "name": "退回修改", "position_x": 1100, "position_y": 300, "sort_order": 5},
        ],
        "edges": [
            {"source": "start", "target": "pm_review"},
            {"source": "pm_review", "target": "qa_review"},
            {"source": "qa_review", "target": "gw_result"},
            {"source": "gw_result", "target": "end_approved", "label": "通过", "condition": {"expression": 'result=="approved"'}},
            {"source": "gw_result", "target": "end_rejected", "label": "退回", "condition": {"expression": 'result=="rejected"'}},
        ],
    },
    # ── 产品功能库审批 ──
    {
        "key": "fn_bank_approval",
        "name": "产品功能审批",
        "description": "产品功能库正式审批：产品负责人审批 → 质量/架构审批 → 通过/退回",
        "category": "product_dev",
        "entity_type": "pdd_function_banks",
        "entity_view_config": {
            "fields": [
                {"key": "function_no", "label": "功能编号"},
                {"key": "function_name", "label": "功能名称"},
                {"key": "hierarchy_level_label", "label": "DFMEA层级"},
                {"key": "discipline_label", "label": "学科归属"},
                {"key": "function_type", "label": "功能类型"},
                {"key": "workflow_status_label", "label": "审批状态"},
                {"key": "description", "label": "功能描述"},
            ],
        },
        "nodes": [
            {"node_key": "start", "node_type": "start", "name": "开始", "position_x": 60, "position_y": 200, "sort_order": 0},
            {"node_key": "product_approval", "node_type": "approval", "name": "产品负责人审批", "position_x": 280, "position_y": 200, "sort_order": 1,
             "assignee_config": {"assigneeType": "role", "assigneeValue": "product_manager"},
             "approval_config": {"approvalType": "sequential", "reject_action": "terminate"},
             "form_config": {"fields": ["approval_comment"]}},
            {"node_key": "qa_arch_approval", "node_type": "approval", "name": "质量/架构审批", "position_x": 560, "position_y": 200, "sort_order": 2,
             "assignee_config": {"assigneeType": "role", "assigneeValue": "quality_manager"},
             "approval_config": {"approvalType": "sequential", "reject_action": "terminate"},
             "form_config": {"fields": ["approval_comment", "approval_result"]}},
            {"node_key": "gw_result", "node_type": "exclusive_gateway", "name": "审批结果", "position_x": 840, "position_y": 200, "sort_order": 3},
            {"node_key": "end_approved", "node_type": "end", "name": "审批通过", "position_x": 1100, "position_y": 120, "sort_order": 4},
            {"node_key": "end_rejected", "node_type": "end", "name": "退回修改", "position_x": 1100, "position_y": 300, "sort_order": 5},
        ],
        "edges": [
            {"source": "start", "target": "product_approval"},
            {"source": "product_approval", "target": "qa_arch_approval"},
            {"source": "qa_arch_approval", "target": "gw_result"},
            {"source": "gw_result", "target": "end_approved", "label": "通过", "condition": {"expression": 'result=="approved"'}},
            {"source": "gw_result", "target": "end_rejected", "label": "退回", "condition": {"expression": 'result=="rejected"'}},
        ],
    },
    # ── 设备功能库审批 ──
    {
        "key": "eqd_fn_bank_approval",
        "name": "设备功能库审批",
        "description": "设备功能库正式审批：设备负责人审批 → 质量审批 → 通过/退回",
        "category": "equipment",
        "entity_type": "eqd_equipment_function_banks",
        "entity_view_config": {
            "fields": [
                {"key": "function_code", "label": "功能编号"},
                {"key": "function_name", "label": "功能名称"},
                {"key": "discipline_label", "label": "学科归属"},
                {"key": "function_type", "label": "功能类型"},
                {"key": "workflow_status_label", "label": "审批状态"},
                {"key": "description", "label": "功能描述"},
            ],
        },
        "nodes": [
            {"node_key": "start", "node_type": "start", "name": "开始", "position_x": 60, "position_y": 200, "sort_order": 0},
            {"node_key": "eq_lead_approval", "node_type": "approval", "name": "设备负责人审批", "position_x": 280, "position_y": 200, "sort_order": 1,
             "assignee_config": {"assigneeType": "role", "assigneeValue": "equipment_manager"},
             "approval_config": {"approvalType": "sequential", "reject_action": "back_to_start"},
             "form_config": {"fields": ["approval_comment"]}},
            {"node_key": "qa_approval", "node_type": "approval", "name": "质量审批", "position_x": 560, "position_y": 200, "sort_order": 2,
             "assignee_config": {"assigneeType": "role", "assigneeValue": "quality_manager"},
             "approval_config": {"approvalType": "sequential", "reject_action": "back_to_start"},
             "form_config": {"fields": ["approval_comment", "approval_result"]}},
            {"node_key": "gw_result", "node_type": "exclusive_gateway", "name": "审批结果", "position_x": 840, "position_y": 200, "sort_order": 3},
            {"node_key": "end_approved", "node_type": "end", "name": "审批通过", "position_x": 1100, "position_y": 120, "sort_order": 4},
            {"node_key": "end_rejected", "node_type": "end", "name": "退回修改", "position_x": 1100, "position_y": 300, "sort_order": 5},
        ],
        "edges": [
            {"source": "start", "target": "eq_lead_approval"},
            {"source": "eq_lead_approval", "target": "qa_approval"},
            {"source": "qa_approval", "target": "gw_result"},
            {"source": "gw_result", "target": "end_approved", "label": "通过", "condition": {"expression": 'result=="approved"'}},
            {"source": "gw_result", "target": "end_rejected", "label": "退回", "condition": {"expression": 'result=="rejected"'}},
        ],
    },
    # ── 硬件模块模板库审批 ──
    {
        "key": "hwe_modbank_approval",
        "name": "硬件模块模板审批",
        "description": "硬件模块模板库正式审批：硬件负责人审批 → 质量/架构审批 → 通过/退回",
        "category": "product_dev",
        "entity_type": "pdd_hwe_module_banks",
        "entity_view_config": {
            "fields": [
                {"key": "module_no", "label": "模块编号"},
                {"key": "name", "label": "模块名称"},
                {"key": "module_type_label", "label": "模块类型"},
                {"key": "workflow_status_label", "label": "审批状态"},
                {"key": "description", "label": "模块描述"},
            ],
        },
        "nodes": [
            {"node_key": "start", "node_type": "start", "name": "开始", "position_x": 60, "position_y": 200, "sort_order": 0},
            {"node_key": "hw_lead_approval", "node_type": "approval", "name": "硬件负责人审批", "position_x": 280, "position_y": 200, "sort_order": 1,
             "assignee_config": {"assigneeType": "role", "assigneeValue": "hardware_manager"},
             "approval_config": {"approvalType": "sequential", "reject_action": "terminate"},
             "form_config": {"fields": ["approval_comment"]}},
            {"node_key": "qa_arch_approval", "node_type": "approval", "name": "质量/架构审批", "position_x": 560, "position_y": 200, "sort_order": 2,
             "assignee_config": {"assigneeType": "role", "assigneeValue": "quality_manager"},
             "approval_config": {"approvalType": "sequential", "reject_action": "terminate"},
             "form_config": {"fields": ["approval_comment", "approval_result"]}},
            {"node_key": "gw_result", "node_type": "exclusive_gateway", "name": "审批结果", "position_x": 840, "position_y": 200, "sort_order": 3},
            {"node_key": "end_approved", "node_type": "end", "name": "审批通过", "position_x": 1100, "position_y": 120, "sort_order": 4},
            {"node_key": "end_rejected", "node_type": "end", "name": "退回修改", "position_x": 1100, "position_y": 300, "sort_order": 5},
        ],
        "edges": [
            {"source": "start", "target": "hw_lead_approval"},
            {"source": "hw_lead_approval", "target": "qa_arch_approval"},
            {"source": "qa_arch_approval", "target": "gw_result"},
            {"source": "gw_result", "target": "end_approved", "label": "通过", "condition": {"expression": 'result=="approved"'}},
            {"source": "gw_result", "target": "end_rejected", "label": "退回", "condition": {"expression": 'result=="rejected"'}},
        ],
    },
    # ── DFMEA 库审批 ──
    {
        "key": "dfmea_bank_approval",
        "name": "DFMEA库审批",
        "description": "DFMEA 知识库正式审批：质量工程师审批 → FMEA 专家审批 → 通过/退回",
        "category": "product_dev",
        "entity_type": "pdd_fmea_banks",
        "entity_view_config": {
            "fields": [
                {"key": "fmea_no", "label": "FMEA编号"},
                {"key": "fmea_name", "label": "FMEA名称"},
                {"key": "function_label", "label": "关联功能"},
                {"key": "severity", "label": "严重度 S"},
                {"key": "rpn", "label": "RPN"},
                {"key": "action_priority_label", "label": "措施优先级 AP"},
                {"key": "workflow_status_label", "label": "审批状态"},
                {"key": "potential_failure_mode", "label": "失效模式"},
            ],
        },
        "nodes": [
            {"node_key": "start", "node_type": "start", "name": "开始", "position_x": 60, "position_y": 200, "sort_order": 0},
            {"node_key": "qa_engineer_approval", "node_type": "approval", "name": "质量工程师审批", "position_x": 280, "position_y": 200, "sort_order": 1,
             "assignee_config": {"assigneeType": "role", "assigneeValue": "quality_engineer"},
             "approval_config": {"approvalType": "sequential", "reject_action": "terminate"},
             "form_config": {"fields": ["approval_comment"]}},
            {"node_key": "fmea_expert_approval", "node_type": "approval", "name": "FMEA专家审批", "position_x": 560, "position_y": 200, "sort_order": 2,
             "assignee_config": {"assigneeType": "role", "assigneeValue": "fmea_expert"},
             "approval_config": {"approvalType": "sequential", "reject_action": "terminate"},
             "form_config": {"fields": ["approval_comment", "approval_result"]}},
            {"node_key": "gw_result", "node_type": "exclusive_gateway", "name": "审批结果", "position_x": 840, "position_y": 200, "sort_order": 3},
            {"node_key": "end_approved", "node_type": "end", "name": "审批通过", "position_x": 1100, "position_y": 120, "sort_order": 4},
            {"node_key": "end_rejected", "node_type": "end", "name": "退回修改", "position_x": 1100, "position_y": 300, "sort_order": 5},
        ],
        "edges": [
            {"source": "start", "target": "qa_engineer_approval"},
            {"source": "qa_engineer_approval", "target": "fmea_expert_approval"},
            {"source": "fmea_expert_approval", "target": "gw_result"},
            {"source": "gw_result", "target": "end_approved", "label": "通过", "condition": {"expression": 'result=="approved"'}},
            {"source": "gw_result", "target": "end_rejected", "label": "退回", "condition": {"expression": 'result=="rejected"'}},
        ],
    },
    # ── DFMEA 项目主表（Form Header）审批 ──
    {
        "key": "pdd_dfmea_metadata_approval",
        "name": "DFMEA主表审批",
        "description": "项目 DFMEA 主表正式审批：质量工程师 → FMEA 专家 → 通过后自动 Released，可保存签字版到设计文档。",
        "category": "product_dev",
        "entity_type": "pdd_fmea_metadata",
        "entity_view_config": {
            "fields": [
                {"key": "fmea_title", "label": "Subject / 主题"},
                {"key": "dfmea_id_number", "label": "DFMEA ID"},
                {"key": "project_name", "label": "项目"},
                {"key": "facilitator", "label": "主持人"},
                {"key": "status_label", "label": "状态"},
                {"key": "fmea_scope", "label": "分析范围"},
            ],
        },
        "nodes": [
            {"node_key": "start", "node_type": "start", "name": "开始", "position_x": 60, "position_y": 200, "sort_order": 0},
            {"node_key": "qa_engineer_approval", "node_type": "approval", "name": "质量工程师审批", "position_x": 280, "position_y": 200, "sort_order": 1,
             "assignee_config": {"assigneeType": "role", "assigneeValue": "quality_engineer"},
             "approval_config": {"approvalType": "sequential", "reject_action": "terminate"},
             "form_config": {"fields": ["approval_comment"]}},
            {"node_key": "fmea_expert_approval", "node_type": "approval", "name": "FMEA专家审批", "position_x": 560, "position_y": 200, "sort_order": 2,
             "assignee_config": {"assigneeType": "role", "assigneeValue": "fmea_expert"},
             "approval_config": {"approvalType": "sequential", "reject_action": "terminate"},
             "form_config": {"fields": ["approval_comment", "approval_result"]}},
            {"node_key": "gw_result", "node_type": "exclusive_gateway", "name": "审批结果", "position_x": 840, "position_y": 200, "sort_order": 3},
            {"node_key": "end_approved", "node_type": "end", "name": "审批通过", "position_x": 1100, "position_y": 120, "sort_order": 4},
            {"node_key": "end_rejected", "node_type": "end", "name": "退回修改", "position_x": 1100, "position_y": 300, "sort_order": 5},
        ],
        "edges": [
            {"source": "start", "target": "qa_engineer_approval"},
            {"source": "qa_engineer_approval", "target": "fmea_expert_approval"},
            {"source": "fmea_expert_approval", "target": "gw_result"},
            {"source": "gw_result", "target": "end_approved", "label": "通过", "condition": {"expression": 'result=="approved"'}},
            {"source": "gw_result", "target": "end_rejected", "label": "退回", "condition": {"expression": 'result=="rejected"'}},
        ],
    },
    # ── AI 技能 Prompt 变更审批 ──
    {
        "key": "ai_skill_prompt_change_approval",
        "name": "AI技能Prompt变更审批",
        "description": "对话发起的技能 Prompt 变更：提交→平台管理员审批→通过后写入 ai_skills.prompt_template",
        "category": "ai",
        "entity_type": "ai_skill_prompt_changes",
        "entity_view_config": {
            "fields": [
                {"key": "skill_code", "label": "技能 Code"},
                {"key": "change_summary", "label": "变更摘要"},
                {"key": "user_instruction", "label": "用户申请说明"},
                {"key": "status_label", "label": "状态"},
                {"key": "page_name", "label": "来源页面"},
                {"key": "proposed_prompt_preview", "label": "建议 Prompt 预览"},
            ],
        },
        "nodes": [
            {"node_key": "start", "node_type": "start", "name": "开始", "position_x": 60, "position_y": 200, "sort_order": 0},
            {"node_key": "platform_review", "node_type": "approval", "name": "AI平台管理员审批", "position_x": 320, "position_y": 200, "sort_order": 1,
             "assignee_config": {"assigneeType": "role", "assigneeValue": "Administrator"},
             "approval_config": {"approvalType": "sequential", "reject_action": "terminate"},
             "form_config": {"fields": ["approval_comment"]}},
            {"node_key": "gw_result", "node_type": "exclusive_gateway", "name": "审批结果", "position_x": 580, "position_y": 200, "sort_order": 2},
            {"node_key": "end_approved", "node_type": "end", "name": "审批通过", "position_x": 840, "position_y": 120, "sort_order": 3},
            {"node_key": "end_rejected", "node_type": "end", "name": "审批驳回", "position_x": 840, "position_y": 300, "sort_order": 4},
        ],
        "edges": [
            {"source": "start", "target": "platform_review"},
            {"source": "platform_review", "target": "gw_result"},
            {"source": "gw_result", "target": "end_approved", "label": "通过", "condition": {"expression": 'result=="approved"'}},
            {"source": "gw_result", "target": "end_rejected", "label": "退回", "condition": {"expression": 'result=="rejected"'}},
        ],
    },
    # ── 物料 BOM 审批 ──
    {
        "key": "mat_bom_header_approval",
        "name": "物料BOM审批",
        "description": "物料BOM正式审批：提交→工艺/工程审核→通过后自动发布快照。",
        "category": "material",
        "entity_type": "mat_bom_headers",
        "entity_view_config": {
            "fields": [
                {"key": "bom_no", "label": "BOM编号"},
                {"key": "bom_name", "label": "BOM名称"},
                {"key": "material_no", "label": "主料号"},
                {"key": "material_name", "label": "主料名称"},
                {"key": "version", "label": "版本"},
                {"key": "status_label", "label": "状态"},
            ],
        },
        "nodes": [
            {"node_key": "start", "node_type": "start", "name": "开始", "position_x": 60, "position_y": 200, "sort_order": 0},
            {"node_key": "eng_review", "node_type": "approval", "name": "工程审核", "position_x": 300, "position_y": 200, "sort_order": 1,
             "assignee_config": {"assigneeType": "role", "assigneeValue": "process_manager"},
             "approval_config": {"approvalType": "sequential", "reject_action": "back_to_start"},
             "form_config": {"fields": ["review_comment", "approval_result"]}},
            {"node_key": "gw_result", "node_type": "exclusive_gateway", "name": "审批结果", "position_x": 560, "position_y": 200, "sort_order": 2},
            {"node_key": "end_approved", "node_type": "end", "name": "审批通过", "position_x": 800, "position_y": 120, "sort_order": 3},
            {"node_key": "end_rejected", "node_type": "end", "name": "退回修改", "position_x": 800, "position_y": 300, "sort_order": 4},
        ],
        "edges": [
            {"source": "start", "target": "eng_review"},
            {"source": "eng_review", "target": "gw_result"},
            {"source": "gw_result", "target": "end_approved", "label": "通过", "condition": {"expression": 'result=="approved"'}},
            {"source": "gw_result", "target": "end_rejected", "label": "退回", "condition": {"expression": 'result=="rejected"'}},
        ],
    },
    # ── 设备设计 BOM 审批 ──
    {
        "key": "eqp_bom_header_approval",
        "name": "设备BOM审批",
        "description": "设备设计BOM正式审批：提交→工程审核→通过后发布。",
        "category": "equipment",
        "entity_type": "eqp_bom_headers",
        "entity_view_config": {
            "fields": [
                {"key": "bom_no", "label": "BOM编号"},
                {"key": "bom_name", "label": "BOM名称"},
                {"key": "equipment_no", "label": "设备编号"},
                {"key": "material_no", "label": "主料号"},
                {"key": "version", "label": "版本"},
                {"key": "status_label", "label": "状态"},
            ],
        },
        "nodes": [
            {"node_key": "start", "node_type": "start", "name": "开始", "position_x": 60, "position_y": 200, "sort_order": 0},
            {"node_key": "eng_review", "node_type": "approval", "name": "工程审核", "position_x": 300, "position_y": 200, "sort_order": 1,
             "assignee_config": {"assigneeType": "role", "assigneeValue": "process_manager"},
             "approval_config": {"approvalType": "sequential", "reject_action": "back_to_start"},
             "form_config": {"fields": ["review_comment", "approval_result"]}},
            {"node_key": "gw_result", "node_type": "exclusive_gateway", "name": "审批结果", "position_x": 560, "position_y": 200, "sort_order": 2},
            {"node_key": "end_approved", "node_type": "end", "name": "审批通过", "position_x": 800, "position_y": 120, "sort_order": 3},
            {"node_key": "end_rejected", "node_type": "end", "name": "退回修改", "position_x": 800, "position_y": 300, "sort_order": 4},
        ],
        "edges": [
            {"source": "start", "target": "eng_review"},
            {"source": "eng_review", "target": "gw_result"},
            {"source": "gw_result", "target": "end_approved", "label": "通过", "condition": {"expression": 'result=="approved"'}},
            {"source": "gw_result", "target": "end_rejected", "label": "退回", "condition": {"expression": 'result=="rejected"'}},
        ],
    },
    # ── 主生产计划审批 ──
    {
        "key": "mfg_master_plan_approval",
        "name": "主生产计划审批",
        "description": "主生产计划正式审批：计划员提交→生产经理审批→通过/退回。",
        "category": "manufacturing",
        "entity_type": "mfg_master_plans",
        "entity_view_config": {
            "fields": [
                {"key": "plan_no", "label": "计划编号"},
                {"key": "name", "label": "计划名称"},
                {"key": "type", "label": "计划类型"},
                {"key": "period_start", "label": "开始日期"},
                {"key": "period_end", "label": "结束日期"},
                {"key": "status_label", "label": "状态"},
                {"key": "remarks", "label": "备注"},
            ],
        },
        "nodes": [
            {"node_key": "start", "node_type": "start", "name": "开始", "position_x": 60, "position_y": 200, "sort_order": 0},
            {"node_key": "prod_approval", "node_type": "approval", "name": "生产经理审批", "position_x": 320, "position_y": 200, "sort_order": 1,
             "assignee_config": {"assigneeType": "role", "assigneeValue": "production_manager"},
             "approval_config": {"approvalType": "sequential", "reject_action": "back_to_start"},
             "form_config": {"fields": ["approval_comment", "approval_result"]}},
            {"node_key": "gw_result", "node_type": "exclusive_gateway", "name": "审批结果", "position_x": 580, "position_y": 200, "sort_order": 2},
            {"node_key": "end_approved", "node_type": "end", "name": "审批通过", "position_x": 820, "position_y": 120, "sort_order": 3},
            {"node_key": "end_rejected", "node_type": "end", "name": "退回修改", "position_x": 820, "position_y": 300, "sort_order": 4},
        ],
        "edges": [
            {"source": "start", "target": "prod_approval"},
            {"source": "prod_approval", "target": "gw_result"},
            {"source": "gw_result", "target": "end_approved", "label": "通过", "condition": {"expression": 'result=="approved"'}},
            {"source": "gw_result", "target": "end_rejected", "label": "退回", "condition": {"expression": 'result=="rejected"'}},
        ],
    },
    # ── 控制设计审批 ──
    {
        "key": "eqd_control_design_approval",
        "name": "控制设计审批",
        "description": "设备控制设计正式审批：提交→控制工程师审核→通过/退回。",
        "category": "equipment",
        "entity_type": "eqd_control_designs",
        "entity_view_config": {
            "fields": [
                {"key": "design_no", "label": "设计编号"},
                {"key": "name", "label": "设计名称"},
                {"key": "version", "label": "版本"},
                {"key": "status_label", "label": "状态"},
                {"key": "equipment_no", "label": "设备编号"},
                {"key": "operation_no", "label": "工序编号"},
            ],
        },
        "nodes": [
            {"node_key": "start", "node_type": "start", "name": "开始", "position_x": 60, "position_y": 200, "sort_order": 0},
            {"node_key": "control_review", "node_type": "approval", "name": "控制工程师审核", "position_x": 320, "position_y": 200, "sort_order": 1,
             "assignee_config": {"assigneeType": "role", "assigneeValue": "equipment_engineer"},
             "approval_config": {"approvalType": "sequential", "reject_action": "back_to_start"},
             "form_config": {"fields": ["review_comment", "approval_result"]}},
            {"node_key": "gw_result", "node_type": "exclusive_gateway", "name": "审批结果", "position_x": 580, "position_y": 200, "sort_order": 2},
            {"node_key": "end_approved", "node_type": "end", "name": "审批通过", "position_x": 820, "position_y": 120, "sort_order": 3},
            {"node_key": "end_rejected", "node_type": "end", "name": "退回修改", "position_x": 820, "position_y": 300, "sort_order": 4},
        ],
        "edges": [
            {"source": "start", "target": "control_review"},
            {"source": "control_review", "target": "gw_result"},
            {"source": "gw_result", "target": "end_approved", "label": "通过", "condition": {"expression": 'result=="approved"'}},
            {"source": "gw_result", "target": "end_rejected", "label": "退回", "condition": {"expression": 'result=="rejected"'}},
        ],
    },
    # ── 结构设计文档审批 ──
    {
        "key": "eqd_structural_design_doc_approval",
        "name": "结构设计文档审批",
        "description": "设备结构设计文档正式审批：提交→结构工程师审核→通过/退回。",
        "category": "equipment",
        "entity_type": "eqd_design_docs",
        "entity_view_config": {
            "fields": [
                {"key": "doc_number", "label": "文档编号"},
                {"key": "title", "label": "文档标题"},
                {"key": "discipline_label", "label": "设计学科"},
                {"key": "design_level_label", "label": "设计层级"},
                {"key": "version", "label": "版本"},
                {"key": "status_label", "label": "状态"},
            ],
        },
        "nodes": [
            {"node_key": "start", "node_type": "start", "name": "开始", "position_x": 60, "position_y": 200, "sort_order": 0},
            {"node_key": "structural_review", "node_type": "approval", "name": "结构工程师审核", "position_x": 320, "position_y": 200, "sort_order": 1,
             "assignee_config": {"assigneeType": "role", "assigneeValue": "equipment_engineer"},
             "approval_config": {"approvalType": "sequential", "reject_action": "back_to_start"},
             "form_config": {"fields": ["review_comment", "approval_result"]}},
            {"node_key": "gw_result", "node_type": "exclusive_gateway", "name": "审批结果", "position_x": 580, "position_y": 200, "sort_order": 2},
            {"node_key": "end_approved", "node_type": "end", "name": "审批通过", "position_x": 820, "position_y": 120, "sort_order": 3},
            {"node_key": "end_rejected", "node_type": "end", "name": "退回修改", "position_x": 820, "position_y": 300, "sort_order": 4},
        ],
        "edges": [
            {"source": "start", "target": "structural_review"},
            {"source": "structural_review", "target": "gw_result"},
            {"source": "gw_result", "target": "end_approved", "label": "通过", "condition": {"expression": 'result=="approved"'}},
            {"source": "gw_result", "target": "end_rejected", "label": "退回", "condition": {"expression": 'result=="rejected"'}},
        ],
    },
    # ── QA 计划审批 ──
    {
        "key": "qlt_qa_plan_approval",
        "name": "质量保证计划审批",
        "description": "QA 计划正式审批：提交→质量经理审批→通过/退回。",
        "category": "quality",
        "entity_type": "qlt_qa_plans",
        "entity_view_config": {
            "fields": [
                {"key": "plan_code", "label": "计划编号"},
                {"key": "title", "label": "计划标题"},
                {"key": "version", "label": "版本"},
                {"key": "status_label", "label": "状态"},
                {"key": "purpose", "label": "目的"},
                {"key": "scope", "label": "范围"},
            ],
        },
        "nodes": [
            {"node_key": "start", "node_type": "start", "name": "开始", "position_x": 60, "position_y": 200, "sort_order": 0},
            {"node_key": "qa_approval", "node_type": "approval", "name": "质量经理审批", "position_x": 320, "position_y": 200, "sort_order": 1,
             "assignee_config": {"assigneeType": "role", "assigneeValue": "quality_manager"},
             "approval_config": {"approvalType": "sequential", "reject_action": "back_to_start"},
             "form_config": {"fields": ["approval_comment", "approval_result"]}},
            {"node_key": "gw_result", "node_type": "exclusive_gateway", "name": "审批结果", "position_x": 580, "position_y": 200, "sort_order": 2},
            {"node_key": "end_approved", "node_type": "end", "name": "审批通过", "position_x": 820, "position_y": 120, "sort_order": 3},
            {"node_key": "end_rejected", "node_type": "end", "name": "退回修改", "position_x": 820, "position_y": 300, "sort_order": 4},
        ],
        "edges": [
            {"source": "start", "target": "qa_approval"},
            {"source": "qa_approval", "target": "gw_result"},
            {"source": "gw_result", "target": "end_approved", "label": "通过", "condition": {"expression": 'result=="approved"'}},
            {"source": "gw_result", "target": "end_rejected", "label": "退回", "condition": {"expression": 'result=="rejected"'}},
        ],
    },
    # ── NCR 关闭审批 ──
    {
        "key": "qlt_ncr_close_approval",
        "name": "NCR关闭审批",
        "description": "不合格品报告关闭审批：实施完成后提交→质量经理确认关闭→通过/退回继续实施。",
        "category": "quality",
        "entity_type": "qlt_ncrs",
        "entity_view_config": {
            "fields": [
                {"key": "ncr_code", "label": "NCR编号"},
                {"key": "title", "label": "标题"},
                {"key": "ncr_type", "label": "类型"},
                {"key": "severity", "label": "严重度"},
                {"key": "status_label", "label": "状态"},
                {"key": "disposition", "label": "处置方式"},
                {"key": "description", "label": "描述"},
            ],
        },
        "nodes": [
            {"node_key": "start", "node_type": "start", "name": "开始", "position_x": 60, "position_y": 200, "sort_order": 0},
            {"node_key": "close_approval", "node_type": "approval", "name": "关闭确认", "position_x": 320, "position_y": 200, "sort_order": 1,
             "assignee_config": {"assigneeType": "role", "assigneeValue": "quality_manager"},
             "approval_config": {"approvalType": "sequential", "reject_action": "terminate"},
             "form_config": {"fields": ["approval_comment", "approval_result"]}},
            {"node_key": "gw_result", "node_type": "exclusive_gateway", "name": "审批结果", "position_x": 580, "position_y": 200, "sort_order": 2},
            {"node_key": "end_approved", "node_type": "end", "name": "关闭通过", "position_x": 820, "position_y": 120, "sort_order": 3},
            {"node_key": "end_rejected", "node_type": "end", "name": "退回实施", "position_x": 820, "position_y": 300, "sort_order": 4},
        ],
        "edges": [
            {"source": "start", "target": "close_approval"},
            {"source": "close_approval", "target": "gw_result"},
            {"source": "gw_result", "target": "end_approved", "label": "通过", "condition": {"expression": 'result=="approved"'}},
            {"source": "gw_result", "target": "end_rejected", "label": "退回", "condition": {"expression": 'result=="rejected"'}},
        ],
    },
    # ── PFMEA 审批 ──
    {
        "key": "prc_fmea_approval",
        "name": "PFMEA审批",
        "description": "项目 PFMEA 正式审批：提交→工艺审核→质量批准→通过/退回。",
        "category": "process",
        "entity_type": "prc_fmeas",
        "entity_view_config": {
            "fields": [
                {"key": "fmea_no", "label": "FMEA编号"},
                {"key": "fmea_name", "label": "FMEA名称"},
                {"key": "status_label", "label": "状态"},
                {"key": "fmea_scope", "label": "分析范围"},
                {"key": "process_item", "label": "过程项"},
                {"key": "failure_mode_current", "label": "失效模式"},
            ],
        },
        "nodes": [
            {"node_key": "start", "node_type": "start", "name": "开始", "position_x": 60, "position_y": 200, "sort_order": 0},
            {"node_key": "process_review", "node_type": "approval", "name": "工艺审核", "position_x": 280, "position_y": 200, "sort_order": 1,
             "assignee_config": {"assigneeType": "role", "assigneeValue": "process_manager"},
             "approval_config": {"approvalType": "sequential"},
             "form_config": {"fields": ["review_comment"]}},
            {"node_key": "quality_approval", "node_type": "approval", "name": "质量批准", "position_x": 560, "position_y": 200, "sort_order": 2,
             "assignee_config": {"assigneeType": "role", "assigneeValue": "quality_engineer"},
             "approval_config": {"approvalType": "sequential", "reject_action": "back_to_start"},
             "form_config": {"fields": ["approval_comment", "approval_result"]}},
            {"node_key": "gw_result", "node_type": "exclusive_gateway", "name": "审批结果", "position_x": 840, "position_y": 200, "sort_order": 3},
            {"node_key": "end_approved", "node_type": "end", "name": "审批通过", "position_x": 1100, "position_y": 120, "sort_order": 4},
            {"node_key": "end_rejected", "node_type": "end", "name": "退回修改", "position_x": 1100, "position_y": 300, "sort_order": 5},
        ],
        "edges": [
            {"source": "start", "target": "process_review"},
            {"source": "process_review", "target": "quality_approval"},
            {"source": "quality_approval", "target": "gw_result"},
            {"source": "gw_result", "target": "end_approved", "label": "通过", "condition": {"expression": 'result=="approved"'}},
            {"source": "gw_result", "target": "end_rejected", "label": "退回", "condition": {"expression": 'result=="rejected"'}},
        ],
    },
    # ── 维保工单完工确认 ──
    {
        "key": "eqp_maintenance_order_completion",
        "name": "维保工单完工确认",
        "description": "维护工单完工确认：提交→设备主管确认→通过标记完成/退回继续处理。",
        "category": "equipment",
        "entity_type": "eqp_maintenance_orders",
        "entity_view_config": {
            "fields": [
                {"key": "order_number", "label": "工单编号"},
                {"key": "title", "label": "标题"},
                {"key": "order_type", "label": "工单类型"},
                {"key": "priority", "label": "优先级"},
                {"key": "status_label", "label": "状态"},
            ],
        },
        "nodes": [
            {"node_key": "start", "node_type": "start", "name": "开始", "position_x": 60, "position_y": 200, "sort_order": 0},
            {"node_key": "completion_confirm", "node_type": "approval", "name": "完工确认", "position_x": 320, "position_y": 200, "sort_order": 1,
             "assignee_config": {"assigneeType": "role", "assigneeValue": "equipment_manager"},
             "approval_config": {"approvalType": "sequential", "reject_action": "terminate"},
             "form_config": {"fields": ["approval_comment", "approval_result"]}},
            {"node_key": "gw_result", "node_type": "exclusive_gateway", "name": "审批结果", "position_x": 580, "position_y": 200, "sort_order": 2},
            {"node_key": "end_approved", "node_type": "end", "name": "确认完成", "position_x": 820, "position_y": 120, "sort_order": 3},
            {"node_key": "end_rejected", "node_type": "end", "name": "退回处理", "position_x": 820, "position_y": 300, "sort_order": 4},
        ],
        "edges": [
            {"source": "start", "target": "completion_confirm"},
            {"source": "completion_confirm", "target": "gw_result"},
            {"source": "gw_result", "target": "end_approved", "label": "通过", "condition": {"expression": 'result=="approved"'}},
            {"source": "gw_result", "target": "end_rejected", "label": "退回", "condition": {"expression": 'result=="rejected"'}},
        ],
    },
    # ── ISO 26262 Functional Safety Reviews ──
    {
        "key": "fs_hazard_review_workflow",
        "name": "HARA危害事件评审审批",
        "description": "ISO 26262 HARA 危害事件评审：提交→安全评审→通过锁定/驳回。",
        "category": "functional_safety",
        "entity_type": "pdd_fs_hazard_events",
        "nodes": [
            {"node_key": "start", "node_type": "start", "name": "开始", "position_x": 60, "position_y": 180, "sort_order": 0},
            {"node_key": "review", "node_type": "approval", "name": "HARA评审", "position_x": 320, "position_y": 180, "sort_order": 1,
             "assignee_config": {"assigneeType": "initiator"},
             "approval_config": {"approvalType": "sequential"}},
            {"node_key": "gw_review", "node_type": "exclusive_gateway", "name": "评审结果", "position_x": 580, "position_y": 180, "sort_order": 2},
            {"node_key": "end_ok", "node_type": "end", "name": "锁定通过", "position_x": 840, "position_y": 100, "sort_order": 3},
            {"node_key": "end_reject", "node_type": "end", "name": "驳回", "position_x": 840, "position_y": 260, "sort_order": 4},
        ],
        "edges": [
            {"source": "start", "target": "review"},
            {"source": "review", "target": "gw_review"},
            {"source": "gw_review", "target": "end_ok", "label": "通过", "condition": {"expression": 'result=="approved"'}},
            {"source": "gw_review", "target": "end_reject", "label": "驳回", "condition": {"expression": 'result=="rejected"'}},
        ],
    },
    {
        "key": "fs_safety_goal_review_workflow",
        "name": "安全目标评审审批",
        "description": "ISO 26262 Safety Goal 评审审批流程。",
        "category": "functional_safety",
        "entity_type": "pdd_fs_safety_goals",
        "nodes": [
            {"node_key": "start", "node_type": "start", "name": "开始", "position_x": 60, "position_y": 180, "sort_order": 0},
            {"node_key": "review", "node_type": "approval", "name": "安全目标评审", "position_x": 320, "position_y": 180, "sort_order": 1,
             "assignee_config": {"assigneeType": "initiator"},
             "approval_config": {"approvalType": "sequential"}},
            {"node_key": "gw_review", "node_type": "exclusive_gateway", "name": "评审结果", "position_x": 580, "position_y": 180, "sort_order": 2},
            {"node_key": "end_ok", "node_type": "end", "name": "通过", "position_x": 840, "position_y": 100, "sort_order": 3},
            {"node_key": "end_reject", "node_type": "end", "name": "驳回", "position_x": 840, "position_y": 260, "sort_order": 4},
        ],
        "edges": [
            {"source": "start", "target": "review"},
            {"source": "review", "target": "gw_review"},
            {"source": "gw_review", "target": "end_ok", "label": "通过", "condition": {"expression": 'result=="approved"'}},
            {"source": "gw_review", "target": "end_reject", "label": "驳回", "condition": {"expression": 'result=="rejected"'}},
        ],
    },
    {
        "key": "fs_requirement_review_workflow",
        "name": "安全需求评审审批",
        "description": "ISO 26262 安全需求（FSR/TSR/SSR/HSR）评审审批流程。",
        "category": "functional_safety",
        "entity_type": "pdd_fs_safety_requirements",
        "nodes": [
            {"node_key": "start", "node_type": "start", "name": "开始", "position_x": 60, "position_y": 180, "sort_order": 0},
            {"node_key": "review", "node_type": "approval", "name": "安全需求评审", "position_x": 320, "position_y": 180, "sort_order": 1,
             "assignee_config": {"assigneeType": "initiator"},
             "approval_config": {"approvalType": "sequential"}},
            {"node_key": "gw_review", "node_type": "exclusive_gateway", "name": "评审结果", "position_x": 580, "position_y": 180, "sort_order": 2},
            {"node_key": "end_ok", "node_type": "end", "name": "通过", "position_x": 840, "position_y": 100, "sort_order": 3},
            {"node_key": "end_reject", "node_type": "end", "name": "驳回", "position_x": 840, "position_y": 260, "sort_order": 4},
        ],
        "edges": [
            {"source": "start", "target": "review"},
            {"source": "review", "target": "gw_review"},
            {"source": "gw_review", "target": "end_ok", "label": "通过", "condition": {"expression": 'result=="approved"'}},
            {"source": "gw_review", "target": "end_reject", "label": "驳回", "condition": {"expression": 'result=="rejected"'}},
        ],
    },
    {
        "key": "fs_confirmation_review_workflow",
        "name": "Confirmation评审审批",
        "description": "ISO 26262 Part 2 Confirmation Measures 独立性评审审批。",
        "category": "functional_safety",
        "entity_type": "pdd_fs_confirmation_reviews",
        "nodes": [
            {"node_key": "start", "node_type": "start", "name": "开始", "position_x": 60, "position_y": 180, "sort_order": 0},
            {"node_key": "review", "node_type": "approval", "name": "Confirmation评审", "position_x": 320, "position_y": 180, "sort_order": 1,
             "assignee_config": {"assigneeType": "initiator"},
             "approval_config": {"approvalType": "sequential"}},
            {"node_key": "gw_review", "node_type": "exclusive_gateway", "name": "评审结果", "position_x": 580, "position_y": 180, "sort_order": 2},
            {"node_key": "end_ok", "node_type": "end", "name": "接受", "position_x": 840, "position_y": 100, "sort_order": 3},
            {"node_key": "end_reject", "node_type": "end", "name": "拒绝", "position_x": 840, "position_y": 260, "sort_order": 4},
        ],
        "edges": [
            {"source": "start", "target": "review"},
            {"source": "review", "target": "gw_review"},
            {"source": "gw_review", "target": "end_ok", "label": "通过", "condition": {"expression": 'result=="approved"'}},
            {"source": "gw_review", "target": "end_reject", "label": "驳回", "condition": {"expression": 'result=="rejected"'}},
        ],
    },
    {
        "key": "fs_safety_case_review_workflow",
        "name": "Safety Case评审审批",
        "description": "ISO 26262 Safety Case 快照发布评审审批。",
        "category": "functional_safety",
        "entity_type": "pdd_fs_safety_case_snapshots",
        "nodes": [
            {"node_key": "start", "node_type": "start", "name": "开始", "position_x": 60, "position_y": 180, "sort_order": 0},
            {"node_key": "review", "node_type": "approval", "name": "Safety Case评审", "position_x": 320, "position_y": 180, "sort_order": 1,
             "assignee_config": {"assigneeType": "initiator"},
             "approval_config": {"approvalType": "sequential"}},
            {"node_key": "gw_review", "node_type": "exclusive_gateway", "name": "评审结果", "position_x": 580, "position_y": 180, "sort_order": 2},
            {"node_key": "end_ok", "node_type": "end", "name": "通过", "position_x": 840, "position_y": 100, "sort_order": 3},
            {"node_key": "end_reject", "node_type": "end", "name": "驳回", "position_x": 840, "position_y": 260, "sort_order": 4},
        ],
        "edges": [
            {"source": "start", "target": "review"},
            {"source": "review", "target": "gw_review"},
            {"source": "gw_review", "target": "end_ok", "label": "通过", "condition": {"expression": 'result=="approved"'}},
            {"source": "gw_review", "target": "end_reject", "label": "驳回", "condition": {"expression": 'result=="rejected"'}},
        ],
    },
    # ── Task A3：生产需求审批（sch_production_demands） ──
    {
        "key": "sch_production_demand_approval",
        "name": "生产需求审批",
        "description": "APS 生产需求确认审批：提交→生产经理审批→通过/退回。"
                     "通过后需求 decision_status=Approved，方可生成工单（generate_pr4）。",
        "category": "scheduling",
        "entity_type": "sch_production_demands",
        "entity_view_config": {
            "fields": [
                {"key": "demand_number", "label": "需求编号"},
                {"key": "material_no", "label": "物料编码"},
                {"key": "material_name", "label": "物料名称"},
                {"key": "quantity", "label": "数量"},
                {"key": "priority", "label": "优先级"},
                {"key": "customer", "label": "客户"},
                {"key": "delivery_date", "label": "交期"},
            ],
        },
        "nodes": [
            {"node_key": "start", "node_type": "start", "name": "开始", "position_x": 60, "position_y": 200, "sort_order": 0},
            {"node_key": "prod_mgr_approval", "node_type": "approval", "name": "生产经理审批", "position_x": 320, "position_y": 200, "sort_order": 1,
             "assignee_config": {"assigneeType": "role", "assigneeValue": "production_manager"},
             "approval_config": {"approvalType": "sequential", "reject_action": "terminate"},
             "form_config": {"fields": ["approval_comment", "approval_result"]}},
            {"node_key": "gw_result", "node_type": "exclusive_gateway", "name": "审批结果", "position_x": 580, "position_y": 200, "sort_order": 2},
            {"node_key": "end_approved", "node_type": "end", "name": "审批通过", "position_x": 820, "position_y": 120, "sort_order": 3},
            {"node_key": "end_rejected", "node_type": "end", "name": "审批拒绝", "position_x": 820, "position_y": 300, "sort_order": 4},
        ],
        "edges": [
            {"source": "start", "target": "prod_mgr_approval"},
            {"source": "prod_mgr_approval", "target": "gw_result"},
            {"source": "gw_result", "target": "end_approved", "label": "通过", "condition": {"expression": 'result=="approved"'}},
            {"source": "gw_result", "target": "end_rejected", "label": "拒绝", "condition": {"expression": 'result=="rejected"'}},
        ],
    },
    # ── Technical Contract (CM002) — Pattern A 对齐项目预算：引擎审批 + 通过/驳回网关 ──
    {
        "key": "contract_internal_review",
        "name": "技术合同内部审查",
        "description": "技术→法律→财务会签，法律事务部门必选（CM002-CR02 / CM001-CR07）",
        "category": "contract",
        "entity_type": "tcm_contracts",
        "entity_view_config": {
            "fields": [
                {"key": "contract_number", "label": "合同编号"},
                {"key": "title", "label": "合同标题"},
                {"key": "contract_type", "label": "合同类型"},
                {"key": "amount", "label": "金额"},
                {"key": "status", "label": "状态"},
            ]
        },
        "nodes": [
            {"node_key": "start", "node_type": "start", "name": "开始", "position_x": 60, "position_y": 200, "sort_order": 0},
            {"node_key": "tech_review", "node_type": "approval", "name": "技术部门评价", "position_x": 260, "position_y": 200, "sort_order": 1,
             "assignee_config": {"assigneeType": "role", "assigneeValue": "技术负责人"},
             "approval_config": {"reject_action": "back_to_start"},
             "form_config": {"fields": ["approval_comment", "approval_result"]}},
            {"node_key": "legal_review", "node_type": "approval", "name": "法律事务评价", "position_x": 460, "position_y": 200, "sort_order": 2,
             "assignee_config": {"assigneeType": "role", "assigneeValue": "法律负责人"},
             "approval_config": {"reject_action": "back_to_start"},
             "form_config": {"fields": ["approval_comment", "approval_result"]}},
            {"node_key": "finance_review", "node_type": "approval", "name": "财务部门评价", "position_x": 660, "position_y": 200, "sort_order": 3,
             "assignee_config": {"assigneeType": "role", "assigneeValue": "财务负责人"},
             "approval_config": {"reject_action": "back_to_start"},
             "form_config": {"fields": ["approval_comment", "approval_result"]}},
            {"node_key": "gw_result", "node_type": "exclusive_gateway", "name": "审查结果", "position_x": 860, "position_y": 200, "sort_order": 4},
            {"node_key": "end_approved", "node_type": "end", "name": "审查通过", "position_x": 1060, "position_y": 120, "sort_order": 5},
            {"node_key": "end_rejected", "node_type": "end", "name": "审查驳回", "position_x": 1060, "position_y": 280, "sort_order": 6},
        ],
        "edges": [
            {"source": "start", "target": "tech_review"},
            {"source": "tech_review", "target": "legal_review"},
            {"source": "legal_review", "target": "finance_review"},
            {"source": "finance_review", "target": "gw_result"},
            {"source": "gw_result", "target": "end_approved", "label": "通过", "condition": {"expression": 'result=="approved"'}},
            {"source": "gw_result", "target": "end_rejected", "label": "拒绝", "condition": {"expression": 'result=="rejected"'}},
        ],
    },
    {
        "key": "contract_huayu_approval",
        "name": "华域技术合同审批",
        "description": "华域技术中心审批（CM002-CR03）；由内部审查通过后自动启动，不绑定 find_workflow",
        "category": "contract",
        # 不设 entity_type，避免与 contract_internal_review 争抢 find_workflow_for_entity
        "entity_type": None,
        "entity_view_config": {
            "fields": [
                {"key": "contract_number", "label": "合同编号"},
                {"key": "title", "label": "合同标题"},
                {"key": "amount", "label": "金额"},
            ]
        },
        "nodes": [
            {"node_key": "start", "node_type": "start", "name": "开始", "position_x": 60, "position_y": 200, "sort_order": 0},
            {"node_key": "doc_check", "node_type": "user_task", "name": "报批资料完整性校验", "position_x": 280, "position_y": 200, "sort_order": 1,
             "assignee_config": {"assigneeType": "initiator"}},
            {"node_key": "huayu_approve", "node_type": "approval", "name": "华域技术中心审批", "position_x": 520, "position_y": 200, "sort_order": 2,
             "assignee_config": {"assigneeType": "role", "assigneeValue": "华域技术中心"},
             "approval_config": {"reject_action": "back_to_start"},
             "form_config": {"fields": ["approval_comment", "approval_result"]}},
            {"node_key": "gw_result", "node_type": "exclusive_gateway", "name": "审批结果", "position_x": 760, "position_y": 200, "sort_order": 3},
            {"node_key": "end_approved", "node_type": "end", "name": "审批通过", "position_x": 980, "position_y": 120, "sort_order": 4},
            {"node_key": "end_rejected", "node_type": "end", "name": "审批驳回", "position_x": 980, "position_y": 280, "sort_order": 5},
        ],
        "edges": [
            {"source": "start", "target": "doc_check"},
            {"source": "doc_check", "target": "huayu_approve"},
            {"source": "huayu_approve", "target": "gw_result"},
            {"source": "gw_result", "target": "end_approved", "label": "通过", "condition": {"expression": 'result=="approved"'}},
            {"source": "gw_result", "target": "end_rejected", "label": "拒绝", "condition": {"expression": 'result=="rejected"'}},
        ],
    },
    # ── CM001 Format Contract Template Review ──
    {
        "key": "contract_template_review",
        "name": "格式合同模板会审",
        "description": "格式合同制订/修订会审，法律事务部门必选（CM001-CR01/CR07）",
        "category": "contract",
        "entity_type": "tcm_contract_templates",
        "entity_view_config": {
            "fields": [
                {"key": "template_number", "label": "模板编号"},
                {"key": "name", "label": "模板名称"},
                {"key": "template_type", "label": "模板类型"},
                {"key": "version_no", "label": "版本"},
                {"key": "status", "label": "状态"},
            ]
        },
        "nodes": [
            {"node_key": "start", "node_type": "start", "name": "开始", "position_x": 60, "position_y": 200, "sort_order": 0},
            {"node_key": "legal_review", "node_type": "approval", "name": "法律事务会审", "position_x": 280, "position_y": 200, "sort_order": 1,
             "assignee_config": {"assigneeType": "role", "assigneeValue": "法律负责人"},
             "approval_config": {"reject_action": "back_to_start"},
             "form_config": {"fields": ["approval_comment", "approval_result"]}},
            {"node_key": "tech_review", "node_type": "approval", "name": "技术部门会审", "position_x": 500, "position_y": 200, "sort_order": 2,
             "assignee_config": {"assigneeType": "role", "assigneeValue": "技术负责人"},
             "approval_config": {"reject_action": "back_to_start"},
             "form_config": {"fields": ["approval_comment", "approval_result"]}},
            {"node_key": "finance_review", "node_type": "approval", "name": "财务部门会审", "position_x": 720, "position_y": 200, "sort_order": 3,
             "assignee_config": {"assigneeType": "role", "assigneeValue": "财务负责人"},
             "approval_config": {"reject_action": "back_to_start"},
             "form_config": {"fields": ["approval_comment", "approval_result"]}},
            {"node_key": "gw_result", "node_type": "exclusive_gateway", "name": "会审结果", "position_x": 920, "position_y": 200, "sort_order": 4},
            {"node_key": "end_approved", "node_type": "end", "name": "会审通过", "position_x": 1120, "position_y": 120, "sort_order": 5},
            {"node_key": "end_rejected", "node_type": "end", "name": "会审驳回", "position_x": 1120, "position_y": 280, "sort_order": 6},
        ],
        "edges": [
            {"source": "start", "target": "legal_review"},
            {"source": "legal_review", "target": "tech_review"},
            {"source": "tech_review", "target": "finance_review"},
            {"source": "finance_review", "target": "gw_result"},
            {"source": "gw_result", "target": "end_approved", "label": "通过", "condition": {"expression": 'result=="approved"'}},
            {"source": "gw_result", "target": "end_rejected", "label": "拒绝", "condition": {"expression": 'result=="rejected"'}},
        ],
    },
]


def _fs_review_workflow_template(
    *,
    key: str,
    name: str,
    description: str,
    entity_type: str,
    review_node_name: str,
    end_ok_name: str = "通过",
) -> dict:
    """ISO 26262 功能安全标准评审模板（提交→评审→通过/驳回）。"""
    return {
        "key": key,
        "name": name,
        "description": description,
        "category": "functional_safety",
        "entity_type": entity_type,
        "nodes": [
            {"node_key": "start", "node_type": "start", "name": "开始", "position_x": 60, "position_y": 180, "sort_order": 0},
            {"node_key": "review", "node_type": "approval", "name": review_node_name, "position_x": 320, "position_y": 180, "sort_order": 1,
             "assignee_config": {"assigneeType": "initiator"},
             "approval_config": {"approvalType": "sequential"}},
            {"node_key": "gw_review", "node_type": "exclusive_gateway", "name": "评审结果", "position_x": 580, "position_y": 180, "sort_order": 2},
            {"node_key": "end_ok", "node_type": "end", "name": end_ok_name, "position_x": 840, "position_y": 100, "sort_order": 3},
            {"node_key": "end_reject", "node_type": "end", "name": "驳回", "position_x": 840, "position_y": 260, "sort_order": 4},
        ],
        "edges": [
            {"source": "start", "target": "review"},
            {"source": "review", "target": "gw_review"},
            {"source": "gw_review", "target": "end_ok", "label": "通过", "condition": {"expression": 'result=="approved"'}},
            {"source": "gw_review", "target": "end_reject", "label": "驳回", "condition": {"expression": 'result=="rejected"'}},
        ],
    }


def _huayu_approval_template(
    *,
    key: str,
    name: str,
    description: str,
    category: str,
    entity_type: str,
    fields: list[dict[str, str]],
    approval_name: str,
    role: str,
) -> dict:
    return {
        "key": key,
        "name": name,
        "description": description,
        "category": category,
        "entity_type": entity_type,
        "entity_view_config": {"fields": fields},
        "nodes": [
            {"node_key": "start", "node_type": "start", "name": "开始", "position_x": 60, "position_y": 200, "sort_order": 0},
            {
                "node_key": "approval",
                "node_type": "approval",
                "name": approval_name,
                "position_x": 320,
                "position_y": 200,
                "sort_order": 1,
                "assignee_config": {"assigneeType": "role", "assigneeValue": role},
                "approval_config": {"approvalType": "sequential", "reject_action": "back_to_start"},
                "form_config": {"fields": ["approval_comment", "approval_result"]},
            },
            {"node_key": "gw_result", "node_type": "exclusive_gateway", "name": "审批结果", "position_x": 580, "position_y": 200, "sort_order": 2},
            {"node_key": "end_approved", "node_type": "end", "name": "审批通过", "position_x": 820, "position_y": 120, "sort_order": 3},
            {"node_key": "end_rejected", "node_type": "end", "name": "退回修改", "position_x": 820, "position_y": 300, "sort_order": 4},
        ],
        "edges": [
            {"source": "start", "target": "approval"},
            {"source": "approval", "target": "gw_result"},
            {"source": "gw_result", "target": "end_approved", "label": "通过", "condition": {"expression": 'result=="approved"'}},
            {"source": "gw_result", "target": "end_rejected", "label": "退回", "condition": {"expression": 'result=="rejected"'}},
        ],
    }


# scripts/check-workflow-entity-types.py 扫描字面量 "entity_type": "<table>"
# "entity_type": "pdd_fs_item_definitions"
# "entity_type": "pdd_fs_safety_analysis_items"
# "entity_type": "pdd_fs_functional_safety_concepts"
# "entity_type": "pdd_fs_technical_safety_concepts"
# "entity_type": "pdd_fs_hsi_items"
# "entity_type": "pdd_fs_safety_mechanisms"
# "entity_type": "pdd_fs_safety_plans"
# "entity_type": "pdd_fs_assessments"
# "entity_type": "pdd_fs_product_releases"
# "entity_type": "pdd_fs_production_controls"
# "entity_type": "pdd_fs_field_events"
# "entity_type": "pdd_fs_fta_models"
# "entity_type": "pdd_fs_tool_qualifications"
# "entity_type": "pdd_fs_test_cases"
# "entity_type": "gov_strategy_plans"
# "entity_type": "sim_factory_plans"
# "entity_type": "qlt_ppap_submissions"
# "entity_type": "ehs_work_permits"
# "entity_type": "aig_go_live_reviews"

WORKFLOW_TEMPLATES.extend(
    [
        _fs_review_workflow_template(
            key="fs_item_definition_review_workflow",
            name="相关项定义评审审批",
            description="ISO 26262 相关项定义评审审批流程。",
            entity_type="pdd_fs_item_definitions",
            review_node_name="相关项定义评审",
        ),
        _fs_review_workflow_template(
            key="fs_safety_analysis_review_workflow",
            name="安全分析项评审审批",
            description="ISO 26262 FMEA/DFA/FMEDA 等安全分析项评审审批。",
            entity_type="pdd_fs_safety_analysis_items",
            review_node_name="安全分析评审",
        ),
        _fs_review_workflow_template(
            key="fs_fsc_review_workflow",
            name="功能安全概念评审审批",
            description="ISO 26262 FSC 评审审批流程。",
            entity_type="pdd_fs_functional_safety_concepts",
            review_node_name="FSC评审",
        ),
        _fs_review_workflow_template(
            key="fs_tsc_review_workflow",
            name="技术安全概念评审审批",
            description="ISO 26262 TSC 评审审批流程。",
            entity_type="pdd_fs_technical_safety_concepts",
            review_node_name="TSC评审",
        ),
        _fs_review_workflow_template(
            key="fs_hsi_review_workflow",
            name="HSI评审审批",
            description="ISO 26262 硬件软件接口评审审批。",
            entity_type="pdd_fs_hsi_items",
            review_node_name="HSI评审",
        ),
        _fs_review_workflow_template(
            key="fs_safety_mechanism_review_workflow",
            name="安全机制评审审批",
            description="ISO 26262 安全机制目录评审审批。",
            entity_type="pdd_fs_safety_mechanisms",
            review_node_name="安全机制评审",
        ),
        _fs_review_workflow_template(
            key="fs_safety_plan_review_workflow",
            name="安全管理计划评审审批",
            description="ISO 26262 Part 2 安全管理计划评审审批。",
            entity_type="pdd_fs_safety_plans",
            review_node_name="安全计划评审",
        ),
        _fs_review_workflow_template(
            key="fs_assessment_review_workflow",
            name="功能安全评估评审审批",
            description="ISO 26262 功能安全评估评审审批。",
            entity_type="pdd_fs_assessments",
            review_node_name="评估评审",
        ),
        _fs_review_workflow_template(
            key="fs_product_release_review_workflow",
            name="产品发布评审审批",
            description="ISO 26262 产品发布评审审批。",
            entity_type="pdd_fs_product_releases",
            review_node_name="发布评审",
        ),
        _fs_review_workflow_template(
            key="fs_production_control_review_workflow",
            name="生产控制评审审批",
            description="ISO 26262 Part 7 生产控制评审审批。",
            entity_type="pdd_fs_production_controls",
            review_node_name="生产控制评审",
        ),
        _fs_review_workflow_template(
            key="fs_field_event_review_workflow",
            name="现场事件关闭评审",
            description="ISO 26262 Part 7 现场事件关闭评审。",
            entity_type="pdd_fs_field_events",
            review_node_name="现场事件评审",
            end_ok_name="关闭",
        ),
        _fs_review_workflow_template(
            key="fs_fta_review_workflow",
            name="FTA评审审批",
            description="ISO 26262 故障树分析评审审批。",
            entity_type="pdd_fs_fta_models",
            review_node_name="FTA评审",
        ),
        _fs_review_workflow_template(
            key="fs_tool_qualification_review_workflow",
            name="工具鉴定评审审批",
            description="ISO 26262 Part 8 工具鉴定评审审批。",
            entity_type="pdd_fs_tool_qualifications",
            review_node_name="工具鉴定评审",
        ),
        _fs_review_workflow_template(
            key="fs_test_case_review_workflow",
            name="安全测试用例评审审批",
            description="ISO 26262 安全测试用例评审审批。",
            entity_type="pdd_fs_test_cases",
            review_node_name="测试用例评审",
        ),
    ]
)

WORKFLOW_TEMPLATES.extend(
    [
        _huayu_approval_template(
            key="gov_strategy_plan_approval",
            name="战略规划审批",
            description="厂级战略规划正式审批：提交→管理层审批→通过/退回。",
            category="governance",
            entity_type="gov_strategy_plans",
            fields=[
                {"key": "plan_no", "label": "规划编号"},
                {"key": "title", "label": "标题"},
                {"key": "plan_type", "label": "类型"},
                {"key": "status_label", "label": "状态"},
            ],
            approval_name="厂级审批",
            role="plant_manager",
        ),
        _huayu_approval_template(
            key="sim_factory_plan_approval",
            name="工厂规划方案审批",
            description="工厂规划方案正式审批：提交→规划负责人审批→通过/退回。",
            category="simulation",
            entity_type="sim_factory_plans",
            fields=[
                {"key": "plan_no", "label": "方案编号"},
                {"key": "title", "label": "标题"},
                {"key": "factory_code", "label": "工厂"},
                {"key": "status_label", "label": "状态"},
            ],
            approval_name="规划审批",
            role="plant_manager",
        ),
        _huayu_approval_template(
            key="qlt_ppap_submission_approval",
            name="PPAP提交审批",
            description="PPAP 提交包正式审批：提交→质量经理审批→通过/退回。须已有批准控制计划。",
            category="quality",
            entity_type="qlt_ppap_submissions",
            fields=[
                {"key": "submission_no", "label": "提交编号"},
                {"key": "title", "label": "标题"},
                {"key": "level", "label": "等级"},
                {"key": "part_no", "label": "零件号"},
                {"key": "status_label", "label": "状态"},
            ],
            approval_name="质量经理审批",
            role="quality_manager",
        ),
        _huayu_approval_template(
            key="ehs_work_permit_approval",
            name="危险作业许可审批",
            description="危险作业许可正式审批：提交→EHS 审批→通过/退回。",
            category="ehs",
            entity_type="ehs_work_permits",
            fields=[
                {"key": "permit_no", "label": "许可编号"},
                {"key": "title", "label": "作业"},
                {"key": "work_type", "label": "类型"},
                {"key": "location", "label": "地点"},
                {"key": "status_label", "label": "状态"},
            ],
            approval_name="EHS审批",
            role="ehs_manager",
        ),
        _huayu_approval_template(
            key="aig_go_live_review_approval",
            name="AI上线评审审批",
            description="AI 助手/模型上线评审：提交→治理负责人审批→通过/退回。",
            category="ai",
            entity_type="aig_go_live_reviews",
            fields=[
                {"key": "review_no", "label": "评审编号"},
                {"key": "title", "label": "标题"},
                {"key": "human_reviewer", "label": "复核人"},
                {"key": "status_label", "label": "状态"},
            ],
            approval_name="治理审批",
            role="ai_governance",
        ),
    ]
)


async def _sync_builtin_workflow_template(
    db: AsyncSession,
    tmpl: dict,
    existing: WorkflowDefinition | None = None,
) -> tuple[WorkflowDefinition, str] | None:
    if existing is None:
        stmt = (
            select(WorkflowDefinition)
            .where(WorkflowDefinition.key == tmpl["key"])
            .options(
                selectinload(
                    WorkflowDefinition.nodes.and_(WorkflowNode.is_deleted == False)  # noqa: E712
                ),
                selectinload(
                    WorkflowDefinition.edges.and_(WorkflowEdge.is_deleted == False)  # noqa: E712
                ),
            )
        )
        result = await db.execute(stmt)
        existing = result.scalar_one_or_none()

    if not existing:
        return None

    if tmpl["key"] not in SYNCABLE_BUILTIN_WORKFLOW_KEYS:
        return existing, "skip"

    # 结构未变则跳过：避免每次 start.sh 对 40+ 个模板做节点/边软删重建（远程库可达 20s+）
    try:
        if _existing_workflow_fingerprint(existing) == _workflow_template_fingerprint(tmpl):
            return existing, "unchanged"
    except Exception:
        # 指纹失败时回退到原同步路径，保证模板仍能收敛
        pass

    active_instance_result = await db.execute(
        select(WorkflowInstance.id)
        .where(WorkflowInstance.is_deleted == False)  # noqa: E712  SQLAlchemy 查询表达式
        .where(WorkflowInstance.definition_id == existing.id)
        .where(WorkflowInstance.status.in_(["running", "suspended"]))
        .limit(1)
    )
    if active_instance_result.scalar_one_or_none():
        # Display-only metadata is safe to sync while instances are running
        if tmpl.get("entity_view_config") is not None:
            existing.entity_view_config = tmpl.get("entity_view_config")
        if tmpl.get("entity_type"):
            existing.entity_type = tmpl.get("entity_type")
        print(f"  ⚠ Workflow '{tmpl['key']}' has active instances, synced view_config only")
        return existing, "active"

    existing.name = tmpl["name"]
    existing.description = tmpl["description"]
    existing.category = tmpl["category"]
    existing.entity_type = tmpl.get("entity_type")
    existing.entity_view_config = tmpl.get("entity_view_config")
    existing.is_builtin = True
    existing.status = "published"

    for edge in list(existing.edges):
        if not edge.is_deleted:
            edge.is_deleted = True
    for node in list(existing.nodes):
        if not node.is_deleted:
            node.is_deleted = True
    await db.flush()

    return existing, "update"


async def seed_workflows() -> None:
    """Insert or update built-in workflow templates."""
    async with AsyncSessionLocal() as db:
        db: AsyncSession
        created = updated = skipped = unchanged = active = 0

        # 一次批量加载，避免每个模板单独 selectinload（远程库可达数十秒）
        template_keys = [tmpl["key"] for tmpl in WORKFLOW_TEMPLATES]
        existing_result = await db.execute(
            select(WorkflowDefinition)
            .where(WorkflowDefinition.key.in_(template_keys))
            .options(
                # 仅加载活跃节点/边：多次启动软删重建后历史行很多，全量 selectinload 会拖慢远程启动
                selectinload(
                    WorkflowDefinition.nodes.and_(WorkflowNode.is_deleted == False)  # noqa: E712
                ),
                selectinload(
                    WorkflowDefinition.edges.and_(WorkflowEdge.is_deleted == False)  # noqa: E712
                ),
            )
        )
        existing_by_key = {d.key: d for d in existing_result.scalars().all()}

        for tmpl in WORKFLOW_TEMPLATES:
            sync_result = await _sync_builtin_workflow_template(
                db, tmpl, existing=existing_by_key.get(tmpl["key"])
            )
            if sync_result is None:
                defn = WorkflowDefinition(
                    id=uuid4(),
                    key=tmpl["key"],
                    name=tmpl["name"],
                    description=tmpl["description"],
                    category=tmpl["category"],
                    entity_type=tmpl.get("entity_type"),
                    entity_view_config=tmpl.get("entity_view_config"),
                    is_builtin=True,
                    status="published",  # Built-in templates are ready to use
                )
                db.add(defn)
                await db.flush()
                action = "created"
                existing_by_key[tmpl["key"]] = defn
            else:
                defn, action = sync_result
                if action in ("skip", "unchanged"):
                    # unchanged：syncable 模板结构一致，无需重写节点/边
                    if action == "unchanged":
                        unchanged += 1
                    else:
                        skipped += 1
                    continue
                if action == "active":
                    active += 1
                    await db.commit()
                    continue

            # Create nodes
            node_key_to_id: dict[str, str] = {}
            for ndata in tmpl["nodes"]:
                node = WorkflowNode(
                    id=uuid4(),
                    definition_id=defn.id,
                    node_key=ndata["node_key"],
                    name=ndata["name"],
                    node_type=ndata["node_type"],
                    sort_order=ndata.get("sort_order", 0),
                    position_x=ndata.get("position_x", 0),
                    position_y=ndata.get("position_y", 0),
                    assignee_config=ndata.get("assignee_config"),
                    approval_config=ndata.get("approval_config"),
                    form_config=ndata.get("form_config"),
                    action_config=ndata.get("action_config"),
                    gateway_config=ndata.get("gateway_config"),
                    timeout_config=ndata.get("timeout_config"),
                )
                db.add(node)
                await db.flush()
                node_key_to_id[ndata["node_key"]] = node.id  # type: ignore[reportArgumentType]  类型修复

            # Create edges
            for i, edata in enumerate(tmpl["edges"]):
                source_id = node_key_to_id.get(edata["source"])
                target_id = node_key_to_id.get(edata["target"])
                if not source_id or not target_id:
                    print(f"  ⚠ Invalid edge in '{tmpl['key']}': {edata['source']} → {edata['target']}")
                    continue
                edge = WorkflowEdge(
                    id=uuid4(),
                    definition_id=defn.id,
                    source_node_id=source_id,
                    target_node_id=target_id,
                    label=edata.get("label"),
                    condition=edata.get("condition"),
                    is_default=edata.get("is_default", False),
                    sort_order=i,
                )
                db.add(edge)

            await db.commit()
            node_count = len(tmpl["nodes"])
            edge_count = len(tmpl["edges"])
            if action == "update":
                updated += 1
                verb = "Updated"
            else:
                created += 1
                verb = "Created"
            print(f"  ✅ {verb} workflow '{tmpl['name']}' ({node_count} nodes, {edge_count} edges)")

        print(
            "\n🎉 Workflow template seeding complete! "
            f"(created={created}, updated={updated}, unchanged={unchanged}, "
            f"skipped={skipped}, active_partial={active})"
        )

if __name__ == "__main__":
    asyncio.run(seed_workflows())

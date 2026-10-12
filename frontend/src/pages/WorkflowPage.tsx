import { Activity, AlertTriangle, Archive, ArrowDown, ArrowUp, ArrowUpDown, ArrowUpRight, BookOpen, Check, CheckCircle, ChevronRight, Clock, Copy, Download, Eye, FileText, Filter, GitBranch, GitMerge, Hash, Layers, LayoutGrid, List, ListChecks, MoreVertical, PauseCircle, Play, Plus, RefreshCcw, Search, Send, Settings, Shield, Target, Trash2, TrendingUp, Upload, X, XCircle } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import React, { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { useLocation, useNavigate as useRRNavigate, useSearchParams } from 'react-router-dom';
import { Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useApp } from '../contexts/AppContext';
import { workflowQuickActions, type WorkflowAIPageKind } from '../utils/workflowAIActions';
import { useAuth } from '../contexts/AuthContext';
import { workflowInstancesApi, workflowsApi, workflowTasksApi } from '../services';
import { ManualViewer } from '../components/ManualViewer';
import SearchableSelect from '../components/SearchableSelect';
import { workflowManual } from '../manuals';
import {
  buildWorkflowCategoryFilterOptions,
  getWorkflowCategoryColor,
  getWorkflowCategoryLabel,
  WORKFLOW_CATEGORY_COLORS,
  WORKFLOW_CATEGORY_LABELS,
} from './workflow/workflowCategoryLabels';
import type {
    WorkflowDefinition, WorkflowInstance, WorkflowTaskItem,
    WorkflowTaskSummary
} from '../types';

/* Lazy sub-pages */
const WorkflowDesignerPage = lazy(() => import('./workflow/WorkflowDesignerPage'));
const WorkflowInstanceDetailPage = lazy(() => import('./workflow/WorkflowInstanceDetailPage'));
const WorkflowTaskHandlePage = lazy(() => import('./workflow/WorkflowTaskHandlePage'));

const PageFallback = () => (
  <div className="flex items-center justify-center h-64">
    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
  </div>
);

const CATEGORY_LABELS = WORKFLOW_CATEGORY_LABELS;
const CATEGORY_COLORS = WORKFLOW_CATEGORY_COLORS;

const CATEGORY_ICONS: Record<string, LucideIcon> = {
  change_management: Shield,
  document: FileText,
  design_review: Eye,
  deviation: AlertTriangle,
  custom: Settings,
  functional_safety: Shield,
  material: Layers,
  process: GitMerge,
  project: Target,
  equipment: Settings,
  product_dev: Eye,
  quality: CheckCircle,
  manufacturing: Activity,
  problem_management: AlertTriangle,
  scheduling: Clock,
  contract: FileText,
  governance: Shield,
  simulation: Layers,
  ehs: AlertTriangle,
  ai: Settings,
};

const PIE_COLORS = ['#3b82f6', '#22c55e', '#ef4444', '#eab308', '#a855f7', '#6b7280'];

const STATUS_BADGES: Record<string, { bg: string; label: string }> = {
  draft: { bg: 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300', label: '草稿' },
  published: { bg: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400', label: '已发布' },
  archived: { bg: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400', label: '已归档' },
  running: { bg: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400', label: '运行中' },
  completed: { bg: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400', label: '已完成' },
  terminated: { bg: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400', label: '已终止' },
  suspended: { bg: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400', label: '已挂起' },
  pending: { bg: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400', label: '待处理' },
  claimed: { bg: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400', label: '处理中' },
};

const WORKFLOW_TEMPLATES = [
  { key: 'ecr_approval', name: 'ECR 变更请求审批', category: 'change_management', description: '工程变更请求的标准审批流程：提交→技术评审→管理层审批→实施', icon: Shield, color: 'text-orange-600 bg-orange-50 dark:bg-orange-900/20' },
  { key: 'eco_implementation', name: 'ECO 变更实施', category: 'change_management', description: '工程变更单的完整实施流程：方案评估→影响分析→多方审批→实施验证', icon: GitMerge, color: 'text-amber-600 bg-amber-50 dark:bg-amber-900/20' },
  { key: 'doc_review', name: '文档评审发布', category: 'document', description: '技术文档的评审与发布流程：编写→部门评审→批准→发布', icon: FileText, color: 'text-blue-600 bg-blue-50 dark:bg-blue-900/20' },
  { key: 'design_review', name: '设计评审', category: 'design_review', description: '产品设计阶段评审：概念评审→详细设计评审→原型验证→量产确认', icon: Eye, color: 'text-purple-600 bg-purple-50 dark:bg-purple-900/20' },
  { key: 'deviation_handling', name: '偏差处理', category: 'deviation', description: '生产偏差处理流程：偏差报告→影响评估→处置决定→跟踪关闭', icon: AlertTriangle, color: 'text-red-600 bg-red-50 dark:bg-red-900/20' },
];

// Pre-built node/edge templates for quick-start
// Uses camelCase keys: nodeKey, nodeType, positionX, positionY, sourceNodeKey, targetNodeKey
// The API client auto-converts to snake_case for the backend
interface TemplateNode {
  nodeKey: string;
  nodeType: string;
  name: string;
  positionX: number;
  positionY: number;
  assigneeConfig?: { assigneeType: string; assigneeValue?: string };
  approvalConfig?: { approvalType: string; minApprovers?: number };
  formConfig?: { fields: string[] };
  actionConfig?: { actions: { type: string; config: Record<string, string> }[] };
  gatewayConfig?: { gatewayType: string };
}
interface TemplateEdge {
  sourceNodeKey: string;
  targetNodeKey: string;
  label?: string;
  condition?: { expression: string };
}
const TEMPLATE_DESIGNS: Record<string, { nodes: TemplateNode[]; edges: TemplateEdge[] }> = {

  // ── ECR 变更请求审批 ──────────────────────────────────
  // 提交 → 技术评审 → 管理层审批(通过/退回)
  ecr_approval: {
    nodes: [
      { nodeKey: 'start', nodeType: 'start', name: '开始', positionX: 60, positionY: 200 },
      { nodeKey: 'submit', nodeType: 'user_task', name: '提交变更请求', positionX: 260, positionY: 200,
        assigneeConfig: { assigneeType: 'initiator' } },
      { nodeKey: 'tech_review', nodeType: 'approval', name: '技术评审', positionX: 480, positionY: 200,
        assigneeConfig: { assigneeType: 'role', assigneeValue: '技术评审员' } },
      { nodeKey: 'gw1', nodeType: 'exclusive_gateway', name: '评审结果', positionX: 700, positionY: 200 },
      { nodeKey: 'mgr_approve', nodeType: 'approval', name: '管理层审批', positionX: 920, positionY: 140,
        assigneeConfig: { assigneeType: 'role', assigneeValue: '部门经理' } },
      { nodeKey: 'revise', nodeType: 'user_task', name: '修改补充', positionX: 920, positionY: 280,
        assigneeConfig: { assigneeType: 'initiator' } },
      { nodeKey: 'end_ok', nodeType: 'end', name: '审批通过', positionX: 1140, positionY: 140 },
      { nodeKey: 'end_no', nodeType: 'end', name: '关闭', positionX: 1140, positionY: 280 },
    ],
    edges: [
      { sourceNodeKey: 'start', targetNodeKey: 'submit' },
      { sourceNodeKey: 'submit', targetNodeKey: 'tech_review' },
      { sourceNodeKey: 'tech_review', targetNodeKey: 'gw1' },
      { sourceNodeKey: 'gw1', targetNodeKey: 'mgr_approve', label: '通过', condition: { expression: 'result=="approved"' } },
      { sourceNodeKey: 'gw1', targetNodeKey: 'revise', label: '退回', condition: { expression: 'result=="rejected"' } },
      { sourceNodeKey: 'mgr_approve', targetNodeKey: 'end_ok' },
      { sourceNodeKey: 'revise', targetNodeKey: 'end_no' },
    ],
  },

  // ── 文档评审发布 ──────────────────────────────────
  doc_review: {
    nodes: [
      { nodeKey: 'start', nodeType: 'start', name: '开始', positionX: 60, positionY: 200 },
      { nodeKey: 'dept_review', nodeType: 'approval', name: '部门评审', positionX: 280, positionY: 200,
        assigneeConfig: { assigneeType: 'role', assigneeValue: '文档评审员' } },
      { nodeKey: 'gw1', nodeType: 'exclusive_gateway', name: '评审决定', positionX: 500, positionY: 200 },
      { nodeKey: 'approve', nodeType: 'approval', name: '审批发布', positionX: 720, positionY: 140,
        assigneeConfig: { assigneeType: 'role', assigneeValue: '文控经理' } },
      { nodeKey: 'reject', nodeType: 'user_task', name: '退回修改', positionX: 720, positionY: 280,
        assigneeConfig: { assigneeType: 'initiator' } },
      { nodeKey: 'publish', nodeType: 'service_task', name: '自动发布', positionX: 940, positionY: 140,
        actionConfig: { actions: [{ type: 'update_field', config: { entityType: 'document', field: 'status', value: 'published' } }] } },
      { nodeKey: 'end', nodeType: 'end', name: '结束', positionX: 1140, positionY: 200 },
    ],
    edges: [
      { sourceNodeKey: 'start', targetNodeKey: 'dept_review' },
      { sourceNodeKey: 'dept_review', targetNodeKey: 'gw1' },
      { sourceNodeKey: 'gw1', targetNodeKey: 'approve', label: '通过', condition: { expression: 'result=="approved"' } },
      { sourceNodeKey: 'gw1', targetNodeKey: 'reject', label: '退回', condition: { expression: 'result=="rejected"' } },
      { sourceNodeKey: 'approve', targetNodeKey: 'publish' },
      { sourceNodeKey: 'publish', targetNodeKey: 'end' },
      { sourceNodeKey: 'reject', targetNodeKey: 'end' },
    ],
  },

  // ── ECO 变更实施流程 ──────────────────────────────────
  // 完整实施流程: 方案评估 → 并行审批(影响分析 | 成本评估) → CCB 会签 → 实施 → 验证
  eco_implementation: {
    nodes: [
      { nodeKey: 'start', nodeType: 'start', name: '开始', positionX: 60, positionY: 240 },
      { nodeKey: 'plan_review', nodeType: 'approval', name: '方案评估', positionX: 260, positionY: 240,
        assigneeConfig: { assigneeType: 'role', assigneeValue: '变更工程师' },
        formConfig: { fields: ['implementation_plan', 'affected_items', 'timeline'] },
      },
      { nodeKey: 'pg_fork', nodeType: 'parallel_gateway', name: '并行评估', positionX: 460, positionY: 240,
        gatewayConfig: { gatewayType: 'fork' },
      },
      { nodeKey: 'impact_analysis', nodeType: 'user_task', name: '影响分析', positionX: 660, positionY: 120,
        assigneeConfig: { assigneeType: 'role', assigneeValue: '技术专家' },
        formConfig: { fields: ['impact_scope', 'affected_parts', 'affected_processes'] },
      },
      { nodeKey: 'cost_analysis', nodeType: 'user_task', name: '成本评估', positionX: 660, positionY: 360,
        assigneeConfig: { assigneeType: 'role', assigneeValue: '财务分析员' },
        formConfig: { fields: ['tooling_cost', 'material_cost', 'labor_cost', 'total_estimate'] },
      },
      { nodeKey: 'pg_join', nodeType: 'parallel_gateway', name: '汇总', positionX: 860, positionY: 240,
        gatewayConfig: { gatewayType: 'join' },
      },
      { nodeKey: 'ccb_review', nodeType: 'approval', name: 'CCB 会签审批', positionX: 1060, positionY: 240,
        assigneeConfig: { assigneeType: 'role', assigneeValue: 'CCB 委员会' },
        approvalConfig: { approvalType: 'countersign', minApprovers: 3 },
      },
      { nodeKey: 'gw_ccb', nodeType: 'exclusive_gateway', name: 'CCB 决议', positionX: 1260, positionY: 240 },
      { nodeKey: 'implement', nodeType: 'user_task', name: '实施变更', positionX: 1460, positionY: 160,
        assigneeConfig: { assigneeType: 'role', assigneeValue: '实施负责人' },
        formConfig: { fields: ['implementation_record', 'completion_date'] },
      },
      { nodeKey: 'verify', nodeType: 'approval', name: '验证确认', positionX: 1660, positionY: 160,
        assigneeConfig: { assigneeType: 'role', assigneeValue: '质量工程师' },
        formConfig: { fields: ['verification_result', 'test_report'] },
      },
      { nodeKey: 'end_ok', nodeType: 'end', name: '变更完成', positionX: 1860, positionY: 160 },
      { nodeKey: 'revise', nodeType: 'user_task', name: '退回修改', positionX: 1460, positionY: 340,
        assigneeConfig: { assigneeType: 'initiator' },
      },
      { nodeKey: 'end_reject', nodeType: 'end', name: '变更驳回', positionX: 1660, positionY: 340 },
    ],
    edges: [
      { sourceNodeKey: 'start', targetNodeKey: 'plan_review' },
      { sourceNodeKey: 'plan_review', targetNodeKey: 'pg_fork' },
      { sourceNodeKey: 'pg_fork', targetNodeKey: 'impact_analysis' },
      { sourceNodeKey: 'pg_fork', targetNodeKey: 'cost_analysis' },
      { sourceNodeKey: 'impact_analysis', targetNodeKey: 'pg_join' },
      { sourceNodeKey: 'cost_analysis', targetNodeKey: 'pg_join' },
      { sourceNodeKey: 'pg_join', targetNodeKey: 'ccb_review' },
      { sourceNodeKey: 'ccb_review', targetNodeKey: 'gw_ccb' },
      { sourceNodeKey: 'gw_ccb', targetNodeKey: 'implement', label: '批准实施', condition: { expression: 'result=="approved"' } },
      { sourceNodeKey: 'gw_ccb', targetNodeKey: 'revise', label: '驳回', condition: { expression: 'result=="rejected"' } },
      { sourceNodeKey: 'implement', targetNodeKey: 'verify' },
      { sourceNodeKey: 'verify', targetNodeKey: 'end_ok' },
      { sourceNodeKey: 'revise', targetNodeKey: 'end_reject' },
    ],
  },

  // ── 设计评审流程 ──────────────────────────────────
  // APQP 阶段评审: 概念评审 → 详细设计评审 → 原型验证 → 量产确认
  design_review: {
    nodes: [
      { nodeKey: 'start', nodeType: 'start', name: '开始', positionX: 60, positionY: 200 },
      { nodeKey: 'concept_review', nodeType: 'approval', name: '概念评审', positionX: 280, positionY: 200,
        assigneeConfig: { assigneeType: 'role', assigneeValue: '设计评审组' },
        approvalConfig: { approvalType: 'countersign', minApprovers: 2 },
        formConfig: { fields: ['design_concept', 'feasibility', 'risk_items'] },
      },
      { nodeKey: 'gw_concept', nodeType: 'exclusive_gateway', name: '概念评审结果', positionX: 480, positionY: 200 },
      { nodeKey: 'detail_review', nodeType: 'approval', name: '详细设计评审', positionX: 680, positionY: 140,
        assigneeConfig: { assigneeType: 'role', assigneeValue: '高级工程师' },
        formConfig: { fields: ['design_specs', 'dfmea', 'design_verification_plan'] },
      },
      { nodeKey: 'gw_detail', nodeType: 'exclusive_gateway', name: '详设评审结果', positionX: 880, positionY: 140 },
      { nodeKey: 'prototype', nodeType: 'user_task', name: '原型验证', positionX: 1080, positionY: 80,
        assigneeConfig: { assigneeType: 'role', assigneeValue: '测试工程师' },
        formConfig: { fields: ['test_results', 'dvp_report', 'issues_found'] },
      },
      { nodeKey: 'production_confirm', nodeType: 'approval', name: '量产确认', positionX: 1280, positionY: 80,
        assigneeConfig: { assigneeType: 'role', assigneeValue: '生产经理' },
        approvalConfig: { approvalType: 'sequential' },
        formConfig: { fields: ['production_readiness', 'ppap_status', 'capacity_plan'] },
      },
      { nodeKey: 'end_approved', nodeType: 'end', name: '评审通过', positionX: 1480, positionY: 80 },
      { nodeKey: 'rework', nodeType: 'user_task', name: '返工修改', positionX: 680, positionY: 300,
        assigneeConfig: { assigneeType: 'initiator' },
      },
      { nodeKey: 'end_rejected', nodeType: 'end', name: '评审终止', positionX: 880, positionY: 300 },
    ],
    edges: [
      { sourceNodeKey: 'start', targetNodeKey: 'concept_review' },
      { sourceNodeKey: 'concept_review', targetNodeKey: 'gw_concept' },
      { sourceNodeKey: 'gw_concept', targetNodeKey: 'detail_review', label: '通过', condition: { expression: 'result=="approved"' } },
      { sourceNodeKey: 'gw_concept', targetNodeKey: 'rework', label: '不通过', condition: { expression: 'result=="rejected"' } },
      { sourceNodeKey: 'detail_review', targetNodeKey: 'gw_detail' },
      { sourceNodeKey: 'gw_detail', targetNodeKey: 'prototype', label: '通过', condition: { expression: 'result=="approved"' } },
      { sourceNodeKey: 'gw_detail', targetNodeKey: 'rework', label: '退回', condition: { expression: 'result=="rejected"' } },
      { sourceNodeKey: 'prototype', targetNodeKey: 'production_confirm' },
      { sourceNodeKey: 'production_confirm', targetNodeKey: 'end_approved' },
      { sourceNodeKey: 'rework', targetNodeKey: 'end_rejected' },
    ],
  },

  // ── 偏差处理流程 ──────────────────────────────────
  // 偏差报告 → 并行(安全评估|质量评估) → 处置决定 → 纠正措施/照用 → 效果验证 → 关闭
  deviation_handling: {
    nodes: [
      { nodeKey: 'start', nodeType: 'start', name: '开始', positionX: 60, positionY: 220 },
      { nodeKey: 'report', nodeType: 'user_task', name: '偏差报告', positionX: 260, positionY: 220,
        assigneeConfig: { assigneeType: 'initiator' },
        formConfig: { fields: ['deviation_description', 'detection_point', 'affected_quantity', 'containment_action'] },
      },
      { nodeKey: 'pg_fork', nodeType: 'parallel_gateway', name: '并行评估', positionX: 460, positionY: 220,
        gatewayConfig: { gatewayType: 'fork' },
      },
      { nodeKey: 'safety_assess', nodeType: 'approval', name: '安全影响评估', positionX: 660, positionY: 120,
        assigneeConfig: { assigneeType: 'role', assigneeValue: '安全工程师' },
        formConfig: { fields: ['safety_impact', 'asil_level', 'iso26262_relevant'] },
      },
      { nodeKey: 'quality_assess', nodeType: 'approval', name: '质量影响评估', positionX: 660, positionY: 320,
        assigneeConfig: { assigneeType: 'role', assigneeValue: '质量工程师' },
        formConfig: { fields: ['quality_impact', 'customer_impact', 'recall_risk'] },
      },
      { nodeKey: 'pg_join', nodeType: 'parallel_gateway', name: '汇总', positionX: 860, positionY: 220,
        gatewayConfig: { gatewayType: 'join' },
      },
      { nodeKey: 'disposition', nodeType: 'approval', name: '处置决定', positionX: 1060, positionY: 220,
        assigneeConfig: { assigneeType: 'role', assigneeValue: '质量经理' },
        formConfig: { fields: ['disposition_type', 'justification'] },
      },
      { nodeKey: 'gw_disp', nodeType: 'exclusive_gateway', name: '处置类型', positionX: 1260, positionY: 220 },
      { nodeKey: 'corrective', nodeType: 'user_task', name: '纠正措施', positionX: 1460, positionY: 140,
        assigneeConfig: { assigneeType: 'role', assigneeValue: '工艺工程师' },
        formConfig: { fields: ['root_cause', 'corrective_action', 'preventive_action', 'target_date'] },
      },
      { nodeKey: 'effectiveness', nodeType: 'approval', name: '效果验证', positionX: 1660, positionY: 140,
        assigneeConfig: { assigneeType: 'role', assigneeValue: '质量工程师' },
        formConfig: { fields: ['verification_method', 'verification_result', 'effectiveness_confirmed'] },
      },
      { nodeKey: 'direct_close', nodeType: 'user_task', name: '直接关闭(照用)', positionX: 1460, positionY: 320,
        assigneeConfig: { assigneeType: 'role', assigneeValue: '质量经理' },
        formConfig: { fields: ['use_as_is_justification', 'customer_approval'] },
      },
      { nodeKey: 'close', nodeType: 'service_task', name: '关闭偏差', positionX: 1860, positionY: 220,
        actionConfig: { actions: [{ type: 'update_field', config: { entityType: 'change_request', field: 'status', value: 'closed' } }] },
      },
      { nodeKey: 'end', nodeType: 'end', name: '结束', positionX: 2040, positionY: 220 },
    ],
    edges: [
      { sourceNodeKey: 'start', targetNodeKey: 'report' },
      { sourceNodeKey: 'report', targetNodeKey: 'pg_fork' },
      { sourceNodeKey: 'pg_fork', targetNodeKey: 'safety_assess' },
      { sourceNodeKey: 'pg_fork', targetNodeKey: 'quality_assess' },
      { sourceNodeKey: 'safety_assess', targetNodeKey: 'pg_join' },
      { sourceNodeKey: 'quality_assess', targetNodeKey: 'pg_join' },
      { sourceNodeKey: 'pg_join', targetNodeKey: 'disposition' },
      { sourceNodeKey: 'disposition', targetNodeKey: 'gw_disp' },
      { sourceNodeKey: 'gw_disp', targetNodeKey: 'corrective', label: '需纠正措施', condition: { expression: 'disposition_type!="use_as_is"' } },
      { sourceNodeKey: 'gw_disp', targetNodeKey: 'direct_close', label: '照用处置', condition: { expression: 'disposition_type=="use_as_is"' } },
      { sourceNodeKey: 'corrective', targetNodeKey: 'effectiveness' },
      { sourceNodeKey: 'effectiveness', targetNodeKey: 'close' },
      { sourceNodeKey: 'direct_close', targetNodeKey: 'close' },
      { sourceNodeKey: 'close', targetNodeKey: 'end' },
    ],
  },
};

type TabId = 'overview' | 'definitions' | 'instances' | 'my-tasks';

type SubPage =
  | { type: 'list' }
  | { type: 'designer'; definitionId: string }
  | { type: 'instance-detail'; instanceId: string }
  | { type: 'task-handle'; taskId: string };

interface WorkflowPageProps {
  basePath?: string;
}

const StatusBadge: React.FC<{ status: string }> = ({ status }) => {
  const config = STATUS_BADGES[status] || { bg: 'bg-gray-100 text-gray-600', label: status };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${config.bg}`}>
      {config.label}
    </span>
  );
};

const WorkflowPage: React.FC<WorkflowPageProps> = ({ basePath = '/workflows' }) => {
  const { theme, setPageAIContext } = useApp();
  const isDark = theme === 'dark';
  const { user } = useAuth();
  const [showManual, setShowManual] = React.useState(false);
  const location = useLocation();
  const navigate = useRRNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const normalizedBasePath = useMemo(() => {
    const trimmed = basePath.replace(/\/+$/, '');
    return trimmed || '/workflows';
  }, [basePath]);

  // Derive active tab from URL path
  const activeTab: TabId = useMemo(() => {
    const p = location.pathname;
    if (p.endsWith('/definitions')) return 'definitions';
    if (p.endsWith('/instances')) return 'instances';
    if (p.endsWith('/tasks')) return 'my-tasks';
    return 'overview';
  }, [location.pathname]);

  // 根路径自动重定向到 dashboard，支持挂载到项目路由下
  useEffect(() => {
    if (location.pathname === normalizedBasePath || location.pathname === `${normalizedBasePath}/`) {
      navigate(`${normalizedBasePath}/dashboard`);
    }
  }, [location.pathname, navigate, normalizedBasePath]);

  // Replaces setActiveTab(tabId) calls
  const setActiveTab = useCallback((tab: TabId) => {
    const routes: Record<TabId, string> = {
      overview: `${normalizedBasePath}/dashboard`,
      definitions: `${normalizedBasePath}/definitions`,
      instances: `${normalizedBasePath}/instances`,
      'my-tasks': `${normalizedBasePath}/tasks`,
    };
    navigate(routes[tab]);
  }, [navigate, normalizedBasePath]);

  const [subPage, setSubPage] = useState<SubPage>({ type: 'list' });

  // 注入 AI 助手页面上下文（快捷操作与实体上下文）
  useEffect(() => {
    const kindMap: Record<TabId, WorkflowAIPageKind> = {
      overview: 'dashboard',
      definitions: 'definitions',
      instances: 'instances',
      'my-tasks': 'my-tasks',
    };
    const kind: WorkflowAIPageKind = subPage.type === 'task-handle'
      ? 'task-handle'
      : subPage.type === 'designer'
        ? 'designer'
        : subPage.type === 'instance-detail'
          ? 'instance-detail'
          : kindMap[activeTab];
    setPageAIContext({
      pageName: 'workflows',
      moduleName: 'workflow',
      recommendedAssistant: '工作流助手',
      contextHint: '用户正在 AIDriveWorkflow 工作流平台操作',
      quickActions: workflowQuickActions({ pageKind: kind }),
    });
    return () => setPageAIContext(null);
  }, [activeTab, subPage, setPageAIContext]);


  const [definitions, setDefinitions] = useState<WorkflowDefinition[]>([]);
  const [defLoading, setDefLoading] = useState(false);
  const [defSearch, setDefSearch] = useState('');
  const [defCategoryFilter, setDefCategoryFilter] = useState('');
  const [defStatusFilter, setDefStatusFilter] = useState('');
  const [defViewMode, setDefViewMode] = useState<'grid' | 'list'>('grid');
  const [entityTypeMap, setEntityTypeMap] = useState<Record<string, string>>({});

  const [instances, setInstances] = useState<WorkflowInstance[]>([]);
  const [instLoading, setInstLoading] = useState(false);
  const [instStatusFilter, setInstStatusFilter] = useState('');
  const [instSearch, setInstSearch] = useState('');
  const [showInstAdvancedFilter, setShowInstAdvancedFilter] = useState(false);
  const [instPriorityFilter, setInstPriorityFilter] = useState('');
  const [instDateFrom, setInstDateFrom] = useState('');
  const [instDateTo, setInstDateTo] = useState('');
  const [instInitiatorFilter, setInstInitiatorFilter] = useState('');

  const [myTasks, setMyTasks] = useState<WorkflowTaskItem[]>([]);
  const [overviewPendingTasks, setOverviewPendingTasks] = useState<WorkflowTaskItem[]>([]);
  const [tasksLoading, setTasksLoading] = useState(false);
  const [taskSummary, setTaskSummary] = useState<WorkflowTaskSummary | null>(null);
  const [taskTab, setTaskTab] = useState<'pending' | 'completed' | 'all'>('pending');
  const [taskSearch, setTaskSearch] = useState('');

  // Task sort
  const [taskSortField, setTaskSortField] = useState<'date' | 'name' | 'workflow' | 'status'>('date');
  const [taskSortDir, setTaskSortDir] = useState<'asc' | 'desc'>('desc');

  // Batch approval
  const [selectedTaskIds, setSelectedTaskIds] = useState<Set<string>>(new Set());
  const [batchApproving, setBatchApproving] = useState(false);

  const [openDropdown, setOpenDropdown] = useState<string | null>(null);
  const [showTemplates, setShowTemplates] = useState(false);

  // Quick approval dialog state
  const [quickApproval, setQuickApproval] = useState<{
    show: boolean;
    taskId: string;
    taskName: string;
    action: 'approve' | 'reject';
    comment: string;
    loading: boolean;
  }>({ show: false, taskId: '', taskName: '', action: 'approve', comment: '', loading: false });

  const loadDefinitions = useCallback(async () => {
    setDefLoading(true);
    try {
      const params: Record<string, string> = {};
      if (defCategoryFilter) params.category = defCategoryFilter;
      if (defStatusFilter) params.status = defStatusFilter;
      const data = await workflowsApi.list(params);
      setDefinitions(data || []);
    } catch { setDefinitions([]); }
    setDefLoading(false);
  }, [defCategoryFilter, defStatusFilter]);

  const loadInstances = useCallback(async () => {
    setInstLoading(true);
    try {
      const params: Record<string, string> = {};
      if (instStatusFilter) params.status = instStatusFilter;
      const data = await workflowInstancesApi.list(params);
      setInstances(data || []);
    } catch { setInstances([]); }
    setInstLoading(false);
  }, [instStatusFilter]);

  const loadTasks = useCallback(async () => {
    setTasksLoading(true);
    try {
      let data: WorkflowTaskItem[];
      if (taskTab === 'pending') data = await workflowTasksApi.my();
      else if (taskTab === 'completed') data = await workflowTasksApi.list({ status: 'completed', assigneeId: user?.id });
      else data = await workflowTasksApi.list({ assigneeId: user?.id });
      setMyTasks(data || []);
      const summary = await workflowTasksApi.summary();
      setTaskSummary(summary);
    } catch { setMyTasks([]); }
    setTasksLoading(false);
  }, [taskTab, user?.id]);

  const loadOverviewPendingTasks = useCallback(async () => {
    try {
      const data = await workflowTasksApi.my();
      setOverviewPendingTasks(data || []);
    } catch { setOverviewPendingTasks([]); }
  }, []);

  const handleQuickApproval = useCallback(async () => {
    if (quickApproval.loading) return;
    setQuickApproval(prev => ({ ...prev, loading: true }));
    try {
      if (quickApproval.action === 'approve') {
        await workflowTasksApi.complete(quickApproval.taskId, {
          result: 'approved',
          comment: quickApproval.comment || '同意',
        });
        toast.success('审批通过');
      } else {
        await workflowTasksApi.reject(quickApproval.taskId, {
          result: 'rejected',
          comment: quickApproval.comment || '不同意',
        });
        toast.success('已拒绝');
      }
      setQuickApproval({ show: false, taskId: '', taskName: '', action: 'approve', comment: '', loading: false });
      loadTasks();
      loadOverviewPendingTasks();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '操作失败';
      toast.error(msg);
      setQuickApproval(prev => ({ ...prev, loading: false }));
    }
  }, [quickApproval, loadTasks, loadOverviewPendingTasks]);

  const handleBatchApprove = useCallback(async () => {
    if (selectedTaskIds.size === 0 || batchApproving) return;
    setBatchApproving(true);
    let ok = 0, fail = 0;
    for (const taskId of selectedTaskIds) {
      try {
        await workflowTasksApi.complete(taskId, { result: 'approved', comment: '批量审批通过' });
        ok++;
      } catch { fail++; }
    }
    setBatchApproving(false);
    setSelectedTaskIds(new Set());
    if (ok > 0) toast.success(`成功通过 ${ok} 个任务${fail > 0 ? `，${fail} 个失败` : ''}`);
    else toast.error(`${fail} 个任务处理失败`);
    loadTasks();
    loadOverviewPendingTasks();
  }, [selectedTaskIds, batchApproving, loadTasks, loadOverviewPendingTasks]);

  const toggleTaskSelection = useCallback((taskId: string) => {
    setSelectedTaskIds(prev => {
      const next = new Set(prev);
      if (next.has(taskId)) next.delete(taskId);
      else next.add(taskId);
      return next;
    });
  }, []);

  const toggleSelectAll = useCallback(() => {
    const pendingTasks = myTasks.filter(t => t.status === 'pending' || t.status === 'claimed');
    if (selectedTaskIds.size === pendingTasks.length && pendingTasks.length > 0) {
      setSelectedTaskIds(new Set());
    } else {
      setSelectedTaskIds(new Set(pendingTasks.map(t => t.id)));
    }
  }, [myTasks, selectedTaskIds]);

  // Filter and sort tasks
  const filteredTasks = useMemo(() => {
    let result = myTasks;
    if (taskSearch.trim()) {
      const kw = taskSearch.toLowerCase();
      result = result.filter(t =>
        t.name.toLowerCase().includes(kw) ||
        t.taskNumber?.toLowerCase().includes(kw) ||
        t.definitionName?.toLowerCase().includes(kw) ||
        t.instanceTitle?.toLowerCase().includes(kw) ||
        (t.entityType && entityTypeMap[t.entityType]?.toLowerCase().includes(kw))
      );
    }
    // Sort
    const sorted = [...result].sort((a, b) => {
      let cmp = 0;
      switch (taskSortField) {
        case 'date':
          cmp = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
          break;
        case 'name':
          cmp = a.name.localeCompare(b.name, 'zh-CN');
          break;
        case 'workflow':
          cmp = (a.definitionName || '').localeCompare(b.definitionName || '', 'zh-CN');
          break;
        case 'status': {
          const order: Record<string, number> = { pending: 0, claimed: 1, completed: 2 };
          cmp = (order[a.status] ?? 9) - (order[b.status] ?? 9);
          break;
        }
      }
      return taskSortDir === 'asc' ? cmp : -cmp;
    });
    return sorted;
  }, [myTasks, taskSearch, entityTypeMap, taskSortField, taskSortDir]);

  // Export tasks to CSV
  const handleExportTasks = useCallback(() => {
    const rows = filteredTasks.map(t => ({
      '任务编号': t.taskNumber || '',
      '任务名称': t.name,
      '工作流': t.definitionName || t.instanceTitle || '',
      '实体类型': t.entityType ? (entityTypeMap[t.entityType] || t.entityType) : '',
      '状态': t.status === 'pending' ? '待处理' : t.status === 'claimed' ? '处理中' : t.status === 'completed' ? '已完成' : t.status,
      '创建时间': new Date(t.createdAt).toLocaleString('zh-CN'),
      '截止时间': t.dueDate ? new Date(t.dueDate).toLocaleString('zh-CN') : '',
      '处理人': t.assignee?.name || '',
    }));
    if (rows.length === 0) { toast.error('无数据可导出'); return; }
    const headers = Object.keys(rows[0]);
    const csv = [headers.join(','), ...rows.map(r => headers.map(h => `"${String((r as Record<string, string>)[h]).replace(/"/g, '""')}"`).join(','))].join('\n');
    const bom = '\uFEFF';
    const blob = new Blob([bom + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `workflow_tasks_${taskTab}_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(`已导出 ${rows.length} 条任务`);
  }, [filteredTasks, entityTypeMap, taskTab]);

  // Filtered instances (deduplicated filter logic)
  const filteredInstances = useMemo(() => {
    return instances.filter(i => {
      const searchMatch = !instSearch || i.title.toLowerCase().includes(instSearch.toLowerCase()) || i.instanceNumber.toLowerCase().includes(instSearch.toLowerCase()) || (i.definitionName || '').toLowerCase().includes(instSearch.toLowerCase());
      const priorityMatch = !instPriorityFilter || i.priority === instPriorityFilter;
      const initiatorMatch = !instInitiatorFilter || (i.initiatedBy?.name || '').toLowerCase().includes(instInitiatorFilter.toLowerCase());
      const dateFromMatch = !instDateFrom || new Date(i.startedAt) >= new Date(instDateFrom);
      const dateToMatch = !instDateTo || new Date(i.startedAt) <= new Date(instDateTo + 'T23:59:59');
      return searchMatch && priorityMatch && initiatorMatch && dateFromMatch && dateToMatch;
    });
  }, [instances, instSearch, instPriorityFilter, instInitiatorFilter, instDateFrom, instDateTo]);

  // Clear selections when tab changes
  useEffect(() => { setSelectedTaskIds(new Set()); setTaskSearch(''); }, [taskTab]);

  // Close dropdown on outside click
  useEffect(() => {
    if (!openDropdown) return;
    const handler = () => setOpenDropdown(null);
    document.addEventListener('click', handler);
    return () => document.removeEventListener('click', handler);
  }, [openDropdown]);

  useEffect(() => { loadDefinitions(); loadInstances(); loadTasks(); loadOverviewPendingTasks(); }, []);

  // Load entity types for display mapping
  useEffect(() => {
    (async () => {
      try {
        const types = await workflowsApi.entityTypes();
        const map: Record<string, string> = {};
        types.forEach(t => { map[t.key] = t.displayName; });
        setEntityTypeMap(map);
      } catch { /* ignore */ }
    })();
  }, []);

  useEffect(() => {
    if (subPage.type !== 'list') return;
    if (activeTab === 'definitions') loadDefinitions();
    else if (activeTab === 'instances') loadInstances();
    else if (activeTab === 'my-tasks') loadTasks();
    else if (activeTab === 'overview') loadOverviewPendingTasks();
  }, [activeTab, subPage, loadDefinitions, loadInstances, loadTasks, loadOverviewPendingTasks]);

  // 切换侧边栏子菜单时重置子页面；URL 带 taskId/task 时打开审批详情（须在 reset 之后处理，避免被覆盖）
  useEffect(() => {
    const taskId = searchParams.get('taskId') || searchParams.get('task');
    if (taskId) {
      setSubPage({ type: 'task-handle', taskId });
      setSearchParams({}, { replace: true });
      return;
    }
    setSubPage({ type: 'list' });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname]);

  // 同路径下仅 query 变化时也能打开详情（例如已在 /workflows/tasks 再点主页「打开」）
  useEffect(() => {
    const taskId = searchParams.get('taskId') || searchParams.get('task');
    if (!taskId) return;
    setSubPage({ type: 'task-handle', taskId });
    setSearchParams({}, { replace: true });
  }, [searchParams, setSearchParams]);

  const overviewStats = useMemo(() => {
    const defByStatus = { draft: 0, published: 0, archived: 0 };
    definitions.forEach(d => { if (d.status in defByStatus) defByStatus[d.status as keyof typeof defByStatus]++; });
    const defByCategory: Record<string, number> = {};
    definitions.forEach(d => { defByCategory[d.category] = (defByCategory[d.category] || 0) + 1; });
    const instByStatus = { running: 0, completed: 0, terminated: 0, suspended: 0 };
    instances.forEach(i => { if (i.status in instByStatus) instByStatus[i.status as keyof typeof instByStatus]++; });
    const categoryPieData = Object.entries(defByCategory).map(([k, v]) => ({ name: getWorkflowCategoryLabel(k), value: v }));
    const instPieData = [
      { name: '运行中', value: instByStatus.running },
      { name: '已完成', value: instByStatus.completed },
      { name: '已终止', value: instByStatus.terminated },
      { name: '已挂起', value: instByStatus.suspended },
    ].filter(d => d.value > 0);
    const now = Date.now(); // eslint-disable-line react-hooks/purity -- intentional time-based calculation
    const sevenDays = 7 * 24 * 60 * 60 * 1000;
    const dayMap: Record<string, number> = {};
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now - i * 24 * 60 * 60 * 1000);
      dayMap[`${d.getMonth() + 1}/${d.getDate()}`] = 0;
    }
    instances.forEach(inst => {
      const d = new Date(inst.startedAt);
      if (now - d.getTime() < sevenDays) {
        const key = `${d.getMonth() + 1}/${d.getDate()}`;
        if (key in dayMap) dayMap[key]++;
      }
    });
    const trendData = Object.entries(dayMap).map(([name, count]) => ({ name, count }));
    return { defByStatus, instByStatus, categoryPieData, instPieData, trendData };
  }, [definitions, instances]);

  const categoryFilterOptions = useMemo(
    () => buildWorkflowCategoryFilterOptions(definitions),
    [definitions],
  );

  const categorySelectOptions = useMemo(
    () => categoryFilterOptions.map(({ value, label }) => ({
      value,
      label,
      meta: value,
    })),
    [categoryFilterOptions],
  );

  const filteredDefs = useMemo(
    () => definitions.filter(d =>
      !defSearch || d.name.toLowerCase().includes(defSearch.toLowerCase()) || d.key.toLowerCase().includes(defSearch.toLowerCase())
    ),
    [definitions, defSearch],
  );

  const handleCreateDefinition = async (templateKey?: string) => {
    const key = templateKey || `wf_${Date.now()}`;
    const template = templateKey ? WORKFLOW_TEMPLATES.find(t => t.key === templateKey) : null;
    try {
      const defn = await workflowsApi.create({
        key, name: template?.name || '新工作流',
        category: template?.category || 'custom',
        description: template?.description
      });
      // If template has pre-built design, save it
      if (templateKey && TEMPLATE_DESIGNS[templateKey]) {
        try {
          await workflowsApi.saveDesign(defn.id, TEMPLATE_DESIGNS[templateKey] as any);
        } catch { /* continue even if design save fails */ }
      }
      setShowTemplates(false);
      setSubPage({ type: 'designer', definitionId: defn.id });
    } catch (e: unknown) { toast.error(e instanceof Error ? e.message : '操作失败'); }
  };

  const handlePublish = async (id: string) => {
    try { await workflowsApi.publish(id); loadDefinitions(); } catch (e: unknown) { toast.error(e instanceof Error ? e.message : '发布失败'); }
    setOpenDropdown(null);
  };
  const handleArchive = async (id: string) => {
    try { await workflowsApi.archive(id); loadDefinitions(); } catch (e: unknown) { toast.error(e instanceof Error ? e.message : '归档失败'); }
    setOpenDropdown(null);
  };
  const handleClone = async (id: string) => {
    try { await workflowsApi.clone(id); loadDefinitions(); } catch (e: unknown) { toast.error(e instanceof Error ? e.message : '克隆失败'); }
    setOpenDropdown(null);
  };
  const handleDeleteDef = async (id: string) => {
    if (!confirm('确认删除此工作流定义？')) return;
    try { await workflowsApi.delete(id); loadDefinitions(); } catch (e: unknown) { toast.error(e instanceof Error ? e.message : '删除失败'); }
    setOpenDropdown(null);
  };
  const handleTerminateInstance = async (id: string) => {
    if (!confirm('确认终止此流程实例？')) return;
    try { await workflowInstancesApi.terminate(id); loadInstances(); } catch (e: unknown) { toast.error(e instanceof Error ? e.message : '终止失败'); }
  };

  const handleExportDefinition = async (id: string) => {
    try {
      const detail = await workflowsApi.get(id);
      const exportData = {
        name: detail.name,
        key: detail.key,
        category: detail.category,
        description: detail.description,
        nodes: detail.nodes || [],
        edges: detail.edges || [],
        version: detail.version,
        exportedAt: new Date().toISOString(),
      };
      const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `workflow_${detail.key}_v${detail.version}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e: unknown) { toast.error(e instanceof Error ? e.message : '导出失败'); }
    setOpenDropdown(null);
  };

  const handleImportDefinition = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        const data = JSON.parse(text);
        const defn = await workflowsApi.create({
          key: `${data.key || 'imported'}_${Date.now()}`,
          name: `${data.name || '导入工作流'} (导入)`,
          category: data.category || 'custom',
          description: data.description || '',
        });
        if (data.nodes?.length > 0) {
          await workflowsApi.saveDesign(defn.id, { nodes: data.nodes, edges: data.edges || [] });
        }
        loadDefinitions();
        setSubPage({ type: 'designer', definitionId: defn.id });
      } catch (e: unknown) { toast.error(`导入失败: ${e instanceof Error ? e.message : '未知错误'}`); }
    };
    input.click();
  };

  /* Sub-page routing */
  if (subPage.type === 'designer') {
    return (
      <Suspense fallback={<PageFallback />}>
        <WorkflowDesignerPage definitionId={subPage.definitionId} onBack={() => { setSubPage({ type: 'list' }); loadDefinitions(); }} />
      </Suspense>
    );
  }
  if (subPage.type === 'instance-detail') {
    return (
      <Suspense fallback={<PageFallback />}>
        <WorkflowInstanceDetailPage instanceId={subPage.instanceId} onBack={() => { setSubPage({ type: 'list' }); loadInstances(); }} onViewTask={(taskId) => setSubPage({ type: 'task-handle', taskId })} />
      </Suspense>
    );
  }
  if (subPage.type === 'task-handle') {
    return (
      <Suspense fallback={<PageFallback />}>
        <WorkflowTaskHandlePage taskId={subPage.taskId} onBack={() => { setSubPage({ type: 'list' }); loadTasks(); }} />
      </Suspense>
    );
  }

  const cardBg = isDark ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200';
  const inputBg = isDark ? 'bg-gray-700 border-gray-600 text-white' : 'bg-white border-gray-300 text-gray-900';

  return (
    <>
    <div className="space-y-4">
      {/* Header Card */}
      <div className={`${cardBg} rounded-2xl shadow-sm border transition-colors`}>
        <div className="p-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-purple-500 to-violet-600 flex items-center justify-center flex-shrink-0">
                <GitMerge size={20} className="text-white" />
              </div>
              <div>
                <h2 className={`text-xl font-bold ${isDark ? 'text-white' : 'text-gray-900'}`}>
                  {activeTab === 'overview' && '仪表板'}
                  {activeTab === 'definitions' && '工作流定义'}
                  {activeTab === 'instances' && '工作流实例'}
                  {activeTab === 'my-tasks' && '我的审批'}
                </h2>
                <p className={`text-sm ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                  {activeTab === 'overview' && `设计、管理和监控业务流程 · ${definitions.length} 个定义 · ${instances.filter(i => i.status === 'running').length} 个运行中 · ${taskSummary?.pending ? `${taskSummary.pending} 项待办` : '无待办'}`}
                  {activeTab === 'definitions' && `管理流程定义模板 · 共 ${definitions.length} 个 · ${overviewStats.defByStatus.published} 个已发布 · ${overviewStats.defByStatus.draft} 个草稿`}
                  {activeTab === 'instances' && `查看和管理流程实例 · 共 ${instances.length} 个 · ${instances.filter(i => i.status === 'running').length} 个运行中`}
                  {activeTab === 'my-tasks' && `处理我的待办审批任务 · ${taskSummary?.pending ? `${taskSummary.pending} 个待处理` : '无待处理'} · ${taskSummary?.completedToday ? `今日完成 ${taskSummary.completedToday} 个` : '今日暂无完成'}`}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowManual(true)}
                title="使用说明书"
                className={`flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg border transition-colors ${isDark ? 'border-gray-600 text-gray-300 hover:bg-gray-700' : 'border-gray-300 text-gray-600 hover:bg-gray-50'}`}
              >
                <BookOpen size={16} /> 使用说明书
              </button>
              {(activeTab === 'definitions' || activeTab === 'overview') && (
                <>
                  <button onClick={() => setShowTemplates(!showTemplates)}
                    className={`flex items-center gap-2 px-3 py-2 border rounded-lg text-sm font-medium transition-colors ${showTemplates ? 'bg-purple-50 text-purple-700 border-purple-300 dark:bg-purple-900/20 dark:text-purple-400 dark:border-purple-600' : isDark ? 'border-gray-600 text-gray-300 hover:bg-gray-700' : 'border-gray-300 text-gray-700 hover:bg-gray-50'}`}>
                    <Layers size={16} /> 模板库
                  </button>
                  <button onClick={() => handleCreateDefinition()}
                    className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm font-medium">
                    <Plus size={16} /> 新建工作流
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Template Gallery */}
      {showTemplates && (
        <div className={`rounded-xl border p-4 ${cardBg}`}>
          <div className="flex items-center justify-between mb-3">
            <h3 className={`text-sm font-semibold ${isDark ? 'text-white' : 'text-gray-900'}`}>工作流模板库</h3>
            <button onClick={() => setShowTemplates(false)} className="text-gray-400 hover:text-gray-600"><XCircle size={18} /></button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {WORKFLOW_TEMPLATES.map(tmpl => {
              const Icon = tmpl.icon;
              return (
                <div key={tmpl.key} onClick={() => handleCreateDefinition(tmpl.key)}
                  className={`p-3 rounded-lg border cursor-pointer transition-all hover:shadow-md hover:scale-[1.01] ${cardBg}`}>
                  <div className="flex items-center gap-3 mb-2">
                    <div className={`p-2 rounded-lg ${tmpl.color}`}><Icon size={20} /></div>
                    <div>
                      <h4 className={`font-medium text-sm ${isDark ? 'text-white' : 'text-gray-900'}`}>{tmpl.name}</h4>
                      <span className={`text-xs px-1.5 py-0.5 rounded-full ${getWorkflowCategoryColor(tmpl.category)}`}>{getWorkflowCategoryLabel(tmpl.category)}</span>
                    </div>
                  </div>
                  <p className={`text-xs leading-relaxed ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>{tmpl.description}</p>
                  {TEMPLATE_DESIGNS[tmpl.key] && (
                    <div className="mt-2 flex items-center gap-1">
                      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400">
                        ✓ 预置 {TEMPLATE_DESIGNS[tmpl.key].nodes.length} 个节点
                      </span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}


      {/* ═══ Overview ═══ */}
      {activeTab === 'overview' && (
        <div className="space-y-4">
          {/* Quick Stats */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              { label: '已发布流程', value: overviewStats.defByStatus.published, icon: <CheckCircle size={20} />, color: 'text-green-600', bg: 'bg-green-50 dark:bg-green-900/20', onClick: () => { setActiveTab('definitions'); setDefStatusFilter('published'); }, alert: false },
              { label: '运行中实例', value: overviewStats.instByStatus.running, icon: <Play size={20} />, color: 'text-blue-600', bg: 'bg-blue-50 dark:bg-blue-900/20', onClick: () => { setActiveTab('instances'); setInstStatusFilter('running'); }, alert: false },
              { label: '待办任务', value: taskSummary?.pending || 0, icon: <Clock size={20} />, color: 'text-amber-600', bg: 'bg-amber-50 dark:bg-amber-900/20', onClick: () => { setActiveTab('my-tasks'); setTaskTab('pending'); }, alert: false },
              { label: '已超时', value: taskSummary?.overdue || 0, icon: <AlertTriangle size={20} />, color: 'text-red-600', bg: 'bg-red-50 dark:bg-red-900/20', onClick: () => setActiveTab('my-tasks'), alert: true },
            ].map(s => (
              <div key={s.label} onClick={s.onClick} className={`p-4 rounded-xl border cursor-pointer transition-all hover:shadow-md hover:scale-[1.02] ${s.alert && s.value > 0 ? 'border-red-300 dark:border-red-700 ring-2 ring-red-100 dark:ring-red-900/30' : ''} ${cardBg}`}>
                <div className="flex items-center justify-between mb-2">
                  <span className={`text-xs font-medium ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>{s.label}</span>
                  <div className={`p-1.5 rounded-lg ${s.bg} relative`}>
                    <span className={s.color}>{s.icon}</span>
                    {s.alert && s.value > 0 && (
                      <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 bg-red-500 rounded-full animate-pulse" />
                    )}
                  </div>
                </div>
                <div className={`text-3xl font-bold ${s.color}`}>{s.value}</div>
              </div>
            ))}
          </div>

          {/* Charts Row */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Category Distribution */}
            <div className={`rounded-xl border p-4 ${cardBg}`}>
              <h3 className={`text-sm font-semibold mb-3 flex items-center gap-2 ${isDark ? 'text-white' : 'text-gray-900'}`}>
                <Layers size={16} className="text-blue-500" /> 流程分类分布
              </h3>
              {overviewStats.categoryPieData.length > 0 ? (
                <ResponsiveContainer width="100%" height={180}>
                  <PieChart>
                    <Pie data={overviewStats.categoryPieData} cx="50%" cy="50%" innerRadius={40} outerRadius={70} paddingAngle={3} dataKey="value">
                      {overviewStats.categoryPieData.map((_, idx) => <Cell key={idx} fill={PIE_COLORS[idx % PIE_COLORS.length]} />)}
                    </Pie>
                    <Tooltip formatter={(value: unknown) => [`${value} 个`, '数量']} />
                  </PieChart>
                </ResponsiveContainer>
              ) : <div className="h-[180px] flex items-center justify-center text-gray-400 text-sm">暂无数据</div>}
              <div className="flex flex-wrap gap-2 mt-2 justify-center">
                {overviewStats.categoryPieData.map((d, i) => (
                  <span key={`pie-${i}-${d.name}`} className="flex items-center gap-1 text-[10px]">
                    <span className="w-2 h-2 rounded-full" style={{ background: PIE_COLORS[i % PIE_COLORS.length] }} />
                    <span className={isDark ? 'text-gray-400' : 'text-gray-500'}>{d.name} ({d.value})</span>
                  </span>
                ))}
              </div>
            </div>

            {/* Instance Status */}
            <div className={`rounded-xl border p-4 ${cardBg}`}>
              <h3 className={`text-sm font-semibold mb-3 flex items-center gap-2 ${isDark ? 'text-white' : 'text-gray-900'}`}>
                <Activity size={16} className="text-green-500" /> 实例运行状态
              </h3>
              {overviewStats.instPieData.length > 0 ? (
                <ResponsiveContainer width="100%" height={180}>
                  <PieChart>
                    <Pie data={overviewStats.instPieData} cx="50%" cy="50%" innerRadius={40} outerRadius={70} paddingAngle={3} dataKey="value">
                      {overviewStats.instPieData.map((entry, idx) => {
                        const c = entry.name === '运行中' ? '#3b82f6' : entry.name === '已完成' ? '#22c55e' : entry.name === '已终止' ? '#ef4444' : '#eab308';
                        return <Cell key={idx} fill={c} />;
                      })}
                    </Pie>
                    <Tooltip formatter={(value: unknown) => [`${value} 个`, '数量']} />
                  </PieChart>
                </ResponsiveContainer>
              ) : <div className="h-[180px] flex items-center justify-center text-gray-400 text-sm">暂无实例</div>}
            </div>

            {/* 7-Day Trend */}
            <div className={`rounded-xl border p-4 ${cardBg}`}>
              <h3 className={`text-sm font-semibold mb-3 flex items-center gap-2 ${isDark ? 'text-white' : 'text-gray-900'}`}>
                <TrendingUp size={16} className="text-purple-500" /> 近7日启动趋势
              </h3>
              <ResponsiveContainer width="100%" height={180}>
                <BarChart data={overviewStats.trendData}>
                  <CartesianGrid strokeDasharray="3 3" stroke={isDark ? '#374151' : '#e5e7eb'} />
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} stroke={isDark ? '#6b7280' : '#9ca3af'} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11 }} stroke={isDark ? '#6b7280' : '#9ca3af'} />
                  <Tooltip formatter={(value: unknown) => [`${value} 个`, '启动数']} />
                  <Bar dataKey="count" fill="#8b5cf6" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Quick Lists */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* My Tasks Quick */}
            <div className={`rounded-xl border ${cardBg}`}>
              <div className="p-4 border-b dark:border-gray-700 flex items-center justify-between">
                <h3 className={`text-sm font-semibold flex items-center gap-2 ${isDark ? 'text-white' : 'text-gray-900'}`}>
                  <ListChecks size={16} className="text-amber-500" /> 我的审批
                </h3>
                <button onClick={() => { setActiveTab('my-tasks'); setTaskTab('pending'); }}
                  className="text-xs text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1">
                  查看全部 <ArrowUpRight size={12} />
                </button>
              </div>
              <div className="divide-y dark:divide-gray-700">
                {overviewPendingTasks.slice(0, 5).map(task => {
                  const isOverdue = task.dueDate && new Date(task.dueDate) < new Date() && task.status !== 'completed';
                  return (
                  <div key={task.id} onClick={() => setSubPage({ type: 'task-handle', taskId: task.id })}
                    className={`flex items-center gap-3 p-3 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700/30 transition-colors ${isOverdue ? 'bg-red-50/50 dark:bg-red-900/10' : ''}`}>
                    <div className={`p-1.5 rounded-lg ${isOverdue ? 'bg-red-100 text-red-600 dark:bg-red-900/20 dark:text-red-400' : task.status === 'pending' ? 'bg-amber-100 text-amber-600 dark:bg-amber-900/20 dark:text-amber-400' : 'bg-blue-100 text-blue-600 dark:bg-blue-900/20 dark:text-blue-400'}`}>
                      {isOverdue ? <AlertTriangle size={14} /> : task.status === 'pending' ? <Clock size={14} /> : <RefreshCcw size={14} />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <p className={`text-sm font-medium truncate ${isDark ? 'text-white' : 'text-gray-900'}`}>{task.name}</p>
                        {isOverdue && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400 flex-shrink-0 animate-pulse">超时</span>
                        )}
                      </div>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        <p className={`text-xs ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>{task.taskNumber}</p>
                        {task.entityType && entityTypeMap[task.entityType] && (
                          <span className={`text-[10px] px-1.5 py-0.5 rounded ${isDark ? 'bg-emerald-900/20 text-emerald-400' : 'bg-emerald-50 text-emerald-600'}`}>
                            {entityTypeMap[task.entityType]}
                          </span>
                        )}
                      </div>
                    </div>
                    <ChevronRight size={14} className="text-gray-400 flex-shrink-0" />
                  </div>
                  );
                })}
                {overviewPendingTasks.length === 0 && (
                  <div className="p-6 text-center text-sm text-gray-400">暂无待办任务</div>
                )}
              </div>
            </div>

            {/* Recent Instances */}
            <div className={`rounded-xl border ${cardBg}`}>
              <div className="p-4 border-b dark:border-gray-700 flex items-center justify-between">
                <h3 className={`text-sm font-semibold flex items-center gap-2 ${isDark ? 'text-white' : 'text-gray-900'}`}>
                  <Activity size={16} className="text-blue-500" /> 最近流程实例
                </h3>
                <button onClick={() => setActiveTab('instances')}
                  className="text-xs text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1">
                  查看全部 <ArrowUpRight size={12} />
                </button>
              </div>
              <div className="divide-y dark:divide-gray-700">
                {instances.slice(0, 5).map(inst => (
                  <div key={inst.id} onClick={() => setSubPage({ type: 'instance-detail', instanceId: inst.id })}
                    className="flex items-center gap-3 p-3 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700/30 transition-colors">
                    <div className={`p-1.5 rounded-lg ${inst.status === 'running' ? 'bg-blue-100 text-blue-600 dark:bg-blue-900/20 dark:text-blue-400' : inst.status === 'completed' ? 'bg-green-100 text-green-600 dark:bg-green-900/20 dark:text-green-400' : 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400'}`}>
                      {inst.status === 'running' ? <Play size={14} /> : inst.status === 'completed' ? <CheckCircle size={14} /> : <XCircle size={14} />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className={`text-sm font-medium truncate ${isDark ? 'text-white' : 'text-gray-900'}`}>{inst.title}</p>
                      <p className={`text-xs ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>{inst.instanceNumber} · {inst.definitionName || inst.initiatedBy?.name || '-'}</p>
                    </div>
                    <StatusBadge status={inst.status} />
                  </div>
                ))}
                {instances.length === 0 && <div className="p-6 text-center text-sm text-gray-400">暂无流程实例</div>}
              </div>
            </div>
          </div>

          {/* Workflow Efficiency Metrics */}
          <div className={`rounded-xl border p-4 ${cardBg}`}>
            <h3 className={`text-sm font-semibold mb-3 flex items-center gap-2 ${isDark ? 'text-white' : 'text-gray-900'}`}>
              <TrendingUp size={16} className="text-emerald-500" /> 效率指标
            </h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {(() => {
                const completedInst = instances.filter(i => i.status === 'completed');
                const avgDurationHrs = completedInst.length > 0
                  ? Math.round(completedInst.reduce((sum, inst) => {
                      const start = new Date(inst.startedAt).getTime();
                      const end = inst.completedAt ? new Date(inst.completedAt).getTime() : Date.now();
                      return sum + (end - start) / 3600000;
                    }, 0) / completedInst.length)
                  : 0;
                const completionRate = instances.length > 0
                  ? Math.round((completedInst.length / instances.length) * 100)
                  : 0;
                const overdueTasks = myTasks.filter(t => t.dueDate && new Date(t.dueDate) < new Date() && t.status !== 'completed').length;
                const todayCompleted = myTasks.filter(t => {
                  if (t.status !== 'completed' || !t.completedAt) return false;
                  const d = new Date(t.completedAt);
                  const today = new Date();
                  return d.toDateString() === today.toDateString();
                }).length;
                return [
                  { label: '平均处理时长', value: avgDurationHrs > 24 ? `${Math.round(avgDurationHrs / 24)}天` : `${avgDurationHrs}小时`, icon: <Clock size={18} />, color: 'text-blue-600 dark:text-blue-400', bg: 'bg-blue-50 dark:bg-blue-900/20' },
                  { label: '完成率', value: `${completionRate}%`, icon: <Target size={18} />, color: 'text-green-600 dark:text-green-400', bg: 'bg-green-50 dark:bg-green-900/20' },
                  { label: '超期任务', value: overdueTasks, icon: <AlertTriangle size={18} />, color: overdueTasks > 0 ? 'text-red-600 dark:text-red-400' : 'text-gray-400', bg: overdueTasks > 0 ? 'bg-red-50 dark:bg-red-900/20' : 'bg-gray-50 dark:bg-gray-800' },
                  { label: '今日完成', value: todayCompleted, icon: <CheckCircle size={18} />, color: 'text-emerald-600 dark:text-emerald-400', bg: 'bg-emerald-50 dark:bg-emerald-900/20' },
                ];
              })().map(m => (
                <div key={m.label} className={`p-3 rounded-lg ${m.bg}`}>
                  <div className={`flex items-center gap-2 mb-1 ${m.color}`}>{m.icon}</div>
                  <div className={`text-xl font-bold ${m.color}`}>{m.value}</div>
                  <div className={`text-xs ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>{m.label}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Recent Activity Timeline */}
          <div className={`rounded-xl border p-4 ${cardBg}`}>
            <h3 className={`text-sm font-semibold mb-3 flex items-center gap-2 ${isDark ? 'text-white' : 'text-gray-900'}`}>
              <Clock size={16} className="text-violet-500" /> 最近活动
            </h3>
            {(() => {
              // Merge recent instances and tasks into a unified timeline
              const activities: { time: Date; type: 'instance' | 'task'; label: string; detail: string; status: string; id: string }[] = [];
              instances.slice(0, 10).forEach(inst => {
                activities.push({
                  time: new Date(inst.startedAt),
                  type: 'instance',
                  label: inst.title,
                  detail: `${inst.definitionName || '工作流'} · ${inst.initiatedBy?.name || '系统'} 发起`,
                  status: inst.status,
                  id: inst.id,
                });
                if (inst.completedAt) {
                  activities.push({
                    time: new Date(inst.completedAt),
                    type: 'instance',
                    label: inst.title,
                    detail: `流程${inst.status === 'completed' ? '完成' : inst.status === 'terminated' ? '终止' : '结束'}`,
                    status: inst.status,
                    id: inst.id,
                  });
                }
              });
              // Sort by time descending, take top 8
              activities.sort((a, b) => b.time.getTime() - a.time.getTime());
              const recent = activities.slice(0, 8);
              if (recent.length === 0) {
                return <div className="text-center py-6 text-sm text-gray-400">暂无活动记录</div>;
              }
              return (
                <div className="relative pl-4">
                  <div className={`absolute left-[7px] top-2 bottom-2 w-px ${isDark ? 'bg-gray-700' : 'bg-gray-200'}`} />
                  <div className="space-y-3">
                    {recent.map((act, idx) => (
                      <div key={`${act.id}-${idx}`} className="relative flex items-start gap-3">
                        <div className={`absolute left-[-13px] mt-1.5 w-2.5 h-2.5 rounded-full border-2 ${
                          act.status === 'running' ? 'bg-blue-500 border-blue-300 dark:border-blue-700'
                          : act.status === 'completed' ? 'bg-green-500 border-green-300 dark:border-green-700'
                          : act.status === 'terminated' ? 'bg-red-500 border-red-300 dark:border-red-700'
                          : 'bg-amber-500 border-amber-300 dark:border-amber-700'
                        }`} />
                        <div className="flex-1 min-w-0 ml-1">
                          <p className={`text-sm font-medium truncate ${isDark ? 'text-gray-200' : 'text-gray-800'}`}>{act.label}</p>
                          <p className={`text-xs ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>{act.detail}</p>
                        </div>
                        <span className={`text-[10px] flex-shrink-0 ${isDark ? 'text-gray-600' : 'text-gray-300'}`}>
                          {act.time.toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })()}
          </div>

          {/* Definition Status Summary */}
          <div className={`rounded-xl border p-4 ${cardBg}`}>
            <h3 className={`text-sm font-semibold mb-3 flex items-center gap-2 ${isDark ? 'text-white' : 'text-gray-900'}`}>
              <GitBranch size={16} className="text-indigo-500" /> 流程定义概览
            </h3>
            <div className="grid grid-cols-3 gap-3">
              {[
                { label: '草稿', count: overviewStats.defByStatus.draft, color: 'bg-gray-200 dark:bg-gray-600', textColor: 'text-gray-600 dark:text-gray-300', filter: 'draft' },
                { label: '已发布', count: overviewStats.defByStatus.published, color: 'bg-green-200 dark:bg-green-800', textColor: 'text-green-700 dark:text-green-300', filter: 'published' },
                { label: '已归档', count: overviewStats.defByStatus.archived, color: 'bg-yellow-200 dark:bg-yellow-800', textColor: 'text-yellow-700 dark:text-yellow-300', filter: 'archived' },
              ].map(item => (
                <div key={item.label} onClick={() => { setActiveTab('definitions'); setDefStatusFilter(item.filter); }}
                  className={`p-3 rounded-lg cursor-pointer hover:opacity-80 transition ${item.color}`}>
                  <div className={`text-2xl font-bold ${item.textColor}`}>{item.count}</div>
                  <div className={`text-xs ${item.textColor} opacity-80`}>{item.label}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ═══ Definitions ═══ */}
      {activeTab === 'definitions' && (
        <div className="space-y-3">
          {/* Definition Stats */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: '总定义数', value: definitions.length, color: 'text-indigo-600', icon: <GitBranch size={18} />, filterVal: '' },
              { label: '已发布', value: overviewStats.defByStatus.published, color: 'text-green-600', icon: <CheckCircle size={18} />, filterVal: 'published' },
              { label: '草稿', value: overviewStats.defByStatus.draft, color: 'text-amber-600', icon: <Clock size={18} />, filterVal: 'draft' },
              { label: '已归档', value: overviewStats.defByStatus.archived, color: 'text-gray-500', icon: <Archive size={18} />, filterVal: 'archived' },
            ].map(s => (
              <div key={s.label} onClick={() => setDefStatusFilter(defStatusFilter === s.filterVal ? '' : s.filterVal)}
                className={`p-3 rounded-lg border cursor-pointer transition-all hover:shadow-md ${cardBg} ${defStatusFilter === s.filterVal && s.filterVal ? 'ring-2 ring-blue-500' : ''}`}>
                <div className="flex items-center justify-between">
                  <span className={`text-xs ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>{s.label}</span>
                  <span className={s.color}>{s.icon}</span>
                </div>
                <div className={`text-2xl font-bold mt-1 ${s.color}`}>{s.value}</div>
              </div>
            ))}
          </div>

          {/* Toolbar */}
          <div className="flex flex-wrap gap-2 items-center">
            <div className="relative flex-1 min-w-[200px]">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input type="text" placeholder="搜索工作流名称或标识..." value={defSearch} onChange={(e) => setDefSearch(e.target.value)}
                className={`w-full pl-9 pr-3 py-2 rounded-lg border text-sm ${inputBg}`} />
            </div>
            <div className="min-w-[168px]">
              <SearchableSelect
                value={defCategoryFilter}
                onChange={setDefCategoryFilter}
                options={categorySelectOptions}
                placeholder="所有分类"
                searchPlaceholder="搜索分类名称或标识..."
                clearLabel="所有分类"
                emptyLabel="没有匹配的分类"
                isDark={isDark}
                allowClear
              />
            </div>
            <select value={defStatusFilter} onChange={(e) => setDefStatusFilter(e.target.value)} className={`px-3 py-2 rounded-lg border text-sm ${inputBg}`}>
              <option value="">所有状态</option>
              <option value="draft">草稿</option>
              <option value="published">已发布</option>
              <option value="archived">已归档</option>
            </select>
            <div className="flex items-center border rounded-lg overflow-hidden dark:border-gray-600">
              <button onClick={() => setDefViewMode('grid')}
                className={`p-2 ${defViewMode === 'grid' ? 'bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400' : isDark ? 'text-gray-400 hover:text-gray-200' : 'text-gray-500 hover:text-gray-700'}`}>
                <LayoutGrid size={16} />
              </button>
              <button onClick={() => setDefViewMode('list')}
                className={`p-2 ${defViewMode === 'list' ? 'bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400' : isDark ? 'text-gray-400 hover:text-gray-200' : 'text-gray-500 hover:text-gray-700'}`}>
                <List size={16} />
              </button>
            </div>
            <button onClick={handleImportDefinition}
              className={`flex items-center gap-1 px-3 py-2 border rounded-lg text-sm transition-colors ${isDark ? 'border-gray-600 text-gray-300 hover:bg-gray-700' : 'border-gray-300 text-gray-700 hover:bg-gray-50'}`}>
              <Upload size={14} /> 导入
            </button>
          </div>

          {defLoading ? (
            <div className="flex justify-center py-12"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div></div>
          ) : filteredDefs.length === 0 ? (
            <div className={`text-center py-16 rounded-lg border ${cardBg}`}>
              <GitBranch size={48} className="mx-auto text-gray-400 mb-3" />
              <p className={`text-lg font-medium ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>暂无工作流定义</p>
              <p className={`text-sm mt-1 ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>点击"新建工作流"或使用模板库创建</p>
            </div>
          ) : defViewMode === 'grid' ? (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
              {filteredDefs.map((defn) => {
                const CatIcon = CATEGORY_ICONS[defn.category] || Settings;
                return (
                  <div key={defn.id} className={`rounded-xl border p-4 hover:shadow-md transition-all cursor-pointer group ${cardBg}`}
                    onClick={() => setSubPage({ type: 'designer', definitionId: defn.id })}>
                    <div className="flex items-start justify-between mb-3">
                      <div className="flex items-center gap-3">
                        <div className={`p-2.5 rounded-xl ${getWorkflowCategoryColor(defn.category)}`}><CatIcon size={20} /></div>
                        <div>
                          <h3 className={`font-semibold text-sm group-hover:text-blue-600 transition-colors ${isDark ? 'text-white' : 'text-gray-900'}`}>{defn.name}</h3>
                          <p className={`text-xs font-mono ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>{defn.key}</p>
                        </div>
                      </div>
                      <div className="relative" onClick={(e) => e.stopPropagation()}>
                        <button onClick={() => setOpenDropdown(openDropdown === defn.id ? null : defn.id)}
                          className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700 opacity-0 group-hover:opacity-100 transition-opacity">
                          <MoreVertical size={16} />
                        </button>
                        {openDropdown === defn.id && (
                          <div className={`absolute right-0 top-8 w-36 rounded-lg border shadow-lg z-10 py-1 ${isDark ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'}`}>
                            <button onClick={() => setSubPage({ type: 'designer', definitionId: defn.id })} className="flex items-center gap-2 w-full px-3 py-1.5 text-sm hover:bg-gray-100 dark:hover:bg-gray-700"><Eye size={14} /> 编辑设计</button>
                            {defn.status === 'draft' && <button onClick={() => handlePublish(defn.id)} className="flex items-center gap-2 w-full px-3 py-1.5 text-sm hover:bg-gray-100 dark:hover:bg-gray-700"><Send size={14} /> 发布</button>}
                            {defn.status === 'published' && <button onClick={() => handleArchive(defn.id)} className="flex items-center gap-2 w-full px-3 py-1.5 text-sm hover:bg-gray-100 dark:hover:bg-gray-700"><Archive size={14} /> 归档</button>}
                            <button onClick={() => handleClone(defn.id)} className="flex items-center gap-2 w-full px-3 py-1.5 text-sm hover:bg-gray-100 dark:hover:bg-gray-700"><Copy size={14} /> 克隆</button>
                            <button onClick={() => handleExportDefinition(defn.id)} className="flex items-center gap-2 w-full px-3 py-1.5 text-sm hover:bg-gray-100 dark:hover:bg-gray-700"><Download size={14} /> 导出</button>
                            <hr className="my-1 dark:border-gray-700" />
                            <button onClick={() => handleDeleteDef(defn.id)} className="flex items-center gap-2 w-full px-3 py-1.5 text-sm text-red-500 hover:bg-gray-100 dark:hover:bg-gray-700"><Trash2 size={14} /> 删除</button>
                          </div>
                        )}
                      </div>
                    </div>
                    {defn.description && <p className={`text-xs mb-3 line-clamp-2 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>{defn.description}</p>}
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={`text-xs px-2 py-0.5 rounded-full ${getWorkflowCategoryColor(defn.category)}`}>{getWorkflowCategoryLabel(defn.category)}</span>
                        <StatusBadge status={defn.status} />
                        {defn.entityType && (
                          <span className="text-xs px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400">
                            {entityTypeMap[defn.entityType] || defn.entityType}
                          </span>
                        )}
                      </div>
                      <span className={`text-xs ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>v{defn.version}</span>
                    </div>
                    {/* Enhanced info row */}
                    <div className={`flex items-center justify-between pt-2 border-t ${isDark ? 'border-gray-700' : 'border-gray-100'}`}>
                      <div className="flex items-center gap-3">
                        {(() => {
                          const relatedInstances = instances.filter(i => i.definitionId === defn.id);
                          const runningCount = relatedInstances.filter(i => i.status === 'running').length;
                          return (
                            <>
                              <span className={`text-[10px] flex items-center gap-1 ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                                <Play size={10} /> {runningCount} 运行中
                              </span>
                              <span className={`text-[10px] flex items-center gap-1 ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                                <Activity size={10} /> {relatedInstances.length} 总实例
                              </span>
                            </>
                          );
                        })()}
                      </div>
                      <div className="flex items-center gap-2">
                        {defn.createdBy && <span className={`text-[10px] ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>{defn.createdBy.name}</span>}
                        <span className={`text-[10px] ${isDark ? 'text-gray-600' : 'text-gray-300'}`}>
                          {new Date(defn.createdAt).toLocaleDateString('zh-CN')}
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className={`rounded-xl border overflow-hidden ${cardBg}`}>
              <table className="w-full text-sm">
                <thead>
                  <tr className={isDark ? 'bg-gray-700/50' : 'bg-gray-50'}>
                    <th className="text-left px-4 py-3 font-medium">名称</th>
                    <th className="text-left px-4 py-3 font-medium">标识</th>
                    <th className="text-left px-4 py-3 font-medium">分类</th>
                    <th className="text-left px-4 py-3 font-medium">状态</th>
                    <th className="text-left px-4 py-3 font-medium">关联模块</th>
                    <th className="text-left px-4 py-3 font-medium">版本</th>
                    <th className="text-left px-4 py-3 font-medium">创建者</th>
                    <th className="text-left px-4 py-3 font-medium">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredDefs.map((defn) => (
                    <tr key={defn.id}
                      className={`border-t cursor-pointer ${isDark ? 'border-gray-700 hover:bg-gray-700/30' : 'border-gray-200 hover:bg-gray-50'}`}
                      onClick={() => setSubPage({ type: 'designer', definitionId: defn.id })}>
                      <td className="px-4 py-3 font-medium">{defn.name}</td>
                      <td className="px-4 py-3 font-mono text-xs text-gray-500">{defn.key}</td>
                      <td className="px-4 py-3">
                        <span className={`text-xs px-2 py-0.5 rounded-full ${getWorkflowCategoryColor(defn.category)}`}>
                          {getWorkflowCategoryLabel(defn.category)}
                        </span>
                      </td>
                      <td className="px-4 py-3"><StatusBadge status={defn.status} /></td>
                      <td className="px-4 py-3 text-xs">
                        {defn.entityType ? (
                          <span className="px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400">
                            {entityTypeMap[defn.entityType] || defn.entityType}
                          </span>
                        ) : (
                          <span className="text-gray-400">通用</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs">v{defn.version}</td>
                      <td className="px-4 py-3 text-xs">{defn.createdBy?.name || '-'}</td>
                      <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                        <div className="flex items-center gap-1">
                          {defn.status === 'draft' && <button onClick={() => handlePublish(defn.id)} className="text-green-600 hover:text-green-800 p-1" title="发布"><Send size={14} /></button>}
                          <button onClick={() => handleClone(defn.id)} className="text-blue-600 hover:text-blue-800 p-1" title="克隆"><Copy size={14} /></button>
                          <button onClick={() => handleDeleteDef(defn.id)} className="text-red-500 hover:text-red-700 p-1" title="删除"><Trash2 size={14} /></button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ═══ Instances ═══ */}
      {activeTab === 'instances' && (
        <div className="space-y-3">
          {/* Status Filter Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: '运行中', value: instances.filter(i => i.status === 'running').length, color: 'text-blue-600', filterVal: 'running', icon: <Play size={18} /> },
              { label: '已完成', value: instances.filter(i => i.status === 'completed').length, color: 'text-green-600', filterVal: 'completed', icon: <CheckCircle size={18} /> },
              { label: '已终止', value: instances.filter(i => i.status === 'terminated').length, color: 'text-red-600', filterVal: 'terminated', icon: <XCircle size={18} /> },
              { label: '已挂起', value: instances.filter(i => i.status === 'suspended').length, color: 'text-yellow-600', filterVal: 'suspended', icon: <PauseCircle size={18} /> },
            ].map(s => (
              <div key={s.label} onClick={() => setInstStatusFilter(instStatusFilter === s.filterVal ? '' : s.filterVal)}
                className={`p-3 rounded-lg border cursor-pointer transition-all hover:shadow-md ${cardBg} ${instStatusFilter === s.filterVal ? 'ring-2 ring-blue-500' : ''}`}>
                <div className="flex items-center justify-between">
                  <span className={`text-xs ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>{s.label}</span>
                  <span className={s.color}>{s.icon}</span>
                </div>
                <div className={`text-2xl font-bold mt-1 ${s.color}`}>{s.value}</div>
              </div>
            ))}
          </div>

          {/* Search + Advanced Filter Toggle */}
          <div className="flex gap-2 items-center">
            <div className="relative flex-1">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input type="text" placeholder="搜索实例标题或编号..." value={instSearch} onChange={(e) => setInstSearch(e.target.value)}
                className={`w-full pl-9 pr-3 py-2 rounded-lg border text-sm ${inputBg}`} />
            </div>
            <button onClick={() => setShowInstAdvancedFilter(!showInstAdvancedFilter)}
              className={`flex items-center gap-2 px-3 py-2 border rounded-lg text-sm font-medium transition-colors whitespace-nowrap ${
                showInstAdvancedFilter || instPriorityFilter || instDateFrom || instDateTo || instInitiatorFilter
                  ? 'bg-blue-50 text-blue-700 border-blue-300 dark:bg-blue-900/20 dark:text-blue-400 dark:border-blue-600'
                  : isDark ? 'border-gray-600 text-gray-300 hover:bg-gray-700' : 'border-gray-300 text-gray-700 hover:bg-gray-50'
              }`}>
              <Filter size={15} /> 高级筛选
              {(instPriorityFilter || instDateFrom || instDateTo || instInitiatorFilter) && (
                <span className="ml-1 px-1.5 py-0.5 text-[10px] font-bold rounded-full bg-blue-600 text-white">
                  {[instPriorityFilter, instDateFrom, instDateTo, instInitiatorFilter].filter(Boolean).length}
                </span>
              )}
            </button>
            {(instPriorityFilter || instDateFrom || instDateTo || instInitiatorFilter) && (
              <button onClick={() => { setInstPriorityFilter(''); setInstDateFrom(''); setInstDateTo(''); setInstInitiatorFilter(''); }}
                className={`flex items-center gap-1 px-3 py-2 border rounded-lg text-sm transition-colors ${isDark ? 'border-gray-600 text-gray-400 hover:text-gray-200 hover:bg-gray-700' : 'border-gray-300 text-gray-500 hover:bg-gray-50'}`}>
                <XCircle size={14} /> 清除
              </button>
            )}
          </div>

          {/* Advanced Filter Panel */}
          {showInstAdvancedFilter && (
            <div className={`rounded-xl border p-4 ${cardBg}`}>
              <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
                <div>
                  <label className={`text-xs font-medium mb-1.5 block ${isDark ? 'text-gray-400' : 'text-gray-600'}`}>优先级</label>
                  <select value={instPriorityFilter} onChange={(e) => setInstPriorityFilter(e.target.value)}
                    className={`w-full px-3 py-2 rounded-lg border text-sm ${inputBg}`}>
                    <option value="">全部优先级</option>
                    <option value="Critical">紧急</option>
                    <option value="High">高</option>
                    <option value="Medium">中</option>
                    <option value="Low">低</option>
                  </select>
                </div>
                <div>
                  <label className={`text-xs font-medium mb-1.5 block ${isDark ? 'text-gray-400' : 'text-gray-600'}`}>发起人</label>
                  <input type="text" placeholder="输入发起人姓名..." value={instInitiatorFilter} onChange={(e) => setInstInitiatorFilter(e.target.value)}
                    className={`w-full px-3 py-2 rounded-lg border text-sm ${inputBg}`} />
                </div>
                <div>
                  <label className={`text-xs font-medium mb-1.5 block ${isDark ? 'text-gray-400' : 'text-gray-600'}`}>发起时间起</label>
                  <input type="date" value={instDateFrom} onChange={(e) => setInstDateFrom(e.target.value)}
                    className={`w-full px-3 py-2 rounded-lg border text-sm ${inputBg}`} />
                </div>
                <div>
                  <label className={`text-xs font-medium mb-1.5 block ${isDark ? 'text-gray-400' : 'text-gray-600'}`}>发起时间止</label>
                  <input type="date" value={instDateTo} onChange={(e) => setInstDateTo(e.target.value)}
                    className={`w-full px-3 py-2 rounded-lg border text-sm ${inputBg}`} />
                </div>
              </div>
            </div>
          )}

          {instLoading ? (
            <div className="flex justify-center py-12"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div></div>
          ) : filteredInstances.length === 0 ? (
            <div className={`text-center py-16 rounded-lg border ${cardBg}`}>
              <Play size={48} className="mx-auto text-gray-400 mb-3" />
              <p className={`text-lg font-medium ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>暂无流程实例</p>
            </div>
          ) : (
            <div className={`rounded-xl border overflow-hidden ${cardBg}`}>
              <table className="w-full text-sm">
                <thead>
                  <tr className={isDark ? 'bg-gray-700/50' : 'bg-gray-50'}>
                    <th className="text-left px-4 py-3 font-medium">编号</th>
                    <th className="text-left px-4 py-3 font-medium">标题</th>
                    <th className="text-left px-4 py-3 font-medium">流程定义</th>
                    <th className="text-left px-4 py-3 font-medium">实体类型</th>
                    <th className="text-left px-4 py-3 font-medium">状态</th>
                    <th className="text-left px-4 py-3 font-medium">进度</th>
                    <th className="text-left px-4 py-3 font-medium">优先级</th>
                    <th className="text-left px-4 py-3 font-medium">发起人</th>
                    <th className="text-left px-4 py-3 font-medium">发起时间</th>
                    <th className="text-left px-4 py-3 font-medium">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredInstances.map((inst) => (
                    <tr key={inst.id}
                      className={`border-t cursor-pointer ${isDark ? 'border-gray-700 hover:bg-gray-700/30' : 'border-gray-200 hover:bg-gray-50'}`}
                      onClick={() => setSubPage({ type: 'instance-detail', instanceId: inst.id })}>
                      <td className="px-4 py-3 font-mono text-xs">{inst.instanceNumber}</td>
                      <td className="px-4 py-3 font-medium">{inst.title}</td>
                      <td className="px-4 py-3 text-xs">
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full ${isDark ? 'bg-purple-900/30 text-purple-400' : 'bg-purple-100 text-purple-700'}`}>
                          <GitBranch size={10} /> {inst.definitionName || '-'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs">
                        {inst.entityType && entityTypeMap[inst.entityType] ? (
                          <span className={`inline-flex items-center px-2 py-0.5 rounded-full ${isDark ? 'bg-emerald-900/30 text-emerald-400' : 'bg-emerald-100 text-emerald-700'}`}>
                            {entityTypeMap[inst.entityType]}
                          </span>
                        ) : (
                          <span className="text-gray-400">-</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5">
                          {inst.status === 'running' && (
                            <span className="relative flex h-2 w-2">
                              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"></span>
                              <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-500"></span>
                            </span>
                          )}
                          <StatusBadge status={inst.status} />
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        {(() => {
                          const pct = inst.status === 'completed' ? 100
                            : inst.status === 'terminated' ? 0
                            : (inst as unknown as Record<string, unknown>).progress != null ? Number((inst as unknown as Record<string, unknown>).progress)
                            : inst.status === 'running' ? 50 : 0;
                          return (
                            <div className="flex items-center gap-2">
                              <div className={`w-16 h-1.5 rounded-full overflow-hidden ${isDark ? 'bg-gray-700' : 'bg-gray-200'}`}>
                                <div
                                  className={`h-full rounded-full transition-all ${
                                    pct === 100 ? 'bg-green-500'
                                    : pct > 60 ? 'bg-blue-500'
                                    : pct > 30 ? 'bg-amber-500'
                                    : 'bg-gray-400'
                                  }`}
                                  style={{ width: `${pct}%` }}
                                />
                              </div>
                              <span className={`text-[10px] font-medium ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>{pct}%</span>
                            </div>
                          );
                        })()}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`text-xs px-2 py-0.5 rounded-full ${
                          inst.priority === 'Critical' ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                          : inst.priority === 'High' ? 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400'
                          : inst.priority === 'Medium' ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'
                          : 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300'
                        }`}>
                          {inst.priority === 'Critical' ? '紧急' : inst.priority === 'High' ? '高' : inst.priority === 'Medium' ? '中' : '低'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs">{inst.initiatedBy?.name || '-'}</td>
                      <td className="px-4 py-3 text-xs">{new Date(inst.startedAt).toLocaleString('zh-CN')}</td>
                      <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                        {inst.status === 'running' && (
                          <button onClick={() => handleTerminateInstance(inst.id)} className="text-red-500 hover:text-red-700 p-1" title="终止">
                            <XCircle size={16} />
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ═══ My Tasks ═══ */}
      {activeTab === 'my-tasks' && (
        <div className="space-y-3">
          {/* Task Summary */}
          {taskSummary && (
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
              {[
                { label: '待处理', value: taskSummary.pending, color: 'text-amber-600', icon: <Clock size={18} /> },
                { label: '处理中', value: taskSummary.claimed, color: 'text-blue-600', icon: <RefreshCcw size={18} /> },
                { label: '今日完成', value: taskSummary.completedToday, color: 'text-green-600', icon: <CheckCircle size={18} /> },
                { label: '已超时', value: taskSummary.overdue, color: 'text-red-600', icon: <AlertTriangle size={18} /> },
                { label: '任务总数', value: taskSummary.total, color: 'text-indigo-600', icon: <Hash size={18} /> },
              ].map(s => (
                <div key={s.label} className={`p-3 rounded-lg border ${cardBg}`}>
                  <div className="flex items-center justify-between">
                    <span className={`text-xs ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>{s.label}</span>
                    <span className={s.color}>{s.icon}</span>
                  </div>
                  <div className={`text-2xl font-bold mt-1 ${s.color}`}>{s.value}</div>
                </div>
              ))}
            </div>
          )}

          {/* Sub-tabs + Search + Sort */}
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex gap-1">
              {(['pending', 'completed', 'all'] as const).map((t) => (
                <button key={t} onClick={() => setTaskTab(t)}
                  className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                    taskTab === t
                      ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'
                      : isDark ? 'text-gray-400 hover:text-gray-200' : 'text-gray-500 hover:text-gray-800'
                  }`}>
                  {t === 'pending' ? '待处理' : t === 'completed' ? '已处理' : '全部'}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2">
              {/* Sort controls */}
              <div className={`flex items-center gap-1 border rounded-lg px-2 py-1 ${isDark ? 'border-gray-700' : 'border-gray-300'}`}>
                {([
                  { field: 'date' as const, label: '时间' },
                  { field: 'name' as const, label: '名称' },
                  { field: 'workflow' as const, label: '流程' },
                  { field: 'status' as const, label: '状态' },
                ] as const).map(s => (
                  <button
                    key={s.field}
                    onClick={() => {
                      if (taskSortField === s.field) setTaskSortDir(d => d === 'asc' ? 'desc' : 'asc');
                      else { setTaskSortField(s.field); setTaskSortDir(s.field === 'date' ? 'desc' : 'asc'); }
                    }}
                    className={`flex items-center gap-0.5 px-2 py-0.5 rounded text-xs font-medium transition-colors ${
                      taskSortField === s.field
                        ? (isDark ? 'bg-blue-900/30 text-blue-400' : 'bg-blue-100 text-blue-700')
                        : (isDark ? 'text-gray-500 hover:text-gray-300' : 'text-gray-400 hover:text-gray-700')
                    }`}
                  >
                    {s.label}
                    {taskSortField === s.field && (taskSortDir === 'asc' ? <ArrowUp size={10} /> : <ArrowDown size={10} />)}
                    {taskSortField !== s.field && <ArrowUpDown size={10} className="opacity-40" />}
                  </button>
                ))}
              </div>
              {/* Search */}
              <div className="relative">
                <Search size={14} className={`absolute left-2.5 top-1/2 -translate-y-1/2 ${isDark ? 'text-gray-500' : 'text-gray-400'}`} />
                <input
                  type="text"
                  placeholder="搜索任务..."
                  value={taskSearch}
                  onChange={(e) => setTaskSearch(e.target.value)}
                  className={`pl-8 pr-3 py-1.5 rounded-lg border text-sm w-52 focus:outline-none focus:ring-2 focus:ring-blue-400 ${
                    isDark ? 'bg-gray-800 border-gray-700 text-white' : 'bg-white border-gray-300 text-gray-900'
                  }`}
                />
              </div>
              {/* Export */}
              <button
                onClick={handleExportTasks}
                title="导出CSV"
                className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg border text-xs font-medium transition-colors ${
                  isDark ? 'border-gray-700 text-gray-400 hover:text-gray-200 hover:bg-gray-700' : 'border-gray-300 text-gray-500 hover:text-gray-800 hover:bg-gray-50'
                }`}
              >
                <Download size={13} /> 导出
              </button>
            </div>
          </div>

          {/* Batch Action Bar */}
          {selectedTaskIds.size > 0 && (
            <div className={`flex items-center gap-3 px-4 py-2.5 rounded-xl border ${isDark ? 'bg-blue-900/20 border-blue-700' : 'bg-blue-50 border-blue-200'}`}>
              <span className={`text-sm font-medium ${isDark ? 'text-blue-300' : 'text-blue-700'}`}>
                已选择 {selectedTaskIds.size} 个任务
              </span>
              <button
                onClick={handleBatchApprove}
                disabled={batchApproving}
                className="px-3 py-1 rounded-lg text-xs font-medium text-white bg-green-600 hover:bg-green-700 disabled:opacity-50"
              >
                {batchApproving ? '处理中...' : '批量通过'}
              </button>
              <button
                onClick={() => setSelectedTaskIds(new Set())}
                className={`px-3 py-1 rounded-lg text-xs font-medium ${isDark ? 'text-gray-300 hover:bg-gray-700' : 'text-gray-600 hover:bg-gray-200'}`}
              >
                取消选择
              </button>
            </div>
          )}

          {tasksLoading ? (
            <div className="flex justify-center py-12"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div></div>
          ) : filteredTasks.length === 0 ? (
            <div className={`text-center py-16 rounded-lg border ${cardBg}`}>
              <ListChecks size={48} className="mx-auto text-gray-400 mb-3" />
              <p className={`text-lg font-medium ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
                {taskSearch ? '未找到匹配任务' : '暂无待办任务'}
              </p>
              {taskSearch && <p className={`text-sm mt-1 ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>请尝试其他搜索关键词</p>}
            </div>
          ) : (
            <div className="space-y-2">
              {/* Select All header (only for pending tab) */}
              {taskTab === 'pending' && filteredTasks.some(t => t.status === 'pending' || t.status === 'claimed') && (
                <div className={`flex items-center gap-2 px-4 py-1.5 text-xs ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                  <input
                    type="checkbox"
                    checked={selectedTaskIds.size > 0 && selectedTaskIds.size === filteredTasks.filter(t => t.status === 'pending' || t.status === 'claimed').length}
                    onChange={toggleSelectAll}
                    className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  />
                  <span>全选可操作任务</span>
                  <span className={`${isDark ? 'text-gray-600' : 'text-gray-300'}`}>|</span>
                  <span>{filteredTasks.length} 个任务</span>
                </div>
              )}
              {filteredTasks.map((task) => {
                const isActionable = task.status === 'pending' || task.status === 'claimed';
                const isSelected = selectedTaskIds.has(task.id);
                return (
                <div key={task.id}
                  className={`flex items-center justify-between rounded-xl border p-4 cursor-pointer hover:shadow-md transition-all ${isSelected ? (isDark ? 'border-blue-600 bg-blue-900/10' : 'border-blue-300 bg-blue-50/50') : ''} ${cardBg}`}>
                  {/* Checkbox (for pending tab) */}
                  {taskTab === 'pending' && isActionable && (
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={(e) => { e.stopPropagation(); toggleTaskSelection(task.id); }}
                      onClick={(e) => e.stopPropagation()}
                      className="mr-3 rounded border-gray-300 text-blue-600 focus:ring-blue-500 flex-shrink-0"
                    />
                  )}
                  <div className="flex items-center gap-3 flex-1 min-w-0" onClick={() => setSubPage({ type: 'task-handle', taskId: task.id })}>
                    <div className={`p-2.5 rounded-xl ${
                      task.status === 'pending' ? 'bg-amber-100 text-amber-600 dark:bg-amber-900/20 dark:text-amber-400'
                      : task.status === 'claimed' ? 'bg-blue-100 text-blue-600 dark:bg-blue-900/20 dark:text-blue-400'
                      : 'bg-green-100 text-green-600 dark:bg-green-900/20 dark:text-green-400'
                    }`}>
                      {task.status === 'pending' ? <Clock size={20} /> : task.status === 'claimed' ? <RefreshCcw size={20} /> : <CheckCircle size={20} />}
                    </div>
                    <div>
                      <h4 className={`font-medium text-sm ${isDark ? 'text-white' : 'text-gray-900'}`}>{task.name}</h4>
                      <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                        <p className={`text-xs ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>{task.taskNumber}</p>
                        {(task.definitionName || task.instanceTitle) && (<><span className={`text-xs ${isDark ? 'text-gray-600' : 'text-gray-300'}`}>·</span><span className={`text-xs px-1.5 py-0.5 rounded ${isDark ? 'bg-purple-900/20 text-purple-400' : 'bg-purple-50 text-purple-600'}`}>{task.definitionName || task.instanceTitle}</span></>)}
                        {task.entityType && entityTypeMap[task.entityType] && (
                          <><span className={`text-xs ${isDark ? 'text-gray-600' : 'text-gray-300'}`}>·</span>
                          <span className={`text-xs px-1.5 py-0.5 rounded ${isDark ? 'bg-emerald-900/20 text-emerald-400' : 'bg-emerald-50 text-emerald-600'}`}>
                            {entityTypeMap[task.entityType]}
                          </span></>
                        )}
                        <span className={`text-xs ${isDark ? 'text-gray-600' : 'text-gray-300'}`}>·</span>
                        <p className={`text-xs ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>{new Date(task.createdAt).toLocaleString('zh-CN')}</p>
                        {task.dueDate && new Date(task.dueDate) < new Date() && task.status !== 'completed' && (
                          <span className="text-xs text-red-500 flex items-center gap-0.5"><AlertTriangle size={10} /> 已超时</span>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {(task.status === 'pending' || task.status === 'claimed') && (
                      <>
                        <button
                          title="快速通过"
                          onClick={(e) => { e.stopPropagation(); setQuickApproval({ show: true, taskId: task.id, taskName: task.name, action: 'approve', comment: '', loading: false }); }}
                          className="p-1.5 rounded-lg bg-green-50 text-green-600 hover:bg-green-100 dark:bg-green-900/20 dark:text-green-400 dark:hover:bg-green-900/40 transition-colors"
                        >
                          <Check size={14} />
                        </button>
                        <button
                          title="快速拒绝"
                          onClick={(e) => { e.stopPropagation(); setQuickApproval({ show: true, taskId: task.id, taskName: task.name, action: 'reject', comment: '', loading: false }); }}
                          className="p-1.5 rounded-lg bg-red-50 text-red-600 hover:bg-red-100 dark:bg-red-900/20 dark:text-red-400 dark:hover:bg-red-900/40 transition-colors"
                        >
                          <X size={14} />
                        </button>
                      </>
                    )}
                    <StatusBadge status={task.status} />
                    <ChevronRight size={16} className="text-gray-400" />
                  </div>
                </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>

    {/* Quick Approval Dialog */}
    {quickApproval.show && (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => !quickApproval.loading && setQuickApproval(prev => ({ ...prev, show: false }))}>
        <div className={`w-full max-w-md mx-4 rounded-2xl shadow-2xl border ${isDark ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'}`}
          onClick={(e) => e.stopPropagation()}>
          <div className={`flex items-center gap-3 px-6 py-4 border-b ${isDark ? 'border-gray-700' : 'border-gray-200'}`}>
            <div className={`p-2 rounded-lg ${quickApproval.action === 'approve' ? 'bg-green-100 text-green-600 dark:bg-green-900/20 dark:text-green-400' : 'bg-red-100 text-red-600 dark:bg-red-900/20 dark:text-red-400'}`}>
              {quickApproval.action === 'approve' ? <Check size={20} /> : <X size={20} />}
            </div>
            <div>
              <h3 className={`font-semibold ${isDark ? 'text-white' : 'text-gray-900'}`}>
                {quickApproval.action === 'approve' ? '确认通过' : '确认拒绝'}
              </h3>
              <p className={`text-xs ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>{quickApproval.taskName}</p>
            </div>
          </div>
          <div className="px-6 py-4">
            <label className={`block text-sm font-medium mb-2 ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
              审批意见 {quickApproval.action === 'reject' && <span className="text-red-500">*</span>}
            </label>
            <textarea
              value={quickApproval.comment}
              onChange={(e) => setQuickApproval(prev => ({ ...prev, comment: e.target.value }))}
              placeholder={quickApproval.action === 'approve' ? '请输入审批意见（可选）' : '请输入拒绝理由'}
              rows={3}
              className={`w-full rounded-lg border px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 ${
                isDark ? 'bg-gray-700 border-gray-600 text-white focus:ring-blue-500' : 'bg-white border-gray-300 text-gray-900 focus:ring-blue-400'
              }`}
              autoFocus
            />
          </div>
          <div className={`flex items-center justify-end gap-3 px-6 py-4 border-t ${isDark ? 'border-gray-700' : 'border-gray-200'}`}>
            <button
              onClick={() => setQuickApproval(prev => ({ ...prev, show: false }))}
              disabled={quickApproval.loading}
              className={`px-4 py-2 rounded-lg text-sm font-medium ${isDark ? 'text-gray-300 hover:bg-gray-700' : 'text-gray-600 hover:bg-gray-100'}`}
            >
              取消
            </button>
            <button
              onClick={handleQuickApproval}
              disabled={quickApproval.loading || (quickApproval.action === 'reject' && !quickApproval.comment.trim())}
              className={`px-4 py-2 rounded-lg text-sm font-medium text-white disabled:opacity-50 ${
                quickApproval.action === 'approve'
                  ? 'bg-green-600 hover:bg-green-700'
                  : 'bg-red-600 hover:bg-red-700'
              }`}
            >
              {quickApproval.loading ? '处理中...' : quickApproval.action === 'approve' ? '确认通过' : '确认拒绝'}
            </button>
          </div>
        </div>
      </div>
    )}
  <ManualViewer show={showManual} onClose={() => setShowManual(false)} manual={workflowManual} isDark={isDark} />
  </>
  );
};

export default WorkflowPage;
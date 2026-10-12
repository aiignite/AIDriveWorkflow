import { Activity, AlertTriangle, ArrowLeft, Calendar, CheckCircle, ChevronDown, ChevronUp, Clock, Download, Eye, ExternalLink, Layers, MessageSquare, Package, User, UserPlus, XCircle } from 'lucide-react'; // 移除未使用的 FileText 导入（TS6133）
import React, { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { useNavigate } from 'react-router-dom';
import WorkflowFormFieldsPanel from '../../components/workflow/WorkflowFormFieldsPanel';
import { useApp } from '../../contexts/AppContext';
import { filesApi, systemApi, workflowInstancesApi, workflowIntegrationApi, workflowTasksApi } from '../../services';
import { fetchWithAuth } from '../../services/client';
import type { EntityDetail } from '../../services/workflow/workflows';
import type { WorkflowButton, WorkflowFormField, WorkflowInstanceLog, WorkflowTaskItem } from '../../types';
import { normalizeButtonAction, resolveButtonResult } from './workflowButtonRoute';

/** Legacy fallback when API does not return detailRoute */
const LEGACY_ENTITY_TYPE_TO_ROUTE: Record<string, (entityId: string) => string> = {
  mat_brands: (entityId: string) => `/brands?openId=${entityId}`,
  chg_requests: (entityId: string) => `/changes/${entityId}`,
  prc_designs: (entityId: string) => `/process?programId=${entityId}`,
  prc_control_plans: (entityId: string) => `/processes/control-plans/${entityId}`,
  change_request: (entityId: string) => `/changes/${entityId}`,
  brand: (entityId: string) => `/brands?openId=${entityId}`,
  process_design: (entityId: string) => `/process?programId=${entityId}`,
  control_plan: (entityId: string) => `/processes/control-plans/${entityId}`,
};

function resolveEntityDetailRoute(entityDetail: EntityDetail): string | null {
  if (entityDetail.detailRoute) {
    return entityDetail.detailRoute;
  }
  const legacyFn = LEGACY_ENTITY_TYPE_TO_ROUTE[entityDetail.entityType];
  return legacyFn ? legacyFn(entityDetail.entityId) : null;
}

/** Fields that should be skipped when no view config is set (technical/system fields) */
const SKIP_FIELDS_DEFAULT = new Set([
  'id', 'created_by', 'updated_by', 'created_by_id', 'updated_by_id',
  'brand_id', 'project_id', 'definition_id', 'instance_id', 'task_id',
  'prepared_by', 'reviewed_by', 'approved_by', 'requested_by', 'budget_id',
  'budget_item_id', 'is_deleted',
  // camelCase (API response after keysToCamel)
  'createdBy', 'updatedBy', 'createdById', 'updatedById',
  'brandId', 'projectId', 'definitionId', 'instanceId', 'taskId',
  'preparedBy', 'reviewedBy', 'approvedBy', 'requestedBy', 'budgetId',
  'budgetItemId', 'isDeleted',
  'logo_url', 'logoUrl',
]);

/** Read detail value by key (supports snake_case config key vs camelCase detail) */
function getDetailValue(detail: Record<string, unknown>, key: string): unknown {
  if (key in detail) return detail[key];
  const camel = key.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
  if (camel in detail) return detail[camel];
  const snake = key.replace(/[A-Z]/g, (m) => `_${m.toLowerCase()}`);
  if (snake in detail) return detail[snake];
  return undefined;
}

/** Suffixes of field names that indicate foreign keys (skip by default) */
const SKIP_FIELD_SUFFIXES = ['_id', '_uuid'];

const EVENT_TYPE_LABELS: Record<string, string> = {
  instance_started: '流程启动',
  instance_completed: '流程完成',
  instance_rejected: '流程驳回',
  instance_suspended: '流程挂起',
  instance_resumed: '流程恢复',
  instance_terminated: '流程终止',
  task_created: '任务创建',
  task_claimed: '任务认领',
  task_completed: '任务完成',
  task_rejected: '任务驳回',
  task_delegated: '任务委派',
  node_entered: '进入节点',
  node_completed: '节点完成',
};

/** Common entity field labels (snake_case keys from API) */
const ENTITY_FIELD_LABELS: Record<string, string> = {
  // 通用
  name: '名称',
  code: '编号',
  number: '编号',
  title: '标题',
  description: '描述',
  remark: '备注',
  notes: '备注',
  status: '状态',
  priority: '优先级',
  category: '分类',
  type: '类型',
  version: '版本',
  serial_number: '序列号',
  // 时间
  created_at: '创建时间',
  updated_at: '更新时间',
  createdAt: '创建时间',
  updatedAt: '更新时间',
  start_date: '开始日期',
  end_date: '结束日期',
  due_date: '截止日期',
  deadline: '截止日期',
  submitted_at: '提交时间',
  approved_at: '审批时间',
  // 人员
  assigned_to: '负责人',
  assignee: '经办人',
  applicant: '申请人',
  reviewer: '评审人',
  owner: '负责人',
  // 品牌
  brand_name: '品牌名称',
  brand_name_en: '英文名称',
  brand_code: '品牌编码',
  country_of_origin: '原产国',
  website: '官网',
  contact_info: '联系信息',
  certification_info: '认证信息',
  quality_rating: '质量评级',
  cooperation_status: '合作状态',
  industry: '行业',
  // 物料
  part_number: '零件号',
  material_type: '物料类型',
  specification: '规格',
  unit: '单位',
  material_number: '物料编号',
  material_name: '物料名称',
  drawing_number: '图号',
  // 设备
  equipment_code: '设备编号',
  equipment_name: '设备名称',
  model: '型号',
  manufacturer: '制造商',
  location: '位置',
  purchase_date: '采购日期',
  // 文档
  file_name: '文件名',
  file_size: '文件大小',
  file_type: '文件类型',
  // 变更
  change_type: '变更类型',
  reason: '变更原因',
  impact: '影响范围',
  // 工艺
  process_name: '工艺名称',
  operation_name: '工序名称',
  // 评审
  review_type: '评审类型',
  result: '评审结果',
  // 项目 / 预算
  project_name: '所属项目',
  projectName: '所属项目',
  budget_type: '预算类型',
  budgetType: '预算类型',
  budget_type_label: '预算类型',
  budgetTypeLabel: '预算类型',
  category_label: '费用分类',
  categoryLabel: '费用分类',
  fiscal_year: '财年',
  fiscalYear: '财年',
  total_budget: '预算总额',
  totalBudget: '预算总额',
  prepared_by_name: '编制人',
  preparedByName: '编制人',
  reviewed_by_name: '审核人',
  reviewedByName: '审核人',
  approved_by_name: '批准人',
  approvedByName: '批准人',
  status_label: '状态',
  statusLabel: '状态',
  department: '使用部门',
  budget_name: '关联预算',
  budgetName: '关联预算',
  adjustment_type: '调整类型',
  adjustmentType: '调整类型',
  adjustment_type_label: '调整类型',
  adjustmentTypeLabel: '调整类型',
  original_amount: '原金额',
  originalAmount: '原金额',
  adjusted_amount: '调整后金额',
  adjustedAmount: '调整后金额',
  requested_by_name: '申请人',
  requestedByName: '申请人',
  // 项目
  milestone: '里程碑',
  progress: '进度',
  // 其他
  quantity: '数量',
  amount: '金额',
  currency: '货币',
  url: '链接',
  tag: '标签',
  tags: '标签',
};

interface Props {
  taskId: string;
  onBack: () => void;
}

const WorkflowTaskHandlePage: React.FC<Props> = ({ taskId, onBack }) => {
  const { theme } = useApp();
  const isDark = theme === 'dark';
  const navigate = useNavigate();

  const [task, setTask] = useState<WorkflowTaskItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  // Form
  const [comment, setComment] = useState('');
  const [formData, setFormData] = useState<Record<string, unknown>>({});
  const [delegateUserId, setDelegateUserId] = useState('');
  const [showDelegateModal, setShowDelegateModal] = useState(false);
  const [allUsers, setAllUsers] = useState<{ id: string; name: string }[]>([]);
  const [rejectHint, setRejectHint] = useState(false);
  const [confirmAction, setConfirmAction] = useState<'approve' | 'reject' | null>(null);

  // Node form config from definition
  const [formFields, setFormFields] = useState<WorkflowFormField[]>([]);
  const [formButtons, setFormButtons] = useState<WorkflowButton[]>([]);

  // Task history/timeline
  const [taskLogs, setTaskLogs] = useState<WorkflowInstanceLog[]>([]);
  const [showTimeline, setShowTimeline] = useState(false);

  // Entity detail for display in approval
  const [entityDetail, setEntityDetail] = useState<EntityDetail | null>(null);
  const [showEntityDetail, setShowEntityDetail] = useState(true);

  // File preview / download for uploaded attachments
  const handleFilePreview = useCallback(async (entityId: string) => {
    try {
      const res = await fetchWithAuth(filesApi.url(entityId));
      if (!res.ok) throw new Error('预览失败');
      const blob = await res.blob();
      window.open(URL.createObjectURL(blob), '_blank');
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : '预览失败');
    }
  }, []);

  const handleFileDownload = useCallback(async (entityId: string, filename?: string) => {
    try {
      await filesApi.download(entityId, filename);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : '下载失败');
    }
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const data = await workflowTasksApi.get(taskId);
        setTask(data);
        if (data.formData) setFormData(data.formData);

        // Try to load form config from the node
        if (data.node?.formConfig) {
          setFormFields(data.node.formConfig.formFields || []);
          setFormButtons(data.node.formConfig.buttons || []);
        }

        // Load instance logs for timeline
        if (data.instanceId) {
          try {
            const instData = await workflowInstancesApi.get(data.instanceId);
            setTaskLogs(instData.logs || []);
          } catch { /* ignore */ }
        }

        // Load entity detail if available
        if (data.entityType && data.entityId) {
          try {
            const detail = await workflowIntegrationApi.entityDetail(data.entityType, data.entityId);
            setEntityDetail(detail);
          } catch { /* ignore - entity may have been deleted */ }
        }
      } catch (err) { console.error(err); }
      setLoading(false);
    })();
  }, [taskId]);

  // Load users for delegate dropdown
  useEffect(() => {
    systemApi.users().then(setAllUsers).catch(() => {});
  }, []);

  const handleClaim = async () => {
    setSubmitting(true);
    try {
      await workflowTasksApi.claim(taskId);
      const data = await workflowTasksApi.get(taskId);
      setTask(data);
    } catch (e: unknown) { toast.error(e instanceof Error ? e.message : '操作失败'); }
    setSubmitting(false);
  };

  const handleApprove = async () => {
    setSubmitting(true);
    try {
      await workflowTasksApi.complete(taskId, {
        result: 'approved',
        comment,
        formData: Object.keys(formData).length > 0 ? formData : undefined,
      });
      onBack();
    } catch (e: unknown) { toast.error(e instanceof Error ? e.message : '操作失败'); }
    setSubmitting(false);
  };

  const handleReject = async () => {
    if (!comment.trim()) {
      setRejectHint(true);
      toast.error('拒绝时必须填写意见');
      return;
    }
    setSubmitting(true);
    try {
      await workflowTasksApi.reject(taskId, {
        result: 'rejected',
        comment,
      });
      onBack();
    } catch (e: unknown) { toast.error(e instanceof Error ? e.message : '操作失败'); }
    setSubmitting(false);
  };

  /** Submit via configured form button (route / terminate / back_to_start). */
  const handleConfiguredButton = async (btn: WorkflowButton) => {
    if (btn.action === 'delegate' || btn.action === 'transfer') {
      setShowDelegateModal(true);
      return;
    }
    if (btn.action === 'cancel') {
      onBack();
      return;
    }
    if (btn.requireComment && !comment.trim()) {
      setRejectHint(true);
      toast.error(`「${btn.label}」需要填写处理意见`);
      return;
    }
    if (btn.confirmMessage && !window.confirm(btn.confirmMessage)) return;

    const result = resolveButtonResult(btn, 'approved');
    setSubmitting(true);
    try {
      await workflowTasksApi.complete(taskId, {
        result,
        comment,
        formData: Object.keys(formData).length > 0 ? formData : undefined,
        buttonKey: btn.key,
        targetNodeKey: btn.targetNodeKey,
      });
      onBack();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : '操作失败');
    }
    setSubmitting(false);
  };

  const requestAction = (action: 'approve' | 'reject') => {
    if (action === 'reject' && !comment.trim()) {
      setRejectHint(true);
      toast.error('拒绝时必须填写意见');
      return;
    }
    setConfirmAction(action);
  };

  const executeConfirmedAction = () => {
    if (confirmAction === 'approve') handleApprove();
    else if (confirmAction === 'reject') handleReject();
    setConfirmAction(null);
  };

  const handleDelegate = async () => {
    if (!delegateUserId) {
      toast.error('请选择委派用户');
      return;
    }
    setSubmitting(true);
    try {
      await workflowTasksApi.delegate(taskId, {
        targetUserId: delegateUserId,
        comment,
      });
      onBack();
    } catch (e: unknown) { toast.error(e instanceof Error ? e.message : '操作失败'); }
    setSubmitting(false);
  };

  const cardBg = isDark ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200';
  const inputBg = isDark ? 'bg-gray-700 border-gray-600 text-white' : 'bg-white border-gray-300 text-gray-900';

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
    </div>
  );

  if (!task) return (
    <div className="text-center py-12">
      <p className="text-red-500">加载失败</p>
      <button onClick={onBack} className="mt-2 text-blue-600 underline">返回</button>
    </div>
  );

  const isPending = task.status === 'pending';
  const isClaimed = task.status === 'claimed';
  const isActionable = isPending || isClaimed;

  return (
    <div className="max-w-3xl mx-auto space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button onClick={onBack} className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700">
          <ArrowLeft size={18} />
        </button>
        <div className="flex-1">
          <h1 className={`text-xl font-bold ${isDark ? 'text-white' : 'text-gray-900'}`}>
            {task.name}
          </h1>
          <p className={`text-sm ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
            {task.taskNumber}
          </p>
        </div>
        <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium ${
          task.status === 'pending' ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'
          : task.status === 'claimed' ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'
          : task.status === 'completed' ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
          : 'bg-gray-100 text-gray-600'
        }`}>
          {task.status === 'pending' ? <><Clock size={12} /> 待处理</>
            : task.status === 'claimed' ? <><User size={12} /> 处理中</>
            : task.status === 'completed' ? <><CheckCircle size={12} /> 已完成</>
            : task.status}
        </span>
      </div>

      {/* Task info */}
      <div className={`rounded-lg border p-4 ${cardBg}`}>
        <h3 className={`text-sm font-semibold mb-3 ${isDark ? 'text-gray-200' : 'text-gray-800'}`}>
          任务信息
        </h3>
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <span className={`text-xs ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>处理人</span>
            <div className={`font-medium ${isDark ? 'text-gray-200' : 'text-gray-800'}`}>
              {task.assignee?.name || '待认领'}
            </div>
          </div>
          <div>
            <span className={`text-xs ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>创建时间</span>
            <div className={`font-medium ${isDark ? 'text-gray-200' : 'text-gray-800'}`}>
              {new Date(task.createdAt).toLocaleString('zh-CN')}
            </div>
          </div>
          {task.dueDate && (
            <div>
              <span className={`text-xs ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>截止时间</span>
              <div className={`font-medium ${
                new Date(task.dueDate) < new Date() ? 'text-red-500' : isDark ? 'text-gray-200' : 'text-gray-800'
              }`}>
                {new Date(task.dueDate).toLocaleString('zh-CN')}
                {new Date(task.dueDate) < new Date() && (
                  <span className="ml-1 inline-flex items-center gap-0.5 text-red-500">
                    <AlertTriangle size={11} /> 已超时
                  </span>
                )}
              </div>
            </div>
          )}
          {task.claimedAt && (
            <div>
              <span className={`text-xs ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>认领时间</span>
              <div className={`font-medium ${isDark ? 'text-gray-200' : 'text-gray-800'}`}>
                {new Date(task.claimedAt).toLocaleString('zh-CN')}
              </div>
            </div>
          )}
          {task.completedAt && (
            <div>
              <span className={`text-xs ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>完成时间</span>
              <div className={`font-medium ${isDark ? 'text-gray-200' : 'text-gray-800'}`}>
                {new Date(task.completedAt).toLocaleString('zh-CN')}
              </div>
            </div>
          )}
          {task.result && (
            <div>
              <span className={`text-xs ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>处理结果</span>
              <div className={`font-medium ${
                task.result === 'approved' ? 'text-green-600' : task.result === 'rejected' ? 'text-red-600' : isDark ? 'text-gray-200' : 'text-gray-800'
              }`}>
                {task.result === 'approved' ? '✅ 通过' : task.result === 'rejected' ? '❌ 拒绝' : task.result}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Entity Detail Panel - shows what is being approved */}
      {entityDetail && (
        <div className={`rounded-lg border ${cardBg}`}>
          <div className="flex items-center justify-between px-4 py-3">
            <button
              onClick={() => setShowEntityDetail(!showEntityDetail)}
              className="flex items-center gap-2 flex-1 text-left"
            >
              <span className={`text-sm font-semibold flex items-center gap-2 ${isDark ? 'text-gray-200' : 'text-gray-800'}`}>
                <Package size={15} className="text-emerald-500" />
                审批对象：{entityDetail.displayName}
                <span className={`text-xs font-normal px-1.5 py-0.5 rounded ${isDark ? 'bg-gray-700 text-gray-400' : 'bg-gray-100 text-gray-500'}`}>
                  {entityDetail.module}
                </span>
              </span>
            </button>
            <div className="flex items-center gap-2">
              {/* 文件预览/下载按钮（仅文档类型） */}
              {entityDetail.entityType === 'doc_documents' && (
                <>
                  <button
                    onClick={() => handleFilePreview(entityDetail.entityId)}
                    className={`flex items-center gap-1 px-2.5 py-1 text-xs rounded-lg border transition-colors ${
                      isDark
                        ? 'border-blue-600 text-blue-400 hover:bg-blue-900/30'
                        : 'border-blue-500 text-blue-600 hover:bg-blue-50'
                    }`}
                    title="在新标签页中预览文件"
                  >
                    <Eye size={12} />
                    预览文件
                  </button>
                  <button
                    onClick={() => handleFileDownload(
                      entityDetail.entityId,
                      (entityDetail.detail.original_filename as string | undefined) ||
                      (entityDetail.detail.title as string | undefined),
                    )}
                    className={`flex items-center gap-1 px-2.5 py-1 text-xs rounded-lg border transition-colors ${
                      isDark
                        ? 'border-indigo-600 text-indigo-400 hover:bg-indigo-900/30'
                        : 'border-indigo-500 text-indigo-600 hover:bg-indigo-50'
                    }`}
                    title="下载文件到本地"
                  >
                    <Download size={12} />
                    下载文件
                  </button>
                </>
              )}
              {/* 打开完整对象 */}
              {entityDetail && resolveEntityDetailRoute(entityDetail) && (
                <button
                  onClick={() => {
                    const route = resolveEntityDetailRoute(entityDetail);
                    if (route) navigate(route);
                  }}
                  className={`flex items-center gap-1 px-2.5 py-1 text-xs rounded-lg border transition-colors ${
                    isDark
                      ? 'border-emerald-600 text-emerald-400 hover:bg-emerald-900/30'
                      : 'border-emerald-500 text-emerald-600 hover:bg-emerald-50'
                  }`}
                  title="在对应模块页面查看完整对象详情"
                >
                  <ExternalLink size={12} />
                  打开完整对象
                </button>
              )}
              <button
                onClick={() => setShowEntityDetail(!showEntityDetail)}
                className={`p-1 rounded transition-colors ${isDark ? 'hover:bg-gray-700' : 'hover:bg-gray-100'}`}
              >
                {showEntityDetail ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
              </button>
            </div>
          </div>
          {showEntityDetail && (
            <div className="px-4 pb-4">
              {(() => {
                // Build field entries
                const entries = entityDetail.viewConfig?.fields
                  ? entityDetail.viewConfig.fields
                      .map(f => [f.key, getDetailValue(entityDetail.detail, f.key), f.label] as const)
                      .filter(([, v]) => v !== null && v !== undefined && v !== '')
                  : Object.entries(entityDetail.detail)
                      .filter(([key, v]) => {
                        if (v === null || v === undefined || v === '') return false;
                        if (SKIP_FIELDS_DEFAULT.has(key)) return false;
                        if (SKIP_FIELD_SUFFIXES.some(s => key.endsWith(s))) return false;
                        return true;
                      })
                      .map(([k, v]) => [k, v, undefined] as const);

                // Group fields by category
                const TIME_FIELDS = new Set(['created_at', 'updated_at', 'createdAt', 'updatedAt', 'start_date', 'end_date', 'due_date', 'deadline', 'submitted_at', 'approved_at', 'purchase_date', 'production_date', 'inspection_date', 'planned_start', 'planned_end', 'actual_start', 'actual_end']);
                const DESC_FIELDS = new Set(['description', 'remark', 'notes', 'reason', 'impact', 'result', 'contact_info', 'certification_info', 'summary', 'content', 'comment']);
                const IDENTITY_FIELDS = new Set(['name', 'code', 'number', 'title', 'serial_number', 'brand_name', 'brand_name_en', 'brand_code', 'part_number', 'material_number', 'material_name', 'equipment_code', 'equipment_name', 'file_name', 'process_name', 'operation_name', 'project_name', 'projectName', 'budget_name', 'budgetName', 'drawing_number', 'status_label', 'statusLabel']);

                type FieldEntry = readonly [string, unknown, string | undefined];
                const groups: { label: string; icon: React.ReactNode; fields: FieldEntry[] }[] = [
                  { label: '基本信息', icon: <Package size={13} className="text-blue-500" />, fields: [] },
                  { label: '属性信息', icon: <Layers size={13} className="text-purple-500" />, fields: [] },
                  { label: '描述与备注', icon: <MessageSquare size={13} className="text-emerald-500" />, fields: [] },
                  { label: '时间信息', icon: <Calendar size={13} className="text-amber-500" />, fields: [] },
                ];

                for (const entry of entries) {
                  const key = entry[0] as string;
                  if (IDENTITY_FIELDS.has(key) || key === 'status' || key === 'version') {
                    groups[0].fields.push(entry);
                  } else if (DESC_FIELDS.has(key)) {
                    groups[2].fields.push(entry);
                  } else if (TIME_FIELDS.has(key)) {
                    groups[3].fields.push(entry);
                  } else {
                    groups[1].fields.push(entry);
                  }
                }

                // Only show groups with fields
                const activeGroups = groups.filter(g => g.fields.length > 0);
                // If viewConfig is set or too few fields, show flat list
                if (entityDetail.viewConfig?.fields || activeGroups.length <= 1) {
                  return (
                    <div className="grid grid-cols-2 gap-x-6 gap-y-2.5 text-sm">
                      {entries.map(([key, value, customLabel]) => {
                        const isWide = key === 'description' || key === 'remark' || key === 'notes'
                          || key === 'contact_info' || key === 'certification_info' || key === 'reason'
                          || key === 'impact' || key === 'result';
                        const displayValue = typeof value === 'object' ? JSON.stringify(value) : String(value);
                        const isDate = typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value);
                        const formatted = isDate ? new Date(value).toLocaleString('zh-CN') : displayValue;
                        const label = customLabel || ENTITY_FIELD_LABELS[key as string] || (key as string).replace(/_/g, ' ');
                        return (
                          <div key={key as string} className={isWide ? 'col-span-2' : ''}>
                            <span className={`text-xs ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>{label}</span>
                            <div className={`font-medium break-words ${isDark ? 'text-gray-200' : 'text-gray-800'}`}>{formatted || '-'}</div>
                          </div>
                        );
                      })}
                    </div>
                  );
                }

                return (
                  <div className="space-y-3">
                    {activeGroups.map((group) => (
                      <div key={group.label}>
                        <div className={`flex items-center gap-1.5 mb-2 pb-1 border-b ${isDark ? 'border-gray-700' : 'border-gray-100'}`}>
                          {group.icon}
                          <span className={`text-xs font-semibold ${isDark ? 'text-gray-300' : 'text-gray-600'}`}>{group.label}</span>
                          <span className={`text-xs ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>({group.fields.length})</span>
                        </div>
                        <div className="grid grid-cols-2 gap-x-6 gap-y-2.5 text-sm">
                          {group.fields.map(([key, value, customLabel]) => {
                            const isWide = DESC_FIELDS.has(key as string);
                            const displayValue = typeof value === 'object' ? JSON.stringify(value) : String(value);
                            const isDate = typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value);
                            const formatted = isDate ? new Date(value).toLocaleString('zh-CN') : displayValue;
                            const label = customLabel || ENTITY_FIELD_LABELS[key as string] || (key as string).replace(/_/g, ' ');
                            return (
                              <div key={key as string} className={isWide ? 'col-span-2' : ''}>
                                <span className={`text-xs ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>{label}</span>
                                <div className={`font-medium break-words ${isDark ? 'text-gray-200' : 'text-gray-800'}`}>{formatted || '-'}</div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                );
              })()}
            </div>
          )}
        </div>
      )}

      {/* Dynamic Form Fields */}
      {formFields.length > 0 && (
        <WorkflowFormFieldsPanel
          fields={formFields}
          formData={formData}
          isDark={isDark}
          readonly={!isActionable}
          onChange={isActionable ? setFormData : undefined}
          businessEntityType={task.entityType}
          businessEntityId={task.entityId}
        />
      )}

      {/* Timeline */}
      {taskLogs.length > 0 && (
        <div className={`rounded-lg border ${cardBg}`}>
          <button
            onClick={() => setShowTimeline(!showTimeline)}
            className="flex items-center justify-between w-full px-4 py-3"
          >
            <span className={`text-sm font-semibold flex items-center gap-2 ${isDark ? 'text-gray-200' : 'text-gray-800'}`}>
              <Activity size={15} className="text-purple-500" /> 流程处理时间线 ({taskLogs.length})
            </span>
            {showTimeline ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </button>
          {showTimeline && (
            <div className="px-4 pb-4">
              <div className="relative border-l-2 border-gray-200 dark:border-gray-600 ml-3 space-y-3">
                {taskLogs.map((log, i) => (
                  <div key={i} className="relative pl-6">
                    <div className={`absolute -left-[9px] top-1 w-4 h-4 rounded-full border-2 ${
                      log.eventType.includes('complete') ? 'bg-green-500 border-green-400'
                      : log.eventType.includes('reject') ? 'bg-red-500 border-red-400'
                      : log.eventType.includes('start') ? 'bg-blue-500 border-blue-400'
                      : 'bg-gray-400 border-gray-300 dark:bg-gray-500 dark:border-gray-400'
                    }`} />
                    <div className="flex items-center justify-between">
                      <span className={`text-sm font-medium ${isDark ? 'text-gray-200' : 'text-gray-800'}`}>
                        {EVENT_TYPE_LABELS[log.eventType] || log.eventType}
                      </span>
                      <span className={`text-xs ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                        {new Date(log.createdAt).toLocaleString('zh-CN')}
                      </span>
                    </div>
                    <p className={`text-xs mt-0.5 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                      {log.actor?.name || '系统'}{log.nodeName ? ` · ${log.nodeName}` : ''}
                    </p>
                    {log.comment && (
                      <p className={`text-xs mt-1 italic ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                        "{log.comment}"
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Action area (only for actionable tasks) — mobile sticky above BottomNav */}
      {isActionable && (
        <div
          className={`rounded-lg border p-4 ${cardBg} sticky z-30 shadow-lg lg:shadow-none lg:static max-lg:bottom-above-nav max-lg:mx-[-0.25rem]`}
        >
          {/* Claim button for pending tasks with no assignee */}
          {isPending && !task.assignee && (
            <div className="text-center py-4">
              <p className={`text-sm mb-3 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                此任务尚未分配，请先认领
              </p>
              <button
                onClick={handleClaim}
                disabled={submitting}
                className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm font-medium disabled:opacity-50"
              >
                认领任务
              </button>
            </div>
          )}

          {/* Comment & action buttons */}
          {(isClaimed || (isPending && task.assignee)) && (
            <>
              <h3 className={`text-sm font-semibold mb-3 flex items-center gap-2 ${isDark ? 'text-gray-200' : 'text-gray-800'}`}>
                <MessageSquare size={15} className="text-indigo-500" /> 处理意见
                {rejectHint && <span className="text-red-500 text-xs font-normal">（意见必填）</span>}
              </h3>
              <textarea
                rows={3}
                value={comment}
                onChange={e => { setComment(e.target.value); if (e.target.value.trim()) setRejectHint(false); }}
                placeholder={rejectHint ? '请输入处理意见（必填）' : '请输入处理意见...'}
                className={`w-full px-3 py-2 text-sm rounded-lg border resize-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500 transition-all ${inputBg} ${rejectHint ? 'ring-2 ring-red-500/50 border-red-400' : ''}`}
              />
              <div className="flex items-center justify-between mt-4 gap-2 flex-wrap">
                <button
                  onClick={() => setShowDelegateModal(true)}
                  className={`flex items-center gap-1 px-3 py-1.5 text-sm rounded-lg border hover:bg-gray-50 dark:hover:bg-gray-700 ${isDark ? 'border-gray-600' : 'border-gray-300'}`}
                >
                  <UserPlus size={14} /> 委派
                </button>
                {formButtons.length > 0 ? (
                  <div className="flex gap-2 flex-wrap justify-end">
                    {formButtons.map(btn => {
                      const btnColorMap: Record<string, string> = {
                        primary: 'bg-blue-600 hover:bg-blue-700 text-white',
                        danger: 'bg-red-500 hover:bg-red-600 text-white',
                        warning: 'bg-amber-500 hover:bg-amber-600 text-white',
                        default: isDark ? 'bg-gray-600 hover:bg-gray-500 text-white' : 'bg-gray-200 hover:bg-gray-300 text-gray-800',
                      };
                      const action = normalizeButtonAction(btn.action);
                      return (
                        <button
                          key={btn.key}
                          onClick={() => void handleConfiguredButton(btn)}
                          disabled={submitting}
                          title={action === 'route' && btn.targetNodeKey ? `→ ${btn.targetNodeKey}` : undefined}
                          className={`flex items-center gap-1 px-4 py-2 text-sm font-medium rounded-lg disabled:opacity-50 transition-colors ${btnColorMap[btn.color] || btnColorMap.default}`}
                        >
                          {btn.label}
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <div className="flex gap-2">
                    <button
                      onClick={() => requestAction('reject')}
                      disabled={submitting}
                      className="flex items-center gap-1 px-4 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600 text-sm font-medium disabled:opacity-50 transition-colors"
                    >
                      <XCircle size={14} /> 拒绝
                    </button>
                    <button
                      onClick={() => requestAction('approve')}
                      disabled={submitting}
                      className="flex items-center gap-1 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 text-sm font-medium disabled:opacity-50 transition-colors"
                    >
                      <CheckCircle size={14} /> 通过
                    </button>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {/* Completed task result */}
      {!isActionable && task.comment && (
        <div className={`rounded-lg border p-4 ${cardBg}`}>
          <h3 className={`text-sm font-semibold mb-2 ${isDark ? 'text-gray-200' : 'text-gray-800'}`}>
            处理意见
          </h3>
          <p className={`text-sm ${isDark ? 'text-gray-300' : 'text-gray-600'}`}>
            {task.comment}
          </p>
        </div>
      )}

      {/* Delegate modal */}
      {showDelegateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className={`w-96 rounded-lg shadow-xl p-5 ${isDark ? 'bg-gray-800' : 'bg-white'}`}>
            <h3 className={`text-lg font-semibold mb-3 ${isDark ? 'text-white' : 'text-gray-900'}`}>
              委派任务
            </h3>
            <div className="space-y-3">
              <div>
                <label className={`block text-sm font-medium mb-1 ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
                  委派给
                </label>
                <select
                  value={delegateUserId}
                  onChange={e => setDelegateUserId(e.target.value)}
                  className={`w-full px-3 py-2 text-sm rounded-lg border ${inputBg}`}
                >
                  <option value="">请选择用户</option>
                  {allUsers.map(u => (
                    <option key={u.id} value={u.id}>{u.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className={`block text-sm font-medium mb-1 ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
                  委派说明
                </label>
                <textarea
                  rows={2}
                  value={comment}
                  onChange={e => setComment(e.target.value)}
                  className={`w-full px-3 py-2 text-sm rounded-lg border resize-none ${inputBg}`}
                  placeholder="请输入委派原因..."
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <button
                onClick={() => setShowDelegateModal(false)}
                className={`px-4 py-2 text-sm rounded-lg border ${isDark ? 'border-gray-600 hover:bg-gray-700' : 'border-gray-300 hover:bg-gray-50'}`}
              >
                取消
              </button>
              <button
                onClick={handleDelegate}
                disabled={submitting}
                className="px-4 py-2 text-sm rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
              >
                确认委派
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirm action dialog */}
      {confirmAction && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60]" onClick={() => setConfirmAction(null)}>
          <div className={`rounded-xl p-6 shadow-2xl max-w-sm w-full mx-4 ${isDark ? 'bg-gray-800' : 'bg-white'}`} onClick={e => e.stopPropagation()}>
            <div className="flex items-center gap-3 mb-4">
              {confirmAction === 'approve' ? (
                <div className="p-2 rounded-full bg-green-100 dark:bg-green-900/30"><CheckCircle size={24} className="text-green-600" /></div>
              ) : (
                <div className="p-2 rounded-full bg-red-100 dark:bg-red-900/30"><XCircle size={24} className="text-red-500" /></div>
              )}
              <div>
                <h3 className={`text-base font-semibold ${isDark ? 'text-white' : 'text-gray-900'}`}>
                  确认{confirmAction === 'approve' ? '通过' : '拒绝'}
                </h3>
                <p className={`text-sm mt-0.5 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                  {confirmAction === 'approve' ? '确定要通过此审批任务吗？' : '确定要拒绝此审批任务吗？'}
                </p>
              </div>
            </div>
            {comment.trim() && (
              <div className={`text-xs p-2 rounded mb-4 ${isDark ? 'bg-gray-700 text-gray-300' : 'bg-gray-50 text-gray-600'}`}>
                <span className="font-medium">意见：</span>{comment}
              </div>
            )}
            <div className="flex justify-end gap-2">
              <button onClick={() => setConfirmAction(null)}
                className={`px-4 py-2 text-sm rounded-lg border ${isDark ? 'border-gray-600 hover:bg-gray-700' : 'border-gray-300 hover:bg-gray-50'}`}>
                取消
              </button>
              <button onClick={executeConfirmedAction} disabled={submitting}
                className={`px-4 py-2 text-sm font-medium rounded-lg text-white disabled:opacity-50 ${confirmAction === 'approve' ? 'bg-green-600 hover:bg-green-700' : 'bg-red-500 hover:bg-red-600'}`}>
                {submitting ? '处理中...' : `确认${confirmAction === 'approve' ? '通过' : '拒绝'}`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default WorkflowTaskHandlePage;
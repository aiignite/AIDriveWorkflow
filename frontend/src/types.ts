// ============================================================
// AIDriveWorkflow - Core Type Definitions
// （自 AIIgnitePLM types.ts Workflow 段 1:1 抽取）
// ============================================================

// ── Workflow Management ─────────────────────────────────────

export type WorkflowNodeType =
  | 'start'
  | 'end'
  | 'user_task'
  | 'approval'
  | 'exclusive_gateway'
  | 'parallel_gateway'
  | 'service_task';

export type WorkflowDefinitionStatus = 'draft' | 'published' | 'archived';
export type WorkflowInstanceStatus = 'running' | 'completed' | 'terminated' | 'suspended';
export type WorkflowTaskStatus = 'pending' | 'claimed' | 'completed' | 'rejected' | 'delegated' | 'expired' | 'cancelled';
export type WorkflowCategory = 'change_management' | 'document' | 'design_review' | 'deviation' | 'custom';

export interface WorkflowFormField {
  field: string;
  label: string;
  type: 'text' | 'textarea' | 'select' | 'number' | 'date' | 'checkbox' | 'radio' | 'file' | 'user_picker';
  options?: { label: string; value: string }[];
  required?: boolean;
  readonly?: boolean;
  defaultValue?: string | number | boolean;
  placeholder?: string;
}

export interface WorkflowButton {
  key: string;
  label: string;
  color: 'primary' | 'danger' | 'warning' | 'default';
  /** route=走绑定出边；terminate=作废；back_to_start=退回发起；其余本地动作 */
  action: 'route' | 'terminate' | 'back_to_start' | 'complete' | 'reject' | 'delegate' | 'transfer' | 'save' | 'cancel';
  /** 写入 task.result / variables.result（如 approved / returned / void） */
  result?: string;
  /** action=route 时：出边目标节点 nodeKey */
  targetNodeKey?: string;
  requireComment?: boolean;
  confirmMessage?: string;
}

export interface WorkflowFormConfig {
  formFields: WorkflowFormField[];
  buttons: WorkflowButton[];
  visibleSections?: string[];
}

export type WorkflowAssigneeHandlerType =
  | 'user'
  | 'role'
  | 'project_role'
  | 'department'
  | 'initiator'
  | 'manager'
  | 'expression';

/** 节点处理人条目（可叠加多条） */
export interface WorkflowAssigneeHandler {
  type: WorkflowAssigneeHandlerType;
  value?: string;
  label?: string;
}

export interface WorkflowAssigneeConfig {
  /** @deprecated 兼容旧单条配置；优先用 handlers */
  assigneeType: WorkflowAssigneeHandlerType;
  /** @deprecated 兼容旧单条配置；优先用 handlers */
  assigneeValue?: string;
  /** 多条异构处理人；有则覆盖 assigneeType/assigneeValue */
  handlers?: WorkflowAssigneeHandler[];
  multiInstance?: boolean;
  completionCondition?: 'all' | 'any' | 'percentage';
  completionPercentage?: number;
}

export interface WorkflowApprovalConfig {
  approvalType: 'single' | 'sequential' | 'parallel';
  approvers: { type: string; id: string; name?: string }[];
  rejectAction: 'back_to_start' | 'back_to_previous' | 'terminate';
  allowDelegate?: boolean;
  allowTransfer?: boolean;
}

export interface WorkflowCondition {
  field?: string;
  operator?: 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'in' | 'contains';
  value?: string | number | boolean | string[];
  logic?: 'and' | 'or';
  conditions?: WorkflowCondition[];
}

export interface WorkflowActionConfig {
  actionType: 'update_field' | 'send_notification' | 'create_task' | 'call_api' | 'run_script';
  actionConfig: Record<string, unknown>;
}

export interface WorkflowTimeoutConfig {
  timeoutHours: number;
  timeoutAction: 'remind' | 'escalate' | 'auto_approve' | 'auto_reject';
}

export interface WorkflowNode {
  id: string;
  definitionId: string;
  nodeKey: string;
  name: string;
  description?: string;
  nodeType: WorkflowNodeType;
  sortOrder: number;
  positionX: number;
  positionY: number;
  assigneeConfig?: WorkflowAssigneeConfig;
  approvalConfig?: WorkflowApprovalConfig;
  formConfig?: WorkflowFormConfig;
  actionConfig?: WorkflowActionConfig;
  gatewayConfig?: { defaultEdgeId?: string };
  timeoutConfig?: WorkflowTimeoutConfig;
}

export interface WorkflowEdge {
  id: string;
  definitionId: string;
  sourceNodeId: string;
  targetNodeId: string;
  label?: string;
  condition?: WorkflowCondition;
  isDefault: boolean;
  sortOrder: number;
}

export interface WorkflowDefinition {
  id: string;
  key: string;
  name: string;
  description?: string;
  category: WorkflowCategory;
  version: number;
  status: WorkflowDefinitionStatus;
  entityType?: string;
  entityViewConfig?: { fields: { key: string; label: string }[] } | null;
  isBuiltin: boolean;
  triggerConfig?: Record<string, unknown>;
  createdBy?: { id: string; name: string; image?: string };
  createdAt: string;
  updatedAt: string;
}

export interface WorkflowDefinitionDetail extends WorkflowDefinition {
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
}

export interface WorkflowInstance {
  id: string;
  definitionId: string;
  instanceNumber: string;
  title: string;
  status: WorkflowInstanceStatus;
  entityType?: string;
  entityId?: string;
  variables?: Record<string, unknown>;
  currentNodeIds?: string[];
  priority: string;
  initiatedBy?: { id: string; name: string; image?: string };
  definitionName?: string;
  startedAt: string;
  completedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface WorkflowInstanceDetail extends WorkflowInstance {
  tasks: WorkflowTaskItem[];
  logs: WorkflowInstanceLog[];
}

export interface WorkflowTaskItem {
  id: string;
  instanceId: string;
  nodeId: string;
  taskNumber: string;
  name: string;
  status: WorkflowTaskStatus;
  assignee?: { id: string; name: string; image?: string };
  candidateIds?: string[];
  result?: string;
  comment?: string;
  formData?: Record<string, unknown>;
  dueDate?: string;
  claimedAt?: string;
  completedAt?: string;
  createdAt: string;
  updatedAt: string;
  node?: WorkflowNode;
  instanceTitle?: string;
  definitionName?: string;
  entityType?: string;
  entityId?: string;
}

export interface WorkflowInstanceLog {
  id: string;
  instanceId: string;
  nodeId?: string;
  nodeName?: string;
  taskId?: string;
  eventType: string;
  actor?: { id: string; name: string; image?: string };
  details?: Record<string, unknown>;
  comment?: string;
  createdAt: string;
}

export interface WorkflowTaskSummary {
  pending: number;
  claimed: number;
  completedToday: number;
  overdue: number;
  total: number;
}

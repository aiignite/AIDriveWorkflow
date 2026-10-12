import { api, buildQuery } from '../client';
import type {
  WorkflowDefinition,
  WorkflowDefinitionDetail,
  WorkflowInstance,
  WorkflowInstanceDetail,
  WorkflowInstanceLog,
  WorkflowTaskItem,
  WorkflowTaskSummary,
} from '../../types';

// ==================== Workflow Management ====================

export const workflowsApi = {
  list: (params?: { category?: string; status?: string }) =>
    api.get<WorkflowDefinition[]>(`/workflows${buildQuery({ category: params?.category, status: params?.status })}`),
  get: (id: string) => api.get<WorkflowDefinitionDetail>(`/workflows/${id}`),
  create: (data: { key: string; name: string; category?: string; description?: string }) => api.post<WorkflowDefinition>('/workflows', data),
  update: (id: string, data: Partial<{ name: string; category: string; description: string; entityType: string }>) => api.patch<WorkflowDefinition>(`/workflows/${id}`, data),
  delete: (id: string) => api.delete(`/workflows/${id}`),
  saveDesign: (id: string, data: { nodes: Record<string, unknown>[]; edges: Record<string, unknown>[] }) =>
    api.put<WorkflowDefinitionDetail>(`/workflows/${id}/design`, data),
  publish: (id: string) => api.post<WorkflowDefinition>(`/workflows/${id}/publish`),
  archive: (id: string) => api.post<WorkflowDefinition>(`/workflows/${id}/archive`),
  clone: (id: string) => api.post<WorkflowDefinition>(`/workflows/${id}/clone`),
  templates: () => api.get<WorkflowDefinition[]>('/workflows/templates'),
  /** List available entity types (table name + display name) for workflow association */
  entityTypes: () => api.get<{ key: string; displayName: string; module: string }[]>('/workflows/entity-types'),
  /** List available columns/fields for an entity type (for view config in designer) */
  entityFields: (entityType: string) =>
    api.get<{ entityType: string; fields: { key: string; type: string; nullable: boolean }[] }>(
      `/workflow-integration/entity-fields${buildQuery({ entity_type: entityType })}`
    ),
};

export const workflowInstancesApi = {
  list: (params?: { status?: string; definitionId?: string }) =>
    api.get<WorkflowInstance[]>(`/workflow-instances${buildQuery({
      status: params?.status,
      definition_id: params?.definitionId,
    })}`),
  get: (id: string) => api.get<WorkflowInstanceDetail>(`/workflow-instances/${id}`),
  start: (data: { definitionId: string; title: string; entityType?: string; entityId?: string; variables?: Record<string, unknown> }) => api.post<WorkflowInstance>('/workflow-instances', data),
  suspend: (id: string) => api.post<WorkflowInstance>(`/workflow-instances/${id}/suspend`),
  resume: (id: string) => api.post<WorkflowInstance>(`/workflow-instances/${id}/resume`),
  terminate: (id: string) => api.post<WorkflowInstance>(`/workflow-instances/${id}/terminate`),
  logs: (id: string) => api.get<WorkflowInstanceLog[]>(`/workflow-instances/${id}/logs`),
};

export const workflowTasksApi = {
  list: (params?: { status?: string; assigneeId?: string }) =>
    api.get<WorkflowTaskItem[]>(`/workflow-tasks${buildQuery({
      status: params?.status,
      assignee_id: params?.assigneeId,
    })}`),
  my: () => api.get<WorkflowTaskItem[]>('/workflow-tasks/my'),
  get: (id: string) => api.get<WorkflowTaskItem>(`/workflow-tasks/${id}`),
  claim: (id: string) => api.post<WorkflowTaskItem>(`/workflow-tasks/${id}/claim`),
  complete: (id: string, data: {
    result: string;
    comment?: string;
    formData?: Record<string, unknown>;
    buttonKey?: string;
    targetNodeKey?: string;
  }) =>
    api.post<WorkflowTaskItem>(`/workflow-tasks/${id}/complete`, data),
  reject: (id: string, data: { result: string; comment?: string; buttonKey?: string }) =>
    api.post<WorkflowTaskItem>(`/workflow-tasks/${id}/reject`, data),
  delegate: (id: string, data: { targetUserId: string; comment?: string }) =>
    api.post<WorkflowTaskItem>(`/workflow-tasks/${id}/delegate`, data),
  summary: () => api.get<WorkflowTaskSummary>('/workflow-tasks/summary'),
};

// ==================== Workflow Integration ====================

export interface WorkflowIntegrationStatus {
  hasWorkflow: boolean;
  instanceId?: string;
  instanceNumber?: string;
  status?: string;
  currentNodeIds?: string[];
  pendingTasks?: { id: string; name: string; status: string; assigneeId?: string }[];
  startedAt?: string;
  completedAt?: string;
  variables?: Record<string, unknown>;
}

export interface WorkflowStartResult {
  instanceId: string;
  instanceNumber: string;
  status: string;
  message: string;
}

export const workflowIntegrationApi = {
  /** Start a workflow for a business entity */
  start: (params: { entityType: string; entityId: string; title: string; category?: string }) =>
    api.post<WorkflowStartResult>(`/workflow-integration/start${buildQuery({
      entity_type: params.entityType,
      entity_id: params.entityId,
      title: params.title,
      category: params.category,
    })}`),
  /** Get workflow status for a business entity */
  status: (entityType: string, entityId: string) =>
    api.get<WorkflowIntegrationStatus>(`/workflow-integration/status${buildQuery({
      entity_type: entityType,
      entity_id: entityId,
    })}`),
  /** Latest workflow instance (includes terminated/completed) */
  latestInstance: (entityType: string, entityId: string) =>
    api.get<WorkflowIntegrationStatus>(`/workflow-integration/latest-instance${buildQuery({
      entity_type: entityType,
      entity_id: entityId,
    })}`),
  /** Check if a workflow is configured for this entity type */
  check: (entityType: string, category?: string) =>
    api.get<{ configured: boolean; entityType: string }>(`/workflow-integration/check${buildQuery({
      entity_type: entityType,
      category: category,
    })}`),
  /** Batch check workflow configuration for multiple entity types */
  batchCheck: (entityTypes: string[], category?: string) =>
    api.post<{ results: Record<string, { configured: boolean }> }>(
      '/workflow-integration/batch-check',
      { entity_types: entityTypes, category },
    ),
  /** Batch get workflow status for multiple entities */
  batchStatus: (items: { entityType: string; entityId: string }[]) =>
    api.post<{ results: Array<WorkflowIntegrationStatus & { entityType: string; entityId: string }> }>(
      '/workflow-integration/batch-status',
      { items: items.map(i => ({ entity_type: i.entityType, entity_id: i.entityId })) },
    ),
  /** Get entity details for display in approval interface */
  entityDetail: (entityType: string, entityId: string) =>
    api.get<EntityDetail>(`/workflow-integration/entity-detail${buildQuery({
      entity_type: entityType,
      entity_id: entityId,
    })}`),
};

/** Generic entity detail returned by the workflow integration API */
export interface EntityDetail {
  entityType: string;
  entityId: string;
  displayName: string;
  module: string;
  detail: Record<string, unknown>;
  viewConfig?: { fields: { key: string; label: string }[] } | null;
  /** Frontend path to open full business object (from backend registry) */
  detailRoute?: string | null;
}

/** One workflow e-sign step (from approval_signatures.steps). */
export interface WorkflowApprovalStep {
  taskId?: string | null;
  nodeId?: string | null;
  nodeKey: string;
  nodeName: string;
  nodeType?: string | null;
  role?: string | null;
  userId?: string | null;
  name?: string | null;
  at?: string | null;
  signatureUrl?: string | null;
  comment?: string | null;
  result?: string | null;
  multiInstance?: boolean;
}

export interface WorkflowApprovalSigner {
  name?: string | null;
  at?: string | null;
  userId?: string | null;
  signatureUrl?: string | null;
}

/** GET …/approval-trail: steps is source of truth; three slots are compatibility. */
export interface WorkflowApprovalTrail {
  steps?: WorkflowApprovalStep[];
  prepared?: WorkflowApprovalSigner | null;
  reviewed?: WorkflowApprovalSigner | null;
  approved?: WorkflowApprovalSigner | null;
  workflowInstanceId?: string | null;
}

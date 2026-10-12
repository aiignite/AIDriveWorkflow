/**
 * 工作流节点处理人 handlers 规范化 / 校验 / 徽标文案
 */
import type {
  WorkflowAssigneeConfig,
  WorkflowAssigneeHandler,
  WorkflowAssigneeHandlerType,
} from '../../types';

export const HANDLER_TYPE_LABELS: Record<WorkflowAssigneeHandlerType, string> = {
  user: '人员',
  role: '系统角色',
  project_role: '项目角色',
  department: '部门',
  initiator: '发起人',
  manager: '上级主管',
  expression: '表达式',
};

/** 需要 value 的类型 */
const VALUE_REQUIRED: ReadonlySet<WorkflowAssigneeHandlerType> = new Set([
  'user',
  'role',
  'project_role',
  'department',
]);

/** 同节点只允许一条的类型 */
export const SINGLETON_HANDLER_TYPES: ReadonlySet<WorkflowAssigneeHandlerType> = new Set([
  'initiator',
  'manager',
]);

export function normalizeHandlers(
  config: WorkflowAssigneeConfig | undefined | null,
): WorkflowAssigneeHandler[] {
  if (!config) return [];
  const raw = config.handlers;
  // 显式有 handlers 数组（含空）时以之为准，不再回退旧字段
  if (Array.isArray(raw)) {
    return raw
      .filter((h): h is WorkflowAssigneeHandler => !!h && typeof h === 'object' && !!h.type)
      .map(h => ({
        type: h.type,
        value: h.value || undefined,
        label: h.label || undefined,
      }));
  }
  const t = config.assigneeType;
  if (!t) return [];
  return [
    {
      type: t,
      value: config.assigneeValue || undefined,
    },
  ];
}

export function isHandlerValid(handler: WorkflowAssigneeHandler): boolean {
  if (!handler?.type) return false;
  if (VALUE_REQUIRED.has(handler.type)) {
    return Boolean(handler.value && String(handler.value).trim());
  }
  return true;
}

/** 保存前校验：至少一条有效 handler */
export function validateAssigneeHandlers(
  config: WorkflowAssigneeConfig | undefined | null,
): string | null {
  const handlers = normalizeHandlers(config);
  if (handlers.length === 0) {
    return '未配置处理人';
  }
  for (let i = 0; i < handlers.length; i++) {
    if (!isHandlerValid(handlers[i])) {
      const label = HANDLER_TYPE_LABELS[handlers[i].type] || handlers[i].type;
      return `第 ${i + 1} 条处理人「${label}」缺少选择值`;
    }
  }
  return null;
}

export type AssigneeLookupMaps = {
  users: { id: string; name: string; realName?: string }[];
  sysRoles: { id: string; name: string }[];
  projectRoles?: { id: string; name: string }[];
  departments: { id: string; name: string }[];
};

function resolveHandlerDisplayName(
  handler: WorkflowAssigneeHandler,
  maps: AssigneeLookupMaps,
): string {
  const { type, value, label } = handler;
  if (label) return label;
  if (type === 'initiator') return '发起人';
  if (type === 'manager') return '上级主管';
  if (type === 'user' && value) {
    const u = maps.users.find(x => x.id === value);
    return u ? u.realName || u.name : value;
  }
  if (type === 'role' && value) {
    const r = maps.sysRoles.find(x => x.id === value || x.name === value);
    return r ? `系统:${r.name}` : `系统:${value}`;
  }
  if (type === 'project_role' && value) {
    const r = maps.projectRoles?.find(x => x.id === value || x.name === value);
    return r ? `项目:${r.name}` : `项目:${value}`;
  }
  if (type === 'department' && value) {
    const d = maps.departments.find(x => x.id === value);
    return d ? `部门:${d.name}` : '部门负责人';
  }
  return HANDLER_TYPE_LABELS[type] || type;
}

/** 画布徽标：单条全名；多条显示前两项 +N */
export function formatHandlersBadge(
  config: WorkflowAssigneeConfig | undefined,
  maps: AssigneeLookupMaps,
): string | null {
  const handlers = normalizeHandlers(config).filter(isHandlerValid);
  if (handlers.length === 0) return null;
  const names = handlers.map(h => resolveHandlerDisplayName(h, maps));
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} + ${names[1]}`;
  return `${names[0]} + ${names[1]} +${names.length - 2}`;
}

/**
 * 从 handlers 列表构建可持久化的 assigneeConfig。
 * 同时写 handlers 与首条 assigneeType/assigneeValue（旧读路径兼容）。
 */
export function buildAssigneeConfigFromHandlers(
  handlers: WorkflowAssigneeHandler[],
  completionCondition: 'all' | 'any' = 'all',
): WorkflowAssigneeConfig {
  const cleaned = handlers.map(h => ({
    type: h.type,
    ...(h.value ? { value: h.value } : {}),
    ...(h.label ? { label: h.label } : {}),
  }));
  const first = cleaned[0];
  const multiInstance = cleaned.length > 1 || completionCondition !== 'all'
    ? true
    : cleaned.some(h => h.type === 'role' || h.type === 'project_role');

  return {
    assigneeType: first?.type || 'user',
    assigneeValue: first?.value,
    handlers: cleaned,
    multiInstance: multiInstance || cleaned.length > 1,
    completionCondition,
  };
}

/** 旧配置默认完成条件：单条 project_role → any，其余 → all */
export function defaultCompletionCondition(
  config: WorkflowAssigneeConfig | undefined | null,
): 'all' | 'any' {
  if (config?.completionCondition === 'any' || config?.completionCondition === 'all') {
    return config.completionCondition;
  }
  const handlers = normalizeHandlers(config);
  if (
    handlers.length === 1 &&
    handlers[0].type === 'project_role' &&
    !config?.handlers
  ) {
    return 'any';
  }
  return 'all';
}

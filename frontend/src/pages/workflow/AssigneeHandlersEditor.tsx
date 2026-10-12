/**
 * 工作流节点处理人列表编辑器：多条 handlers + 会签/或签
 */
import { Plus, Trash2, UserPlus } from 'lucide-react';
import React, { useMemo, useState } from 'react';
import SearchableSelect from '../../components/SearchableSelect';
import { OrgUserPickerModal, type PickerUser } from '../../components/org';
import type {
  WorkflowAssigneeConfig,
  WorkflowAssigneeHandler,
  WorkflowAssigneeHandlerType,
} from '../../types';
import {
  HANDLER_TYPE_LABELS,
  SINGLETON_HANDLER_TYPES,
  buildAssigneeConfigFromHandlers,
  defaultCompletionCondition,
  normalizeHandlers,
} from './assigneeHandlers';

export interface AssigneeHandlersEditorProps {
  value: WorkflowAssigneeConfig | undefined;
  onChange: (config: WorkflowAssigneeConfig) => void;
  users: PickerUser[];
  roles: { id: string; name: string }[];
  projectRoles?: { id: string; name: string }[];
  departments: { id: string; name: string }[];
  isDark: boolean;
}

type AddKind = 'user' | 'role' | 'project_role' | 'department' | 'initiator' | 'manager';

const ADD_BUTTONS: { kind: AddKind; label: string; className: string }[] = [
  { kind: 'user', label: '人员', className: 'bg-blue-600 hover:bg-blue-700 text-white' },
  { kind: 'role', label: '角色', className: 'bg-sky-500 hover:bg-sky-600 text-white' },
  { kind: 'project_role', label: '项目角色', className: 'bg-emerald-600 hover:bg-emerald-700 text-white' },
  { kind: 'department', label: '部门', className: 'bg-teal-600 hover:bg-teal-700 text-white' },
  { kind: 'initiator', label: '发起人', className: 'bg-amber-500 hover:bg-amber-600 text-white' },
  { kind: 'manager', label: '上级主管', className: 'bg-orange-500 hover:bg-orange-600 text-white' },
];

const AssigneeHandlersEditor: React.FC<AssigneeHandlersEditorProps> = ({
  value,
  onChange,
  users,
  roles,
  projectRoles = [],
  departments,
  isDark,
}) => {
  const handlers = useMemo(() => normalizeHandlers(value), [value]);
  const completion = defaultCompletionCondition(value);
  const [pickerOpen, setPickerOpen] = useState(false);

  const tableBorder = isDark ? 'border-gray-700' : 'border-gray-200';
  const thBg = isDark ? 'bg-gray-800 text-gray-400' : 'bg-gray-50 text-gray-500';

  const commit = (
    nextHandlers: WorkflowAssigneeHandler[],
    nextCondition: 'all' | 'any' = completion,
  ) => {
    onChange(buildAssigneeConfigFromHandlers(nextHandlers, nextCondition));
  };

  const hasSingleton = (type: WorkflowAssigneeHandlerType) =>
    handlers.some(h => h.type === type);

  const handleAddClick = (kind: AddKind) => {
    if (SINGLETON_HANDLER_TYPES.has(kind) && hasSingleton(kind)) {
      return;
    }
    if (kind === 'user') {
      setPickerOpen(true);
      return;
    }
    if (kind === 'initiator' || kind === 'manager') {
      commit([...handlers, { type: kind, label: HANDLER_TYPE_LABELS[kind] }]);
      return;
    }
    // role / project_role / department：先加空行，再在行内选
    commit([...handlers, { type: kind }]);
  };

  const updateHandler = (index: number, patch: Partial<WorkflowAssigneeHandler>) => {
    const next = handlers.map((h, i) => (i === index ? { ...h, ...patch } : h));
    commit(next);
  };

  const removeHandler = (index: number) => {
    commit(handlers.filter((_, i) => i !== index));
  };

  const existingUserIds = handlers.filter(h => h.type === 'user' && h.value).map(h => h.value!) ;

  const roleOptions = roles.map(r => ({ value: r.id, label: r.name }));
  const projectRoleOptions = projectRoles.map(r => ({ value: r.id, label: r.name }));
  const deptOptions = departments.map(d => ({ value: d.id, label: d.name }));

  const resolveName = (h: WorkflowAssigneeHandler): string => {
    if (h.label) return h.label;
    if (h.type === 'initiator') return '发起人';
    if (h.type === 'manager') return '上级主管';
    if (h.type === 'user' && h.value) {
      const u = users.find(x => x.id === h.value);
      return u ? (u.realName || u.name) : h.value;
    }
    if (h.type === 'role' && h.value) {
      const r = roles.find(x => x.id === h.value || x.name === h.value);
      return r?.name || h.value;
    }
    if (h.type === 'project_role' && h.value) {
      const r = projectRoles.find(x => x.id === h.value || x.name === h.value);
      return r?.name || h.value;
    }
    if (h.type === 'department' && h.value) {
      const d = departments.find(x => x.id === h.value);
      return d?.name || h.value;
    }
    return '—';
  };

  const typeBadge = (type: WorkflowAssigneeHandlerType) => (
    <span
      className={`inline-flex shrink-0 items-center rounded px-1.5 py-0.5 text-[10px] font-medium ${
        isDark ? 'bg-gray-700 text-gray-300' : 'bg-gray-100 text-gray-600'
      }`}
    >
      {HANDLER_TYPE_LABELS[type] || type}
    </span>
  );

  const renderValueControl = (h: WorkflowAssigneeHandler, index: number) => {
    if (h.type === 'user' || h.type === 'initiator' || h.type === 'manager') {
      return (
        <span className={`text-sm truncate ${isDark ? 'text-gray-200' : 'text-gray-800'}`}>
          {resolveName(h)}
        </span>
      );
    }
    if (h.type === 'role') {
      return (
        <SearchableSelect
          value={roles.some(r => r.id === h.value) ? (h.value || '') : (roles.find(r => r.name === h.value)?.id || h.value || '')}
          onChange={v => {
            const r = roles.find(x => x.id === v);
            updateHandler(index, { value: v, label: r?.name });
          }}
          options={roleOptions}
          placeholder="选择系统角色"
          isDark={isDark}
          allowClear={false}
          compact
        />
      );
    }
    if (h.type === 'project_role') {
      return (
        <SearchableSelect
          value={projectRoles.some(r => r.id === h.value) ? (h.value || '') : (projectRoles.find(r => r.name === h.value)?.id || h.value || '')}
          onChange={v => {
            const r = projectRoles.find(x => x.id === v);
            updateHandler(index, { value: v, label: r?.name });
          }}
          options={projectRoleOptions}
          placeholder="选择项目角色"
          isDark={isDark}
          allowClear={false}
          compact
        />
      );
    }
    if (h.type === 'department') {
      return (
        <SearchableSelect
          value={h.value || ''}
          onChange={v => {
            const d = departments.find(x => x.id === v);
            updateHandler(index, { value: v, label: d?.name });
          }}
          options={deptOptions}
          placeholder="选择部门"
          isDark={isDark}
          allowClear={false}
          compact
        />
      );
    }
    return (
      <span className={`text-sm ${isDark ? 'text-gray-200' : 'text-gray-800'}`}>{resolveName(h)}</span>
    );
  };

  return (
    <div className="space-y-3">
      <div>
        <label className={`block text-xs font-medium mb-1.5 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
          通过条件
        </label>
        <div className="flex gap-3">
          <label className={`flex items-center gap-1.5 text-xs cursor-pointer ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
            <input
              type="radio"
              name="completionCondition"
              checked={completion === 'all'}
              onChange={() => commit(handlers, 'all')}
              className="accent-blue-600"
            />
            会签（全部通过）
          </label>
          <label className={`flex items-center gap-1.5 text-xs cursor-pointer ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
            <input
              type="radio"
              name="completionCondition"
              checked={completion === 'any'}
              onChange={() => commit(handlers, 'any')}
              className="accent-blue-600"
            />
            或签（任一人通过）
          </label>
        </div>
      </div>

      {/* 全宽行列表：避免窄表格单元格把 SearchableSelect 挤扁 / overflow 裁切下拉 */}
      <div className={`rounded border ${tableBorder}`}>
        <div className={`flex items-center gap-2 px-2 py-1.5 text-[10px] font-medium border-b ${thBg} ${tableBorder}`}>
          <span className="w-5 shrink-0">#</span>
          <span className="w-14 shrink-0">类型</span>
          <span className="flex-1 min-w-0">名称</span>
          <span className="w-6 shrink-0" />
        </div>
        {handlers.length === 0 && (
          <div className={`px-2 py-3 text-center text-xs ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
            请点击下方按钮添加处理人
          </div>
        )}
        <ul className="divide-y divide-gray-200 dark:divide-gray-700">
          {handlers.map((h, index) => (
            <li
              key={`${h.type}-${h.value || index}-${index}`}
              className="relative z-0 px-2 py-2 focus-within:z-20 hover:z-20"
            >
              <div className="flex items-start gap-2">
                <span className={`w-5 shrink-0 pt-2 text-xs tabular-nums ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                  {index + 1}
                </span>
                <div className="w-14 shrink-0 pt-1.5">{typeBadge(h.type)}</div>
                <div className="flex-1 min-w-0">{renderValueControl(h, index)}</div>
                <button
                  type="button"
                  onClick={() => removeHandler(index)}
                  className={`mt-1.5 p-0.5 rounded shrink-0 ${isDark ? 'text-gray-400 hover:text-red-400' : 'text-gray-400 hover:text-red-500'}`}
                  title="删除"
                >
                  <Trash2 size={12} />
                </button>
              </div>
            </li>
          ))}
        </ul>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {ADD_BUTTONS.map(btn => {
          const disabled =
            SINGLETON_HANDLER_TYPES.has(btn.kind) && hasSingleton(btn.kind);
          return (
            <button
              key={btn.kind}
              type="button"
              disabled={disabled}
              onClick={() => handleAddClick(btn.kind)}
              className={`inline-flex items-center gap-0.5 px-2 py-1 rounded text-[11px] font-medium disabled:opacity-40 disabled:cursor-not-allowed ${btn.className}`}
            >
              {btn.kind === 'user' ? <UserPlus size={11} /> : <Plus size={11} />}
              {btn.label}
            </button>
          );
        })}
      </div>

      {completion === 'any' && handlers.length > 1 && (
        <p className={`text-[10px] ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
          或签：任一人完成后，其余待办将自动取消。
        </p>
      )}
      {completion === 'all' && handlers.length > 1 && (
        <p className={`text-[10px] ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
          会签：所有处理人均需完成审批后节点才推进。
        </p>
      )}

      <OrgUserPickerModal
        isOpen={pickerOpen}
        onClose={() => setPickerOpen(false)}
        users={users}
        excludeUserIds={existingUserIds}
        title="选择处理人"
        onConfirm={ids => {
          const additions: WorkflowAssigneeHandler[] = ids.map(id => {
            const u = users.find(x => x.id === id);
            return {
              type: 'user' as const,
              value: id,
              label: u ? (u.realName || u.name) : id,
            };
          });
          commit([...handlers, ...additions]);
          setPickerOpen(false);
        }}
      />
    </div>
  );
};

export default AssigneeHandlersEditor;

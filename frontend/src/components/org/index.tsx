/**
 * 轻量组织选择器 — AIDriveWorkflow 版 OrgUserPickerModal。
 * 与 PLM 同名组件保持相同的 props 契约（users 由调用方传入，无需部门树接口）。
 */
import React, { useMemo, useState } from 'react';
import { Check, Search, Users, X } from 'lucide-react';

export interface PickerUser {
  id: string;
  name: string;
  realName?: string | null;
  email?: string | null;
  department?: string | null;
  position?: string | null;
}

interface OrgUserPickerModalProps {
  isOpen: boolean;
  onClose: () => void;
  users: PickerUser[];
  excludeUserIds?: string[];
  title?: string;
  onConfirm: (selectedIds: string[]) => void;
}

const OrgUserPickerModal: React.FC<OrgUserPickerModalProps> = ({
  isOpen,
  onClose,
  users,
  excludeUserIds = [],
  title = '选择用户',
  onConfirm,
}) => {
  const [keyword, setKeyword] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const available = useMemo(
    () => users.filter(u => !excludeUserIds.includes(u.id)),
    [users, excludeUserIds],
  );

  const filtered = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    if (!kw) return available;
    return available.filter(u =>
      [u.name, u.realName, u.email, u.department, u.position]
        .some(v => v && String(v).toLowerCase().includes(kw)),
    );
  }, [available, keyword]);

  if (!isOpen) return null;

  const toggle = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div
        className="w-full max-w-md max-h-[70vh] flex flex-col rounded-xl shadow-2xl overflow-hidden bg-white dark:bg-gray-800"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 dark:border-gray-700">
          <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-100 flex items-center gap-2">
            <Users size={16} /> {title}
          </h3>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X size={18} />
          </button>
        </div>

        <div className="px-4 py-2 border-b border-gray-100 dark:border-gray-700">
          <div className="flex items-center gap-2 rounded-lg bg-gray-50 dark:bg-gray-700/60 px-3 py-2">
            <Search size={14} className="text-gray-400" />
            <input
              autoFocus
              value={keyword}
              onChange={e => setKeyword(e.target.value)}
              placeholder="搜索姓名/邮箱/部门…"
              className="w-full bg-transparent text-sm text-gray-700 dark:text-gray-200 outline-none"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {filtered.length === 0 && (
            <p className="text-xs text-gray-400 text-center py-8">没有可选用户</p>
          )}
          {filtered.map(u => {
            const active = selected.has(u.id);
            return (
              <button
                key={u.id}
                type="button"
                onClick={() => toggle(u.id)}
                className={`w-full flex items-center justify-between px-4 py-2.5 text-left transition-colors ${
                  active ? 'bg-blue-50 dark:bg-blue-900/30' : 'hover:bg-gray-50 dark:hover:bg-gray-700/50'
                }`}
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-800 dark:text-gray-100 truncate">
                    {u.realName || u.name}
                    {u.realName && u.name !== u.realName && (
                      <span className="ml-1 text-xs text-gray-400">{u.name}</span>
                    )}
                  </p>
                  {(u.department || u.position || u.email) && (
                    <p className="text-[11px] text-gray-400 truncate">
                      {[u.department, u.position, u.email].filter(Boolean).join(' · ')}
                    </p>
                  )}
                </div>
                {active && <Check size={16} className="text-blue-500 shrink-0" />}
              </button>
            );
          })}
        </div>

        <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100 dark:border-gray-700">
          <span className="text-xs text-gray-400">已选 {selected.size} 人</span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 text-sm rounded-lg text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
            >
              取消
            </button>
            <button
              type="button"
              disabled={selected.size === 0}
              onClick={() => onConfirm(Array.from(selected))}
              className="px-4 py-1.5 text-sm rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40"
            >
              确定
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export { OrgUserPickerModal };
export type { OrgUserPickerModalProps };

import {
  ArrowRight, Check, MoreHorizontal, RefreshCw, RotateCcw, Send, Trash2, XCircle,
} from 'lucide-react';
import React, { useEffect, useState } from 'react';
import toast from 'react-hot-toast';

export interface WorkflowActionItem {
  action: string;
  label: string;
  targetStatus: string;
}

export interface WorkflowActionApi {
  getAvailableActions: (id: string) => Promise<{ actions: WorkflowActionItem[] }>;
  performWorkflowAction: (id: string, data: { action: string; comment?: string }) => Promise<unknown>;
}

const ACTION_ICON_MAP: Record<string, React.ReactNode> = {
  submit: <Send size={13} />,
  approve: <Check size={13} />,
  reject: <XCircle size={13} />,
  release: <ArrowRight size={13} />,
  revoke: <RotateCcw size={13} />,
  obsolete: <Trash2 size={13} />,
  reactivate: <RefreshCw size={13} />,
};

const ACTION_STYLE_MAP: Record<string, string> = {
  submit: 'text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20',
  approve: 'text-green-600 hover:bg-green-50 dark:hover:bg-green-900/20',
  reject: 'text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20',
  release: 'text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-900/20',
  revoke: 'text-orange-600 hover:bg-orange-50 dark:hover:bg-orange-900/20',
  obsolete: 'text-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700',
  reactivate: 'text-purple-600 hover:bg-purple-50 dark:hover:bg-purple-900/20',
};

export interface WorkflowActionMenuProps {
  itemId: string;
  currentStatus: string;
  api: WorkflowActionApi;
  onActionDone: () => void;
  confirmActions?: string[];
}

const WorkflowActionMenu: React.FC<WorkflowActionMenuProps> = ({
  itemId,
  currentStatus,
  api,
  onActionDone,
  confirmActions = ['reject', 'obsolete'],
}) => {
  const [actions, setActions] = useState<WorkflowActionItem[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [confirmAction, setConfirmAction] = useState<string | null>(null);
  const [comment, setComment] = useState('');

  useEffect(() => {
    let cancelled = false;
    api.getAvailableActions(itemId).then(res => {
      if (!cancelled) setActions(res.actions || []);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [itemId, currentStatus, api]);

  const handleAction = async (action: string) => {
    if (confirmActions.includes(action) && confirmAction !== action) {
      setConfirmAction(action);
      return;
    }
    setLoading(true);
    try {
      await api.performWorkflowAction(itemId, { action, comment: comment || undefined });
      toast.success(`${actions.find(a => a.action === action)?.label || action}成功`);
      setOpen(false);
      setConfirmAction(null);
      setComment('');
      onActionDone();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : '操作失败');
    } finally {
      setLoading(false);
    }
  };

  if (actions.length === 0) return null;

  if (actions.length === 1 && !confirmAction) {
    const act = actions[0];
    return (
      <button
        type="button"
        onClick={() => handleAction(act.action)}
        disabled={loading}
        className={`inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-lg transition-colors ${ACTION_STYLE_MAP[act.action] || ''}`}
      >
        {ACTION_ICON_MAP[act.action]} {act.label}
      </button>
    );
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-lg text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-700"
      >
        <MoreHorizontal size={14} /> 流程
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => { setOpen(false); setConfirmAction(null); }} />
          <div className="absolute right-0 top-full mt-1 z-50 bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 py-1 min-w-[160px]">
            {confirmAction ? (
              <div className="p-3 space-y-2">
                <p className="text-xs font-medium text-gray-700 dark:text-gray-300">
                  确认{actions.find(a => a.action === confirmAction)?.label}？
                </p>
                <textarea
                  value={comment}
                  onChange={e => setComment(e.target.value)}
                  placeholder="备注（可选）"
                  rows={2}
                  className="w-full px-2 py-1 text-xs border rounded-lg resize-none dark:bg-gray-700 dark:border-gray-600"
                />
                <div className="flex gap-1.5">
                  <button
                    type="button"
                    onClick={() => handleAction(confirmAction)}
                    disabled={loading}
                    className="flex-1 px-2 py-1 text-xs bg-red-600 text-white rounded-lg"
                  >
                    {loading ? '...' : '确认'}
                  </button>
                  <button
                    type="button"
                    onClick={() => { setConfirmAction(null); setComment(''); }}
                    className="flex-1 px-2 py-1 text-xs bg-gray-100 dark:bg-gray-700 rounded-lg"
                  >
                    取消
                  </button>
                </div>
              </div>
            ) : (
              actions.map(act => (
                <button
                  key={act.action}
                  type="button"
                  onClick={() => handleAction(act.action)}
                  disabled={loading}
                  className={`w-full flex items-center gap-2 px-3 py-2 text-xs font-medium transition-colors ${ACTION_STYLE_MAP[act.action] || ''}`}
                >
                  {ACTION_ICON_MAP[act.action]}
                  <span>{act.label}</span>
                  <span className="ml-auto text-[10px] text-gray-400">→ {act.targetStatus}</span>
                </button>
              ))
            )}
          </div>
        </>
      )}
    </div>
  );
};

export default WorkflowActionMenu;

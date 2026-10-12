/**
 * WorkflowChangeConfirmCard — AI 写操作确认卡片。
 * AI 工具（start_workflow_instance / complete_workflow_task）返回
 * requires_confirmation 预览，用户确认后由前端调用普通 REST 端点落库。
 */
import React from 'react';
import { CheckCircle2, GitBranch, Loader2, XCircle } from 'lucide-react';
import type { WorkflowPendingChange } from '../../hooks/useAIChat';

interface Props {
  pending: WorkflowPendingChange;
  onConfirm: () => void;
  onDismiss: () => void;
  applying?: boolean;
  isDark: boolean;
}

const RESULT_LABELS: Record<string, string> = {
  approved: '通过',
  rejected: '驳回',
  void: '作废',
  returned: '退回',
};

const WorkflowChangeConfirmCard: React.FC<Props> = ({
  pending,
  onConfirm,
  onDismiss,
  applying,
  isDark,
}) => {
  const action = pending.confirmAction;
  const isStart = action.type === 'start_instance';
  const summary = (pending.summary ?? {}) as Record<string, unknown>;
  const disabled = applying || pending.applied;

  const rows: { label: string; value: string }[] = [];
  if (isStart) {
    rows.push({ label: '流程', value: String(summary.workflow ?? '-') });
    rows.push({ label: '标题', value: String(summary.title ?? action.title ?? '-') });
    if (summary.priority) rows.push({ label: '优先级', value: String(summary.priority) });
  } else {
    rows.push({ label: '任务', value: String(summary.task ?? '-') });
    if (summary.instance_title) rows.push({ label: '所属流程', value: String(summary.instance_title) });
    rows.push({ label: '审批结果', value: RESULT_LABELS[String(action.result)] ?? String(action.result ?? '-') });
    if (action.comment) rows.push({ label: '审批意见', value: String(action.comment) });
  }
  const variables = (isStart ? action.variables : action.form_data) as Record<string, unknown> | undefined;
  const hasVariables = variables && Object.keys(variables).length > 0;

  return (
    <div className={`mt-2 rounded-xl border p-3 ${isDark ? 'border-gray-600 bg-gray-800/60' : 'border-gray-200 bg-gray-50'}`}>
      <div className="flex items-center gap-2 text-sm font-medium">
        {isStart ? (
          <GitBranch size={15} className="text-blue-500" />
        ) : (
          <CheckCircle2 size={15} className="text-emerald-500" />
        )}
        <span className={isDark ? 'text-gray-100' : 'text-gray-800'}>
          {isStart ? '确认发起流程？' : '确认提交审批结果？'}
        </span>
      </div>

      <div className="mt-2 space-y-1">
        {rows.map(({ label, value }) => (
          <div key={label} className="flex items-start gap-2 text-xs">
            <span className={`w-14 shrink-0 ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>{label}</span>
            <span className={`flex-1 break-all ${isDark ? 'text-gray-200' : 'text-gray-700'}`}>{value}</span>
          </div>
        ))}
        {hasVariables && (
          <div className="flex items-start gap-2 text-xs">
            <span className={`w-14 shrink-0 ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
              {isStart ? '变量' : '表单'}
            </span>
            <span className={`flex-1 break-all font-mono ${isDark ? 'text-gray-300' : 'text-gray-600'}`}>
              {JSON.stringify(variables, null, 0)}
            </span>
          </div>
        )}
      </div>

      {pending.applied ? (
        <p className="mt-2.5 flex items-center gap-1.5 text-xs text-emerald-500">
          <CheckCircle2 size={13} /> 已提交
        </p>
      ) : pending.dismissed ? (
        <p className={`mt-2.5 text-xs ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>已取消</p>
      ) : (
        <div className="mt-2.5 flex items-center gap-2">
          <button
            type="button"
            onClick={onConfirm}
            disabled={disabled}
            className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {applying ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle2 size={13} />}
            {isStart ? '确认发起' : '确认提交'}
          </button>
          <button
            type="button"
            onClick={onDismiss}
            disabled={disabled}
            className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs ${
              isDark
                ? 'border-gray-600 text-gray-300 hover:bg-gray-700'
                : 'border-gray-300 text-gray-600 hover:bg-gray-100'
            } disabled:opacity-50`}
          >
            <XCircle size={13} /> 取消
          </button>
        </div>
      )}
    </div>
  );
};

export default WorkflowChangeConfirmCard;

/**
 * WorkflowApprovalSignatureFooter — 按工作流 steps[] 动态签章栏。
 * 未知节点（会签等）原样展示，不写死编制/审核/批准三栏。
 */
import React, { useEffect, useMemo, useState } from 'react';
import { PenLine } from 'lucide-react';
import type { WorkflowApprovalStep, WorkflowApprovalTrail } from '../../services/workflow/workflows';
import { toAbsoluteMediaUrl } from '../../utils/mediaUrl';

export type WorkflowSignatureAccent = 'rose' | 'amber';

interface WorkflowApprovalSignatureFooterProps {
  approvalTrail: WorkflowApprovalTrail | null;
  isDark?: boolean;
  isZh?: boolean;
  accent?: WorkflowSignatureAccent;
  footerId?: string;
}

function formatDate(d?: string | null): string {
  if (!d) return '—';
  try {
    return new Date(d).toLocaleDateString('zh-CN');
  } catch {
    return String(d).slice(0, 10);
  }
}

const SignatureImage: React.FC<{ url?: string | null; alt: string }> = ({ url, alt }) => {
  if (!url) {
    return (
      <span className="inline-flex h-10 min-w-[72px] items-center justify-center rounded border border-dashed border-gray-300 px-2 text-[10px] text-gray-400 dark:border-gray-600 dark:text-gray-500">
        —
      </span>
    );
  }
  return (
    <img
      src={toAbsoluteMediaUrl(url)}
      alt={alt}
      className="h-10 max-w-[120px] object-contain"
    />
  );
};

function fallbackSteps(trail: WorkflowApprovalTrail, isZh: boolean): WorkflowApprovalStep[] {
  const mk = (
    role: string,
    nodeKey: string,
    nodeName: string,
    signer?: WorkflowApprovalTrail['prepared'],
  ): WorkflowApprovalStep | null => {
    if (!signer?.name && !signer?.at && !signer?.signatureUrl) return null;
    return {
      nodeKey,
      nodeName,
      role,
      name: signer?.name,
      at: signer?.at,
      signatureUrl: signer?.signatureUrl,
      userId: signer?.userId,
    };
  };
  return [
    mk('prepared', 'prepared', isZh ? '编制' : 'Prepared', trail.prepared),
    mk('reviewed', 'reviewed', isZh ? '审核' : 'Reviewed', trail.reviewed),
    mk('approved', 'approved', isZh ? '批准' : 'Approved', trail.approved),
  ].filter((s): s is WorkflowApprovalStep => s != null);
}

const ACCENT: Record<
  WorkflowSignatureAccent,
  { bar: string; title: string; icon: string }
> = {
  rose: {
    bar: 'border-rose-100 bg-rose-50/70',
    title: 'text-rose-700',
    icon: 'text-rose-500',
  },
  amber: {
    bar: 'border-amber-100 bg-amber-50/70',
    title: 'text-amber-700',
    icon: 'text-amber-500',
  },
};

const WorkflowApprovalSignatureFooter: React.FC<WorkflowApprovalSignatureFooterProps> = ({
  approvalTrail,
  isDark = false,
  isZh = true,
  accent = 'rose',
  footerId = 'workflow-approval-signature-footer',
}) => {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    setVisible(true);
  }, [approvalTrail]);

  const steps = useMemo(() => {
    if (!approvalTrail) return [];
    if (approvalTrail.steps && approvalTrail.steps.length > 0) return approvalTrail.steps;
    return fallbackSteps(approvalTrail, isZh);
  }, [approvalTrail, isZh]);

  if (!approvalTrail || steps.length === 0) return null;

  const tone = ACCENT[accent];
  const colClass =
    steps.length === 1
      ? 'md:grid-cols-1'
      : steps.length === 2
        ? 'md:grid-cols-2'
        : steps.length === 3
          ? 'md:grid-cols-3'
          : 'md:grid-cols-4';

  return (
    <div
      id={footerId}
      className={`mt-4 rounded-2xl border overflow-hidden print:break-inside-avoid ${
        isDark ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'
      }`}
    >
      <div
        className={`px-4 py-2 border-b flex items-center gap-2 ${
          isDark ? 'border-gray-700 bg-gray-750/60' : tone.bar
        }`}
      >
        <PenLine size={13} className={tone.icon} />
        <span className={`text-xs font-bold ${isDark ? 'text-gray-200' : tone.title}`}>
          {isZh ? '审批签字栏' : 'Approval Signatures'}
        </span>
      </div>

      <div
        className={`grid grid-cols-1 ${colClass} divide-y md:divide-y-0 md:divide-x ${
          isDark ? 'divide-gray-700' : 'divide-gray-200'
        }`}
      >
        {steps.map((step, idx) => (
          <div key={step.taskId || `${step.nodeKey}-${idx}`} className="px-4 py-4">
            <div
              className={`text-[10px] font-semibold uppercase tracking-wider mb-2 ${
                isDark ? 'text-gray-500' : 'text-gray-400'
              }`}
            >
              {step.nodeName || step.nodeKey}
            </div>
            <div className="flex items-center gap-3 flex-wrap">
              <span className={`text-sm font-semibold ${isDark ? 'text-white' : 'text-gray-900'}`}>
                {step.name || '—'}
              </span>
              {visible && step.role !== 'prepared' && (
                <SignatureImage
                  url={step.signatureUrl}
                  alt={`${step.nodeName || step.nodeKey}签名`}
                />
              )}
            </div>
            <div className={`text-[11px] mt-1 ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
              {formatDate(step.at)}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default WorkflowApprovalSignatureFooter;

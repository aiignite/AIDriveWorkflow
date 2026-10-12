/** Pure helpers for approval-node button → edge routing. */

import type { WorkflowButton } from '../../types';

export type WorkflowButtonAction = WorkflowButton['action'];

export interface OutgoingEdgeOption {
  targetNodeKey: string;
  label: string;
}

/** Resolve button config from form_config.buttons by key (legacy complete→route). */
export function findButtonByKey(
  buttons: WorkflowButton[] | undefined,
  buttonKey: string | undefined,
): WorkflowButton | undefined {
  if (!buttons?.length || !buttonKey) return undefined;
  return buttons.find((b) => b.key === buttonKey);
}

/** Normalize legacy actions for engine semantics. */
export function normalizeButtonAction(action: WorkflowButtonAction | undefined): WorkflowButtonAction {
  if (action === 'complete' || action === 'save') return 'route';
  if (action === 'reject') return 'back_to_start';
  return action || 'route';
}

export function resolveButtonResult(btn: WorkflowButton | undefined, fallback: string): string {
  if (btn?.result) return btn.result;
  const action = normalizeButtonAction(btn?.action);
  if (action === 'terminate') return 'void';
  if (action === 'back_to_start') return 'returned';
  if (btn?.action === 'reject') return 'rejected';
  return fallback || 'approved';
}

export function edgeOptionLabel(
  edgeLabel: string | undefined,
  targetNodeName: string | undefined,
  targetNodeKey: string,
): string {
  if (edgeLabel?.trim()) return edgeLabel.trim();
  if (targetNodeName?.trim()) return `→ ${targetNodeName.trim()}`;
  return `→ ${targetNodeKey}`;
}

export const APPROVAL_BUTTON_PRESETS: WorkflowButton[] = [
  {
    key: 'approve',
    label: '发送批准',
    color: 'primary',
    action: 'route',
    result: 'approved',
    requireComment: false,
  },
  {
    key: 'return',
    label: '退回申请',
    color: 'warning',
    action: 'back_to_start',
    result: 'returned',
    requireComment: true,
  },
  {
    key: 'void',
    label: '作废流程',
    color: 'danger',
    action: 'terminate',
    result: 'void',
    requireComment: true,
    confirmMessage: '确定要作废当前流程吗？此操作不可撤销。',
  },
];

import { describe, expect, it } from 'vitest';
import {
  APPROVAL_BUTTON_PRESETS,
  edgeOptionLabel,
  findButtonByKey,
  normalizeButtonAction,
  resolveButtonResult,
} from './workflowButtonRoute';
import type { WorkflowButton } from '../../types';

describe('workflowButtonRoute', () => {
  const buttons: WorkflowButton[] = [
    { key: 'approve', label: '发送批准', color: 'primary', action: 'route', result: 'approved', targetNodeKey: 'n2' },
    { key: 'return', label: '退回', color: 'warning', action: 'back_to_start', result: 'returned', requireComment: true },
    { key: 'legacy', label: '完成', color: 'primary', action: 'complete' },
  ];

  it('findButtonByKey', () => {
    expect(findButtonByKey(buttons, 'approve')?.label).toBe('发送批准');
    expect(findButtonByKey(buttons, 'missing')).toBeUndefined();
    expect(findButtonByKey(undefined, 'approve')).toBeUndefined();
  });

  it('normalizeButtonAction maps legacy actions', () => {
    expect(normalizeButtonAction('complete')).toBe('route');
    expect(normalizeButtonAction('save')).toBe('route');
    expect(normalizeButtonAction('reject')).toBe('back_to_start');
    expect(normalizeButtonAction('terminate')).toBe('terminate');
    expect(normalizeButtonAction(undefined)).toBe('route');
  });

  it('resolveButtonResult prefers explicit result', () => {
    expect(resolveButtonResult(buttons[0], 'x')).toBe('approved');
    expect(resolveButtonResult({ key: 'v', label: '作废', color: 'danger', action: 'terminate' }, 'x')).toBe('void');
    expect(resolveButtonResult({ key: 'r', label: '拒', color: 'danger', action: 'reject' }, 'x')).toBe('returned');
    expect(resolveButtonResult(undefined, 'fallback')).toBe('fallback');
  });

  it('edgeOptionLabel', () => {
    expect(edgeOptionLabel('通过', '下一节点', 'n2')).toBe('通过');
    expect(edgeOptionLabel(undefined, '下一节点', 'n2')).toBe('→ 下一节点');
    expect(edgeOptionLabel('', '', 'n2')).toBe('→ n2');
  });

  it('APPROVAL_BUTTON_PRESETS has approve/return/void', () => {
    expect(APPROVAL_BUTTON_PRESETS.map((b) => b.key)).toEqual(['approve', 'return', 'void']);
    expect(APPROVAL_BUTTON_PRESETS[0].action).toBe('route');
    expect(APPROVAL_BUTTON_PRESETS[1].action).toBe('back_to_start');
    expect(APPROVAL_BUTTON_PRESETS[2].action).toBe('terminate');
  });
});

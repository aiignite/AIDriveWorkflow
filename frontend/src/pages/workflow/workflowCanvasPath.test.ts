import { describe, expect, it } from 'vitest';

import {
  computeEdgePath,
  inferEdgeColorFromLabel,
  strokeDashForLineStyle,
} from './workflowCanvasPath';

describe('workflowCanvasPath', () => {
  it('computes straight anchor path', () => {
    const result = computeEdgePath({
      sourceRect: { x: 0, y: 0, w: 160, h: 72 },
      targetRect: { x: 300, y: 0, w: 160, h: 72 },
      routingMode: 'straight',
    });
    expect(result.d).toContain('M');
    expect(result.d).toContain('L');
    expect(result.labelX).toBeGreaterThan(0);
  });

  it('computes orthogonal rounded path', () => {
    const result = computeEdgePath({
      sourceRect: { x: 0, y: 0, w: 160, h: 72 },
      targetRect: { x: 0, y: 200, w: 160, h: 72 },
      routingMode: 'orthogonal',
      cornerRadius: 8,
    });
    expect(result.d).toMatch(/M .* Q .* L/);
  });

  it('computes smooth bezier path', () => {
    const result = computeEdgePath({
      sourceRect: { x: 0, y: 0, w: 160, h: 72 },
      targetRect: { x: 260, y: 120, w: 160, h: 72 },
      routingMode: 'smooth',
    });
    expect(result.d).toContain('C');
  });

  it('infers semantic edge colors from labels', () => {
    expect(inferEdgeColorFromLabel('通过')).toBe('#22c55e');
    expect(inferEdgeColorFromLabel('驳回')).toBe('#ef4444');
    expect(inferEdgeColorFromLabel('条件分支')).toBe('#3b82f6');
  });

  it('maps line styles to dash arrays', () => {
    expect(strokeDashForLineStyle('dashed')).toBe('8 4');
    expect(strokeDashForLineStyle('dotted')).toBe('2 4');
    expect(strokeDashForLineStyle('solid')).toBeUndefined();
  });
});

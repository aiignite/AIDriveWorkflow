/** Shared SVG path utilities for workflow designer + instance preview. */

export type EdgeRoutingMode = 'straight' | 'orthogonal' | 'smooth';
export type EdgeLineStyle = 'solid' | 'dashed' | 'dotted';

export interface NodeRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type AnchorDir = 'left' | 'right' | 'top' | 'bottom';

export interface AnchorPoint {
  x: number;
  y: number;
  dir: AnchorDir;
}

export interface EdgePathInput {
  sourceRect: NodeRect;
  targetRect: NodeRect;
  routingMode?: EdgeRoutingMode;
  cornerRadius?: number;
}

export interface EdgePathResult {
  d: string;
  labelX: number;
  labelY: number;
}

export const WORKFLOW_EDGE_COLORS = {
  approve: '#22c55e',
  reject: '#ef4444',
  condition: '#3b82f6',
  default: '',
  neutral: '#9ca3af',
} as const;

export function inferEdgeColorFromLabel(label?: string): string | undefined {
  if (!label) return undefined;
  const t = label.trim();
  if (/通过|同意|批准|approve/i.test(t)) return WORKFLOW_EDGE_COLORS.approve;
  if (/驳回|拒绝|reject/i.test(t)) return WORKFLOW_EDGE_COLORS.reject;
  if (/条件|分支|是|否|yes|no/i.test(t)) return WORKFLOW_EDGE_COLORS.condition;
  return undefined;
}

export function getNodeAnchor(
  rect: NodeRect,
  targetCenter: { x: number; y: number },
): AnchorPoint {
  const cx = rect.x + rect.w / 2;
  const cy = rect.y + rect.h / 2;
  const dx = targetCenter.x - cx;
  const dy = targetCenter.y - cy;
  const absDx = Math.abs(dx);
  const absDy = Math.abs(dy);
  const hw = rect.w / 2;
  const hh = rect.h / 2;
  if (absDx === 0 && absDy === 0) return { x: cx + hw, y: cy, dir: 'right' };
  if (absDx * hh > absDy * hw) {
    return dx > 0
      ? { x: rect.x + rect.w, y: cy, dir: 'right' }
      : { x: rect.x, y: cy, dir: 'left' };
  }
  return dy > 0
    ? { x: cx, y: rect.y + rect.h, dir: 'bottom' }
    : { x: cx, y: rect.y, dir: 'top' };
}

function extendAnchor(anchor: AnchorPoint, offset: number): { x: number; y: number } {
  const p = { x: anchor.x, y: anchor.y };
  if (anchor.dir === 'right') p.x += offset;
  else if (anchor.dir === 'left') p.x -= offset;
  else if (anchor.dir === 'bottom') p.y += offset;
  else p.y -= offset;
  return p;
}

function buildOrthogonalPoints(
  srcAnchor: AnchorPoint,
  tgtAnchor: AnchorPoint,
  offset: number,
): { x: number; y: number }[] {
  const srcExt = extendAnchor(srcAnchor, offset);
  const tgtExt = extendAnchor(tgtAnchor, offset);
  const points: { x: number; y: number }[] = [
    { x: srcAnchor.x, y: srcAnchor.y },
    srcExt,
  ];
  const isHExit = srcAnchor.dir === 'right' || srcAnchor.dir === 'left';
  const isHEntry = tgtAnchor.dir === 'right' || tgtAnchor.dir === 'left';
  if (isHExit) {
    if (!isHEntry) {
      points.push({ x: tgtExt.x, y: srcExt.y });
    } else {
      const midX = (srcExt.x + tgtExt.x) / 2;
      points.push({ x: midX, y: srcExt.y }, { x: midX, y: tgtExt.y });
    }
  } else if (isHEntry) {
    points.push({ x: srcExt.x, y: tgtExt.y });
  } else {
    const midY = (srcExt.y + tgtExt.y) / 2;
    points.push({ x: srcExt.x, y: midY }, { x: tgtExt.x, y: midY });
  }
  points.push(tgtExt, { x: tgtAnchor.x, y: tgtAnchor.y });
  return points;
}

function pointsToRoundedPath(points: { x: number; y: number }[], radius: number): string {
  if (points.length < 2) return '';
  if (radius <= 0 || points.length < 3) {
    return points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
  }

  let d = `M ${points[0].x} ${points[0].y}`;
  for (let i = 1; i < points.length - 1; i += 1) {
    const prev = points[i - 1];
    const curr = points[i];
    const next = points[i + 1];
    const v1 = { x: curr.x - prev.x, y: curr.y - prev.y };
    const v2 = { x: next.x - curr.x, y: next.y - curr.y };
    const len1 = Math.hypot(v1.x, v1.y);
    const len2 = Math.hypot(v2.x, v2.y);
    const r = Math.min(radius, len1 / 2, len2 / 2);
    if (r <= 0 || len1 === 0 || len2 === 0) {
      d += ` L ${curr.x} ${curr.y}`;
      continue;
    }
    const p1 = {
      x: curr.x - (v1.x / len1) * r,
      y: curr.y - (v1.y / len1) * r,
    };
    const p2 = {
      x: curr.x + (v2.x / len2) * r,
      y: curr.y + (v2.y / len2) * r,
    };
    d += ` L ${p1.x} ${p1.y} Q ${curr.x} ${curr.y} ${p2.x} ${p2.y}`;
  }
  const last = points[points.length - 1];
  d += ` L ${last.x} ${last.y}`;
  return d;
}

function buildSmoothPath(
  srcAnchor: AnchorPoint,
  tgtAnchor: AnchorPoint,
  offset: number,
): string {
  const srcExt = extendAnchor(srcAnchor, offset);
  const tgtExt = extendAnchor(tgtAnchor, offset);
  return [
    `M ${srcAnchor.x} ${srcAnchor.y}`,
    `L ${srcExt.x} ${srcExt.y}`,
    `C ${srcExt.x} ${srcExt.y}, ${tgtExt.x} ${tgtExt.y}, ${tgtExt.x} ${tgtExt.y}`,
    `L ${tgtAnchor.x} ${tgtAnchor.y}`,
  ].join(' ');
}

export function computeEdgePath(input: EdgePathInput): EdgePathResult {
  const { sourceRect, targetRect, routingMode = 'orthogonal', cornerRadius = 8 } = input;
  const srcCenter = { x: sourceRect.x + sourceRect.w / 2, y: sourceRect.y + sourceRect.h / 2 };
  const tgtCenter = { x: targetRect.x + targetRect.w / 2, y: targetRect.y + targetRect.h / 2 };
  const srcAnchor = getNodeAnchor(sourceRect, tgtCenter);
  const tgtAnchor = getNodeAnchor(targetRect, srcCenter);
  const OFFSET = 24;

  if (routingMode === 'straight') {
    const labelX = (srcAnchor.x + tgtAnchor.x) / 2;
    const labelY = (srcAnchor.y + tgtAnchor.y) / 2;
    return {
      d: `M ${srcAnchor.x} ${srcAnchor.y} L ${tgtAnchor.x} ${tgtAnchor.y}`,
      labelX,
      labelY,
    };
  }

  if (routingMode === 'smooth') {
    const d = buildSmoothPath(srcAnchor, tgtAnchor, OFFSET);
    const labelX = (srcAnchor.x + tgtAnchor.x) / 2;
    const labelY = (srcAnchor.y + tgtAnchor.y) / 2;
    return { d, labelX, labelY };
  }

  const points = buildOrthogonalPoints(srcAnchor, tgtAnchor, OFFSET);
  const d = pointsToRoundedPath(points, cornerRadius);
  const mid = Math.floor(points.length / 2);
  const labelX = (points[mid - 1].x + points[mid].x) / 2;
  const labelY = (points[mid - 1].y + points[mid].y) / 2;
  return { d, labelX, labelY };
}

export function strokeDashForLineStyle(lineStyle?: EdgeLineStyle): string | undefined {
  if (lineStyle === 'dashed') return '8 4';
  if (lineStyle === 'dotted') return '2 4';
  return undefined;
}

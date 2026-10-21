import type { ListAnchor, VirtualWindow } from './types';

/**
 * Small framework-neutral virtual-list contract. The Vue layer may replace it with a renderer,
 * while history prepends and media resize use these deterministic calculations.
 */
export function getVirtualWindow(count: number, scrollTop: number, viewport: number, estimate = 72, overscan = 4): VirtualWindow {
  const start = Math.max(0, Math.floor(scrollTop / estimate) - overscan);
  const end = Math.min(count, Math.ceil((scrollTop + viewport) / estimate) + overscan);
  return { start, end, paddingTop: start * estimate, paddingBottom: Math.max(0, count - end) * estimate };
}

/** Keep the first visible historic message stationary after prepending older rows. */
export function restoreHistoryAnchor(anchor: ListAnchor, idsAfterPrepend: string[], rowHeights: Record<string, number>): number {
  const index = idsAfterPrepend.indexOf(anchor.id);
  if (index < 0) return 0;
  return idsAfterPrepend.slice(0, index).reduce((total, id) => total + (rowHeights[id] ?? 72), 0) + anchor.offset;
}

/** Async image/video dimension changes adjust scroll only when the changed row is above the anchor. */
export function mediaHeightScrollDelta(rowIndex: number, anchorIndex: number, before: number, after: number): number {
  return rowIndex < anchorIndex ? after - before : 0;
}

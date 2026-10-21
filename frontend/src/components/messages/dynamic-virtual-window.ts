export interface DynamicVirtualItem { id: string }

export interface DynamicViewportAnchor {
  id: string;
  offset: number;
}

export interface DynamicVirtualRange {
  start: number;
  end: number;
  visibleStart: number;
  visibleEnd: number;
  paddingTop: number;
  paddingBottom: number;
  totalHeight: number;
}

export interface DynamicViewportSnapshot {
  scrollTop: number;
  clientHeight: number;
  scrollHeight: number;
  firstVisibleId?: string;
  lastVisibleId?: string;
  atBottom: boolean;
}

function validHeight(height: number, fallback: number): number {
  return Number.isFinite(height) && height > 0 ? height : fallback;
}

export function hasPrependedItems(previousIds: readonly string[], nextIds: readonly string[]): boolean {
  if (!previousIds.length || nextIds.length <= previousIds.length) return false;
  const start = nextIds.indexOf(previousIds[0]);
  if (start <= 0 || start + previousIds.length > nextIds.length) return false;
  return previousIds.every((id, index) => nextIds[start + index] === id);
}

/**
 * ID-keyed dynamic-height index. Prefix offsets are rebuilt once per measurement
 * batch so ResizeObserver bursts stay O(items + changed rows), not O(items * rows).
 */
export class DynamicVirtualWindow<T extends DynamicVirtualItem> {
  private itemsValue: readonly T[] = [];
  private readonly measuredHeights = new Map<string, number>();
  private indexById = new Map<string, number>();
  private prefixOffsets: number[] = [0];
  private estimateValue: number;
  // “贴底闩锁”：发消息/收到消息且原本贴底/切换会话等场景下由 lockToBottom() 置位。
  // 置位期间调用方（ImVirtualMessageList）应无条件按 bottomScrollTop() 钉底，
  // 不再依赖“当前是否在阈值内”的判定——新追加的行在被 ResizeObserver 量到真实高度前，
  // totalHeight 用的是估算值，估算与真实值的落差一旦超过阈值就会被误判为“没到底”，
  // 这正是“发送消息后滚动条差一点没到底”的根因。闩锁只由 unlockBottom() 显式解除
  // （对应用户主动向上滚动/跳转到具体消息）。
  private bottomLockedValue = false;

  constructor(estimateHeight = 72) {
    this.estimateValue = validHeight(estimateHeight, 72);
  }

  get items(): readonly T[] { return this.itemsValue; }
  get length(): number { return this.itemsValue.length; }
  get totalHeight(): number { return this.prefixOffsets[this.prefixOffsets.length - 1] ?? 0; }
  get estimateHeight(): number { return this.estimateValue; }
  get isBottomLocked(): boolean { return this.bottomLockedValue; }

  setEstimateHeight(height: number): void {
    const next = validHeight(height, this.estimateValue);
    if (next === this.estimateValue) return;
    this.estimateValue = next;
    this.rebuildPrefixes();
  }

  setItems(items: readonly T[]): void {
    const nextIndex = new Map<string, number>();
    items.forEach((item, index) => {
      if (nextIndex.has(item.id)) throw new Error(`Duplicate virtual item id: ${item.id}`);
      nextIndex.set(item.id, index);
    });
    for (const id of this.measuredHeights.keys()) {
      if (!nextIndex.has(id)) this.measuredHeights.delete(id);
    }
    this.itemsValue = items;
    this.indexById = nextIndex;
    this.rebuildPrefixes();
  }

  indexOf(id: string): number { return this.indexById.get(id) ?? -1; }
  offsetOf(index: number): number {
    const safe = Math.max(0, Math.min(Math.trunc(index), this.length));
    return this.prefixOffsets[safe] ?? 0;
  }
  heightOf(index: number): number {
    const item = this.itemsValue[index];
    return item ? (this.measuredHeights.get(item.id) ?? this.estimateValue) : 0;
  }

  /** Returns the row containing offset. Exact row-end boundaries belong to the next row. */
  indexAtOffset(offset: number): number {
    if (!this.length) return -1;
    const target = Math.max(0, Math.min(Number.isFinite(offset) ? offset : 0, this.totalHeight));
    if (target >= this.totalHeight) return this.length - 1;
    let low = 0;
    let high = this.length;
    while (low < high) {
      const middle = low + Math.floor((high - low) / 2);
      if (this.prefixOffsets[middle + 1] <= target) low = middle + 1;
      else high = middle;
    }
    return low;
  }

  measure(id: string, height: number): boolean {
    return this.measureMany(new Map([[id, height]]));
  }

  measureMany(measurements: ReadonlyMap<string, number>): boolean {
    let changed = false;
    for (const [id, rawHeight] of measurements) {
      if (!this.indexById.has(id)) continue;
      const height = validHeight(rawHeight, this.estimateValue);
      const previous = this.measuredHeights.get(id);
      if (previous !== undefined && Math.abs(previous - height) < 0.5) continue;
      this.measuredHeights.set(id, height);
      changed = true;
    }
    if (changed) this.rebuildPrefixes();
    return changed;
  }

  captureAnchor(scrollTop: number): DynamicViewportAnchor | undefined {
    const index = this.indexAtOffset(scrollTop);
    const item = this.itemsValue[index];
    if (!item) return undefined;
    return { id: item.id, offset: Math.max(0, scrollTop - this.offsetOf(index)) };
  }

  restoreAnchor(anchor: DynamicViewportAnchor): number | undefined {
    const index = this.indexOf(anchor.id);
    if (index < 0) return undefined;
    return this.offsetOf(index) + Math.max(0, anchor.offset);
  }

  measureKeepingAnchor(measurements: ReadonlyMap<string, number>, scrollTop: number): { changed: boolean; scrollTop: number } {
    const anchor = this.captureAnchor(scrollTop);
    const changed = this.measureMany(measurements);
    if (!changed || !anchor) return { changed, scrollTop };
    return { changed, scrollTop: this.restoreAnchor(anchor) ?? scrollTop };
  }

  /** 贴底目标 scrollTop：钉在“当前已知”的总高度处（可能仍是估算，也可能已被测量修正）。 */
  bottomScrollTop(clientHeight: number): number {
    return Math.max(0, this.totalHeight - Math.max(0, clientHeight));
  }

  /** 显式贴底请求：置位闩锁并返回当前应采用的目标 scrollTop。 */
  lockToBottom(clientHeight: number): number {
    this.bottomLockedValue = true;
    return this.bottomScrollTop(clientHeight);
  }

  /** 用户主动上滚脱离底部（或主动跳转到具体消息）后调用，解除闩锁。 */
  unlockBottom(): void {
    this.bottomLockedValue = false;
  }

  getRange(scrollTop: number, clientHeight: number, overscanPixels = this.estimateValue * 5): DynamicVirtualRange {
    if (!this.length) return { start: 0, end: 0, visibleStart: 0, visibleEnd: 0, paddingTop: 0, paddingBottom: 0, totalHeight: 0 };
    const viewportTop = Math.max(0, Number.isFinite(scrollTop) ? scrollTop : 0);
    const viewportBottom = Math.min(this.totalHeight, viewportTop + Math.max(0, clientHeight));
    const overscan = Math.max(0, Number.isFinite(overscanPixels) ? overscanPixels : 0);
    const visibleStart = this.indexAtOffset(viewportTop);
    const visibleEnd = Math.min(this.length, this.indexAtOffset(Math.max(viewportTop, viewportBottom - Number.EPSILON)) + 1);
    const start = this.indexAtOffset(Math.max(0, viewportTop - overscan));
    const end = Math.min(this.length, this.indexAtOffset(Math.min(this.totalHeight, viewportBottom + overscan)) + 1);
    return {
      start,
      end,
      visibleStart,
      visibleEnd,
      paddingTop: this.offsetOf(start),
      paddingBottom: Math.max(0, this.totalHeight - this.offsetOf(end)),
      totalHeight: this.totalHeight
    };
  }

  private rebuildPrefixes(): void {
    const prefix = new Array<number>(this.length + 1);
    prefix[0] = 0;
    for (let index = 0; index < this.length; index += 1) {
      prefix[index + 1] = prefix[index] + this.heightOf(index);
    }
    this.prefixOffsets = prefix;
  }
}

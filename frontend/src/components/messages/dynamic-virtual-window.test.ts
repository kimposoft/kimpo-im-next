import { describe, expect, it } from 'vitest';
import { DynamicVirtualWindow, hasPrependedItems } from './dynamic-virtual-window';

const items = (count: number, start = 0) => Array.from({ length: count }, (_, index) => ({ id: `m-${start + index}` }));

describe('DynamicVirtualWindow', () => {
  it('keeps the rendered window bounded for 10k messages', () => {
    const model = new DynamicVirtualWindow(60);
    model.setItems(items(10_000));
    const range = model.getRange(300_000, 600, 300);
    expect(range.end - range.start).toBeLessThanOrEqual(22);
    expect(range.start).toBeGreaterThan(4_000);
    expect(range.end).toBeLessThan(10_000);
    expect(range.paddingTop + range.paddingBottom).toBeGreaterThan(590_000);
  });

  it('keeps a 10k-message viewport anchored when an image above it reports its real height', () => {
    const model = new DynamicVirtualWindow(72);
    model.setItems(items(10_000));
    const initialScrollTop = model.offsetOf(5_000) + 19;
    const before = model.captureAnchor(initialScrollTop);
    const result = model.measureKeepingAnchor(new Map([['m-4990', 432]]), initialScrollTop);
    const after = model.captureAnchor(result.scrollTop);

    expect(before).toEqual({ id: 'm-5000', offset: 19 });
    expect(result).toEqual({ changed: true, scrollTop: initialScrollTop + 360 });
    expect(after).toEqual(before);
    for (const scrollTop of [0, result.scrollTop, model.totalHeight - 600]) {
      expect(model.getRange(scrollTop, 600, 360).end - model.getRange(scrollTop, 600, 360).start).toBeLessThanOrEqual(22);
    }
  });

  it('finds exact binary-search boundaries across measured heights', () => {
    const model = new DynamicVirtualWindow(10);
    model.setItems(items(3));
    model.measureMany(new Map([['m-0', 10], ['m-1', 20], ['m-2', 30]]));
    expect(model.indexAtOffset(-1)).toBe(0);
    expect(model.indexAtOffset(0)).toBe(0);
    expect(model.indexAtOffset(9.99)).toBe(0);
    expect(model.indexAtOffset(10)).toBe(1);
    expect(model.indexAtOffset(29.99)).toBe(1);
    expect(model.indexAtOffset(30)).toBe(2);
    expect(model.indexAtOffset(60)).toBe(2);
  });

  it('compensates scrollTop only when dynamic measurements move the current anchor', () => {
    const model = new DynamicVirtualWindow(100);
    model.setItems(items(3));
    const above = model.measureKeepingAnchor(new Map([['m-0', 180]]), 150);
    expect(above).toEqual({ changed: true, scrollTop: 230 });
    const anchorRow = model.measureKeepingAnchor(new Map([['m-1', 200]]), above.scrollTop);
    expect(anchorRow).toEqual({ changed: true, scrollTop: 230 });
  });

  it('restores first-visible id and row offset after prepend', () => {
    const model = new DynamicVirtualWindow(100);
    model.setItems([{ id: 'b' }, { id: 'c' }]);
    model.measure('b', 120);
    const anchor = model.captureAnchor(40)!;
    expect(anchor).toEqual({ id: 'b', offset: 40 });
    expect(hasPrependedItems(['b', 'c'], ['a', 'b', 'c'])).toBe(true);
    model.setItems([{ id: 'a' }, { id: 'b' }, { id: 'c' }]);
    expect(model.restoreAnchor(anchor)).toBe(140);
    expect(model.heightOf(1)).toBe(120);
  });

  it('rejects duplicate ids and does not mistake append for prepend', () => {
    const model = new DynamicVirtualWindow();
    expect(() => model.setItems([{ id: 'same' }, { id: 'same' }])).toThrow('Duplicate virtual item id');
    expect(hasPrependedItems(['a'], ['a', 'b'])).toBe(false);
  });

  // 复现“发送消息后滚动条差一点没到底”的根因：发送后 scrollToBottom() 是按估算行高
  // （72px）算的目标位置，此时刚追加的新行还没被 ResizeObserver 量到真实高度。
  // 若真实高度比估算大得多（比如多行文本），落差会超出 atBottomThreshold（默认 24px），
  // 使得旧的“阈值内才纠偏”判定失效——这就是本用例要锁住的行为。
  it('bottom lock: keeps pinning to the true bottom even when the appended row is far taller than the estimate', () => {
    const model = new DynamicVirtualWindow(72);
    model.setItems(items(20));
    const clientHeight = 600;

    // 模拟 scrollToBottom()：置位闩锁，此刻新行尚未测量，只能按估算总高给出目标位置。
    const estimatedTarget = model.lockToBottom(clientHeight);
    expect(model.isBottomLocked).toBe(true);
    expect(estimatedTarget).toBe(20 * 72 - clientHeight); // 840

    // 稍后 ResizeObserver 量到最后一行的真实高度（多行文本，远比估算高）。
    model.measureKeepingAnchor(new Map([['m-19', 220]]), estimatedTarget);
    const realTotal = 19 * 72 + 220; // 1588
    const lockedTarget = model.bottomScrollTop(clientHeight);
    expect(lockedTarget).toBe(realTotal - clientHeight); // 988

    // 反证：估算与真实值的落差远超默认 24px 阈值——旧的“isAtBottom 阈值判定”
    // 会把这种情况误判为“没到底”而放弃纠偏，这正是缺陷的量级根因。
    const gap = lockedTarget - estimatedTarget;
    expect(gap).toBeGreaterThan(24);
    // 无论落差多大，闩锁生效期间都无条件采用测量后的真实底部，不受阈值影响。
    expect(model.isBottomLocked).toBe(true);
  });

  it('bottom lock: stays engaged across repeated measurement corrections until explicitly unlocked', () => {
    const model = new DynamicVirtualWindow(72);
    model.setItems(items(5));
    const clientHeight = 300;
    model.lockToBottom(clientHeight);

    // 最后一行的真实高度比估算矮很多（比如一条很短的消息），总高应相应收缩。
    model.measureMany(new Map([['m-4', 10]]));
    expect(model.totalHeight).toBe(4 * 72 + 10); // 298
    expect(model.bottomScrollTop(clientHeight)).toBe(0); // 298 - 300 < 0，钉在顶部即可
    expect(model.isBottomLocked).toBe(true);

    // 只有用户主动上滚（或跳转到具体消息）时组件层才会调用 unlockBottom()。
    model.unlockBottom();
    expect(model.isBottomLocked).toBe(false);
  });

  // 锁住“解锁之后不再钉底”这条语义：闩锁生效时调用 unlockBottom() 之后，
  // isBottomLocked 必须变为 false；此后即便又有一行发生测量变化（比如翻历史时
  // 图片加载完成报告真实高度），ImVirtualMessageList.flushMeasurements() 里
  // `(model.isBottomLocked || followBottom) ? model.bottomScrollTop(...) : result.scrollTop`
  // 这条判定应该走 anchor 保持分支（result.scrollTop），而不是被钉去 bottomScrollTop()——
  // 用户停留的位置远离底部，等价的 followBottom 也一定是 false。
  it('bottom lock: unlockBottom() makes later measurement corrections keep the anchor instead of pinning to bottom', () => {
    const model = new DynamicVirtualWindow(72);
    model.setItems(items(20));
    const clientHeight = 600;

    model.lockToBottom(clientHeight);
    expect(model.isBottomLocked).toBe(true);

    // 用户向上滚动翻历史，组件层探测到后调用 unlockBottom()。
    model.unlockBottom();
    expect(model.isBottomLocked).toBe(false);

    // 用户停在第 5 行附近（scrollTop=370），离底部（840）还有一大截，远超阈值。
    const historyScrollTop = model.offsetOf(5) + 10; // 370
    const result = model.measureKeepingAnchor(new Map([['m-3', 150]]), historyScrollTop);
    const bottomTarget = model.bottomScrollTop(clientHeight);

    expect(result.scrollTop).toBe(448); // anchor（m-5，offset 10）保持：row3 变高把它顺移到 438+10
    expect(bottomTarget).toBe(918); // 1518 - 600，若被误钉底会落到这里
    expect(result.scrollTop).not.toBe(bottomTarget);
    // 解锁状态在测量前后都保持 false，不会被 measureKeepingAnchor 之类的调用悄悄重置。
    expect(model.isBottomLocked).toBe(false);
  });
});

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const component = readFileSync(new URL('./ImVirtualMessageList.vue', import.meta.url), 'utf8');
const model = readFileSync(new URL('./dynamic-virtual-window.ts', import.meta.url), 'utf8');

describe('ImVirtualMessageList component contract', () => {
  it('renders only the sliced dynamic window with stable message ids', () => {
    expect(component).toContain('props.messages.slice(range.value.start, range.value.end)');
    expect(component).toContain(':key="message.id"');
    expect(component).toContain(':data-message-id="message.id"');
    expect(component).toContain('paddingTop: `${range.paddingTop}px`');
    expect(component).toContain('paddingBottom: `${range.paddingBottom}px`');
    expect(model).toContain('private prefixOffsets');
    expect(model).toContain('while (low < high)');
  });

  it('measures dynamic rows and preserves id plus offset anchors', () => {
    expect(component).toContain('new ResizeObserver');
    expect(component).toContain('model.measureKeepingAnchor');
    expect(component).toContain('(model.isBottomLocked || followBottom) ? domBottomScrollTop(element)');
    expect(component).toContain('hasPrependedItems(previousIds, nextIds)');
    expect(component).toContain('model.restoreAnchor(anchor)');
    expect(component).toContain("typeof ResizeObserver !== 'undefined'");
    expect(component).toContain('getBoundingClientRect().height');
  });

  // 修复“发送消息后滚动条差一点没到底”：scrollToBottom() 用 model.lockToBottom() 置位
  // “贴底闩锁”，flushMeasurements() 里闩锁生效时无条件钉底，不再单纯依赖测量前的
  // isAtBottom() 阈值判定（新行还没被 ResizeObserver 量到真实高度时，估算与真实值的
  // 落差一旦超过 atBottomThreshold 就会被误判成“没到底”而放弃纠偏）。闩锁只在探测到
  // 用户主动向上滚动、或主动跳转到具体消息时才解除，避免用户翻历史时被强行拽回底部。
  it('locks onto the true bottom on scrollToBottom and only releases on user-driven scroll-up', () => {
    expect(model).toContain('lockToBottom(clientHeight: number): number');
    expect(model).toContain('unlockBottom(): void');
    expect(model).toContain('bottomScrollTop(clientHeight: number): number');
    expect(component).toContain('model.lockToBottom(element.clientHeight);');
    expect(component).toContain('model.unlockBottom();');
    expect(component).toContain('suppressUnlockOnNextScroll = true;');
    expect(component).toContain('if (!programmatic && element && !isAtBottom(element)) model.unlockBottom();');
  });

  // 真机实测锁：发消息后即便闩锁生效、所有行都已测量到精确高度，滚动条依然恒定
  // 差一截——真机数据 scrollHeight(2400) - __items 实际高度(2388) = 12，与 gap 逐像素
  // 吻合。根因是滚动容器（本组件根元素）被宿主通过 class 施加了 padding-top:12px
  // （ImNextPanel.vue 的 .message-scroll），这段 padding 计入 element.scrollHeight，
  // 但 model.totalHeight 只统计行高之和，对宿主样式一无所知，用它算出的目标恒定少
  // 这段常量——这是常量偏移，不是估算竞态，闩锁机制解决不了它，必须换成 DOM 真实值。
  // 纯模型层单测抓不到这个偏移（DynamicVirtualWindow 根本不知道容器有 padding），
  // 只能靠这里的结构断言守住“组件里贴底目标真的走了 DOM 值，而不是 model 估算值”。
  it('pins to the DOM-true bottom (scrollHeight - clientHeight), not the model-estimated total height', () => {
    expect(component).toContain('function domBottomScrollTop(element: HTMLElement): number {');
    expect(component).toContain('return Math.max(0, element.scrollHeight - element.clientHeight);');
    expect(component).toContain('return element.scrollHeight - element.scrollTop - element.clientHeight <= props.atBottomThreshold;');
    expect(component).toContain('const target = domBottomScrollTop(element);');
    // flushMeasurements 的闩锁分支必须钉去 DOM 真值，不能退回 model.bottomScrollTop()。
    expect(component).not.toContain('? model.bottomScrollTop(element.clientHeight)');
    // scrollToBottom() 不应该再把 model.lockToBottom() 的返回值当成滚动目标使用。
    expect(component).not.toContain('const target = model.lockToBottom(element.clientHeight);');
  });

  // 回归锁：解锁判定必须在 scheduleScrollUpdate() 的同步段（scroll 事件回调本体）里，
  // 不能挪进它排的 requestAnimationFrame 回调——用户向上滚动会连带触发虚拟窗口渲染
  // 新行，新行挂载会让 ResizeObserver 立即测量并排一个 flushMeasurements 的 rAF；
  // 若解锁判定还留在滚动自己的 rAF 里没轮到，测量 rAF 可能先跑到、读到“闩锁仍生效”，
  // 把用户刚翻上去的历史强行钉回底部。这条用例锁住“解锁判定在 rAF 调度之前”这个
  // 结构顺序，防止以后又被挪回 rAF 里。
  it('keeps the unlock check synchronous, ahead of the scroll rAF scheduling guard', () => {
    const scheduleStart = component.indexOf('function scheduleScrollUpdate');
    const scheduleEnd = component.indexOf('function flushMeasurements');
    expect(scheduleStart).toBeGreaterThan(-1);
    expect(scheduleEnd).toBeGreaterThan(scheduleStart);
    const scheduleBody = component.slice(scheduleStart, scheduleEnd);

    const unlockIndex = scheduleBody.indexOf('if (!programmatic && element && !isAtBottom(element)) model.unlockBottom();');
    const guardIndex = scheduleBody.indexOf('if (scrollFrame) return;');
    const rafIndex = scheduleBody.indexOf('requestAnimationFrame(() => {');
    expect(unlockIndex).toBeGreaterThan(-1);
    expect(guardIndex).toBeGreaterThan(-1);
    expect(rafIndex).toBeGreaterThan(-1);
    // 解锁判定要出现在“若已有排队的 rAF 则直接返回”这一行之前，即处于同步段。
    expect(unlockIndex).toBeLessThan(guardIndex);
    // rAF 回调体（从 requestAnimationFrame(() => { 开始到函数结尾）不应再包含解锁调用。
    expect(scheduleBody.slice(rafIndex)).not.toContain('unlockBottom');
  });

  it('exposes viewport controls and emits lifecycle boundaries', () => {
    expect(component).toContain('defineExpose({ scrollToBottom, scrollToMessage, getViewport })');
    expect(component).toContain("'at-bottom': [atBottom: boolean]");
    expect(component).toContain("'top-reached': []");
    expect(component).toContain("'viewport-ready': [viewport: DynamicViewportSnapshot]");
  });

  it('separates screen-reader announcements from recycled list rows', () => {
    expect(component).toContain('role="list"');
    expect(component).toContain('aria-live="off"');
    expect(component).toContain(':aria-posinset');
    expect(component).toContain(':aria-setsize');
    expect(component).toContain(':aria-live="ariaLive"');
    expect(component).toContain('aria-atomic="true"');
  });

  it('cleans observers, listeners and scheduled frames', () => {
    expect(component).toContain("removeEventListener('scroll', scheduleScrollUpdate)");
    expect(component).toContain('resizeObserver?.disconnect()');
    expect(component).toContain('cancelAnimationFrame(measurementFrame)');
    expect(component).toContain('cancelAnimationFrame(scrollFrame)');
  });
});

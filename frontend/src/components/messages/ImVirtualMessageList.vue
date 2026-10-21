<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue';
import type { Message } from '../../domain/types';
import {
  DynamicVirtualWindow,
  hasPrependedItems,
  type DynamicViewportSnapshot,
  type DynamicVirtualRange
} from './dynamic-virtual-window';

const props = withDefaults(defineProps<{
  messages: readonly Message[];
  estimateHeight?: number;
  overscanPixels?: number;
  atBottomThreshold?: number;
  ariaLabel: string;
  ariaLive?: 'off' | 'polite' | 'assertive';
  liveText?: string;
}>(), {
  estimateHeight: 72,
  overscanPixels: 360,
  atBottomThreshold: 24,
  ariaLive: 'polite',
  liveText: ''
});

const emit = defineEmits<{
  'at-bottom': [atBottom: boolean];
  'top-reached': [];
  'viewport-ready': [viewport: DynamicViewportSnapshot];
}>();

const viewport = ref<HTMLElement>();
const model = new DynamicVirtualWindow<Message>(props.estimateHeight);
const range = shallowRef<DynamicVirtualRange>(model.getRange(0, 0, props.overscanPixels));
const rowElements = new Map<string, HTMLElement>();
const pendingMeasurements = new Map<string, number>();
let resizeObserver: ResizeObserver | undefined;
let measurementFrame = 0;
let scrollFrame = 0;
let topReachedLatched = false;
let readyEmitted = false;
let itemsRevision = 0;
let disposed = false;
// 标记“下一次原生 scroll 事件是我们自己写 scrollTop 触发的”，避免 scheduleScrollUpdate
// 把程序化滚动（scrollToBottom / scrollToMessage / flushMeasurements 的钉底纠偏）
// 误判成“用户主动上滚”，从而错误解除贴底闩锁（model.isBottomLocked）。
let suppressUnlockOnNextScroll = false;

const visibleMessages = computed(() => props.messages.slice(range.value.start, range.value.end));

function isAtBottom(element: HTMLElement): boolean {
  // 用 DOM 真实值（element.scrollHeight）判定，不用 model.totalHeight：本组件根元素
  // （滚动容器）可能被宿主通过 class 施加 padding（例如 ImNextPanel.vue 的
  // .message-scroll 有 padding-top:12px），这段 padding 会被浏览器计入
  // scrollHeight/clientHeight，但 model 对宿主样式一无所知，model.totalHeight
  // 只统计行高之和（=内容层高度），用它判定会系统性偏差整段容器 padding——真机实测
  // 就是这个偏差量（12px）导致“发送后差一点点没到底”，且与测量是否精确无关，
  // 就算所有行都已经量到精确的真实高度，这个常量落差依然存在。
  // 这里紧接着复用了下一行也要读的 element.clientHeight：同一段同步代码里若布局
  // 因为这次读取被刷新过，后面再读 scrollTop/scrollHeight 不会二次触发强制回流。
  return element.scrollHeight - element.scrollTop - element.clientHeight <= props.atBottomThreshold;
}

/**
 * 真实底部 scrollTop（DOM 权威值，不是 model 估算值）。
 * 必须用它而不是 model.bottomScrollTop()：滚动容器自身的 padding（见 isAtBottom 注释）
 * 计入 scrollHeight，但 model 完全不知道宿主样式，用 model.totalHeight 算出的目标
 * 恒定比真实底部少这段常量——这是常量偏移，不是估算/测量时序问题，闩锁机制解决不了它。
 * 已渲染的行在 DOM 里是真实高度（model 里可能还是估算值），加上容器自身的
 * padding，因此 scrollHeight 严格不劣于 model.totalHeight，可以放心作为唯一真值来源。
 */
function domBottomScrollTop(element: HTMLElement): number {
  return Math.max(0, element.scrollHeight - element.clientHeight);
}

function snapshot(): DynamicViewportSnapshot {
  const element = viewport.value;
  const current = range.value;
  return {
    scrollTop: element?.scrollTop ?? 0,
    clientHeight: element?.clientHeight ?? 0,
    scrollHeight: model.totalHeight,
    firstVisibleId: model.items[current.visibleStart]?.id,
    lastVisibleId: model.items[Math.max(current.visibleStart, current.visibleEnd - 1)]?.id,
    atBottom: element ? isAtBottom(element) : model.length === 0
  };
}

function updateRange(): void {
  const element = viewport.value;
  range.value = model.getRange(element?.scrollTop ?? 0, element?.clientHeight ?? 0, props.overscanPixels);
}

function emitViewportState(allowTopReached: boolean): void {
  const element = viewport.value;
  if (!element) return;
  emit('at-bottom', isAtBottom(element));
  const atTop = element.scrollTop <= 1;
  if (allowTopReached && atTop && !topReachedLatched) emit('top-reached');
  topReachedLatched = atTop;
}

function scheduleScrollUpdate(): void {
  // 解锁判定必须放在这里的同步段（scroll 事件回调本体），不能放进下面的 rAF 回调：
  // 按 HTML 规范，scroll 事件在“更新渲染”步骤中先于 requestAnimationFrame 回调派发。
  // 用户向上滚动会触发虚拟窗口渲染出新行，新行挂载时 ResizeObserver.observe() 会
  // 立即触发一次测量回调，进而排一个 flushMeasurements 的 rAF——如果那个测量 rAF
  // 恰好先于（或与）这次滚动的 scrollFrame rAF 一起被排队执行，而解锁判定还留在
  // rAF 里没轮到，flushMeasurements 会读到“闩锁仍然生效”，把用户刚翻上去的历史
  // 强行钉回底部。放在同步段可以保证：任何已排队的测量 rAF 跑到时，闩锁已经解除。
  const programmatic = suppressUnlockOnNextScroll;
  suppressUnlockOnNextScroll = false;
  const element = viewport.value;
  if (!programmatic && element && !isAtBottom(element)) model.unlockBottom();
  if (scrollFrame) return;
  scrollFrame = requestAnimationFrame(() => {
    scrollFrame = 0;
    updateRange();
    emitViewportState(true);
  });
}

function flushMeasurements(): void {
  measurementFrame = 0;
  const element = viewport.value;
  if (!pendingMeasurements.size || !element) {
    pendingMeasurements.clear();
    return;
  }
  // 测量前先按旧总高判一次“是否已在底部”，兜底任意行（不一定是刚追加的新行）
  // 高度漂移时的贴底体验，维持原有行为。
  const followBottom = isAtBottom(element);
  const result = model.measureKeepingAnchor(pendingMeasurements, element.scrollTop);
  pendingMeasurements.clear();
  if (!result.changed) return;
  // 贴底闩锁生效时无条件钉去 DOM 真实底部（domBottomScrollTop），不用 model.bottomScrollTop()：
  // 后者只统计行高之和，不含滚动容器自身可能被宿主施加的 padding（见 domBottomScrollTop
  // 注释），会恒定比真实底部少一截常量——这个偏移和“新行还没被测量”是两回事，闩锁只解决
  // 后者（估算竞态），常量偏移必须靠换用 DOM 真值来解决。
  const nextScrollTop = (model.isBottomLocked || followBottom) ? domBottomScrollTop(element) : result.scrollTop;
  if (Math.abs(nextScrollTop - element.scrollTop) >= 0.5) {
    suppressUnlockOnNextScroll = true;
    element.scrollTop = nextScrollTop;
  }
  updateRange();
  emitViewportState(false);
}

function queueMeasurement(id: string, height: number): void {
  if (disposed || !Number.isFinite(height) || height <= 0) return;
  pendingMeasurements.set(id, height);
  if (!measurementFrame) measurementFrame = requestAnimationFrame(flushMeasurements);
}

function setRowElement(id: string, element: Element | null): void {
  const previous = rowElements.get(id);
  if (previous && previous !== element) resizeObserver?.unobserve(previous);
  if (!(element instanceof HTMLElement)) {
    rowElements.delete(id);
    return;
  }
  rowElements.set(id, element);
  if (resizeObserver) resizeObserver.observe(element);
  else void nextTick(() => queueMeasurement(id, element.getBoundingClientRect().height));
}

function scrollToBottom(behavior: ScrollBehavior = 'auto'): void {
  const element = viewport.value;
  if (!element) return;
  // 显式贴底请求（发送/收到消息且原本贴底、切换会话、点击“跳到最新”等）：置位闩锁，
  // 供 flushMeasurements() 后续无条件纠偏使用。lockToBottom() 的返回值是按
  // model.totalHeight 估算的目标，这里不采用它——“真实底部”统一以 DOM 为准
  // （domBottomScrollTop），避免容器自身 padding（宿主可能施加，见该函数注释）
  // 造成的常量落差。
  model.lockToBottom(element.clientHeight);
  const target = domBottomScrollTop(element);
  // 只有目标位置与当前 scrollTop 确有差异（沿用 flushMeasurements 里同款 0.5px 判据）
  // 才置位“程序化滚动”标记：如果已经在目标位置，scrollTo 不会产生位移、也就不会有
  // scroll 事件来消费这个标记，标记残留会导致用户之后第一次真实滚动被误判为
  // 程序化，从而漏掉一次解锁判定。
  if (Math.abs(target - element.scrollTop) >= 0.5) suppressUnlockOnNextScroll = true;
  element.scrollTo({ top: target, behavior });
  if (behavior === 'auto') {
    updateRange();
    emitViewportState(false);
  }
}

function scrollToMessage(id: string, align: 'start' | 'center' | 'end' | 'nearest' = 'nearest', behavior: ScrollBehavior = 'auto'): boolean {
  const element = viewport.value;
  const index = model.indexOf(id);
  if (!element || index < 0) return false;
  // 主动跳转到某条具体消息属于离开“贴底”的用户意图，解除闩锁，
  // 避免此后任意行的测量刷新把视口强行拽回底部。
  model.unlockBottom();
  const top = model.offsetOf(index);
  const bottom = top + model.heightOf(index);
  let target = top;
  if (align === 'center') target = top - (element.clientHeight - model.heightOf(index)) / 2;
  else if (align === 'end') target = bottom - element.clientHeight;
  else if (align === 'nearest') {
    if (top >= element.scrollTop && bottom <= element.scrollTop + element.clientHeight) return true;
    target = top < element.scrollTop ? top : bottom - element.clientHeight;
  }
  // 上限同样以 DOM 真实底部为准（domBottomScrollTop）而不是 model.totalHeight：容器自身的
  // padding 计入 scrollHeight 但模型不感知，用模型值会把上限压低约一个 padding 的量，
  // 导致 align:'end' 定位到接近列表末尾的消息时同样差一截——与 scrollToBottom 同源的偏差。
  const clampedTarget = Math.max(0, Math.min(target, domBottomScrollTop(element)));
  // 同 scrollToBottom()：目标与当前 scrollTop 无实质差异时不置位标记，避免残留。
  if (Math.abs(clampedTarget - element.scrollTop) >= 0.5) suppressUnlockOnNextScroll = true;
  element.scrollTo({ top: clampedTarget, behavior });
  if (behavior === 'auto') updateRange();
  return true;
}

function getViewport(): DynamicViewportSnapshot {
  return snapshot();
}

watch(() => props.estimateHeight, value => {
  const element = viewport.value;
  const anchor = element ? model.captureAnchor(element.scrollTop) : undefined;
  model.setEstimateHeight(value);
  if (element && anchor) element.scrollTop = model.restoreAnchor(anchor) ?? element.scrollTop;
  updateRange();
});

watch(() => props.overscanPixels, updateRange);

watch(() => props.messages, async (next, previous = []) => {
  const revision = ++itemsRevision;
  const element = viewport.value;
  const previousIds = previous.map(message => message.id);
  const nextIds = next.map(message => message.id);
  const anchor = element ? model.captureAnchor(element.scrollTop) : undefined;
  const restorePrepend = Boolean(anchor && hasPrependedItems(previousIds, nextIds));
  model.setItems(next);
  updateRange();
  await nextTick();
  if (disposed || revision !== itemsRevision) return;
  if (restorePrepend && anchor && element) {
    element.scrollTop = model.restoreAnchor(anchor) ?? element.scrollTop;
    updateRange();
  }
  if (!readyEmitted && element) {
    readyEmitted = true;
    emit('viewport-ready', snapshot());
    emitViewportState(false);
  }
}, { immediate: true });

onMounted(async () => {
  const element = viewport.value;
  if (!element) return;
  element.addEventListener('scroll', scheduleScrollUpdate, { passive: true });
  if (typeof ResizeObserver !== 'undefined') {
    resizeObserver = new ResizeObserver(entries => {
      for (const entry of entries) {
        const id = (entry.target as HTMLElement).dataset.messageId;
        const borderBox = entry.borderBoxSize[0];
        if (id) queueMeasurement(id, borderBox?.blockSize ?? (entry.target as HTMLElement).getBoundingClientRect().height);
      }
    });
    rowElements.forEach(row => resizeObserver?.observe(row));
  }
  updateRange();
  await nextTick();
  if (!readyEmitted) {
    readyEmitted = true;
    emit('viewport-ready', snapshot());
    emitViewportState(false);
  }
});

onBeforeUnmount(() => {
  disposed = true;
  itemsRevision += 1;
  viewport.value?.removeEventListener('scroll', scheduleScrollUpdate);
  resizeObserver?.disconnect();
  resizeObserver = undefined;
  rowElements.clear();
  pendingMeasurements.clear();
  if (measurementFrame) cancelAnimationFrame(measurementFrame);
  if (scrollFrame) cancelAnimationFrame(scrollFrame);
  measurementFrame = 0;
  scrollFrame = 0;
});

defineExpose({ scrollToBottom, scrollToMessage, getViewport });
</script>

<template>
  <div ref="viewport" class="im-virtual-message-list" tabindex="0" :aria-label="ariaLabel">
    <div
      class="im-virtual-message-list__items"
      role="list"
      aria-live="off"
      :aria-label="ariaLabel"
      :style="{ paddingTop: `${range.paddingTop}px`, paddingBottom: `${range.paddingBottom}px` }"
    >
      <div
        v-for="(message, localIndex) in visibleMessages"
        :key="message.id"
        :ref="element => setRowElement(message.id, element as Element | null)"
        class="im-virtual-message-list__row"
        role="listitem"
        :data-message-id="message.id"
        :aria-posinset="range.start + localIndex + 1"
        :aria-setsize="messages.length"
      >
        <slot :message="message" :index="range.start + localIndex">
          {{ message.text || message.attachment?.fileName || '' }}
        </slot>
      </div>
    </div>
    <div class="im-virtual-message-list__live" :aria-live="ariaLive" aria-atomic="true">{{ liveText }}</div>
  </div>
</template>

<style scoped>
.im-virtual-message-list {
  position: relative;
  min-height: 0;
  overflow-x: hidden;
  overflow-y: auto;
  overflow-anchor: none;
  box-sizing: border-box;
  -webkit-overflow-scrolling: touch;
}
.im-virtual-message-list:focus-visible {
  outline: none;
  box-shadow: inset var(--im-uikit-focus-ring, 0 0 0 2px rgba(20, 122, 255, 0.28));
}
.im-virtual-message-list__items { min-height: 100%; box-sizing: border-box; }
.im-virtual-message-list__row { display: flow-root; overflow-anchor: none; }
.im-virtual-message-list__live {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  clip-path: inset(50%);
  margin: -1px;
  padding: 0;
  border: 0;
  white-space: nowrap;
}
</style>

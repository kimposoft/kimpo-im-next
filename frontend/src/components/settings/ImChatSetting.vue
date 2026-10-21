<script setup lang="ts">
import { nextTick, onMounted, ref, useId } from 'vue';

const props = withDefaults(defineProps<{
  title: string;
  closeLabel: string;
  contentLabel?: string;
  autofocusClose?: boolean;
}>(), {
  contentLabel: undefined,
  autofocusClose: true
});

const emit = defineEmits<{ close: [] }>();
const headingId = `im-chat-setting-${useId()}`;
const closeButton = ref<HTMLButtonElement>();

function requestClose(): void {
  emit('close');
}

function focusClose(): void {
  closeButton.value?.focus();
}

onMounted(() => {
  if (props.autofocusClose) void nextTick(focusClose);
});

defineExpose({ focusClose });
</script>

<template>
  <aside
    class="im-chat-setting"
    role="dialog"
    aria-modal="false"
    :aria-labelledby="headingId"
    @keydown.esc.stop.prevent="requestClose"
  >
    <header class="im-chat-setting__header">
      <h2 :id="headingId" class="im-chat-setting__title">
        <slot name="title">{{ title }}</slot>
      </h2>
      <div class="im-chat-setting__header-actions">
        <slot name="header-actions" />
        <button ref="closeButton" type="button" class="im-chat-setting__close" :aria-label="closeLabel" @click="requestClose">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M6.4 5.3 12 10.9l5.6-5.6 1.1 1.1-5.6 5.6 5.6 5.6-1.1 1.1-5.6-5.6-5.6 5.6-1.1-1.1 5.6-5.6-5.6-5.6z" />
          </svg>
        </button>
      </div>
    </header>
    <div
      class="im-chat-setting__scroll"
      role="region"
      :aria-label="contentLabel || title"
      tabindex="0"
    >
      <slot />
    </div>
  </aside>
</template>

<style scoped>
/* Figma 聊天设置浮层定版：353 宽、#f5f5f5 底、#ebeef5 描边、圆角8、统一投影 */
.im-chat-setting {
  display: flex;
  width: 353px;
  min-width: 353px;
  max-width: 353px;
  /* 高度过约束修复：宿主 ImNextPanel.vue 里 .chat-setting-overlay 给根元素
     追加了 position:absolute + top:69px + bottom:40px（Vue 单根组件 class
     透传，与本类同落在这一个 <aside> 上）。CSS 规则里绝对定位元素若
     top / height / bottom 三者都给出非 auto 值即为过约束，浏览器会按规范
     丢弃 bottom、以 top+height 反推——这里原先的 height:100% 正是那个被
     保留的第三值，导致面板高度按包含块（.im-body）100% 撑满、整体又被
     top:69px 下压，实际底边超出 .im-body 可视区并被其 overflow:hidden
     裁掉，且裁切发生在祖先层、内部滚动区滚到底也补不回来。
     这里改为 height:auto，把高度让位给 top+bottom 反解（浏览器在
     top/bottom 均非 auto 时会用它们和容器高度反推出正确的 auto 高度）；
     max-height:100% 是防御性上限，供未来若把本组件挪作普通 flex 子项
     （无绝对定位）时，仍能被 align-items:stretch 撑满而不会意外溢出。
     千万不要把 height 加回 100%，会重新触发上述过约束。 */
  height: auto;
  min-height: 0;
  max-height: 100%;
  box-sizing: border-box;
  flex-direction: column;
  border: 1px solid var(--im-uikit-border-lighter, #ebeef5);
  border-radius: var(--im-uikit-radius-md, 8px);
  box-shadow: var(--im-uikit-shadow-popup, -1px 2px 13px rgba(0, 0, 0, 0.1));
  color: var(--im-uikit-text-primary, #1f1f1f);
  background: var(--im-uikit-bg-surface, #f5f5f5);
  font-family: var(--im-uikit-font-family, Roboto, 'Source Han Sans SC', sans-serif);
}
.im-chat-setting__header {
  display: flex;
  flex: 0 0 47px;
  min-width: 0;
  align-items: center;
  justify-content: space-between;
  box-sizing: border-box;
  padding: 0 16px;
}
.im-chat-setting__title {
  overflow: hidden;
  margin: 0;
  color: var(--im-uikit-text-primary, #1f1f1f);
  font-size: 14px;
  font-weight: 500;
  line-height: 20px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.im-chat-setting__header-actions {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 4px;
  margin-inline-start: 12px;
}
.im-chat-setting__close {
  display: inline-flex;
  width: 24px;
  height: 24px;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  margin: 0;
  border: 0;
  border-radius: var(--im-uikit-radius-xs, 4px);
  padding: 5px;
  color: var(--im-uikit-text-secondary, #666);
  background: transparent;
  cursor: pointer;
}
.im-chat-setting__close:hover { background: var(--im-uikit-bg-dropdown-hover, #f0f7ff); }
.im-chat-setting__close:focus-visible,
.im-chat-setting__scroll:focus-visible {
  outline: none;
  box-shadow: var(--im-uikit-focus-ring, 0 0 0 2px rgba(20, 122, 255, 0.28));
}
.im-chat-setting__close svg { width: 100%; height: 100%; fill: currentColor; }
.im-chat-setting__scroll {
  flex: 1 1 auto;
  min-height: 0;
  overflow-x: hidden;
  overflow-y: auto;
  /* 需求A（2026-08-11）：滚动条占位修布局跳动。本浮层内容长短会变（普通群 vs 部门群的可见
     分组不同、成员数不同），在"内容不足一屏(无滚动条)"与"超出一屏(有滚动条)"之间切换时，
     若不预留滚动条槽宽，内容区可用宽度会随滚动条有无而突变；scrollbar-gutter:stable 让槽宽
     恒定预留，消除这个跳动。本容器左右都是 padding:0（内容自身控制左右间距），没有需要
     因预留槽而重新配平的外部 margin，故无需连带调整内边距。 */
  scrollbar-gutter: stable;
  box-sizing: border-box;
  padding: 4px 0 16px;
}
</style>

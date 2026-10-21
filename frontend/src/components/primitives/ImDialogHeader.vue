<script setup lang="ts">
import { computed, inject, ref } from 'vue';
import ImIcon from './ImIcon.vue';
import { IM_WINDOW_PLATFORM } from '../../domain/window-platform';

/**
 * 插件内弹窗统一弹窗头（2026-10-17 标题栏改版配套）。
 * 与窗口标题栏同一条规则：macOS 关闭按钮在左、标题紧跟其后；Windows / Linux 标题在左、关闭在右。
 * 平台由外壳 ImFloatingShell provide（IM_WINDOW_PLATFORM），没有外壳（单测/独立预览）时按 'other'。
 * 统一规格：高 48、标题 15 中粗、副标题 12 提示色、关闭 28 点击区 + 20 线形叉（Figma 关闭图标）。
 */
const props = defineProps<{
  title: string;
  closeLabel: string;
  /** 副标题（群名、文件类型、已选条数等），与标题同行、更淡更小 */
  subtitle?: string;
  /** 标题元素 id，供外层 role=dialog 的 aria-labelledby 引用 */
  titleId?: string;
}>();
const emit = defineEmits<{ close: [] }>();

const platform = inject(IM_WINDOW_PLATFORM, computed(() => 'other' as const));
const closeButton = ref<HTMLButtonElement>();

/** 供外层弹窗做初始聚焦 / 焦点环回的锚点 */
defineExpose({ closeButton, focusClose: () => closeButton.value?.focus() });
</script>

<template>
  <header class="im-dialog-header" :class="`im-dialog-header--${platform}`">
    <button ref="closeButton" type="button" class="im-dialog-header__close" :aria-label="props.closeLabel" :title="props.closeLabel" @click="emit('close')">
      <ImIcon name="windowClose" :size="20" />
    </button>
    <div class="im-dialog-header__heading">
      <h2 :id="props.titleId" class="im-dialog-header__title">{{ props.title }}</h2>
      <small v-if="props.subtitle" class="im-dialog-header__subtitle">{{ props.subtitle }}</small>
    </div>
  </header>
</template>

<style scoped>
.im-dialog-header { display:flex;min-height:48px;flex:0 0 auto;align-items:center;gap:8px;box-sizing:border-box;padding:0 12px 0 16px;border-bottom:1px solid var(--im-uikit-border-lighter,#ebeef5); }
.im-dialog-header--mac { padding:0 16px 0 12px; }
/* 其他平台：关闭按钮排到最右（DOM 里它在前，便于 macOS 下键盘 Tab 先到关闭，与视觉顺序一致） */
.im-dialog-header--other .im-dialog-header__close { order:2;margin-left:auto; }
.im-dialog-header__heading { display:flex;min-width:0;align-items:baseline;gap:8px; }
.im-dialog-header__title { margin:0;overflow:hidden;color:var(--im-uikit-text-primary,#1f1f1f);font-size:15px;font-weight:500;line-height:22px;text-overflow:ellipsis;white-space:nowrap; }
.im-dialog-header__subtitle { min-width:0;overflow:hidden;color:var(--im-uikit-text-tertiary,#999);font-size:12px;line-height:20px;text-overflow:ellipsis;white-space:nowrap; }
.im-dialog-header__close { display:flex;width:28px;height:28px;flex:0 0 28px;align-items:center;justify-content:center;border:0;border-radius:var(--im-uikit-radius-xs,4px);padding:0;color:var(--im-uikit-text-secondary,#666);background:transparent;cursor:pointer;transition:background-color var(--im-uikit-transition-interaction,.2s ease); }
.im-dialog-header__close:hover { background:var(--im-uikit-bg-list-hover,rgba(0,0,0,.06)); }
.im-dialog-header__close:focus-visible { outline:none;box-shadow:var(--im-uikit-focus-ring); }
</style>

<script setup lang="ts">
export type ImIconButtonSize = 'sm' | 'md';
export type ImIconButtonTone = 'link' | 'neutral' | 'danger';

withDefaults(defineProps<{
  label: string;
  title?: string;
  size?: ImIconButtonSize;
  tone?: ImIconButtonTone;
  disabled?: boolean;
  pressed?: boolean;
}>(), {
  title: undefined,
  size: 'md',
  tone: 'link',
  disabled: false,
  pressed: undefined
});
</script>

<template>
  <button
    type="button"
    :class="['im-icon-button', `im-icon-button--${size}`, `im-icon-button--${tone}`]"
    :aria-label="label"
    :aria-pressed="pressed"
    :title="title"
    :disabled="disabled"
  >
    <span class="im-icon-button__content" aria-hidden="true"><slot /></span>
  </button>
</template>

<style scoped>
.im-icon-button {
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  margin: 0;
  border: 0;
  border-radius: var(--im-uikit-radius-md, 8px);
  padding: 4px;
  background: transparent;
  cursor: pointer;
  transition: color var(--im-uikit-transition-color, 0.3s ease-out), background-color var(--im-uikit-transition-interaction, 0.2s ease);
}
.im-icon-button--sm { width: var(--im-uikit-icon-button-sm, 24px); height: var(--im-uikit-icon-button-sm, 24px); }
.im-icon-button--md { width: var(--im-uikit-icon-button-md, 32px); height: var(--im-uikit-icon-button-md, 32px); }
.im-icon-button--link { color: var(--im-uikit-text-link, #147aff); }
.im-icon-button--neutral { color: var(--im-uikit-text-primary, rgba(0, 0, 0, 0.9)); }
.im-icon-button--danger { color: var(--im-uikit-text-error, #ff584c); }
.im-icon-button:hover:not(:disabled) { background: var(--im-uikit-bg-dropdown-hover, #f0f7ff); }
.im-icon-button:active:not(:disabled),
.im-icon-button[aria-pressed="true"] { background: var(--im-uikit-bg-dropdown-active, #e6f2ff); }
.im-icon-button--danger:hover:not(:disabled) { background: var(--im-uikit-bg-danger-hover, #fff1f0); }
.im-icon-button:focus-visible { outline: none; box-shadow: var(--im-uikit-focus-ring, 0 0 0 2px rgba(20, 122, 255, 0.28)); }
.im-icon-button:disabled { cursor: not-allowed; opacity: 0.4; }
.im-icon-button__content { display: flex; width: 100%; height: 100%; align-items: center; justify-content: center; }
.im-icon-button__content :deep(svg) { width: 100%; height: 100%; fill: currentColor; }
</style>

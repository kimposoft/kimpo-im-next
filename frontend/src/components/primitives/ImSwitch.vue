<script setup lang="ts">
const props = withDefaults(defineProps<{
  modelValue: boolean;
  label: string;
  disabled?: boolean;
}>(), { disabled: false });

const emit = defineEmits<{
  'update:modelValue': [value: boolean];
  change: [value: boolean];
}>();

function toggle(): void {
  if (props.disabled) return;
  const value = !props.modelValue;
  emit('update:modelValue', value);
  emit('change', value);
}
</script>

<template>
  <button
    type="button"
    class="im-switch"
    role="switch"
    :aria-label="label"
    :aria-checked="modelValue"
    :disabled="disabled"
    @click="toggle"
  >
    <span class="im-switch__thumb" aria-hidden="true" />
  </button>
</template>

<style scoped>
.im-switch {
  position: relative;
  display: inline-flex;
  flex: 0 0 auto;
  width: var(--im-uikit-switch-width, 40px);
  height: var(--im-uikit-switch-height, 24px);
  box-sizing: border-box;
  align-items: center;
  margin: 0;
  border: 0;
  border-radius: var(--im-uikit-radius-pill, 999px);
  padding: 2px;
  background: var(--im-uikit-border-deep, #cdd0d6);
  cursor: pointer;
  transition: background-color var(--im-uikit-transition-interaction, 0.2s ease);
}
.im-switch[aria-checked="true"] { background: var(--im-uikit-text-link, #0877f4); }
.im-switch__thumb {
  width: var(--im-uikit-switch-thumb, 20px);
  height: var(--im-uikit-switch-thumb, 20px);
  border-radius: 50%;
  background: #fff;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.18);
  transform: translateX(0);
  transition: transform var(--im-uikit-transition-interaction, 0.2s ease);
}
/* 行程 = 宽38 - 左右衬2×2 - 拇指16 = 18px（Figma 开关 38×20） */
.im-switch[aria-checked="true"] .im-switch__thumb { transform: translateX(18px); }
.im-switch:focus-visible { outline: none; box-shadow: var(--im-uikit-focus-ring, 0 0 0 2px rgba(20, 122, 255, 0.28)); }
.im-switch:disabled { cursor: not-allowed; opacity: 0.4; }
</style>

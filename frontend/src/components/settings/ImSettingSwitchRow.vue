<script setup lang="ts">
import ImSwitch from '../primitives/ImSwitch.vue';

defineProps<{
  modelValue: boolean;
  label: string;
  disabled?: boolean;
}>();

const emit = defineEmits<{
  'update:modelValue': [value: boolean];
  change: [value: boolean];
}>();
</script>

<template>
  <div class="im-setting-switch-row">
    <span class="im-setting-switch-row__label">{{ label }}</span>
    <ImSwitch
      :model-value="modelValue"
      :label="label"
      :disabled="disabled"
      @update:model-value="emit('update:modelValue', $event)"
      @change="emit('change', $event)"
    />
  </div>
</template>

<style scoped>
/* Figma 白卡行：44px、14px 主文字 + 右侧开关 */
.im-setting-switch-row {
  display: flex;
  width: 100%;
  height: 44px;
  min-width: 0;
  align-items: center;
  justify-content: space-between;
  box-sizing: border-box;
  gap: 16px;
  margin: 0;
  padding: 12px 0;
}
.im-setting-switch-row__label {
  overflow: hidden;
  color: var(--im-uikit-text-primary, #1f1f1f);
  font-size: 14px;
  font-weight: 400;
  line-height: 20px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>

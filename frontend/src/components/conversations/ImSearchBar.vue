<script setup lang="ts">
import { ref } from 'vue';
import ImIcon from '../primitives/ImIcon.vue';

const props = withDefaults(defineProps<{
  modelValue: string;
  label: string;
  placeholder?: string;
  clearLabel?: string;
  disabled?: boolean;
}>(), {
  placeholder: '',
  clearLabel: undefined,
  disabled: false
});

const emit = defineEmits<{
  'update:modelValue': [value: string];
  clear: [];
}>();
const input = ref<HTMLInputElement>();

function onInput(event: Event): void { emit('update:modelValue', (event.target as HTMLInputElement).value); }
function clear(): void {
  if (props.disabled) return;
  emit('update:modelValue', '');
  emit('clear');
  input.value?.focus();
}

defineExpose({ focus: () => input.value?.focus() });
</script>

<template>
  <div class="im-search-bar" role="search">
    <div class="im-search-bar__input-wrapper">
      <span class="im-search-bar__icon" aria-hidden="true">
        <slot name="icon"><ImIcon name="search" :size="16" /></slot>
      </span>
      <input
        ref="input"
        class="im-search-bar__input"
        type="search"
        :value="modelValue"
        :aria-label="label"
        :placeholder="placeholder"
        :disabled="disabled"
        autocomplete="off"
        @input="onInput"
      />
      <button
        v-if="modelValue"
        type="button"
        class="im-search-bar__clear"
        :aria-label="clearLabel || label"
        :disabled="disabled"
        @click="clear"
      ><span aria-hidden="true">×</span></button>
    </div>
  </div>
</template>

<style scoped>
/* Figma 搜索框定版：230×36、#ebebeb 底、圆角8、图标+12px 提示文字 */
.im-search-bar { box-sizing: border-box; width: 100%; padding: 0; }
.im-search-bar__input-wrapper {
  position: relative;
  display: flex;
  align-items: center;
  /* 参考应用实测 26 高（此前 36）；外层搜索行仍是 61，输入框在其中垂直居中 */
  height: 26px;
  box-sizing: border-box;
  border-radius: var(--im-uikit-radius-md, 8px);
  padding: 0 10px;
  background: var(--im-uikit-bg-field, #ebebeb);
  transition: background-color var(--im-uikit-transition-color, 0.3s ease-out), box-shadow var(--im-uikit-transition-interaction, 0.2s ease);
}
.im-search-bar__input-wrapper:focus-within { box-shadow: var(--im-uikit-focus-ring, 0 0 0 2px rgba(8, 119, 244, 0.28)); }
.im-search-bar__icon { display: flex; flex: 0 0 auto; align-items: center; justify-content: center; width: 16px; height: 16px; margin-right: 6px; color: var(--im-uikit-text-tertiary, #999); }
.im-search-bar__input { flex: 1; min-width: 0; height: 100%; border: 0; outline: 0; padding: 0; color: var(--im-uikit-text-primary, #1f1f1f); background: transparent; font: 400 var(--im-uikit-font-size-sm, 12px)/var(--im-uikit-line-height-md, 20px) var(--im-uikit-font-family, Roboto, 'Source Han Sans SC', sans-serif); }
.im-search-bar__input::-webkit-search-cancel-button { display: none; }
.im-search-bar__input::placeholder { color: var(--im-uikit-text-tertiary, #999); }
.im-search-bar__clear { display: flex; flex: 0 0 auto; width: 20px; height: 20px; align-items: center; justify-content: center; margin-right: -4px; border: 0; border-radius: 50%; padding: 0; color: var(--im-uikit-text-secondary, rgba(0, 0, 0, 0.55)); background: transparent; cursor: pointer; }
.im-search-bar__clear:hover { background: var(--im-uikit-bg-dropdown-hover, #f0f7ff); }
.im-search-bar__clear:focus-visible { outline: none; box-shadow: var(--im-uikit-focus-ring, 0 0 0 2px rgba(20, 122, 255, 0.28)); }
</style>

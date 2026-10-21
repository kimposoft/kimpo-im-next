<script setup lang="ts">
import type { SendState } from '../../domain/types';

defineProps<{
  state?: SendState;
  label?: string;
  retryLabel?: string;
}>();

defineEmits<{ retry: [] }>();
</script>

<template>
  <button v-if="state === 'failed'" type="button" class="im-message-status im-message-status--failed" @click="$emit('retry')">
    {{ retryLabel || label }}
  </button>
  <span v-else-if="state" :class="['im-message-status', `im-message-status--${state}`]">{{ label }}</span>
</template>

<style scoped>
.im-message-status { flex:0 0 auto;border:0;padding:0;color:var(--im-uikit-text-tertiary);background:transparent;font-size:11px;line-height:16px; }
.im-message-status--failed { color:var(--im-uikit-text-error);cursor:pointer; }
.im-message-status--sent { color:var(--im-uikit-text-link-accessible,#075eb8); }
</style>

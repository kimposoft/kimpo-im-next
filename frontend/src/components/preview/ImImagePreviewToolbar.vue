<script setup lang="ts">
import ImIconButton from '../primitives/ImIconButton.vue';

defineProps<{
  index: number;
  total: number;
  zoom: number;
  toolbarLabel: string;
  previousLabel: string;
  nextLabel: string;
  zoomInLabel: string;
  zoomOutLabel: string;
  resetLabel: string;
}>();

defineEmits<{
  previous: [];
  next: [];
  zoomIn: [];
  zoomOut: [];
  reset: [];
}>();
</script>

<template>
  <div class="image-preview-toolbar" role="toolbar" :aria-label="toolbarLabel">
    <ImIconButton :label="previousLabel" tone="neutral" size="md" :disabled="index <= 0" @click="$emit('previous')">
      <svg viewBox="0 0 24 24"><path d="m15.4 5.6-1.4-1.4L6.2 12l7.8 7.8 1.4-1.4L9 12l6.4-6.4Z" /></svg>
    </ImIconButton>
    <span class="image-preview-toolbar__count" aria-live="polite">{{ index + 1 }} / {{ total }}</span>
    <ImIconButton :label="nextLabel" tone="neutral" size="md" :disabled="index < 0 || index >= total - 1" @click="$emit('next')">
      <svg viewBox="0 0 24 24"><path d="m8.6 18.4 1.4 1.4 7.8-7.8L10 4.2 8.6 5.6 15 12l-6.4 6.4Z" /></svg>
    </ImIconButton>
    <span class="image-preview-toolbar__divider" aria-hidden="true" />
    <ImIconButton :label="zoomOutLabel" tone="neutral" size="md" :disabled="zoom <= .25" @click="$emit('zoomOut')">
      <svg viewBox="0 0 24 24"><path d="M5 11h14v2H5z" /></svg>
    </ImIconButton>
    <button type="button" class="image-preview-toolbar__zoom" :aria-label="resetLabel" @click="$emit('reset')">{{ Math.round(zoom * 100) }}%</button>
    <ImIconButton :label="zoomInLabel" tone="neutral" size="md" :disabled="zoom >= 4" @click="$emit('zoomIn')">
      <svg viewBox="0 0 24 24"><path d="M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6z" /></svg>
    </ImIconButton>
  </div>
</template>

<style scoped>
.image-preview-toolbar { display:flex;min-height:44px;align-items:center;justify-content:center;gap:4px;border-bottom:1px solid var(--im-uikit-border-lighter,rgba(0,0,0,.08));padding:6px 12px;color:var(--im-uikit-text-primary);background:var(--im-uikit-bg-operate); }
.image-preview-toolbar__count { min-width:48px;text-align:center;color:var(--im-uikit-text-secondary);font-size:var(--im-uikit-font-size-sm);line-height:var(--im-uikit-line-height-sm); }
.image-preview-toolbar__divider { width:1px;height:20px;margin:0 6px;background:var(--im-uikit-border-lighter,rgba(0,0,0,.1)); }
.image-preview-toolbar__zoom { min-width:56px;height:32px;border:0;border-radius:var(--im-uikit-radius-md);padding:4px 6px;color:var(--im-uikit-text-primary);background:transparent;font:inherit;cursor:pointer; }
.image-preview-toolbar__zoom:hover { background:var(--im-uikit-bg-dropdown-hover); }
.image-preview-toolbar__zoom:focus-visible { outline:none;box-shadow:var(--im-uikit-focus-ring); }
</style>

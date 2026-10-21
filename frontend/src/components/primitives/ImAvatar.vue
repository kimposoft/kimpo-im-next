<script setup lang="ts">
import { computed } from 'vue';

export type ImAvatarSize = 'xs' | 'sm' | 'md';
export type ImPresenceState = 'online' | 'busy' | 'offline';

const props = withDefaults(defineProps<{
  src?: string;
  name?: string;
  alt?: string;
  size?: ImAvatarSize;
  presence?: ImPresenceState;
  decorative?: boolean;
}>(), {
  src: undefined,
  name: '',
  alt: undefined,
  size: 'sm',
  presence: undefined,
  decorative: false
});

const fallback = computed(() => Array.from(props.name.trim())[0]?.toLocaleUpperCase() ?? '');
const accessibleName = computed(() => props.decorative ? undefined : (props.alt || props.name || undefined));
</script>

<template>
  <span
    :class="['im-avatar', `im-avatar--${size}`]"
    :role="!decorative && !src ? 'img' : undefined"
    :aria-hidden="decorative ? 'true' : undefined"
    :aria-label="!decorative && !src ? accessibleName : undefined"
  >
    <img v-if="src" class="im-avatar__image" :src="src" :alt="decorative ? '' : (accessibleName ?? '')" />
    <span v-else class="im-avatar__fallback" aria-hidden="true">
      <slot>{{ fallback }}</slot>
    </span>
    <span v-if="presence" :class="['im-avatar__presence', `im-avatar__presence--${presence}`]" aria-hidden="true" />
  </span>
</template>

<style scoped>
.im-avatar {
  position: relative;
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  overflow: visible;
  width: var(--im-avatar-size);
  height: var(--im-avatar-size);
  border-radius: 50%;
  font-family: var(--im-uikit-font-family, Arial, "PingFang SC", sans-serif);
}
.im-avatar--xs { --im-avatar-size: var(--im-uikit-avatar-xs, 24px); font-size: 11px; }
.im-avatar--sm { --im-avatar-size: var(--im-uikit-avatar-sm, 32px); font-size: 12px; }
.im-avatar--md { --im-avatar-size: var(--im-uikit-avatar-md, 40px); font-size: 16px; }
.im-avatar__image,
.im-avatar__fallback {
  display: flex;
  width: 100%;
  height: 100%;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  border-radius: inherit;
}
.im-avatar__image { object-fit: cover; }
.im-avatar__fallback {
  /* 首字母兜底：品牌浅底 + 无障碍主色字，两者均随宿主主色在暗色下翻转 */
  color: var(--im-uikit-text-link-accessible, #2563eb);
  background: var(--im-uikit-bg-brand-soft, #dbeafe);
  font-weight: 600;
  line-height: 1;
  user-select: none;
}
.im-avatar__presence {
  position: absolute;
  right: -1px;
  bottom: -1px;
  width: 8px;
  height: 8px;
  box-sizing: border-box;
  border: 2px solid var(--im-uikit-bg-operate, #fff);
  border-radius: 50%;
}
/* 在线态三档接回语义 token（成功/错误/提示灰），暗色下随宿主翻转 */
.im-avatar__presence--online { background: var(--im-uikit-presence-online, #1fc16b); }
.im-avatar__presence--busy { background: var(--im-uikit-error, #ff584c); }
.im-avatar__presence--offline { background: var(--im-uikit-presence-offline, #b8bdc7); }
</style>

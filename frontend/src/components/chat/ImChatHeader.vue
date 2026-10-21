<script setup lang="ts">
import type { ImPresenceState } from '../primitives/ImAvatar.vue';

defineProps<{
  title: string;
  avatar?: string;
  subtitle?: string;
  presence?: ImPresenceState;
}>();
</script>

<template>
  <!-- Figma 聊天顶栏定版：61px、左=名字+在线状态点（无头像）、右=动作区、底描边；
       data-im-drag-handle：标题区非交互空白可拖动窗口（外壳统一处理） -->
  <header class="im-chat-header" data-im-drag-handle>
    <div class="im-chat-header__container">
      <div class="im-chat-header__left">
        <slot name="avatar" />
        <div class="im-chat-header__info">
          <h1 class="im-chat-header__title">{{ title }}</h1>
          <span
            v-if="presence"
            :class="['im-chat-header__presence', `im-chat-header__presence--${presence}`]"
            :title="subtitle"
            aria-hidden="true"
          />
          <span v-else-if="subtitle" class="im-chat-header__subtitle">{{ subtitle }}</span>
        </div>
      </div>
      <div v-if="$slots.actions" class="im-chat-header__actions" data-kimpo-extension="chat-header-actions">
        <slot name="actions" />
      </div>
    </div>
  </header>
</template>

<style scoped>
.im-chat-header {
  display: flex;
  flex: 0 0 var(--im-uikit-chat-header-height, 61px);
  width: 100%;
  height: var(--im-uikit-chat-header-height, 61px);
  align-items: center;
  box-sizing: border-box;
  border-bottom: 1px solid var(--im-uikit-border-lighter, #ebeef5);
  padding: 0 20px;
  color: var(--im-uikit-text-primary, #1f1f1f);
  background: transparent;
  font-family: var(--im-uikit-font-family, Roboto, 'Source Han Sans SC', sans-serif);
}
.im-chat-header__container {
  display: flex;
  width: 100%;
  min-width: 0;
  align-items: center;
  justify-content: space-between;
  box-sizing: border-box;
}
.im-chat-header__left {
  display: flex;
  min-width: 0;
  align-items: center;
}
.im-chat-header__info {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 16px;
}
.im-chat-header__title,
.im-chat-header__subtitle {
  overflow: hidden;
  margin: 0;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.im-chat-header__title {
  color: var(--im-uikit-text-primary, #1f1f1f);
  /* 参考应用实测标题字号约 14（此前 16，明显偏大） */
  font-size: 14px;
  font-weight: 500;
  line-height: 22px;
}
/* 在线状态点：8px；在线=功能绿 / 离线=提示灰 */
.im-chat-header__presence { flex: 0 0 auto; width: 8px; height: 8px; border-radius: 50%; }
.im-chat-header__presence--online { background: var(--im-uikit-presence-online, #67c23a); }
.im-chat-header__presence--busy { background: var(--im-uikit-error, #e84f4f); }
.im-chat-header__presence--offline { background: var(--im-uikit-presence-offline, #999); }
.im-chat-header__subtitle {
  color: var(--im-uikit-text-tertiary, #999);
  font-size: 12px;
  font-weight: 400;
  line-height: 22px;
}
.im-chat-header__actions {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 8px;
  margin-inline-start: 12px;
}
</style>

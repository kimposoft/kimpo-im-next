<script setup lang="ts">
import { ref } from 'vue';
import type { Message } from '../../domain/types';
import ImAvatar from '../primitives/ImAvatar.vue';
import ImFloatingMenu from '../primitives/ImFloatingMenu.vue';

export interface ImMessageAction {
  key: string;
  label: string;
  tone?: 'default' | 'danger';
  disabled?: boolean;
}

const props = withDefaults(defineProps<{
  message: Message;
  own: boolean;
  grouped: boolean;
  highlighted?: boolean;
  actions: readonly ImMessageAction[];
  menuLabel: string;
  timeLabel: string;
  editedLabel?: string;
  selectable?: boolean;
  selected?: boolean;
  selectionLabel?: string;
  /** Figma 定版：单聊不显示发送者名（时间走居中分隔线），群聊对端消息显示 */
  showSender?: boolean;
}>(), {
  highlighted: false,
  selectable: false,
  selected: false,
  selectionLabel: undefined,
  showSender: false
});

const emit = defineEmits<{
  action: [key: string];
  'update:selected': [selected: boolean];
}>();

const menuOpen = ref(false);
const menuAnchor = ref<HTMLButtonElement>();
const anchorPoint = ref<{ x: number; y: number }>();

function openMenu(): void {
  anchorPoint.value = undefined;
  menuOpen.value = !menuOpen.value;
}

function openContextMenu(event: MouseEvent): void {
  if (!props.actions.length) return;
  anchorPoint.value = { x: event.clientX, y: event.clientY };
  menuOpen.value = true;
}

function selectAction(key?: string): void {
  if (key) emit('action', key);
}
</script>

<template>
  <article
    :class="['message-layout', { 'message-layout--own': own, 'message-layout--grouped': grouped, 'message-layout--highlighted': highlighted }]"
    :data-seq="message.seq"
    @contextmenu.prevent="openContextMenu"
  >
    <input
      v-if="selectable"
      class="message-layout__selection"
      type="checkbox"
      :aria-label="selectionLabel"
      :checked="selected"
      @change="emit('update:selected', ($event.target as HTMLInputElement).checked)"
    />
    <div class="message-layout__avatar">
      <ImAvatar v-if="!grouped" :src="message.sender.avatar" :name="message.sender.name" size="md" />
    </div>
    <div class="message-layout__content">
      <header v-if="!grouped && !own && showSender" class="message-layout__header">
        <b>{{ message.sender.name }}</b>
      </header>
      <div class="message-layout__body">
        <div class="message-layout__bubble" :title="timeLabel"><slot name="bubble" /></div>
        <div class="message-layout__operate">
          <slot name="status" />
          <button
            v-if="actions.length"
            ref="menuAnchor"
            type="button"
            class="message-layout__menu-trigger"
            :aria-label="menuLabel"
            :aria-expanded="menuOpen"
            aria-haspopup="menu"
            @click="openMenu"
          ><span aria-hidden="true">•••</span></button>
        </div>
      </div>
      <small v-if="editedLabel" class="message-layout__edited">{{ editedLabel }}</small>
      <div v-if="$slots.after" class="message-layout__after"><slot name="after" /></div>
    </div>
    <ImFloatingMenu
      v-model:open="menuOpen"
      :anchor="menuAnchor"
      :anchor-point="anchorPoint"
      :label="menuLabel"
      variant="message"
      :placement="own ? 'bottom-start' : 'bottom-end'"
      @select="selectAction($event.key)"
    >
      <button
        v-for="action in actions"
        :key="action.key"
        type="button"
        role="menuitem"
        :data-menu-key="action.key"
        :data-tone="action.tone === 'danger' ? 'danger' : undefined"
        :disabled="action.disabled"
      >{{ action.label }}</button>
    </ImFloatingMenu>
  </article>
</template>

<style scoped>
/* Figma 消息行定版：左右留白24、头像36、气泡白底圆角4（12px/22 文字，最大 480px） */
.message-layout { display:flex;align-items:flex-start;gap:12px;padding:8px 24px 2px;position:relative;font-size:var(--im-uikit-font-size-sm,12px);line-height:var(--im-uikit-line-height-composer,22px); }
.message-layout--own { flex-direction:row-reverse; }
.message-layout__selection { flex:0 0 auto;align-self:center; }
.message-layout__avatar { width:36px;height:36px;flex:0 0 36px; }
.message-layout__content { display:flex;min-width:0;max-width:min(76%,520px);flex-direction:column;align-items:flex-start; }
.message-layout--own .message-layout__content { align-items:flex-end; }
.message-layout__header { display:flex;gap:8px;align-items:center;margin:0 0 4px;color:var(--im-uikit-text-tertiary);font-size:12px;line-height:14px; }
.message-layout__header b { font-weight:400; }
.message-layout__body { display:flex;align-items:flex-end;gap:4px;position:relative;max-width:100%; }
.message-layout--own .message-layout__body { flex-direction:row-reverse; }
.message-layout__bubble { min-width:0;padding:4px 8px;border-radius:var(--im-uikit-radius-xs,4px);color:var(--im-uikit-text-primary,#1f1f1f);background:var(--im-uikit-bg-bubble-peer,#fff);box-shadow:none;font-size:var(--im-uikit-font-size-sm,12px);line-height:var(--im-uikit-line-height-composer,22px);overflow-wrap:anywhere; }
.message-layout--own .message-layout__bubble { background:var(--im-uikit-bg-bubble-own,#fff);text-align:left; }
/* 卡片规范：气泡内为业务卡片时，外框由卡片自带，气泡归零内边距与底色 */
.message-layout__bubble:has(> .im-business-card) { padding:0;background:transparent; }
.message-layout__operate { display:flex;align-items:center;gap:2px;position:absolute;left:calc(100% + 4px);bottom:0; }
.message-layout--own .message-layout__operate { right:calc(100% + 4px);left:auto;flex-direction:row-reverse; }
.message-layout__menu-trigger { width:24px;height:24px;border:0;border-radius:6px;padding:0;color:var(--im-uikit-text-tertiary);background:transparent;opacity:0;cursor:pointer; }
.message-layout:hover .message-layout__menu-trigger,.message-layout__menu-trigger:focus-visible,.message-layout__menu-trigger[aria-expanded="true"] { opacity:1; }
.message-layout__menu-trigger:hover { background:var(--im-uikit-bg-dropdown-hover); }
.message-layout__menu-trigger:focus-visible { outline:none;box-shadow:var(--im-uikit-focus-ring); }
.message-layout__after { width:100%;margin-top:4px; }
.message-layout__edited { margin-top:2px;color:var(--im-uikit-text-tertiary);font-size:11px;line-height:16px; }
.message-layout--highlighted { background:var(--im-uikit-bg-list-focused,rgba(8,119,244,.08)); }
.message-layout--grouped { padding-top:2px; }
</style>

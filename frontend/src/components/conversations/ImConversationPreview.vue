<script setup lang="ts">
import { computed } from 'vue';
import ImAvatar from '../primitives/ImAvatar.vue';
import ImIcon from '../primitives/ImIcon.vue';
import type { Conversation } from '../../domain/types';
import {
  getConversationMentionSeq,
  getConversationPresence,
  getConversationPreviewSummary,
  getConversationTitleSuffix,
  type ConversationMenuRequest
} from './conversation-list-model';

const props = defineProps<{
  conversation: Conversation;
  selected: boolean;
  time: string;
  mutedLabel: string;
  mentionLabel?: string;
  draft?: string;
  draftLabel: string;
  tabIndex: 0 | -1;
  /** 单聊非在线状态后缀「[忙碌]」文案，由宿主面板注入（群聊/部门群/系统通知不使用）。 */
  presenceBusyLabel: string;
  /** 单聊非在线状态后缀「[离线]」文案，由宿主面板注入。 */
  presenceOfflineLabel: string;
}>();

const emit = defineEmits<{
  select: [conversation: Conversation];
  focus: [conversationId: string];
  'open-menu': [request: ConversationMenuRequest];
  'locate-mention': [conversation: Conversation, seq: number];
}>();

// 单聊在线状态点：仅 peerUserId 有值的会话才计算，群聊/系统通知恒为 undefined（ImAvatar 不画状态点）
const presence = computed(() => getConversationPresence(props.conversation));
// 单聊非 online 时追加的名称后缀，文案来自 props，不在组件内硬编码中文
const titleSuffix = computed(() => getConversationTitleSuffix(props.conversation, { presenceBusy: props.presenceBusyLabel, presenceOffline: props.presenceOfflineLabel }));

function focusOption(event: Event): HTMLElement | undefined {
  const option = (event.currentTarget as HTMLElement | null)?.closest<HTMLElement>('[role="option"]');
  option?.focus({ preventScroll: true });
  return option ?? undefined;
}
function select(event?: Event): void {
  if (event) focusOption(event);
  emit('select', props.conversation);
}
function locateMention(event: MouseEvent): void {
  focusOption(event);
  const seq = getConversationMentionSeq(props.conversation);
  if (seq !== undefined) emit('locate-mention', props.conversation, seq);
}
function openFromContext(event: MouseEvent): void {
  event.preventDefault();
  emit('open-menu', { conversation: props.conversation, anchor: event.currentTarget as HTMLElement, point: { x: event.clientX, y: event.clientY } });
}
function onKeydown(event: KeyboardEvent): void {
  if (event.target !== event.currentTarget) return;
  if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); select(); }
  else if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
    event.preventDefault();
    emit('open-menu', { conversation: props.conversation, anchor: event.currentTarget as HTMLElement });
  }
}
</script>

<template>
  <div
    :class="[
      'im-conversation-preview',
      { 'im-conversation-preview--active': selected, 'im-conversation-preview--pinned': conversation.pinned, 'im-conversation-preview--unread': conversation.unread > 0 }
    ]"
    role="option"
    :aria-selected="selected"
    :tabindex="tabIndex"
    @click="select"
    @focus="emit('focus', conversation.id)"
    @keydown="onKeydown"
    @contextmenu="openFromContext"
  >
    <div class="im-conversation-preview__card">
      <div class="im-conversation-preview__avatar">
        <slot name="avatar" :conversation="conversation">
          <ImAvatar :src="conversation.avatar" :name="conversation.title" :presence="presence" size="md" />
        </slot>
      </div>
      <div class="im-conversation-preview__content">
        <div class="im-conversation-preview__header">
          <span class="im-conversation-preview__title">{{ conversation.title }}{{ titleSuffix }}</span>
          <time class="im-conversation-preview__time">{{ time }}</time>
        </div>
        <div class="im-conversation-preview__footer">
          <span
            v-if="mentionLabel && getConversationMentionSeq(conversation) !== undefined"
            class="im-conversation-preview__mention"
            :title="mentionLabel"
            aria-hidden="true"
            @click.stop="locateMention"
          >{{ mentionLabel }}</span>
          <template v-if="getConversationPreviewSummary(conversation, draft).draft">
            <span class="im-conversation-preview__draft-prefix">[{{ draftLabel }}]</span>
            <span class="im-conversation-preview__summary">{{ getConversationPreviewSummary(conversation, draft).text }}</span>
          </template>
          <span v-else class="im-conversation-preview__summary">{{ conversation.summary }}</span>
          <!-- Figma：右下角为免打扰铃铛或红点/数字徽标（禁描边，规范第十一节） -->
          <span v-if="conversation.muted" class="im-conversation-preview__mute-icon" :aria-label="mutedLabel">
            <slot name="muted-icon"><ImIcon name="mutedBell" :size="12" /></slot>
          </span>
          <span
            v-else-if="conversation.unread"
            class="im-conversation-preview__unread"
            role="status"
            :aria-label="String(conversation.unread)"
          >{{ conversation.unread > 99 ? '99+' : conversation.unread }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* Figma 会话行定版：外框 72px 内衬 4px；内卡圆角8、内边距 12/6；选中=品牌 5% 底 + 0.5px 品牌描边 */
.im-conversation-preview {
  position: relative;
  display: flex;
  flex: 0 0 auto;
  width: 100%;
  height: var(--im-uikit-conversation-row-height, 72px);
  box-sizing: border-box;
  align-items: stretch;
  border: 0;
  padding: 4px;
  color: var(--im-uikit-text-primary, #1f1f1f);
  background: var(--im-uikit-bg-list-default, transparent);
  cursor: pointer;
  line-height: 22px;
  transition: color var(--im-uikit-transition-color, 0.3s ease-out), background-color var(--im-uikit-transition-color, 0.3s ease-out);
}
/* 置顶会话整行铺 #ebebeb（Figma 置顶态） */
.im-conversation-preview--pinned { background: var(--im-uikit-bg-field, #ebebeb); }
.im-conversation-preview__card {
  position: relative;
  display: flex;
  flex: 1;
  min-width: 0;
  align-items: center;
  gap: 8px;
  border: 0.5px solid transparent;
  border-radius: var(--im-uikit-radius-md, 8px);
  padding: 6px 12px;
  transition: background-color var(--im-uikit-transition-color, 0.3s ease-out);
}
.im-conversation-preview:hover .im-conversation-preview__card { background: var(--im-uikit-bg-list-hover, rgba(31, 31, 31, 0.05)); }
.im-conversation-preview--active .im-conversation-preview__card,
.im-conversation-preview--active:hover .im-conversation-preview__card {
  border-color: var(--im-uikit-brand, #0877f4);
  background: var(--im-uikit-bg-list-focused, rgba(8, 119, 244, 0.05));
}
.im-conversation-preview:focus-visible { outline: none; box-shadow: inset var(--im-uikit-focus-ring, 0 0 0 2px rgba(8, 119, 244, 0.28)); }
.im-conversation-preview__avatar { position: relative; display: flex; flex: 0 0 auto; }
.im-conversation-preview__content { flex: 1; min-width: 0; text-align: start; }
.im-conversation-preview__header { display: flex; height: 22px; align-items: center; justify-content: space-between; }
.im-conversation-preview__title { flex: 1; min-width: 0; overflow: hidden; color: var(--im-uikit-text-primary, #1f1f1f); font-size: var(--im-uikit-font-size-md, 14px); font-weight: 500; line-height: 22px; text-overflow: ellipsis; white-space: nowrap; }
.im-conversation-preview__time { flex: 0 0 auto; margin-inline-start: 8px; color: var(--im-uikit-text-tertiary, #999); font-size: var(--im-uikit-font-size-xs, 10px); font-weight: 400; line-height: 22px; white-space: nowrap; }
.im-conversation-preview__footer { display: flex; height: 22px; align-items: center; }
.im-conversation-preview__mention { flex: 0 0 auto; margin: 0 4px 0 0; color: var(--im-uikit-text-error, #e84f4f); cursor: pointer; font-size: var(--im-uikit-font-size-sm, 12px); line-height: var(--im-uikit-line-height-sm, 18px); }
.im-conversation-preview__mention:hover { text-decoration: underline; }
.im-conversation-preview__summary { flex: 1; min-width: 0; overflow: hidden; color: var(--im-uikit-text-secondary, #666); font-size: var(--im-uikit-font-size-sm, 12px); font-weight: 400; line-height: 22px; text-overflow: ellipsis; white-space: nowrap; }
.im-conversation-preview__draft-prefix { flex:0 0 auto;margin-right:3px;color:var(--im-uikit-text-error,#e84f4f);font-size:var(--im-uikit-font-size-sm,12px);line-height:var(--im-uikit-line-height-sm,18px); }
/* 未读徽标：#e84f4f 底、白字 8px、完全圆角、无描边（红点规范） */
.im-conversation-preview__unread {
  display: flex;
  min-width: 14px;
  height: 14px;
  box-sizing: border-box;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  margin-inline-start: 8px;
  border-radius: var(--im-uikit-radius-pill, 999px);
  padding: 0 4px;
  color: var(--im-uikit-text-on-primary, #fff);
  background: var(--im-uikit-error, #e84f4f);
  font-size: 8px;
  font-weight: 400;
  line-height: 1;
}
.im-conversation-preview__mute-icon { display: flex; flex: 0 0 auto; align-items: center; justify-content: center; margin-inline-start: 8px; color: var(--im-uikit-text-tertiary, #999); }
</style>

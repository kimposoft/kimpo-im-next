<script setup lang="ts">
import { nextTick, ref, watch } from 'vue';
import type { Conversation } from '../../domain/types';
import ImFloatingMenu from '../primitives/ImFloatingMenu.vue';
import ImConversationPreview from './ImConversationPreview.vue';
import {
  getConversationMenuItems,
  getConversationMentionSeq,
  type ConversationMenuAction,
  type ConversationMenuLabels,
  type ConversationMenuRequest
} from './conversation-list-model';

defineOptions({ inheritAttrs: false });

const props = defineProps<{
  conversations: Conversation[];
  activeConversationId?: string;
  listLabel: string;
  labels: ConversationMenuLabels;
  drafts?: ReadonlyMap<string, string>;
  draftLabel: string;
  formatTime?: (conversation: Conversation) => string;
}>();

const emit = defineEmits<{
  select: [conversationId: string];
  action: [conversation: Conversation, action: ConversationMenuAction];
  'locate-mention': [conversationId: string, seq: number];
}>();

const menuOpen = ref(false);
const menuConversation = ref<Conversation>();
const menuAnchor = ref<HTMLElement>();
const menuPoint = ref<{ x: number; y: number }>();
const list = ref<HTMLElement>();
const focusedConversationId = ref('');

watch([() => props.conversations.map(conversation => conversation.id), () => props.activeConversationId], ([ids, activeId]) => {
  if (ids.includes(focusedConversationId.value)) return;
  focusedConversationId.value = activeId && ids.includes(activeId) ? activeId : ids[0] ?? '';
}, { immediate: true });

function displayTime(conversation: Conversation): string {
  return props.formatTime?.(conversation) ?? new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(conversation.updatedAt));
}
function select(conversation: Conversation): void {
  focusedConversationId.value = conversation.id;
  menuOpen.value = false;
  emit('select', conversation.id);
}
function locateMention(conversation: Conversation, seq: number): void {
  menuOpen.value = false;
  emit('locate-mention', conversation.id, seq);
}
function openMenu(request: ConversationMenuRequest): void {
  menuConversation.value = request.conversation;
  menuAnchor.value = request.anchor;
  menuPoint.value = request.point;
  menuOpen.value = true;
}
function clearMenu(): void {
  menuConversation.value = undefined;
  menuAnchor.value = undefined;
  menuPoint.value = undefined;
}
function runAction(action: ConversationMenuAction | 'mention'): void {
  const conversation = menuConversation.value;
  if (!conversation) return;
  if (action === 'mention') {
    const seq = getConversationMentionSeq(conversation);
    if (seq !== undefined) locateMention(conversation, seq);
    return;
  }
  emit('action', conversation, action);
}
function focusConversation(conversationId: string): void {
  focusedConversationId.value = conversationId;
}
function onListKeydown(event: KeyboardEvent): void {
  const option = (event.target as Element | null)?.closest<HTMLElement>('[role="option"]');
  if (!option || !list.value?.contains(option)) return;
  const options = [...list.value.querySelectorAll<HTMLElement>('[role="option"]')];
  const current = options.indexOf(option);
  let next: number | undefined;
  if (event.key === 'ArrowDown') next = Math.min(current + 1, options.length - 1);
  else if (event.key === 'ArrowUp') next = Math.max(current - 1, 0);
  else if (event.key === 'Home') next = 0;
  else if (event.key === 'End') next = options.length - 1;
  if (next === undefined || next === current) return;
  event.preventDefault();
  focusedConversationId.value = props.conversations[next]?.id ?? focusedConversationId.value;
  void nextTick(() => options[next]?.focus({ preventScroll: true }));
}
</script>

<template>
  <div ref="list" v-bind="$attrs" class="im-conversation-list" role="listbox" :aria-label="listLabel" @keydown="onListKeydown">
    <ImConversationPreview
      v-for="conversation in conversations"
      :key="conversation.id"
      :conversation="conversation"
      :selected="activeConversationId === conversation.id"
      :time="displayTime(conversation)"
      :muted-label="labels.mutedState"
      :mention-label="labels.mentioned"
      :draft="drafts?.get(conversation.id)"
      :draft-label="draftLabel"
      :tab-index="focusedConversationId === conversation.id ? 0 : -1"
      :presence-busy-label="labels.presenceBusy"
      :presence-offline-label="labels.presenceOffline"
      @select="select"
      @focus="focusConversation"
      @locate-mention="locateMention"
      @open-menu="openMenu"
    />
  </div>
  <ImFloatingMenu
    v-model:open="menuOpen"
    :anchor="menuAnchor"
    :anchor-point="menuPoint"
    :label="labels.actions"
    variant="conversation"
    placement="bottom-end"
    @close="clearMenu"
  >
    <button
      v-if="menuConversation && labels.mentioned && getConversationMentionSeq(menuConversation) !== undefined"
      type="button"
      data-menu-key="mention"
      @click="runAction('mention')"
    >{{ labels.mentioned }}</button>
    <button
      v-for="item in menuConversation ? getConversationMenuItems(menuConversation, labels) : []"
      :key="item.action"
      type="button"
      :data-menu-key="item.action"
      :data-tone="item.tone"
      @click="runAction(item.action)"
    >{{ item.label }}</button>
  </ImFloatingMenu>
</template>

<style scoped>
.im-conversation-list {
  display: flex;
  flex: 1 1 auto;
  min-height: 0;
  flex-direction: column;
  overflow: auto;
  background: transparent;
  scrollbar-width: none;
}
.im-conversation-list::-webkit-scrollbar { display: none; }
</style>

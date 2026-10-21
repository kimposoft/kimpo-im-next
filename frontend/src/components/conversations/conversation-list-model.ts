import type { Conversation } from '../../domain/types';
import type { ImPresenceState } from '../primitives/ImAvatar.vue';

export type ConversationMenuAction = 'pin' | 'mute' | 'hide';

export interface ConversationMenuLabels {
  actions: string;
  pin: string;
  unpin: string;
  mute: string;
  unmute: string;
  hide: string;
  mutedState: string;
  /** Optional until the host panel connects the locale entry. */
  mentioned?: string;
  /** 最近聊天单聊状态后缀「[忙碌]」「[离线]」文案，宿主面板注入，组件内不硬编码中文。 */
  presenceBusy: string;
  presenceOffline: string;
}

export interface ConversationMenuItem {
  action: ConversationMenuAction;
  label: string;
  tone?: 'danger';
}

export interface ConversationMenuRequest {
  conversation: Conversation;
  anchor: HTMLElement;
  point?: { x: number; y: number };
}

export interface ConversationPreviewSummary { readonly text: string; readonly draft: boolean }

/** Draft text is a view projection and never mutates the authoritative conversation DTO. */
export function getConversationPreviewSummary(conversation: Conversation, draft?: string): ConversationPreviewSummary {
  return draft?.trim() ? { text: draft, draft: true } : { text: conversation.summary, draft: false };
}

/** Reject malformed or stale transport hints before exposing a locate action. */
export function getConversationMentionSeq(conversation: Conversation): number | undefined {
  const seq = conversation.mentionSeq;
  if (!conversation.hasMention || !Number.isSafeInteger(seq) || (seq ?? 0) <= conversation.readSeq) return undefined;
  return seq;
}

/**
 * 最近聊天列表在线状态点判据：仅单聊（peerUserId 有值）才计算状态；
 * 群聊/部门群/系统通知会话没有 peerUserId，恒不显示状态点。
 * 单聊时状态恒显示：online/busy 原样透传，其余（connecting/未知）一律归并为 offline。
 */
export function getConversationPresence(conversation: Conversation): ImPresenceState | undefined {
  if (!conversation.peerUserId) return undefined;
  if (conversation.connection === 'online') return 'online';
  if (conversation.connection === 'busy') return 'busy';
  return 'offline';
}

/**
 * 单聊非在线时，会话名称后追加「[忙碌]」/「[离线]」后缀；online 与非单聊会话均不追加。
 * 标题为空时也不追加——真机上存在标题缺失的单聊（后端未回名、宿主也没回退成对端显示名），
 * 若照追后缀会渲染成光秃秃的「[离线]」，看着像 bug；此时状态仍由头像状态点表达，信息不丢。
 */
export function getConversationTitleSuffix(conversation: Conversation, labels: Pick<ConversationMenuLabels, 'presenceBusy' | 'presenceOffline'>): string {
  if (!conversation.title.trim()) return '';
  const presence = getConversationPresence(conversation);
  if (presence === undefined || presence === 'online') return '';
  return presence === 'busy' ? `[${labels.presenceBusy}]` : `[${labels.presenceOffline}]`;
}

/** Keeps product action permissions separate from the visual menu component. */
export function getConversationMenuItems(conversation: Conversation, labels: ConversationMenuLabels): ConversationMenuItem[] {
  const items: ConversationMenuItem[] = [{ action: 'pin', label: conversation.pinned ? labels.unpin : labels.pin }];
  if (conversation.kind !== 'system') {
    items.push({ action: 'mute', label: conversation.muted ? labels.unmute : labels.mute });
    items.push({ action: 'hide', label: labels.hide, tone: 'danger' });
  }
  return items;
}

import type { Conversation } from '../../domain/types';

export interface ChatHeaderLabels {
  online: string;
  busy: string;
  connecting: string;
  offline: string;
  department: string;
  members: string;
}

export function conversationHeaderSubtitle(conversation: Conversation, labels: ChatHeaderLabels): string | undefined {
  const summary = conversation.summary.trim() || undefined;

  if (conversation.kind === 'single') {
    if (conversation.connection === 'online') return labels.online;
    if (conversation.connection === 'busy') return labels.busy;
    if (conversation.connection === 'connecting') return labels.connecting;
    if (conversation.connection === 'offline') return labels.offline;
    return summary;
  }

  if (conversation.kind === 'department') {
    return conversation.memberCount === undefined
      ? labels.department
      : `${labels.department} · ${conversation.memberCount} ${labels.members}`;
  }

  if (conversation.kind === 'group') {
    return conversation.memberCount === undefined ? summary : `${conversation.memberCount} ${labels.members}`;
  }

  return summary;
}

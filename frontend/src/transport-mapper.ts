import type { NahidaAssetReference, NahidaBusinessCard, NahidaConversation, NahidaGroupMember, NahidaMessage, NahidaSystemNotification } from '@kimposoft/plugin-sdk/nahida-im';
import type { OrgDept, OrgMember } from '@kimposoft/plugin-sdk/org-directory';
import type { Attachment, Conversation, GroupMember, Message, OrgUnit, User } from './domain/types';

export function mapOrgMember(member: OrgMember): User {
  return {
    id: member.userId,
    name: member.displayName,
    ...(member.avatar ? { avatar: member.avatar } : {}),
    email: member.email,
    mobile: member.mobile,
    memberships: member.memberships.map(item => ({
      orgUnitId: item.orgUnitId,
      orgUnitName: item.orgUnitName,
      primary: item.primary
    })),
    departments: [...new Set(member.memberships.map(item => item.orgUnitName ?? item.orgUnitId))]
  };
}

export function mapDepartment(dept: OrgDept, members: readonly OrgMember[], children: OrgUnit[] = []): OrgUnit {
  return {
    id: dept.id,
    name: dept.name,
    members: members.map(mapOrgMember),
    childCount: dept.childCount ?? children.length,
    children,
    membersLoaded: members.length > 0,
    childrenLoaded: children.length > 0 || (dept.childCount ?? 0) === 0
  };
}

export function mapAsset(asset: NahidaAssetReference): Attachment {
  return { ...asset };
}

export function mapGroupMember(member: NahidaGroupMember): GroupMember {
  return { ...member };
}

function mapBusinessCard(card: NahidaBusinessCard | undefined): Message['card'] {
  if (!card) return undefined;
  return {
    cardType: card.cardType,
    schemaVersion: card.schemaVersion,
    rendererKey: card.rendererKey,
    title: card.title,
    summary: card.summary,
    state: card.state,
    data: card.data,
    link: card.link?.route,
    actions: (card.actions ?? []).map(action => ({
      key: action.key,
      label: action.label,
      style: action.style,
      disabled: action.disabled,
      requiresComment: action.requiresComment
    }))
  };
}

function mapConversationKind(kind: NahidaConversation['kind']): Conversation['kind'] {
  if (kind === 'system-notification') return 'system';
  if (kind === 'business') return 'object';
  return kind;
}

function messageSummary(message: NahidaMessage | undefined): string {
  if (!message) return '';
  return message.content.text
    ?? message.content.asset?.fileName
    ?? message.content.card?.summary
    ?? message.content.card?.title
    ?? '';
}

export function mapConversation(dto: NahidaConversation): Conversation {
  return {
    id: dto.id,
    title: dto.displayName,
    avatar: dto.avatarAssetId,
    kind: mapConversationKind(dto.kind),
    summary: messageSummary(dto.lastMessage),
    updatedAt: dto.updatedAt,
    unread: dto.unreadCount,
    pinned: dto.pinned,
    muted: dto.muted,
    memberCount: dto.memberCount,
    peerUserId: dto.peerUserId,
    currentMemberRole: dto.currentMemberRole,
    currentMemberSource: dto.currentMemberSource,
    departmentId: dto.department?.orgUnitId,
    lastSeq: dto.lastSeq,
    readSeq: dto.readSeq,
    mentionSeq: dto.mentionSeq,
    hasMention: dto.hasMention,
    readonly: dto.readonly,
    allMuted: dto.muteAll ?? false,
    currentMemberSendMuted: dto.currentMemberSendMuted ?? false,
    announcementMessageId: dto.announcementMessageId,
    hidden: dto.hidden,
    archived: false
  };
}

export function mapMessage(dto: NahidaMessage, self?: User): Message {
  const sender = self?.id === dto.senderId
    ? self
    : { id: dto.senderId, name: dto.senderDisplayName ?? dto.senderId, avatar: dto.senderAvatarAssetId, departments: [] };
  const revoked = Boolean(dto.revokedAt) || dto.kind === 'recall-tombstone';
  const kind: Message['kind'] = revoked
    ? 'recall'
    : dto.kind === 'image'
      ? 'image'
      : dto.kind === 'file'
        ? 'file'
        : dto.kind === 'system'
          ? 'system'
          : dto.kind === 'card'
            ? 'card'
            : 'text';
  return {
    id: dto.id,
    conversationId: dto.conversationId,
    seq: dto.seq,
    clientMsgId: dto.clientMsgId,
    sender,
    kind,
    text: dto.content.text,
    attachment: dto.content.asset ? mapAsset(dto.content.asset) : undefined,
    createdAt: dto.createdAt,
    editedAt: dto.editedAt,
    sendState: 'sent',
    replyTo: dto.replyToSeq === undefined ? undefined : { id: `seq:${dto.replyToSeq}`, seq: dto.replyToSeq, sender: { id: '', name: '', departments: [] } },
    revoked,
    reactions: dto.reactions?.map(item => ({ emoji: item.emoji, count: item.count, mine: item.reactedByMe })),
    mentions: dto.mentions,
    systemCode: dto.content.systemCode,
    systemParams: dto.content.systemParams,
    card: mapBusinessCard(dto.content.card),
    cardAction: dto.cardAction
  };
}

export function mapNotification(notification: NahidaSystemNotification, conversationId: string): Message {
  return {
    id: `notification:${notification.id}`,
    conversationId,
    seq: Date.parse(notification.createdAt),
    clientMsgId: `notification:${notification.id}`,
    sender: { id: 'system', name: 'System', departments: [] },
    kind: notification.card ? 'card' : 'system',
    // 卡片类通知的 content 是卡片 JSON 载体，文本兜底（搜索/摘要）改用卡片摘要，防 JSON 外露
    text: notification.card
      ? notification.card.summary ?? notification.card.title ?? notification.title
      : notification.content,
    card: mapBusinessCard(notification.card),
    notification: {
      id: notification.id,
      title: notification.title,
      content: notification.content,
      readAt: notification.readAt,
      link: notification.link
    },
    createdAt: notification.createdAt,
    sendState: 'sent'
  };
}

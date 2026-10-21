import type { Conversation, GroupMember, User } from './types';

function isOrdinaryGroup(conversation: Conversation | undefined): conversation is Conversation {
  return conversation?.kind === 'group';
}

export function canInviteGroup(conversation: Conversation | undefined): boolean {
  return isOrdinaryGroup(conversation) && (conversation.currentMemberRole === 'owner' || conversation.currentMemberRole === 'admin');
}

export function canEditGroupInfo(conversation: Conversation | undefined): boolean {
  return canInviteGroup(conversation);
}

/** Owners are deliberately excluded until the backend supports a safe owner-leave path. */
export function canLeaveOrdinaryGroup(conversation: Conversation | undefined): boolean {
  return isOrdinaryGroup(conversation) && (conversation.currentMemberRole === 'member' || conversation.currentMemberRole === 'admin');
}

export function canDissolveOrdinaryGroup(conversation: Conversation | undefined): boolean {
  return isOrdinaryGroup(conversation) && conversation.currentMemberRole === 'owner';
}

export function canKickOrdinaryGroupMember(conversation: Conversation | undefined, member: GroupMember, selfId?: string): boolean {
  if (!isOrdinaryGroup(conversation) || member.userId === selfId || member.source !== 'manual') return false;
  if (conversation.currentMemberRole === 'admin') return member.role === 'member';
  if (conversation.currentMemberRole === 'owner') return member.role === 'member' || member.role === 'admin';
  return false;
}

export function canSetOrdinaryGroupAdmin(conversation: Conversation | undefined, member: GroupMember, selfId?: string): boolean {
  return isOrdinaryGroup(conversation)
    && conversation.currentMemberRole === 'owner'
    && member.userId !== selfId
    && (member.role === 'member' || member.role === 'admin');
}

export function canTransferOrdinaryGroupOwnership(conversation: Conversation | undefined, member: GroupMember, selfId?: string): boolean {
  return isOrdinaryGroup(conversation)
    && conversation.currentMemberRole === 'owner'
    && member.userId !== selfId
    && member.role !== 'owner';
}

export function selectableGroupCandidates(
  users: readonly User[],
  mode: 'create' | 'invite',
  selfId: string | undefined,
  members: readonly GroupMember[],
  selectedIds: ReadonlySet<string> = new Set()
): User[] {
  const existing = mode === 'invite' ? new Set(members.map(member => member.userId)) : new Set<string>();
  return users.filter(user => user.id !== selfId && !existing.has(user.id) && !selectedIds.has(user.id));
}

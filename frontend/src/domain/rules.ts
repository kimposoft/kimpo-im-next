import type { Conversation, Message, OrgUnit, User } from './types';

/** Pinned conversations precede chronological conversations; unread only affects visual status. */
export function sortConversations(items: Conversation[]): Conversation[] {
  return [...items].sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)) || b.updatedAt.localeCompare(a.updatedAt));
}

/** Search projection deduplicates people by immutable user ID while retaining every department. */
export function uniqueDirectoryUsers(units: OrgUnit[]): User[] {
  const found = new Map<string, User>();
  const visit = (nodes: OrgUnit[]) => nodes.forEach(node => {
    node.members.forEach(user => {
      const prior = found.get(user.id);
      if (!prior) {
        found.set(user.id, user);
        return;
      }
      const memberships = new Map((prior.memberships ?? []).map(item => [item.orgUnitId, item]));
      for (const membership of user.memberships ?? []) {
        const existing = memberships.get(membership.orgUnitId);
        memberships.set(membership.orgUnitId, existing ? {
          ...existing,
          orgUnitName: existing.orgUnitName ?? membership.orgUnitName,
          primary: existing.primary || membership.primary
        } : membership);
      }
      found.set(user.id, {
        ...prior,
        name: prior.name || user.name,
        avatar: prior.avatar || user.avatar,
        email: prior.email || user.email,
        mobile: prior.mobile || user.mobile,
        departments: [...new Set([...prior.departments, ...user.departments])],
        ...(memberships.size ? { memberships: [...memberships.values()] } : {})
      });
    });
    if (node.children) visit(node.children);
  });
  visit(units);
  return [...found.values()];
}

/** Adjacent messages from one sender are grouped only within a short time window. */
export function isGroupedWithPrevious(previous: Message | undefined, current: Message): boolean {
  if (!previous || previous.sender.id !== current.sender.id || ['system', 'recall'].includes(previous.kind) || ['system', 'recall'].includes(current.kind)) return false;
  return Math.abs(Date.parse(current.createdAt) - Date.parse(previous.createdAt)) < 5 * 60_000;
}

/** Department membership is organization-authoritative: no leave, kick, or dissolve UI action. */
export function canManageDepartmentGroup(conversation: Conversation): boolean { return conversation.kind !== 'department'; }
export function canLeaveGroup(conversation: Conversation): boolean { return canManageDepartmentGroup(conversation); }
export function canKickGroupMember(conversation: Conversation): boolean { return canManageDepartmentGroup(conversation); }
export function canDissolveGroup(conversation: Conversation): boolean { return canManageDepartmentGroup(conversation); }
export function canSend(conversation: Conversation | undefined): boolean {
  if (!conversation || conversation.archived || conversation.currentMemberSendMuted) return false;
  if (conversation.allMuted && !['admin', 'owner'].includes(conversation.currentMemberRole ?? '')) return false;
  return !conversation.readonly || conversation.currentMemberRole === 'admin' || conversation.currentMemberRole === 'owner';
}

import { describe, expect, it } from 'vitest';
import { canDissolveOrdinaryGroup, canEditGroupInfo, canInviteGroup, canKickOrdinaryGroupMember, canLeaveOrdinaryGroup, canSetOrdinaryGroupAdmin, canTransferOrdinaryGroupOwnership, selectableGroupCandidates } from './group-permissions';
import type { Conversation, GroupMember } from './types';

function conversation(kind: Conversation['kind'], role: Conversation['currentMemberRole']): Conversation {
  return { id: 'c', title: 'Group', kind, summary: '', updatedAt: '', unread: 0, lastSeq: 0, readSeq: 0, currentMemberRole: role };
}

function member(role: GroupMember['role'], source: GroupMember['source'] = 'manual', userId = 'other'): GroupMember {
  return { userId, displayName: userId, role, source, joinedAt: '' };
}

describe('ordinary group permission matrix', () => {
  it('allows member/admin leave, owner dissolve, and owner/admin invite or edit', () => {
    const regular = conversation('group', 'member');
    const admin = conversation('group', 'admin');
    const owner = conversation('group', 'owner');
    expect(canLeaveOrdinaryGroup(regular)).toBe(true);
    expect(canLeaveOrdinaryGroup(admin)).toBe(true);
    expect(canLeaveOrdinaryGroup(owner)).toBe(false);
    expect(canDissolveOrdinaryGroup(owner)).toBe(true);
    expect(canDissolveOrdinaryGroup(admin)).toBe(false);
    expect(canInviteGroup(admin)).toBe(true);
    expect(canInviteGroup(owner)).toBe(true);
    expect(canEditGroupInfo(admin)).toBe(true);
  });

  it('limits kicks by actor role and manual membership source', () => {
    const admin = conversation('group', 'admin');
    const owner = conversation('group', 'owner');
    expect(canKickOrdinaryGroupMember(admin, member('member'), 'self')).toBe(true);
    expect(canKickOrdinaryGroupMember(admin, member('admin'), 'self')).toBe(false);
    expect(canKickOrdinaryGroupMember(owner, member('admin'), 'self')).toBe(true);
    expect(canKickOrdinaryGroupMember(owner, member('owner'), 'self')).toBe(false);
    expect(canKickOrdinaryGroupMember(owner, member('member', 'organization'), 'self')).toBe(false);
    expect(canKickOrdinaryGroupMember(owner, member('member', 'manual', 'self'), 'self')).toBe(false);
  });

  it('keeps department groups view-only regardless of the projected role', () => {
    const department = conversation('department', 'owner');
    expect(canInviteGroup(department)).toBe(false);
    expect(canLeaveOrdinaryGroup(department)).toBe(false);
    expect(canDissolveOrdinaryGroup(department)).toBe(false);
    expect(canKickOrdinaryGroupMember(department, member('member'), 'self')).toBe(false);
    expect(canSetOrdinaryGroupAdmin(department, member('member'), 'self')).toBe(false);
    expect(canTransferOrdinaryGroupOwnership(department, member('member'), 'self')).toBe(false);
  });

  it('allows only ordinary-group owners to manage other active member roles regardless of source', () => {
    const owner = conversation('group', 'owner');
    const admin = conversation('group', 'admin');
    const regular = conversation('group', 'member');
    const orgMember = member('member', 'organization', 'org-member');
    const businessAdmin = member('admin', 'business', 'business-admin');
    expect(canSetOrdinaryGroupAdmin(owner, orgMember, 'self')).toBe(true);
    expect(canSetOrdinaryGroupAdmin(owner, businessAdmin, 'self')).toBe(true);
    expect(canTransferOrdinaryGroupOwnership(owner, orgMember, 'self')).toBe(true);
    expect(canTransferOrdinaryGroupOwnership(owner, businessAdmin, 'self')).toBe(true);
    expect(canSetOrdinaryGroupAdmin(admin, orgMember, 'self')).toBe(false);
    expect(canSetOrdinaryGroupAdmin(regular, orgMember, 'self')).toBe(false);
    expect(canTransferOrdinaryGroupOwnership(admin, orgMember, 'self')).toBe(false);
    expect(canSetOrdinaryGroupAdmin(owner, member('owner', 'manual', 'self'), 'self')).toBe(false);
    expect(canTransferOrdinaryGroupOwnership(owner, member('owner', 'manual', 'self'), 'self')).toBe(false);
  });

  it('filters self for creation and the complete member roster for invitations', () => {
    const users = [
      { id: 'self', name: 'Self', departments: [] },
      { id: 'member', name: 'Member', departments: [] },
      { id: 'new', name: 'New', departments: [] }
    ];
    expect(selectableGroupCandidates(users, 'create', 'self', [], new Set(['member'])).map(user => user.id)).toEqual(['new']);
    expect(selectableGroupCandidates(users, 'invite', 'self', [member('member', 'manual', 'member')]).map(user => user.id)).toEqual(['new']);
  });
});

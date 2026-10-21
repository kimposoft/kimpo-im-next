import { describe, expect, it } from 'vitest';
import { canDissolveGroup, canKickGroupMember, canLeaveGroup, canManageDepartmentGroup, canSend, isGroupedWithPrevious, sortConversations, uniqueDirectoryUsers } from './rules';
import { getVirtualWindow, mediaHeightScrollDelta, restoreHistoryAnchor } from './virtual-window';
import type { Conversation, Message, OrgUnit, User } from './types';

const a: User = { id: 'u-a', name: 'A', departments: ['D1'] };
const conv = (id: string, updatedAt: string, pinned = false): Conversation => ({ id, title: id, kind: 'group', summary: '', updatedAt, unread: 0, pinned, lastSeq: 0, readSeq: 0 });
const msg = (id: string, time: string): Message => ({ id, conversationId: 'c', seq: Number(id), clientMsgId: `client-${id}`, sender: a, kind: 'text', text: 'x', createdAt: time });

describe('IM domain rules', () => {
  it('sorts pinned then most recent and preserves unread for rendering', () => {
    expect(sortConversations([conv('old', '2026-01-01', true), conv('new', '2026-02-01'), conv('pin-new', '2026-03-01', true)]).map(x => x.id)).toEqual(['pin-new', 'old', 'new']);
  });
  it('deduplicates people across departments', () => {
    const units: OrgUnit[] = [{ id: 'd1', name: 'D1', members: [{ ...a, email: 'a@example.test', memberships: [{ orgUnitId: 'd1', orgUnitName: 'D1', primary: true }] }], childCount: 1, membersLoaded: true, childrenLoaded: true, children: [
      { id: 'd2', name: 'D2', members: [{ ...a, mobile: '123', departments: ['D2'], memberships: [{ orgUnitId: 'd2', orgUnitName: 'D2', primary: false }] }], childCount: 0, children: [], membersLoaded: true, childrenLoaded: true }
    ] }];
    expect(uniqueDirectoryUsers(units)).toEqual([{
      ...a, email: 'a@example.test', mobile: '123', departments: ['D1', 'D2'], memberships: [
        { orgUnitId: 'd1', orgUnitName: 'D1', primary: true },
        { orgUnitId: 'd2', orgUnitName: 'D2', primary: false }
      ]
    }]);
  });
  it('groups close messages and blocks leave/kick/dissolve for department groups', () => {
    expect(isGroupedWithPrevious(msg('1', '2026-01-01T00:00:00Z'), msg('2', '2026-01-01T00:04:00Z'))).toBe(true);
    const department = { ...conv('dept', '2026-01-01'), kind: 'department' } as Conversation;
    expect(canManageDepartmentGroup(department)).toBe(false);
    expect(canLeaveGroup(department)).toBe(false);
    expect(canKickGroupMember(department)).toBe(false);
    expect(canDissolveGroup(department)).toBe(false);
    expect(canSend({ ...conv('mute', '2026-01-01'), allMuted: true })).toBe(false);
    expect(canSend({ ...conv('mute-admin', '2026-01-01'), allMuted: true, currentMemberRole: 'admin' })).toBe(true);
    expect(canSend({ ...conv('member-muted', '2026-01-01'), currentMemberRole: 'admin', currentMemberSendMuted: true })).toBe(false);
    expect(canSend({ ...conv('readonly-member', '2026-01-01'), readonly: true, currentMemberRole: 'member' })).toBe(false);
    expect(canSend({ ...conv('readonly-admin', '2026-01-01'), readonly: true, currentMemberRole: 'admin' })).toBe(true);
  });
  it('models virtual window, prepended-history anchor and async-media adjustment', () => {
    expect(getVirtualWindow(100, 720, 360)).toMatchObject({ start: 6, end: 19, paddingTop: 432 });
    expect(restoreHistoryAnchor({ id: 'm2', offset: 8 }, ['old', 'm1', 'm2'], { old: 50, m1: 60 })).toBe(118);
    expect(mediaHeightScrollDelta(1, 2, 80, 150)).toBe(70);
  });
});

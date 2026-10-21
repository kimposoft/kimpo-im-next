import { describe, expect, it } from 'vitest';
import { mapConversation, mapMessage, mapNotification, mapOrgMember } from './transport-mapper';

describe('transport DTO to UI mapper', () => {
  it('maps stable department identity and cursor counters', () => {
    const mapped = mapConversation({ id: 'c', kind: 'department', displayName: 'R&D', department: { orgUnitId: 'd1', includeChildren: false }, memberCount: 3, lastSeq: 9, readSeq: 8, deliveredSeq: 9, mentionSeq: 0, unreadCount: 1, hasMention: false, muted: false, pinned: true, hidden: false, readonly: false, currentMemberRole: 'admin', currentMemberSource: 'organization', updatedAt: '2026-07-22T00:00:00Z' });
    expect(mapped).toMatchObject({ id: 'c', kind: 'department', departmentId: 'd1', lastSeq: 9, readSeq: 8, mentionSeq: 0, hasMention: false, unread: 1, readonly: false, allMuted: false, currentMemberRole: 'admin', currentMemberSource: 'organization' });
  });

  it('preserves the mention cursor used by the conversation-list locate action', () => {
    const mapped = mapConversation({ id: 'mentioned', kind: 'group', displayName: 'Team', memberCount: 3, lastSeq: 12, readSeq: 8, deliveredSeq: 12, mentionSeq: 10, unreadCount: 4, hasMention: true, muted: false, pinned: false, hidden: false, readonly: false, currentMemberRole: 'member', currentMemberSource: 'manual', updatedAt: '2026-07-22T00:00:00Z' });
    expect(mapped).toMatchObject({ mentionSeq: 10, hasMention: true });
  });

  it('keeps user-hidden state separate from server archival semantics', () => {
    const mapped = mapConversation({ id: 'hidden', kind: 'single', displayName: 'Hidden', memberCount: 2, lastSeq: 0, readSeq: 0, deliveredSeq: 0, mentionSeq: 0, unreadCount: 0, hasMention: false, muted: false, pinned: false, hidden: true, readonly: false, currentMemberRole: null, currentMemberSource: null, updatedAt: '2026-07-22T00:00:00Z' });
    expect(mapped).toMatchObject({ hidden: true, archived: false });
  });

  it('maps file assets and keeps transport IDs as strings', () => {
    const mapped = mapMessage({ id: 'm', conversationId: 'c', seq: 3, senderId: '9007199254740993', clientMsgId: 'client', kind: 'file', content: { asset: { assetId: 'asset', fileName: 'a.mp4', byteSize: 1, mimeType: 'video/mp4' } }, createdAt: '2026-07-22T00:00:00Z', editedAt: '2026-07-22T00:05:00Z' });
    expect(mapped.sender.id).toBe('9007199254740993');
    expect(mapped.attachment).toMatchObject({ assetId: 'asset', mimeType: 'video/mp4' });
    expect(mapped.editedAt).toBe('2026-07-22T00:05:00Z');
  });

  it('keeps every explicit membership for one directory user', () => {
    expect(mapOrgMember({ userId: 'u', displayName: 'User', avatar: '/api/v1/auth/avatars/7', email: 'user@example.test', mobile: '123', memberships: [
      { orgUnitId: 'd1', orgUnitName: 'R&D', primary: true }, { orgUnitId: 'd2', orgUnitName: 'Product', primary: false }
    ] })).toMatchObject({
      avatar: '/api/v1/auth/avatars/7', email: 'user@example.test', mobile: '123', departments: ['R&D', 'Product'], memberships: [
        { orgUnitId: 'd1', orgUnitName: 'R&D', primary: true },
        { orgUnitId: 'd2', orgUnitName: 'Product', primary: false }
      ]
    });
  });

  it('keeps card, system, and recall messages on distinct renderer branches', () => {
    const base = { id: 'm', conversationId: 'c', seq: 1, senderId: 'u', clientMsgId: 'client', createdAt: '2026-07-22T00:00:00Z' };
    expect(mapMessage({ ...base, kind: 'card', content: { card: { rendererKey: 'unknown.safe', title: 'Card', data: {} } } }).kind).toBe('card');
    expect(mapMessage({ ...base, kind: 'system', content: { systemCode: 'IM_MEMBER_JOINED', systemParams: { operator: 'Ann', targets: ['Bob'] } } })).toMatchObject({
      kind: 'system', systemCode: 'IM_MEMBER_JOINED', systemParams: { operator: 'Ann', targets: ['Bob'] }
    });
    expect(mapMessage({ ...base, kind: 'recall-tombstone', content: {} }).kind).toBe('recall');
  });

  it('keeps the raw card JSON out of the text projection for card notifications', () => {
    const rawCardJson = '{"renderer":"workflow.approval","title":"流程审批","summary":"有一条流程任务待你处理"}';
    const base = { id: '7', type: 'workflow.task.card', title: '流程审批', createdAt: '2026-07-22T00:00:00Z', readAt: null };
    // 卡片类通知：content 即卡片 JSON 载体，text 兜底须用卡片摘要而非原文
    const carded = mapNotification({
      ...base, content: rawCardJson,
      card: { rendererKey: 'workflow.approval', title: '流程审批', summary: '有一条流程任务待你处理', data: {}, actions: [] }
    }, 'notify');
    expect(carded.kind).toBe('card');
    expect(carded.text).toBe('有一条流程任务待你处理');
    expect(carded.text).not.toContain('renderer');
    // 纯文本通知：text 维持原文
    const plain = mapNotification({ ...base, type: 'jobs', content: '任务已完成', card: undefined }, 'notify');
    expect(plain.kind).toBe('system');
    expect(plain.text).toBe('任务已完成');
  });
});

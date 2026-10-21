import { describe, expect, it } from 'vitest';
import type { Conversation } from '../../domain/types';
import { conversationHeaderSubtitle } from './chat-header-model';

const labels = { online: 'Online', busy: 'Busy', connecting: 'Connecting', offline: 'Offline', department: 'Department', members: 'Members' };
const base: Conversation = {
  id: 'c', title: 'Chat', kind: 'single', summary: 'Fallback summary', updatedAt: '2026-07-22T00:00:00Z',
  unread: 0, lastSeq: 0, readSeq: 0
};

describe('conversationHeaderSubtitle', () => {
  it('projects peer presence before the single-chat summary', () => {
    expect(conversationHeaderSubtitle({ ...base, connection: 'online' }, labels)).toBe('Online');
    expect(conversationHeaderSubtitle({ ...base, connection: 'connecting' }, labels)).toBe('Connecting');
    expect(conversationHeaderSubtitle({ ...base, connection: 'offline' }, labels)).toBe('Offline');
    expect(conversationHeaderSubtitle(base, labels)).toBe('Fallback summary');
  });

  it('projects group and organization-managed department membership', () => {
    expect(conversationHeaderSubtitle({ ...base, kind: 'group', memberCount: 0 }, labels)).toBe('0 Members');
    expect(conversationHeaderSubtitle({ ...base, kind: 'department', memberCount: 23 }, labels)).toBe('Department · 23 Members');
    expect(conversationHeaderSubtitle({ ...base, kind: 'department', summary: '', memberCount: undefined }, labels)).toBe('Department');
  });

  it('keeps safe summaries for system/object conversations and omits an empty fallback', () => {
    expect(conversationHeaderSubtitle({ ...base, kind: 'system' }, labels)).toBe('Fallback summary');
    expect(conversationHeaderSubtitle({ ...base, kind: 'object', summary: 'Order #42' }, labels)).toBe('Order #42');
    expect(conversationHeaderSubtitle({ ...base, kind: 'object', summary: '   ' }, labels)).toBeUndefined();
  });
});

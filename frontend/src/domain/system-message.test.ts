import { describe, expect, it } from 'vitest';
import { formatSystemMessage } from './system-message';
import type { Message } from './types';

const t = (key: string): string => ({
  'system.memberJoined': '{operator} added {targets}',
  'system.groupRenamed': 'renamed to {name}',
  'system.groupUpdated': '{operator} updated the group',
  'system.ownerTransferred': '{from} transferred to {to}',
  'system.groupDissolved': '{operator} dissolved the group',
  'system.adminGranted': '{operator} promoted {target}',
  'system.muteAllEnabled': '{operator} enabled mute-all',
  'system.memberSendMuted': '{operator} muted {target}',
  'system.announcementPublished': '{operator} announced {text}',
  'system.someone': 'someone',
  'system.separator': ', ',
  'system.members': 'members',
  'system.group': 'group',
  'system.unknown': 'status updated'
}[key] ?? key);

function message(systemCode: string, systemParams?: Message['systemParams']): Message {
  return {
    id: 'm', conversationId: 'c', seq: 1, clientMsgId: 'client', sender: { id: 'system', name: '', departments: [] },
    kind: 'system', createdAt: '2026-07-22T00:00:00Z', systemCode, systemParams
  };
}

describe('localized system code renderer', () => {
  it('preserves and interpolates safe code parameters', () => {
    expect(formatSystemMessage(message('IM_MEMBER_JOINED', { operator: 'Ann', targets: ['Bob', 'Chen'] }), t)).toBe('Ann added Bob, Chen');
    expect(formatSystemMessage(message('IM_GROUP_INFO_UPDATED', { name: 'Platform' }), t)).toBe('renamed to Platform');
    expect(formatSystemMessage(message('IM_ADMIN_SET', { operator: 'Ann', target: 'Bob' }), t)).toBe('Ann promoted Bob');
    expect(formatSystemMessage(message('IM_GROUP_UPDATED', { newName: 'Core' }), t)).toBe('renamed to Core');
    expect(formatSystemMessage(message('IM_GROUP_INFO_UPDATED', { operatorId: 42 }), t)).toBe('42 updated the group');
    expect(formatSystemMessage(message('IM_OWNER_TRANSFERRED', { oldOwner: 'Ann', newOwner: 'Bob' }), t)).toBe('Ann transferred to Bob');
    expect(formatSystemMessage(message('IM_GROUP_DISSOLVED', { operatorId: 'Ann' }), t)).toBe('Ann dissolved the group');
    expect(formatSystemMessage(message('OWNER_TRANSFERRED', { fromUserId: 1, toUserId: 2 }), t)).toBe('1 transferred to 2');
    expect(formatSystemMessage(message('GROUP_UPDATED', { new_name: 'Infra' }), t)).toBe('renamed to Infra');
    expect(formatSystemMessage(message('GROUP_DISSOLVED', { operator: 'Ann' }), t)).toBe('Ann dissolved the group');
    expect(formatSystemMessage(message('IM_GROUP_MUTE_ALL_ENABLED', { operator: 'Ann' }), t)).toBe('Ann enabled mute-all');
    expect(formatSystemMessage(message('IM_MEMBER_SEND_MUTED', { operator: 'Ann', target: 'Bob' }), t)).toBe('Ann muted Bob');
    expect(formatSystemMessage(message('IM_ANNOUNCEMENT_PUBLISHED', { operator: 'Ann', text: 'Ship at 17:00' }), t)).toBe('Ann announced Ship at 17:00');
  });

  it('uses generic localized text for unknown codes instead of exposing raw params', () => {
    expect(formatSystemMessage(message('UNKNOWN', { html: '<img onerror=alert(1)>' }), t)).toBe('status updated');
  });
});

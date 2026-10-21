import { describe, expect, it } from 'vitest';
import type { Conversation } from '../../domain/types';
import {
  getConversationMentionSeq,
  getConversationMenuItems,
  getConversationPresence,
  getConversationPreviewSummary,
  getConversationTitleSuffix,
  type ConversationMenuLabels
} from './conversation-list-model';

const labels: ConversationMenuLabels = {
  actions: '会话操作',
  pin: '置顶',
  unpin: '取消置顶',
  mute: '免打扰',
  unmute: '取消免打扰',
  hide: '隐藏',
  mutedState: '已免打扰',
  presenceBusy: '忙碌',
  presenceOffline: '离线'
};
const base: Conversation = { id: 'c1', title: '会话', kind: 'single', summary: '', updatedAt: '2026-07-22T09:00:00.000Z', unread: 0, lastSeq: 0, readSeq: 0 };

describe('getConversationMenuItems', () => {
  it('keeps pin, mute, and hide actions for a regular conversation', () => {
    expect(getConversationMenuItems(base, labels)).toEqual([
      { action: 'pin', label: '置顶' },
      { action: 'mute', label: '免打扰' },
      { action: 'hide', label: '隐藏', tone: 'danger' }
    ]);
  });

  it('projects toggled labels and protects the system conversation', () => {
    expect(getConversationMenuItems({ ...base, kind: 'system', pinned: true, muted: true }, labels))
      .toEqual([{ action: 'pin', label: '取消置顶' }]);
  });
});

describe('getConversationMentionSeq', () => {
  it('only exposes a positive safe cursor when the server says the conversation has a mention', () => {
    expect(getConversationMentionSeq({ ...base, hasMention: true, mentionSeq: 9 })).toBe(9);
    expect(getConversationMentionSeq({ ...base, hasMention: false, mentionSeq: 9 })).toBeUndefined();
    expect(getConversationMentionSeq({ ...base, hasMention: true, mentionSeq: 0 })).toBeUndefined();
    expect(getConversationMentionSeq({ ...base, readSeq: 9, hasMention: true, mentionSeq: 9 })).toBeUndefined();
    expect(getConversationMentionSeq({ ...base, hasMention: true, mentionSeq: Number.MAX_SAFE_INTEGER + 1 })).toBeUndefined();
  });
});

describe('getConversationPresence', () => {
  it('only computes a presence state for single chats with a peerUserId', () => {
    expect(getConversationPresence({ ...base, peerUserId: 'u1', connection: 'online' })).toBe('online');
    expect(getConversationPresence({ ...base, peerUserId: 'u1', connection: 'busy' })).toBe('busy');
    // connecting / 未知一律归并为 offline（单聊状态点恒显示，不留空白态）
    expect(getConversationPresence({ ...base, peerUserId: 'u1', connection: 'connecting' })).toBe('offline');
    expect(getConversationPresence({ ...base, peerUserId: 'u1', connection: undefined })).toBe('offline');
    expect(getConversationPresence({ ...base, peerUserId: 'u1', connection: 'offline' })).toBe('offline');
    // 无 peerUserId（群聊/部门群/系统通知）恒不出状态点
    expect(getConversationPresence({ ...base, connection: 'online' })).toBeUndefined();
    expect(getConversationPresence({ ...base, kind: 'group', connection: 'online' })).toBeUndefined();
  });
});

describe('getConversationTitleSuffix', () => {
  it('appends a bracketed presence suffix only for non-online single chats', () => {
    expect(getConversationTitleSuffix({ ...base, peerUserId: 'u1', connection: 'online' }, labels)).toBe('');
    expect(getConversationTitleSuffix({ ...base, peerUserId: 'u1', connection: 'busy' }, labels)).toBe('[忙碌]');
    expect(getConversationTitleSuffix({ ...base, peerUserId: 'u1', connection: 'offline' }, labels)).toBe('[离线]');
    expect(getConversationTitleSuffix({ ...base, peerUserId: 'u1', connection: 'connecting' }, labels)).toBe('[离线]');
    // 群聊无 peerUserId，恒无后缀
    expect(getConversationTitleSuffix({ ...base, kind: 'group', connection: 'busy' }, labels)).toBe('');
  });

  // 2026-08-11 真机抓到：实例里存在标题缺失的单聊，若照追后缀会渲染成光秃秃的「[离线]」。
  // 反向断言——标题为空/纯空白时必须不追加后缀（状态改由头像状态点表达，信息不丢）。
  it('never emits a bare suffix when the conversation has no title to append to', () => {
    expect(getConversationTitleSuffix({ ...base, title: '', peerUserId: 'u1', connection: 'offline' }, labels)).toBe('');
    expect(getConversationTitleSuffix({ ...base, title: '   ', peerUserId: 'u1', connection: 'busy' }, labels)).toBe('');
    // 有标题时后缀照旧，确保守卫没有把正常场景一并掐掉
    expect(getConversationTitleSuffix({ ...base, title: 'admin3', peerUserId: 'u1', connection: 'offline' }, labels)).toBe('[离线]');
  });
});

describe('getConversationPreviewSummary', () => {
  it('projects a nonblank draft ahead of the authoritative summary without mutating the DTO', () => {
    const conversation = { ...base, summary: 'server summary' };
    expect(getConversationPreviewSummary(conversation, ' draft text ')).toEqual({ text: ' draft text ', draft: true });
    expect(conversation.summary).toBe('server summary');
    expect(getConversationPreviewSummary(conversation, '   ')).toEqual({ text: 'server summary', draft: false });
  });
});

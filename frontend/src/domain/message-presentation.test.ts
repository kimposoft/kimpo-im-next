import { describe, expect, it } from 'vitest';
import type { Message } from './types';
import { buildMessagePresentations, linkifyMessageText } from './message-presentation';

const message = (id: string, seq: number, createdAt: string): Message => ({
  id, conversationId: 'c', seq, clientMsgId: id, sender: { id: 'u', name: 'U', departments: [] },
  kind: 'text', text: 'text', createdAt
});

describe('message presentation', () => {
  it('linkifies only HTTP(S), preserves punctuation, and never creates markup', () => {
    expect(linkifyMessageText('See https://example.com/a?q=1, then http://localhost:80/x.')).toEqual([
      { kind: 'text', text: 'See ' },
      { kind: 'link', text: 'https://example.com/a?q=1', href: 'https://example.com/a?q=1' },
      { kind: 'text', text: ',' },
      { kind: 'text', text: ' then ' },
      { kind: 'link', text: 'http://localhost:80/x', href: 'http://localhost:80/x' },
      { kind: 'text', text: '.' }
    ]);
    expect(linkifyMessageText('javascript:alert(1) ftp://host/x')).toEqual([{ kind: 'text', text: 'javascript:alert(1) ftp://host/x' }]);
  });

  it('splits across significant gaps and days and suppresses grouping at dividers', () => {
    const result = buildMessagePresentations([
      message('1', 1, '2026-07-22T10:00:00Z'),
      message('2', 2, '2026-07-22T10:01:00Z'),
      message('3', 3, '2026-07-22T10:08:00Z'),
      message('4', 4, '2026-07-23T00:01:00Z')
    ], 2);
    expect(result.map(item => item.showTimeDivider)).toEqual([true, false, true, true]);
    expect(result.map(item => item.grouped)).toEqual([false, true, false, false]);
    expect(result.map(item => item.showUnreadDivider)).toEqual([false, false, true, false]);
  });

  it('places unread divider on the first loaded sequence after readSeq', () => {
    const result = buildMessagePresentations([message('9', 9, '2026-07-22T10:00:00Z'), message('10', 10, '2026-07-22T10:01:00Z')], 3);
    expect(result[0].showUnreadDivider).toBe(true);
    expect(result[1].showUnreadDivider).toBe(false);
  });

  it('uses the host timezone for calendar-day dividers across DST', () => {
    const messages = [
      message('1', 1, '2026-03-08T04:59:00Z'),
      message('2', 2, '2026-03-08T05:01:00Z')
    ];
    expect(buildMessagePresentations(messages, 2, 60 * 60_000, 'America/New_York').map(item => item.showTimeDivider)).toEqual([true, true]);
    expect(buildMessagePresentations(messages, 2, 60 * 60_000, 'Asia/Tokyo').map(item => item.showTimeDivider)).toEqual([true, false]);
  });
});

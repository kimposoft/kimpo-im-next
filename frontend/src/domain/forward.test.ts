import { describe, expect, it } from 'vitest';
import type { Message } from './types';
import { buildMergedMessagesCard, canForwardMessage, MAX_MERGED_MESSAGES, MAX_MERGED_SUMMARY, MERGED_MESSAGES_RENDERER } from './forward';

function message(seq: number, text = `message ${seq}`): Message {
  return { id: `m${seq}`, conversationId: 'c', seq, clientMsgId: `client-${seq}`, sender: { id: 'u', name: 'User', departments: [] }, kind: 'text', text, createdAt: '2026-07-22T00:00:00Z', sendState: 'sent' };
}

describe('merged-message forward contract', () => {
  it('sorts by seq, uses the fixed renderer, and caps the summary', () => {
    const card = buildMergedMessagesCard([message(2, 'x'.repeat(180)), message(1, 'first')]);
    expect(card.rendererKey).toBe(MERGED_MESSAGES_RENDERER);
    expect(card.summary!.length).toBeLessThanOrEqual(MAX_MERGED_SUMMARY);
    expect((card.data.items as Array<{ seq: number }>).map(item => item.seq)).toEqual([1, 2]);
  });

  it('emits the backend canonical merged item shape with typed msgType and bounded summaries', () => {
    const image = { ...message(2), kind: 'image' as const, text: undefined, attachment: { assetId: 'image', fileName: 'diagram.png', byteSize: 1, mimeType: 'image/png' } };
    const file = { ...message(3), kind: 'file' as const, text: undefined, attachment: { assetId: 'file', fileName: 'report.pdf', byteSize: 1, mimeType: 'application/pdf' } };
    const card = buildMergedMessagesCard([file, image, message(1, 'x'.repeat(260))]);
    const items = card.data.items as Array<Record<string, unknown>>;
    expect(card.summary!.length).toBeLessThanOrEqual(200);
    expect(items.map(item => item.seq)).toEqual([1, 2, 3]);
    expect(items.map(item => item.msgType)).toEqual([0, 1, 2]);
    for (const item of items) {
      expect(typeof item.senderName).toBe('string');
      expect(typeof item.summary).toBe('string');
      expect((item.summary as string).length).toBeLessThanOrEqual(200);
      expect(typeof item.msgType).toBe('number');
      expect(typeof item.createdAt).toBe('string');
    }
  });

  it('rejects more than 50 eligible items and excludes unsupported message kinds', () => {
    expect(() => buildMergedMessagesCard(Array.from({ length: MAX_MERGED_MESSAGES + 1 }, (_, index) => message(index + 1)))).toThrow('forward_merged_limit');
    expect(canForwardMessage({ ...message(1), kind: 'card' })).toBe(false);
    expect(canForwardMessage({ ...message(1), kind: 'system' })).toBe(false);
    expect(canForwardMessage({ ...message(1), kind: 'recall' })).toBe(false);
    expect(canForwardMessage({ ...message(1), sendState: 'failed' })).toBe(false);
  });
});

describe('localizeMergedMessagesCard (card style spec)', () => {
  it('titles the card by distinct senders and previews at most three rows', async () => {
    const { localizeMergedMessagesCard, MERGED_MESSAGES_RENDERER } = await import('./forward');
    const card = { rendererKey: MERGED_MESSAGES_RENDERER, data: { items: [
      { senderName: '王一', summary: '下周一评审改到下午', msgType: 0 },
      { senderName: '李二', summary: '', msgType: 1 },
      { senderName: '王一', summary: '好', msgType: 0 },
      { senderName: '王一', summary: '再确认', msgType: 0 }
    ] } } as never;
    const result = localizeMergedMessagesCard(card, { title: '', detailRows: [] }, 'zh-CN');
    expect(result?.title).toBe('王一和李二的聊天记录');
    expect(result?.detailRows).toEqual([
      { label: '王一', value: '下周一评审改到下午' }, { label: '李二', value: '[图片]' }, { label: '王一', value: '好' }
    ]);
    expect(result?.viewLabel).toBe('查看 4 条聊天记录');
    expect(localizeMergedMessagesCard({ rendererKey: 'todo', data: {} } as never, { title: 'x', detailRows: [] }, 'zh-CN')).toBeUndefined();
  });
});

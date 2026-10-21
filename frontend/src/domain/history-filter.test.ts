import { describe, expect, it } from 'vitest';
import { filterHistory, isFileMessage, isLinkMessage, isMediaMessage, type HistoryTab } from './history-filter';
import type { Message } from './types';

function msg(partial: Partial<Message> & Pick<Message, 'id' | 'seq' | 'kind'>): Message {
  return {
    conversationId: 'c',
    clientMsgId: partial.id,
    sender: { id: 'u1', name: '六一', departments: [] },
    createdAt: '2026-08-11T00:00:00Z',
    sendState: 'sent',
    ...partial
  } as Message;
}

const text = msg({ id: 't', seq: 1, kind: 'text', text: '周末带小孩没空给你送过来' });
const linked = msg({ id: 'l', seq: 2, kind: 'text', text: '看这个 https://example.com/doc 链接' });
const image = msg({ id: 'i', seq: 3, kind: 'image', attachment: { assetId: 'a1', fileName: '照片.png', byteSize: 1, mimeType: 'image/png' } });
const video = msg({ id: 'v', seq: 4, kind: 'file', attachment: { assetId: 'a2', fileName: '演示.mp4', byteSize: 1, mimeType: 'video/mp4' } });
const file = msg({ id: 'f', seq: 5, kind: 'file', attachment: { assetId: 'a3', fileName: '报表.xlsx', byteSize: 1, mimeType: 'application/vnd.ms-excel' } });
const recalled = msg({ id: 'r', seq: 6, kind: 'recall' });
const systemEvent = msg({ id: 's', seq: 7, kind: 'system', systemCode: 'IM_MEMBER_JOINED' });
const all = [file, text, image, recalled, video, linked, systemEvent];

describe('chat history filter', () => {
  it('classifies media, file and link messages on the WeChat-style tab semantics', () => {
    expect(isMediaMessage(image)).toBe(true);
    expect(isMediaMessage(video)).toBe(true);
    expect(isMediaMessage(file)).toBe(false);
    expect(isFileMessage(file)).toBe(true);
    expect(isFileMessage(video)).toBe(false);
    expect(isLinkMessage(linked)).toBe(true);
    expect(isLinkMessage(text)).toBe(false);
  });

  it('filters by tab, hides recall/system tombstones, and keeps seq ascending order', () => {
    const ids = (tab: HistoryTab) => filterHistory(all, tab, '').map(item => item.id);
    expect(ids('all')).toEqual(['t', 'l', 'i', 'v', 'f']);
    expect(ids('media')).toEqual(['i', 'v']);
    expect(ids('file')).toEqual(['f']);
    expect(ids('link')).toEqual(['l']);
  });

  it('keeps notification entries visible on the notifications source and hides them on messages', () => {
    const cardNotification = msg({
      id: 'n1', seq: 8, kind: 'card',
      text: '有一条流程任务待你处理',
      card: { rendererKey: 'workflow.approval', title: '流程审批', summary: '有一条流程任务待你处理', data: {}, actions: [] },
      notification: { id: '7', title: '流程审批', content: '{"renderer":"workflow.approval"}', readAt: null }
    } as never);
    const plainNotification = msg({
      id: 'n2', seq: 9, kind: 'system', text: '任务已完成',
      notification: { id: '8', title: '任务超时提醒', content: '任务已完成', readAt: null }
    } as never);
    const pool = [...all, cardNotification, plainNotification];
    // 消息源：通知条目不可见（普通会话的记录里不该混入通知）
    expect(filterHistory(pool, 'all', '', 'messages').map(item => item.id)).toEqual(['t', 'l', 'i', 'v', 'f']);
    // 通知源：通知条目可见，撤回/纯群系统事件仍隐藏
    expect(filterHistory(pool, 'all', '', 'notifications').map(item => item.id)).toEqual(['t', 'l', 'i', 'v', 'f', 'n1', 'n2']);
    // 关键词：命中通知标题；卡片 JSON 原文不可命中（content 是卡片载体）
    expect(filterHistory(pool, 'all', '超时', 'notifications').map(item => item.id)).toEqual(['n2']);
    expect(filterHistory(pool, 'all', 'renderer', 'notifications')).toEqual([]);
  });

  it('matches keyword against text, file name and sender name case-insensitively', () => {
    expect(filterHistory(all, 'all', '报表').map(item => item.id)).toEqual(['f']);
    expect(filterHistory(all, 'all', 'EXAMPLE').map(item => item.id)).toEqual(['l']);
    expect(filterHistory(all, 'media', '演示').map(item => item.id)).toEqual(['v']);
    expect(filterHistory(all, 'all', '不存在的词')).toEqual([]);
  });

  it('filters by calendar day, honoring the given timezone across the UTC midnight boundary', () => {
    // 命中日：夹具默认 createdAt 全部落在 2026-08-11（UTC）
    expect(filterHistory(all, 'all', '', 'messages', '2026-08-11', 'UTC').map(item => item.id)).toEqual(['t', 'l', 'i', 'v', 'f']);
    // 不命中日：切到另一天应全部为空
    expect(filterHistory(all, 'all', '', 'messages', '2026-08-12', 'UTC')).toEqual([]);
    // 跨时区边界：UTC 深夜（16:30）折算到 Asia/Tokyo（+9）已跨入次日 01:30
    const lateUtc = msg({ id: 'z', seq: 10, kind: 'text', text: '跨天消息', createdAt: '2026-08-10T16:30:00Z' });
    expect(filterHistory([lateUtc], 'all', '', 'messages', '2026-08-10', 'UTC').map(item => item.id)).toEqual(['z']);
    expect(filterHistory([lateUtc], 'all', '', 'messages', '2026-08-10', 'Asia/Tokyo')).toEqual([]);
    expect(filterHistory([lateUtc], 'all', '', 'messages', '2026-08-11', 'Asia/Tokyo').map(item => item.id)).toEqual(['z']);
    // 未传 day：不按日期过滤，行为与旧签名一致
    expect(filterHistory(all, 'all', '').map(item => item.id)).toEqual(['t', 'l', 'i', 'v', 'f']);
  });
});

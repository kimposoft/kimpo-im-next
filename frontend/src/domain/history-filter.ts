import type { Message } from './types';
import { linkifyMessageText } from './message-presentation';
import { imCalendarDay } from './time-format';

/**
 * 聊天记录浮层的分类/搜索过滤（2026-08-11，参考微信聊天记录页交互）。
 * 纯函数：输入已加载的消息集合，输出按分类页签与关键字过滤后的展示序列（seq 升序）。
 */
export type HistoryTab = 'all' | 'media' | 'file' | 'link';
/** 浮层数据源：普通会话=消息分页；系统通知会话=通知分页 */
export type HistorySource = 'messages' | 'notifications';

/** 图片与视频：图片消息，或附件 MIME 为 video/* 的文件消息 */
export function isMediaMessage(message: Message): boolean {
  if (message.kind === 'image') return true;
  return message.kind === 'file' && Boolean(message.attachment?.mimeType.startsWith('video/'));
}

/** 文件：排除视频（归图片与视频页签）后的附件消息 */
export function isFileMessage(message: Message): boolean {
  return message.kind === 'file' && !message.attachment?.mimeType.startsWith('video/');
}

/** 链接：文本消息且 linkify 能检出至少一段 URL（与气泡内联链接同一判定口径） */
export function isLinkMessage(message: Message): boolean {
  if (message.kind !== 'text' || !message.text) return false;
  return linkifyMessageText(message.text).some(part => part.kind === 'link');
}

/**
 * 「全部」页签的可见面：撤回墓碑与群系统事件不属于聊天记录内容。
 * 通知源（系统通知会话）保留 notification 条目——那正是它的记录本体。
 */
export function isHistoryVisible(message: Message, source: HistorySource = 'messages'): boolean {
  if (['recall', 'system'].includes(message.kind) && !message.notification) return false;
  if (source === 'messages') return !message.notification;
  return true;
}

function matchesTab(message: Message, tab: HistoryTab): boolean {
  if (tab === 'media') return isMediaMessage(message);
  if (tab === 'file') return isFileMessage(message);
  if (tab === 'link') return isLinkMessage(message);
  return true;
}

function matchesKeyword(message: Message, keyword: string): boolean {
  if (!keyword) return true;
  const needle = keyword.toLocaleLowerCase();
  // 卡片类通知的 notification.content 是卡片 JSON 载体（禁止参与匹配防 JSON 命中），
  // 用卡片摘要/标题替代；纯文本通知 content 正常参与。
  const notificationContent = message.notification
    ? (message.card ? message.card.summary ?? message.card.title : message.notification.content)
    : undefined;
  return [
    message.text, message.attachment?.fileName, message.card?.title, message.card?.summary,
    message.sender.name, message.notification?.title, notificationContent
  ].some(value => value?.toLocaleLowerCase().includes(needle));
}

/**
 * 日期筛选（2026-08-11）：day 为 'YYYY-MM-DD' 日历日，未传时不按日期过滤。
 * "哪一天"一律走 imCalendarDay 折算宿主时区后的日历日，禁止用 UTC 截断，
 * 否则夜间消息在东八区/日本等时区会被错分到前一天。
 */
function matchesDay(message: Message, day: string | undefined, timezone: string | undefined): boolean {
  if (!day) return true;
  return imCalendarDay(message.createdAt, timezone ?? 'UTC') === day;
}

export function filterHistory(
  messages: readonly Message[],
  tab: HistoryTab,
  keyword: string,
  source: HistorySource = 'messages',
  day?: string,
  timezone?: string
): Message[] {
  const trimmed = keyword.trim();
  return messages
    .filter(
      message =>
        isHistoryVisible(message, source) &&
        matchesTab(message, tab) &&
        matchesKeyword(message, trimmed) &&
        matchesDay(message, day, timezone)
    )
    .sort((a, b) => a.seq - b.seq);
}

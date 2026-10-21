import type { NahidaBusinessCard, NahidaJsonObject } from '@kimposoft/plugin-sdk/nahida-im';
import type { Message } from './types';

export const MERGED_MESSAGES_RENDERER = 'im.merged_messages';
export const MAX_MERGED_MESSAGES = 50;
export const MAX_MERGED_SUMMARY = 200;

function mergedMessageType(message: Message): 0 | 1 | 2 {
  if (message.kind === 'image') return 1;
  if (message.kind === 'file') return 2;
  return 0;
}

export function canForwardMessage(message: Message): boolean {
  return !message.notification && ['text', 'image', 'file'].includes(message.kind) && message.sendState === 'sent';
}

export function buildMergedMessagesCard(messages: readonly Message[]): NahidaBusinessCard {
  const ordered = [...messages].filter(canForwardMessage).sort((a, b) => a.seq - b.seq);
  if (!ordered.length) throw new Error('forward_no_eligible_messages');
  if (ordered.length > MAX_MERGED_MESSAGES) throw new Error('forward_merged_limit');
  const items = ordered.map(message => ({
    conversationId: message.conversationId,
    seq: message.seq,
    senderId: message.sender.id,
    senderName: message.sender.name,
    summary: (message.text ?? message.attachment?.fileName ?? '').slice(0, MAX_MERGED_SUMMARY),
    msgType: mergedMessageType(message),
    createdAt: message.createdAt
  })) as unknown as NahidaJsonObject[];
  const summary = ordered.map(message => `${message.sender.name}: ${message.text ?? message.attachment?.fileName ?? ''}`)
    .join(' · ').slice(0, MAX_MERGED_SUMMARY);
  return {
    rendererKey: MERGED_MESSAGES_RENDERER,
    summary,
    data: { items }
  };
}

export type MergedCardLocale = 'zh-CN' | 'zh-TW' | 'en-US' | 'ja-JP';
const MAX_MERGED_PREVIEW_ROWS = 3;

/**
 * 合并转发卡的展示本地化（卡片样式规范第五节）：标题「A和B的聊天记录」、前三条摘要进明细井、
 * 查看按钮带条数。纯展示：只读 data.items，不改后端载荷；items 非法时退回原模型。
 */
export function localizeMergedMessagesCard(
  card: Readonly<Pick<NahidaBusinessCard, 'rendererKey' | 'data'>>,
  model: { readonly title: string; readonly detailRows: readonly { label: string; value: string }[] },
  locale: MergedCardLocale
): { title: string; detailRows: readonly { label: string; value: string }[]; viewLabel: string } | undefined {
  if (card.rendererKey !== MERGED_MESSAGES_RENDERER) return undefined;
  const items = Array.isArray((card.data as { items?: unknown }).items) ? (card.data as { items: unknown[] }).items : [];
  const rows = items.flatMap(item => {
    if (!item || typeof item !== 'object') return [];
    const { senderName, summary, msgType } = item as { senderName?: unknown; summary?: unknown; msgType?: unknown };
    const name = typeof senderName === 'string' ? senderName.trim() : '';
    const typeText = msgType === 1
      ? { 'zh-CN': '[图片]', 'zh-TW': '[圖片]', 'en-US': '[Image]', 'ja-JP': '[画像]' }[locale]
      : msgType === 2 ? { 'zh-CN': '[文件]', 'zh-TW': '[檔案]', 'en-US': '[File]', 'ja-JP': '[ファイル]' }[locale] : '';
    const text = (typeof summary === 'string' ? summary.trim() : '') || typeText;
    return name && text ? [{ label: name, value: text }] : [];
  });
  const names = [...new Set(rows.map(row => row.label))];
  const joined = names.slice(0, 2).join({ 'zh-CN': '和', 'zh-TW': '和', 'en-US': ' and ', 'ja-JP': 'と' }[locale]);
  const suffix = names.length > 2 ? ({ 'zh-CN': '等', 'zh-TW': '等', 'en-US': ' et al.', 'ja-JP': 'など' } as const)[locale] : '';
  const title = names.length
    ? ({ 'zh-CN': `${joined}${suffix}的聊天记录`, 'zh-TW': `${joined}${suffix}的聊天記錄`, 'en-US': `Chat history of ${joined}${suffix}`, 'ja-JP': `${joined}${suffix}のチャット履歴` } as const)[locale]
    : model.title || ({ 'zh-CN': '聊天记录', 'zh-TW': '聊天記錄', 'en-US': 'Chat history', 'ja-JP': 'チャット履歴' } as const)[locale];
  const count = rows.length;
  const viewLabel = ({
    'zh-CN': `查看 ${count} 条聊天记录`, 'zh-TW': `查看 ${count} 則聊天記錄`,
    'en-US': count === 1 ? 'View 1 message' : `View ${count} messages`, 'ja-JP': `${count} 件のチャット履歴を見る`
  } as const)[locale];
  return { title, detailRows: rows.slice(0, MAX_MERGED_PREVIEW_ROWS), viewLabel };
}

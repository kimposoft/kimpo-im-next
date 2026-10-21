import { isGroupedWithPrevious } from './rules';
import type { Message } from './types';
import { imCalendarDay } from './time-format';

export interface MessageTextPart {
  kind: 'text' | 'link';
  text: string;
  href?: string;
}

export interface MessagePresentation {
  grouped: boolean;
  showTimeDivider: boolean;
  showUnreadDivider: boolean;
}

const URL_PATTERN = /https?:\/\/[^\s<>]+/giu;
const TRAILING_PUNCTUATION = /[),.!?;:\]，。！？；：、]+$/u;

export function linkifyMessageText(text: string): MessageTextPart[] {
  const parts: MessageTextPart[] = [];
  let cursor = 0;
  for (const match of text.matchAll(URL_PATTERN)) {
    const index = match.index ?? 0;
    if (index > cursor) parts.push({ kind: 'text', text: text.slice(cursor, index) });
    const raw = match[0];
    const href = raw.replace(TRAILING_PUNCTUATION, '');
    let safe = false;
    try {
      const parsed = new URL(href);
      safe = parsed.protocol === 'http:' || parsed.protocol === 'https:';
    } catch { safe = false; }
    if (safe && href) parts.push({ kind: 'link', text: href, href });
    else parts.push({ kind: 'text', text: href || raw });
    const trailing = raw.slice(href.length);
    if (trailing) parts.push({ kind: 'text', text: trailing });
    cursor = index + raw.length;
  }
  if (cursor < text.length) parts.push({ kind: 'text', text: text.slice(cursor) });
  return parts.length ? parts : [{ kind: 'text', text }];
}

export function buildMessagePresentations(messages: readonly Message[], readSeq: number, gapMs = 5 * 60_000, timezone = 'UTC'): MessagePresentation[] {
  let unreadPlaced = false;
  return messages.map((message, index) => {
    const previous = messages[index - 1];
    const elapsed = previous ? Date.parse(message.createdAt) - Date.parse(previous.createdAt) : Number.POSITIVE_INFINITY;
    const showTimeDivider = !previous || imCalendarDay(previous.createdAt, timezone) !== imCalendarDay(message.createdAt, timezone)
      || !Number.isFinite(elapsed) || elapsed >= gapMs;
    const showUnreadDivider = !unreadPlaced && message.seq > readSeq;
    if (showUnreadDivider) unreadPlaced = true;
    return {
      showTimeDivider,
      showUnreadDivider,
      grouped: !showTimeDivider && !showUnreadDivider && isGroupedWithPrevious(previous, message)
    };
  });
}

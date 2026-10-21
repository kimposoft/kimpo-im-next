/** All IM timestamps are rendered in the host-provided IANA timezone, never the browser default. */
export function normalizeIanaTimezone(timezone: string | undefined): string {
  const candidate = timezone?.trim() || 'UTC';
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: candidate }).format(0);
    return candidate;
  } catch {
    return 'UTC';
  }
}

function validDate(timestamp: string): Date | undefined {
  const date = new Date(timestamp);
  return Number.isFinite(date.getTime()) ? date : undefined;
}

export function formatImClock(timestamp: string, timezone: string, locale: string): string {
  const date = validDate(timestamp);
  if (!date) return timestamp;
  return new Intl.DateTimeFormat(locale, {
    timeZone: normalizeIanaTimezone(timezone), hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).format(date);
}

export function formatImDivider(timestamp: string, timezone: string, locale: string): string {
  const date = validDate(timestamp);
  if (!date) return timestamp;
  return new Intl.DateTimeFormat(locale, {
    timeZone: normalizeIanaTimezone(timezone), month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).format(date);
}

export function imCalendarDay(timestamp: string, timezone: string): string {
  const date = validDate(timestamp);
  if (!date) return timestamp;
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: normalizeIanaTimezone(timezone), year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find(part => part.type === type)?.value || '';
  return `${value('year')}-${value('month')}-${value('day')}`;
}

/**
 * 需求7：判断两个 ISO 时刻是否落在同一个宿主时区日历日——纯函数，"当前时间"必须由调用方
 * 以显式参数传入（绝不在函数内部 new Date()），保证跨时区边界可以稳定单测、不依赖系统时钟。
 * 折算复用 imCalendarDay，与分隔线其余渲染路径同源，避免"当天判定"和"分隔线文案"走两套算法而错位。
 */
export function isImSameCalendarDay(a: string, b: string, timezone: string): boolean {
  return imCalendarDay(a, timezone) === imCalendarDay(b, timezone);
}

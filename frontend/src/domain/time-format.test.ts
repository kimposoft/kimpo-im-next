import { describe, expect, it } from 'vitest';
import { formatImClock, imCalendarDay, isImSameCalendarDay, normalizeIanaTimezone } from './time-format';

describe('host IANA timezone formatting', () => {
  it('renders Asia/Tokyo independently of the browser timezone', () => {
    expect(formatImClock('2026-07-22T00:05:00Z', 'Asia/Tokyo', 'en-US')).toBe('09:05');
    expect(imCalendarDay('2026-07-21T16:00:00Z', 'Asia/Tokyo')).toBe('2026-07-22');
  });

  it('honors America/New_York DST spring-forward and calendar boundaries', () => {
    expect(formatImClock('2026-03-08T06:30:00Z', 'America/New_York', 'en-US')).toBe('01:30');
    expect(formatImClock('2026-03-08T07:30:00Z', 'America/New_York', 'en-US')).toBe('03:30');
    expect(imCalendarDay('2026-03-08T04:30:00Z', 'America/New_York')).toBe('2026-03-07');
    expect(imCalendarDay('2026-03-08T05:30:00Z', 'America/New_York')).toBe('2026-03-08');
  });

  it('falls back to UTC for an invalid host value', () => {
    expect(normalizeIanaTimezone('Browser/Local')).toBe('UTC');
    expect(formatImClock('2026-07-22T00:05:00Z', 'Browser/Local', 'en-US')).toBe('00:05');
  });
});

// 需求7：聊天分隔线"当天"判据；"现在"由调用方注入而非函数内部取，见 time-format.ts 的注释。
describe('isImSameCalendarDay', () => {
  it('is true when two instants land in the same host-timezone calendar day', () => {
    expect(isImSameCalendarDay('2026-08-11T09:00:00Z', '2026-08-11T09:30:00Z', 'Asia/Shanghai')).toBe(true);
  });

  it('is false once the later instant crosses into the next host-timezone calendar day', () => {
    // 09:00Z→17:00 上海时间(11日)，16:05Z→次日 00:05 上海时间(12日)，跨零点
    expect(isImSameCalendarDay('2026-08-11T09:00:00Z', '2026-08-11T16:05:00Z', 'Asia/Shanghai')).toBe(false);
  });

  it('classifies the same pair of UTC instants differently across timezones (calendar-day boundary)', () => {
    // 15:30Z/17:30Z 这一对时刻：上海(+8)已跨过零点分属 11日/12日；纽约(EDT −4)仍同属 11日。
    expect(isImSameCalendarDay('2026-08-11T15:30:00Z', '2026-08-11T17:30:00Z', 'Asia/Shanghai')).toBe(false);
    expect(isImSameCalendarDay('2026-08-11T15:30:00Z', '2026-08-11T17:30:00Z', 'America/New_York')).toBe(true);
  });
});

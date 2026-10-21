import { describe, expect, it } from 'vitest';
import {
  dndDraft,
  dndPreferenceInput,
  enforceCategoryPreference,
  notificationCategories,
  validateDndPreference
} from './notification-preference-model';

describe('notification preference model', () => {
  it('covers the five authoritative notification categories', () => {
    expect(notificationCategories).toEqual(['chat', 'todo', 'mention', 'announcement', 'system']);
  });

  it('validates enabled DND times and an IANA timezone', () => {
    const base = { enabled: true, startTime: '22:00', endTime: '08:00', timezone: 'Asia/Tokyo', urgentBypassDnd: true };
    expect(validateDndPreference(base)).toBeUndefined();
    expect(validateDndPreference({ ...base, startTime: '' })).toBe('time-required');
    expect(validateDndPreference({ ...base, endTime: '22:00' })).toBe('time-same');
    expect(validateDndPreference({ ...base, timezone: '' })).toBe('timezone-required');
    expect(validateDndPreference({ ...base, timezone: 'Tokyo' })).toBe('timezone-invalid');
  });

  it('round-trips nullable times without recalculating delivery semantics', () => {
    const draft = dndDraft({ enabled: false, startTime: null, endTime: null, timezone: 'UTC', urgentBypassDnd: false });
    expect(dndPreferenceInput(draft)).toEqual({ enabled: false, startTime: null, endTime: null, timezone: 'UTC', urgentBypassDnd: false });
  });

  it('cannot disable mandatory todo or system in-app delivery', () => {
    expect(enforceCategoryPreference('todo', { inApp: false, mail: true, sms: false })).toEqual({ inApp: true, mail: true, sms: false });
    expect(enforceCategoryPreference('system', { inApp: false, mail: false, sms: true }).inApp).toBe(true);
    expect(enforceCategoryPreference('chat', { inApp: false, mail: true, sms: false }).inApp).toBe(false);
  });
});

import type {
  NahidaCategoryPreference,
  NahidaDndPreference,
  NahidaNotificationCategory
} from '@kimposoft/plugin-sdk/nahida-im';

export const notificationCategories = ['chat', 'todo', 'mention', 'announcement', 'system'] as const satisfies readonly NahidaNotificationCategory[];
export const notificationChannels = ['inApp', 'mail', 'sms'] as const satisfies readonly (keyof NahidaCategoryPreference)[];
export type NotificationChannel = typeof notificationChannels[number];

export interface DndPreferenceDraft {
  enabled: boolean;
  startTime: string;
  endTime: string;
  timezone: string;
  urgentBypassDnd: boolean;
}

export type DndValidationError = 'time-required' | 'time-same' | 'timezone-required' | 'timezone-invalid';

export function dndDraft(preference: NahidaDndPreference): DndPreferenceDraft {
  return {
    enabled: preference.enabled,
    startTime: preference.startTime ?? '',
    endTime: preference.endTime ?? '',
    timezone: preference.timezone,
    urgentBypassDnd: preference.urgentBypassDnd
  };
}

export function validateDndPreference(draft: DndPreferenceDraft): DndValidationError | undefined {
  if (!draft.timezone.trim()) return 'timezone-required';
  try { new Intl.DateTimeFormat('en-US', { timeZone: draft.timezone.trim() }).format(); }
  catch { return 'timezone-invalid'; }
  if (!draft.enabled) return undefined;
  if (!draft.startTime || !draft.endTime) return 'time-required';
  if (draft.startTime === draft.endTime) return 'time-same';
  return undefined;
}

export function dndPreferenceInput(draft: DndPreferenceDraft): NahidaDndPreference {
  return {
    enabled: draft.enabled,
    startTime: draft.startTime || null,
    endTime: draft.endTime || null,
    timezone: draft.timezone.trim(),
    urgentBypassDnd: draft.urgentBypassDnd
  };
}

export function requiresInApp(category: NahidaNotificationCategory): boolean {
  return category === 'todo' || category === 'system';
}

/** Keeps mandatory in-app delivery true even if a stale UI event tries to turn it off. */
export function enforceCategoryPreference(
  category: NahidaNotificationCategory,
  preference: NahidaCategoryPreference
): NahidaCategoryPreference {
  return requiresInApp(category) ? { ...preference, inApp: true } : { ...preference };
}

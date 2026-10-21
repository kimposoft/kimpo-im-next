import { describe, expect, it } from 'vitest';
import { createDemoHarness } from '../../fixtures/demo';

describe('notification preference demo fixture', () => {
  it('stores DND and category writes for standalone verification', async () => {
    const harness = createDemoHarness();
    const preferences = harness.host.im!.preferences;
    await preferences.updateDnd({ enabled: true, startTime: '22:00', endTime: '08:00', timezone: 'Asia/Tokyo', urgentBypassDnd: false });
    await preferences.updateCategoryPrefs('chat', { inApp: true, mail: true, sms: false });

    expect(harness.dndPreferenceUpdates).toEqual([
      { enabled: true, startTime: '22:00', endTime: '08:00', timezone: 'Asia/Tokyo', urgentBypassDnd: false }
    ]);
    expect(harness.categoryPreferenceUpdates).toEqual([
      { category: 'chat', prefs: { inApp: true, mail: true, sms: false } }
    ]);
    expect(await preferences.getDnd()).toMatchObject({ enabled: true, timezone: 'Asia/Tokyo' });
    expect((await preferences.getCategoryPrefs()).chat.mail).toBe(true);
  });
});

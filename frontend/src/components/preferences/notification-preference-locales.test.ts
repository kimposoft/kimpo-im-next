import { describe, expect, it } from 'vitest';
import en from '../../../locales/en-US.json';
import zh from '../../../locales/zh-CN.json';

describe('notification preference locales', () => {
  it('keeps notification settings labels present with full locale parity', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(zh).sort());
    for (const key of [
      'preference.title', 'preference.dnd', 'preference.timezone', 'preference.urgentBypassDnd',
      'preference.inApp', 'preference.mail', 'preference.sms', 'preference.category.system'
    ]) {
      expect(en[key as keyof typeof en]).toBeTruthy();
      expect(zh[key as keyof typeof zh]).toBeTruthy();
    }
  });
});

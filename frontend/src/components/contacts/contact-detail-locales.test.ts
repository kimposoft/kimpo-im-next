import { describe, expect, it } from 'vitest';
import en from '../../../locales/en-US.json';
import zh from '../../../locales/zh-CN.json';

describe('contact detail locales', () => {
  it('keeps English and Chinese keys in exact parity', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(zh).sort());
    for (const key of [
      'contact.detailTitle', 'contact.userId', 'contact.email', 'contact.phone',
      'contact.departments', 'contact.primaryDepartment', 'contact.sendMessage',
      'contact.departmentGroups', 'contact.ordinaryGroups', 'contact.groupDetailTitle',
      'contact.departmentGroupRule', 'contact.ordinaryGroupRule', 'contact.enterGroup', 'message.edited'
    ]) {
      expect(zh[key as keyof typeof zh]).toBeTruthy();
      expect(en[key as keyof typeof en]).toBeTruthy();
    }
  });
});

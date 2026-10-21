import { describe, expect, it } from 'vitest';
import { buildContactDetailViewModel, contactDetailFromUser, type ContactDetailLabels } from './contact-detail-model';

const labels: ContactDetailLabels = {
  title: 'Contact details',
  close: 'Close',
  userId: 'User ID',
  email: 'Email',
  phone: 'Phone',
  departments: 'Departments',
  primaryDepartment: 'Primary',
  sendMessage: 'Message'
};

describe('buildContactDetailViewModel', () => {
  it('keeps every valid department path and primary marker', () => {
    const view = buildContactDetailViewModel({
      userId: 'u-42',
      displayName: ' Ada ',
      email: ' ada@example.test ',
      phone: ' 123 ',
      departments: [
        { id: 'research', path: ['Company', 'Research'], primary: true },
        { id: 'platform', path: 'Company / Platform' }
      ]
    }, labels);

    expect(view.displayName).toBe('Ada');
    expect(view.rows).toEqual([
      { key: 'userId', label: 'User ID', value: 'u-42' },
      { key: 'email', label: 'Email', value: 'ada@example.test' },
      { key: 'phone', label: 'Phone', value: '123' }
    ]);
    expect(view.departments).toEqual([
      { id: 'research', path: 'Company / Research', primary: true },
      { id: 'platform', path: 'Company / Platform', primary: false }
    ]);
  });

  it('safely omits absent optional fields and empty department paths', () => {
    const view = buildContactDetailViewModel({
      userId: 'fallback-id',
      displayName: '   ',
      email: ' ',
      departments: [{ id: 'empty', path: [' ', ''] }]
    }, labels);

    expect(view.displayName).toBe('fallback-id');
    expect(view.rows).toEqual([{ key: 'userId', label: 'User ID', value: 'fallback-id' }]);
    expect(view.departments).toEqual([]);
  });

  it('uses only the membership name supplied by the directory contract', () => {
    expect(contactDetailFromUser({
      id: 'u-1', name: 'User', email: 'user@example.test', mobile: '123', departments: ['Research'], memberships: [
        { orgUnitId: 'd-research', orgUnitName: 'Research', primary: true },
        { orgUnitId: 'd-unknown', primary: false }
      ]
    })).toEqual({
      userId: 'u-1', displayName: 'User', avatar: undefined, email: 'user@example.test', phone: '123', departments: [
        { id: 'd-research', path: 'Research', primary: true },
        { id: 'd-unknown', path: 'd-unknown', primary: false }
      ]
    });
  });
});

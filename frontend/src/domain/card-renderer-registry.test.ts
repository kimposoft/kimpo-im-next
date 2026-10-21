import { describe, expect, it } from 'vitest';
import type { BusinessCard } from './types';
import {
  buildCardDisplayModel,
  isKnownCardRenderer,
  normalizeSafeCardLink,
  registerBusinessCardRenderer
} from './card-renderer-registry';

function card(overrides: Partial<BusinessCard> = {}): BusinessCard {
  return {
    rendererKey: 'workflow.approval',
    title: 'Expense approval',
    summary: 'Please review',
    state: 'pending',
    actions: [{ key: 'forward', label: 'Forward', style: 'primary' }],
    data: {},
    ...overrides
  };
}

describe('business card renderer registry', () => {
  it('normalizes the built-in aliases and keeps action keys data-driven', () => {
    for (const rendererKey of ['approval', 'workflow.approval', 'workflow.approval_card', 'todo']) {
      const model = buildCardDisplayModel(card({ rendererKey }), { actionSource: 'nahida-notification' });
      expect(model.supported).toBe(true);
      expect(model.variant).toBe(rendererKey === 'todo' ? 'todo' : 'approval');
      expect(model.actions).toEqual([expect.objectContaining({ key: 'forward', disabled: false, blockReason: 'allowed' })]);
    }
  });

  it('models merged cards as local read-only views, never IM card actions', () => {
    const model = buildCardDisplayModel(card({
      rendererKey: 'im.merged_messages',
      actions: [{ key: 'unexpected', label: 'Unexpected' }]
    }), { actionSource: 'none' });
    expect(model.variant).toBe('merged');
    expect(model.localView).toBe('merged');
    expect(model.actions[0]).toMatchObject({ disabled: true, blockReason: 'renderer-readonly' });
  });

  it('fails closed for unknown renderers, regular messages, settled cards and busy actions', () => {
    expect(buildCardDisplayModel(card({ rendererKey: 'unknown' }), { actionSource: 'nahida-notification' }).actions[0])
      .toMatchObject({ disabled: true, blockReason: 'unsupported-renderer' });
    expect(buildCardDisplayModel(card(), { actionSource: 'none' }).actions[0])
      .toMatchObject({ disabled: true, blockReason: 'not-notification' });
    expect(buildCardDisplayModel(card({ state: 'done' }), { actionSource: 'nahida-notification' }).actions[0])
      .toMatchObject({ disabled: true, blockReason: 'not-pending' });
    expect(buildCardDisplayModel(card(), { actionSource: 'nahida-notification', busy: true }).actions[0])
      .toMatchObject({ disabled: true, blockReason: 'busy' });
  });

  it('honors declared disabled and rejects malformed or duplicated action keys', () => {
    const model = buildCardDisplayModel(card({ actions: [
      { key: 'disabled', label: 'Disabled', disabled: true },
      { key: 'bad key', label: 'Bad' },
      { key: 'disabled', label: 'Duplicate' }
    ] }), { actionSource: 'nahida-notification' });
    expect(model.actions).toHaveLength(2);
    expect(model.actions[0]).toMatchObject({ blockReason: 'declared-disabled', disabled: true });
    expect(model.actions[1]).toMatchObject({ blockReason: 'invalid-action', disabled: true });
  });

  it('allows only app-relative and http(s) links', () => {
    expect(normalizeSafeCardLink('/workflow/tasks/1')).toBe('/workflow/tasks/1');
    expect(normalizeSafeCardLink('https://example.com/a')).toBe('https://example.com/a');
    expect(normalizeSafeCardLink('http://example.com')).toBe('http://example.com/');
    expect(normalizeSafeCardLink('//evil.example/a')).toBeUndefined();
    expect(normalizeSafeCardLink('javascript:alert(1)')).toBeUndefined();
    expect(normalizeSafeCardLink('data:text/html,x')).toBeUndefined();
    expect(normalizeSafeCardLink('relative/path')).toBeUndefined();
  });

  it('registers sanitized presentation-only extensions without overriding known keys', () => {
    const unregister = registerBusinessCardRenderer({
      rendererKey: 'crm.customer',
      allowNahidaActions: true,
      buildDisplay: () => ({
        title: '<b>Customer</b>',
        summary: 'Summary',
        detailRows: [{ label: 'Code', value: 'A-1' }, { label: '', value: 'ignored' }],
        link: 'file:///etc/passwd'
      })
    });
    expect(isKnownCardRenderer('crm.customer')).toBe(true);
    const model = buildCardDisplayModel(card({ rendererKey: 'crm.customer' }), { actionSource: 'nahida-notification' });
    expect(model).toMatchObject({ variant: 'extension', title: '<b>Customer</b>', safeLink: undefined });
    expect(model.detailRows).toEqual([{ label: 'Code', value: 'A-1' }]);
    expect(model.actions[0]).toMatchObject({ disabled: false, blockReason: 'allowed' });
    expect(() => registerBusinessCardRenderer({ rendererKey: 'crm.customer', buildDisplay: () => ({}) })).toThrow('card_renderer_already_registered');
    expect(() => registerBusinessCardRenderer({ rendererKey: 'approval', buildDisplay: () => ({}) })).toThrow('card_renderer_already_registered');
    unregister();
    expect(isKnownCardRenderer('crm.customer')).toBe(false);
  });

  it('turns extension failures into an explicit fallback', () => {
    const unregister = registerBusinessCardRenderer({ rendererKey: 'broken.renderer', buildDisplay: () => { throw new Error('boom'); } });
    const model = buildCardDisplayModel(card({ rendererKey: 'broken.renderer' }), { actionSource: 'nahida-notification' });
    expect(model).toMatchObject({ supported: false, variant: 'fallback' });
    expect(model.actions[0]).toMatchObject({ disabled: true, blockReason: 'unsupported-renderer' });
    unregister();
  });
});

describe('card tone (card style spec)', () => {
  it('maps released edit requests to success, todo to warning, merged/fallback to neutral', () => {
    const tone = (rendererKey: string) => buildCardDisplayModel({ rendererKey, actions: [], data: {} } as never, { actionSource: 'none' }).tone;
    expect(tone('workflow.approval')).toBe('brand');
    expect(tone('edit_request.template')).toBe('brand');
    expect(tone('edit_request.released.template')).toBe('success');
    expect(tone('todo')).toBe('warning');
    expect(tone('im.merged_messages')).toBe('neutral');
    expect(tone('nobody.registered.this')).toBe('neutral');
  });
});

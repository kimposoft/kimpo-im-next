import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const source = readFileSync(fileURLToPath(new URL('./ImBusinessCard.vue', import.meta.url)), 'utf8');

describe('ImBusinessCard safety boundary', () => {
  it('renders only interpolated model fields and never dynamic HTML or components', () => {
    expect(source).not.toContain('v-html');
    expect(source).not.toContain('<component');
    expect(source).not.toContain('eval(');
    expect(source).toContain('{{ model.title || untitledLabel }}');
    expect(source).toContain('{{ model.summary || noSummaryLabel }}');
  });

  it('emits an action only after the normalized permission model allows it', () => {
    expect(source).toContain("!action.disabled && action.blockReason === 'allowed'");
    expect(source).toContain("emit('action', action)");
    expect(source).toContain(':data-block-reason="action.blockReason"');
  });

  it('uses anchors only for sanitized external links and delegates internal navigation', () => {
    expect(source).toContain("model.safeLink && externalLink");
    expect(source).toContain(':href="model.safeLink"');
    expect(source).toContain("'noopener noreferrer'");
    expect(source).toContain("emit('view', internalLink)");
    expect(source).not.toContain('window.open');
    expect(source).not.toContain('window.location');
  });
});

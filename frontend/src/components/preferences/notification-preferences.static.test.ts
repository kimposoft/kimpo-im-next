import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const component = readFileSync(new URL('./ImNotificationPreferences.vue', import.meta.url), 'utf8');

describe('notification preferences component contract', () => {
  it('loads both authoritative preference resources in parallel and refetches after failures', () => {
    expect(component).toContain('await Promise.all([');
    expect(component).toContain('props.client.getDnd()');
    expect(component).toContain('props.client.getCategoryPrefs()');
    expect(component).toContain('await props.client.updateDnd(');
    expect(component).toContain('await props.client.updateCategoryPrefs(category, next)');
    expect(component.match(/await loadPreferences\(\);/g)).toHaveLength(2);
  });

  it('keeps mandatory channels disabled and enforced in the submitted value', () => {
    expect(component).toContain("channel === 'inApp' && requiresInApp(category)");
    expect(component).toContain('enforceCategoryPreference(category, { ...current, [channel]: value })');
    expect(component).toContain('type="time"');
    expect(component).toContain('v-model="dnd.timezone"');
  });

  it('uses accessible dialog/focus semantics without HTML injection or naked transport calls', () => {
    expect(component).toContain('role="dialog"');
    expect(component).toContain('@keydown.esc.stop.prevent');
    expect(component).toContain('@keydown.tab="trapFocus"');
    expect(component).toContain('onBeforeUnmount(() => props.returnFocus?.focus())');
    expect(component).not.toContain('v-html');
    expect(component).not.toMatch(/fetch\(|axios|\/api\//);
  });
});

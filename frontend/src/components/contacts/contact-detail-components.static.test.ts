import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const component = readFileSync(new URL('./ImContactDetailDialog.vue', import.meta.url), 'utf8');

describe('ImContactDetailDialog structure', () => {
  it('renders the complete contact card from model and caller labels', () => {
    expect(component).toContain(':src="contact.avatar"');
    expect(component).toContain('view.displayName');
    expect(component).toContain('v-for="row in view.rows"');
    expect(component).toContain('v-for="department in view.departments"');
    expect(component).toContain('labels.primaryDepartment');
    expect(component).toContain("emit('send-message', props.contact.userId)");
  });

  it('owns dialog keyboard semantics and exposes focus lifecycle hooks', () => {
    expect(component).toContain('role="dialog"');
    expect(component).toContain('aria-modal="true"');
    expect(component).toContain('@keydown.esc.stop.prevent');
    expect(component).toContain('@keydown.tab="keepFocusInside"');
    expect(component).toContain("@click.self=\"requestClose('backdrop')\"");
    expect(component).toContain('onMounted(() => void nextTick(focusInitial))');
    expect(component).toContain('onBeforeUnmount');
    expect(component).toContain('defineExpose({ focusInitial, restoreFocus })');
    expect(component).toContain('<footer v-if="canSendMessage"');
  });

  it('does not call SDK, routing or embed localized system copy', () => {
    expect(component).not.toMatch(/hostBridge|router|route|sdk/i);
    expect(component).not.toMatch(/[\u4e00-\u9fff]/);
    expect(component).not.toMatch(/>\s*(Contact|Close|User ID|Email|Phone|Departments|Primary|Message)\s*</);
  });
});

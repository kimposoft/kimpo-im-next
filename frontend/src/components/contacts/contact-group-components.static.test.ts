import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const sections = readFileSync(new URL('./ImContactGroupSections.vue', import.meta.url), 'utf8');
const detail = readFileSync(new URL('./ImGroupDetailDialog.vue', import.meta.url), 'utf8');
const panel = readFileSync(new URL('../../ImNextPanel.vue', import.meta.url), 'utf8');

describe('contact group projection and detail components', () => {
  it('renders independent department and ordinary sections with loading, error and empty states', () => {
    for (const token of ["status === 'loading'", "status === 'error'", 'emptyDepartment', 'emptyOrdinary', 'departmentGroups', 'ordinaryGroups']) {
      expect(sections).toContain(token);
    }
    expect(panel).toContain("item.kind === 'department' && !item.hidden");
    expect(panel).toContain("item.kind === 'group' && !item.hidden");
    expect(panel).not.toContain('contactDepartmentGroups = computed(() => c.contacts');
    expect(sections).toContain("group.currentMemberSource === 'organization'");
    expect(sections).toContain("group.currentMemberSource === 'business'");
  });

  it('opens details before entering a conversation and distinguishes organization rules', () => {
    expect(detail).toContain('role="dialog"');
    expect(detail).toContain("conversation.kind === 'department'");
    expect(detail).toContain("emit('enter')");
    expect(panel).toContain('@open="openGroupDetail"');
    expect(panel).toContain('@enter="enterGroupConversation"');
    expect(panel).toContain('selectedGroupDetail.value = undefined');
  });

  it('restores trigger focus on close', () => {
    expect(detail).toContain('props.returnFocus?.focus()');
    expect(detail).toContain("event.key === 'Escape'");
    expect(detail).toContain("event.key !== 'Tab'");
    expect(detail).toContain('document.activeElement === first');
    expect(detail).toContain('document.activeElement === last');
  });
});

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const panel = readFileSync(new URL('../../ImNextPanel.vue', import.meta.url), 'utf8');
const controller = readFileSync(new URL('../../controller.ts', import.meta.url), 'utf8');
const tree = readFileSync(new URL('./ImOrganizationTree.vue', import.meta.url), 'utf8');
const node = readFileSync(new URL('./ImOrganizationTreeNode.vue', import.meta.url), 'utf8');

describe('group candidate organization tree', () => {
  it('uses the controller directory projection and lazy expansion without a new API', () => {
    expect(panel).toContain('<ImOrganizationTree');
    // presence 存储收敛（controller.directory 投影）后，模板改读投影版而非 snapshot 原始值；
    // 绑定的仍是 controller 暴露的目录数据，接线方式没变，只是字面量表达式变了。
    expect(panel).toContain('c.directory.value');
    expect(panel).toContain('await c.expandDepartment(unit)');
    expect(controller).toContain('caps.org.listDepartments(target.id)');
    expect(controller).toContain('includeChildren: false');
  });

  it('uses one roving tree focus model with complete hierarchy and keyboard semantics', () => {
    expect(tree).toContain('role="tree"');
    expect(node).toContain('role="treeitem"');
    expect(node).toContain('role="group"');
    for (const token of [':aria-level=', ':aria-expanded=', ':aria-selected=', ':tabindex=']) expect(node).toContain(token);
    for (const key of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'Enter']) expect(tree).toContain(`'${key}'`);
    expect(tree).toContain("event.key === ' '");
    expect(node).not.toContain('<button');
    expect(node).not.toContain('<input');
  });

  it('keeps search and tree visible together with de-duplicated selection', () => {
    expect(panel).toContain('groupSearchCandidates');
    expect(panel).toContain('group-directory');
    expect(panel).toContain('c.groupCandidateSelectedIds.value.has(user.id)');
    expect(controller).toContain('groupCandidateSelectedUsers.value = users');
    expect(controller).toContain('const ids = new Set(groupCandidateSelectedIds.value)');
  });

  it('disables existing members and exposes failed-node retry', () => {
    expect(panel).toContain('groupExistingMemberIds');
    expect(panel).toContain(':disabled="isGroupCandidateDisabled(user)"');
    expect(panel).toContain('groupDialogUnitErrors');
    expect(panel).toContain('@retry="retryGroupDialogUnit"');
    expect(node).toContain('data-tree-kind="retry"');
  });
});

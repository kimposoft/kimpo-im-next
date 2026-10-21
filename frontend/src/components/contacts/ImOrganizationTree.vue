<script setup lang="ts">
import { nextTick, ref, watch } from 'vue';
import type { OrgUnit, User } from '../../domain/types';
import ImOrganizationTreeNode from './ImOrganizationTreeNode.vue';

const props = withDefaults(defineProps<{
  units: readonly OrgUnit[];
  expandedIds: ReadonlySet<string>;
  label: string;
  mode?: 'browse' | 'select';
  selectedMemberIds?: ReadonlySet<string>;
  disabledMemberIds?: ReadonlySet<string>;
  errorUnitIds?: ReadonlySet<string>;
  errorLabel?: string;
  retryLabel?: string;
  /** Figma 好友页成员行在线/忙碌/离线状态文案（不传则不渲染状态行） */
  onlineLabel?: string;
  offlineLabel?: string;
  busyLabel?: string;
}>(), {
  mode: 'browse',
  selectedMemberIds: () => new Set<string>(),
  disabledMemberIds: () => new Set<string>(),
  errorUnitIds: () => new Set<string>(),
  errorLabel: '',
  retryLabel: '',
  onlineLabel: '',
  offlineLabel: '',
  busyLabel: ''
});

const emit = defineEmits<{
  toggle: [unit: OrgUnit];
  'activate-unit': [unit: OrgUnit, element: HTMLElement];
  'activate-member': [member: User, element: HTMLElement];
  retry: [unit: OrgUnit];
}>();

const tree = ref<HTMLElement>();
const focusedKey = ref('');
const selectedKey = ref('');

function firstUnitKey(): string { return props.units[0] ? `unit:${props.units[0].id}` : ''; }
function visibleItems(): HTMLElement[] {
  return tree.value ? [...tree.value.querySelectorAll<HTMLElement>('[role="treeitem"]')] : [];
}
function setFocusedKey(key: string): void {
  focusedKey.value = key;
}
function focusItem(item?: HTMLElement): void {
  if (!item) return;
  focusedKey.value = item.dataset.treeKey ?? focusedKey.value;
  void nextTick(() => item.focus({ preventScroll: true }));
}
function directChild(item: HTMLElement): HTMLElement | undefined {
  const group = [...item.children].find(child => child.getAttribute('role') === 'group');
  return group?.querySelector<HTMLElement>('[role="treeitem"]') ?? undefined;
}
function parentItem(item: HTMLElement): HTMLElement | undefined {
  return item.parentElement?.closest<HTMLElement>('[role="treeitem"]') ?? undefined;
}
function unitById(id?: string): OrgUnit | undefined {
  if (!id) return undefined;
  const visit = (units: readonly OrgUnit[]): OrgUnit | undefined => {
    for (const unit of units) {
      if (unit.id === id) return unit;
      const child = visit(unit.children);
      if (child) return child;
    }
    return undefined;
  };
  return visit(props.units);
}
function memberByKey(key?: string): User | undefined {
  if (!key) return undefined;
  const [, unitId, memberId] = key.split(':');
  return unitById(unitId)?.members.find(member => member.id === memberId);
}
function activate(item: HTMLElement): void {
  const kind = item.dataset.treeKind;
  if (kind === 'unit') {
    const unit = unitById(item.dataset.unitId);
    if (unit) {
      selectedKey.value = item.dataset.treeKey ?? '';
      emit('activate-unit', unit, item);
    }
  } else if (kind === 'member' && item.getAttribute('aria-disabled') !== 'true') {
    const member = memberByKey(item.dataset.treeKey);
    if (member) {
      selectedKey.value = item.dataset.treeKey ?? '';
      emit('activate-member', member, item);
    }
  } else if (kind === 'retry') {
    const unitId = item.dataset.treeKey?.slice('retry:'.length);
    const unit = unitById(unitId);
    if (unit) emit('retry', unit);
  }
}
function onKeydown(event: KeyboardEvent): void {
  const item = (event.target as Element | null)?.closest<HTMLElement>('[role="treeitem"]');
  if (!item || !tree.value?.contains(item)) return;
  const items = visibleItems();
  const current = items.indexOf(item);
  let target: HTMLElement | undefined;
  if (event.key === 'ArrowDown') target = items[Math.min(current + 1, items.length - 1)];
  else if (event.key === 'ArrowUp') target = items[Math.max(current - 1, 0)];
  else if (event.key === 'Home') target = items[0];
  else if (event.key === 'End') target = items.at(-1);
  else if (event.key === 'ArrowRight' && item.dataset.treeKind === 'unit') {
    const unit = unitById(item.dataset.unitId);
    if (unit && item.getAttribute('aria-expanded') !== 'true') emit('toggle', unit);
    else target = directChild(item);
  } else if (event.key === 'ArrowLeft') {
    const unit = item.dataset.treeKind === 'unit' ? unitById(item.dataset.unitId) : undefined;
    if (unit && item.getAttribute('aria-expanded') === 'true') emit('toggle', unit);
    else target = parentItem(item);
  } else if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    activate(item);
    return;
  } else return;
  event.preventDefault();
  focusItem(target);
}

watch(() => props.units.map(unit => unit.id), () => {
  const available = visibleItems().some(item => item.dataset.treeKey === focusedKey.value);
  if (!available) focusedKey.value = firstUnitKey();
}, { immediate: true, flush: 'post' });
</script>

<template>
  <div ref="tree" class="im-org-tree" role="tree" :aria-label="label" @keydown="onKeydown">
    <ImOrganizationTreeNode
      v-for="unit in units"
      :key="unit.id"
      :unit="unit"
      :level="1"
      :expanded-ids="expandedIds"
      :focused-key="focusedKey || firstUnitKey()"
      :selected-key="selectedKey"
      :selected-member-ids="selectedMemberIds"
      :disabled-member-ids="disabledMemberIds"
      :error-unit-ids="errorUnitIds"
      :mode="mode"
      :error-label="errorLabel"
      :retry-label="retryLabel"
      :online-label="onlineLabel"
      :offline-label="offlineLabel"
      :busy-label="busyLabel"
      @focus="setFocusedKey"
      @toggle="emit('toggle', $event)"
      @activate-unit="(item, element) => emit('activate-unit', item, element)"
      @activate-member="(member, element) => emit('activate-member', member, element)"
      @retry="emit('retry', $event)"
    />
  </div>
</template>

<style scoped>
/* Figma 通讯录-好友页定版：部门行=箭头+名(14)+右侧在线/总数(12 提示灰)；成员行=头像36+名(12 Medium)+状态点(8)+状态文字(10) */
.im-org-tree { display:grid;gap:4px;outline:none; }
.im-org-tree :deep(.im-org-tree__item) { border-radius:var(--im-uikit-radius-md,8px);outline:none;cursor:pointer; }
.im-org-tree :deep(.im-org-tree__item:focus-visible) { box-shadow:var(--im-uikit-focus-ring);background:var(--im-uikit-bg-list-hover); }
.im-org-tree :deep(.im-org-tree__item[aria-selected="true"]) { background:var(--im-uikit-bg-list-focused); }
.im-org-tree :deep(.im-org-tree__item[aria-disabled="true"]) { cursor:not-allowed;opacity:.55; }
.im-org-tree :deep(.im-org-tree__unit-row) { display:flex;min-height:24px;align-items:center;gap:4px;padding:0;box-sizing:border-box; }
.im-org-tree :deep(.im-org-tree__member-row) { display:flex;min-height:36px;align-items:center;gap:8px;padding:4px 0;box-sizing:border-box; }
.im-org-tree :deep(.im-org-tree__toggle) { display:grid;width:24px;height:24px;flex:0 0 24px;place-items:center;border-radius:var(--im-uikit-radius-xs,4px);color:var(--im-uikit-text-secondary); }
.im-org-tree :deep(.im-org-tree__toggle:hover) { background:var(--im-uikit-bg-dropdown-hover); }
/* 切图箭头本体朝上：展开=旋转180（朝下，Figma 展开态）、折叠=旋转90（朝右） */
.im-org-tree :deep(.im-org-tree__toggle svg) { transform:rotate(180deg);transition:transform var(--im-uikit-transition-interaction,.2s ease); }
.im-org-tree :deep(.im-org-tree__toggle--collapsed svg) { transform:rotate(90deg); }
.im-org-tree :deep(.im-org-tree__unit-row>b) { font-size:var(--im-uikit-font-size-md,14px);font-weight:400;color:var(--im-uikit-text-primary,#1f1f1f); }
.im-org-tree :deep(.im-org-tree__unit-row>small) { margin-left:auto;color:var(--im-uikit-text-tertiary,#999);font-size:var(--im-uikit-font-size-sm,12px); }
.im-org-tree :deep(.im-org-tree__group) { display:grid;gap:4px;padding-top:4px; }
.im-org-tree :deep(.im-org-tree__member-copy) { display:grid;min-width:0;gap:2px; }
.im-org-tree :deep(.im-org-tree__member-copy>b) { overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--im-uikit-text-primary,#1f1f1f);font-size:var(--im-uikit-font-size-sm,12px);font-weight:500;line-height:17px; }
.im-org-tree :deep(.im-org-tree__presence) { display:flex;align-items:center;gap:2px;color:var(--im-uikit-text-tertiary,#999);font-size:10px;line-height:14px; }
.im-org-tree :deep(.im-org-tree__presence i) { width:8px;height:8px;border-radius:50%;background:var(--im-uikit-presence-offline,#999); }
.im-org-tree :deep(.im-org-tree__presence--online i) { background:var(--im-uikit-presence-online,#67c23a); }
.im-org-tree :deep(.im-org-tree__presence--busy i) { background:var(--im-uikit-error,#e84f4f); }
.im-org-tree :deep(.im-org-tree__member-row small) { color:var(--im-uikit-text-tertiary);font-size:11px; }
.im-org-tree :deep(.im-org-tree__check) { display:grid;width:14px;height:14px;flex:0 0 14px;place-items:center;border:1px solid var(--im-uikit-border-default,#dcdfe6);border-radius:3px;color:var(--im-uikit-text-on-primary,#fff);font-size:10px; }
.im-org-tree :deep(.im-org-tree__member--selected .im-org-tree__check) { border-color:var(--im-uikit-text-link);background:var(--im-uikit-text-link); }
.im-org-tree :deep(.im-org-tree__error) { margin:2px 8px;padding:6px;color:var(--im-uikit-text-error);font-size:11px; }
</style>

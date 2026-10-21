<script setup lang="ts">
import { computed } from 'vue';
import type { OrgUnit, User } from '../../domain/types';
import ImIcon from '../primitives/ImIcon.vue';
import ImAvatar from '../primitives/ImAvatar.vue';

defineOptions({ name: 'ImOrganizationTreeNode' });

const props = defineProps<{
  unit: OrgUnit;
  level: number;
  expandedIds: ReadonlySet<string>;
  focusedKey: string;
  selectedKey?: string;
  selectedMemberIds: ReadonlySet<string>;
  disabledMemberIds: ReadonlySet<string>;
  errorUnitIds: ReadonlySet<string>;
  mode: 'browse' | 'select';
  errorLabel: string;
  retryLabel: string;
  onlineLabel: string;
  offlineLabel: string;
  busyLabel: string;
}>();

const emit = defineEmits<{
  focus: [key: string];
  toggle: [unit: OrgUnit];
  'activate-unit': [unit: OrgUnit, element: HTMLElement];
  'activate-member': [member: User, element: HTMLElement];
  retry: [unit: OrgUnit];
}>();

const unitKey = () => `unit:${props.unit.id}`;
const memberKey = (member: User) => `member:${props.unit.id}:${member.id}`;
const retryKey = () => `retry:${props.unit.id}`;
// Figma 部门行右侧计数：在线数/总数（成员未加载时不显示）
const onlineCount = computed(() => props.unit.members.filter(member => member.presence === 'online').length);

function activateUnit(event: MouseEvent): void {
  const item = event.currentTarget as HTMLElement;
  emit('focus', unitKey());
  if ((event.target as Element | null)?.closest('[data-tree-toggle]')) emit('toggle', props.unit);
  else emit('activate-unit', props.unit, item);
}

function activateMember(member: User, event: MouseEvent): void {
  if (props.disabledMemberIds.has(member.id)) return;
  emit('focus', memberKey(member));
  emit('activate-member', member, event.currentTarget as HTMLElement);
}
</script>

<template>
  <div
    class="im-org-tree__item im-org-tree__unit"
    role="treeitem"
    data-tree-kind="unit"
    :data-tree-key="unitKey()"
    :data-unit-id="unit.id"
    :aria-label="unit.name"
    :aria-level="level"
    :aria-expanded="expandedIds.has(unit.id)"
    :aria-selected="selectedKey === unitKey()"
    :tabindex="focusedKey === unitKey() ? 0 : -1"
    @focus="emit('focus', unitKey())"
    @click.stop="activateUnit"
  >
    <span class="im-org-tree__unit-row" :style="{ paddingInlineStart: `${(level - 1) * 16}px` }" aria-hidden="true">
      <span :class="['im-org-tree__toggle', { 'im-org-tree__toggle--collapsed': !expandedIds.has(unit.id) }]" data-tree-toggle>
        <template v-if="unit.loading">…</template>
        <ImIcon v-else name="chevron" :size="10" />
      </span>
      <b>{{ unit.name }}</b>
      <small v-if="unit.members.length">{{ onlineCount }}/{{ unit.members.length }}</small>
    </span>
    <div v-if="expandedIds.has(unit.id)" class="im-org-tree__group" role="group">
      <div
        v-for="member in unit.members"
        :key="memberKey(member)"
        :class="['im-org-tree__item', 'im-org-tree__member', { 'im-org-tree__member--selected': selectedMemberIds.has(member.id) }]"
        role="treeitem"
        data-tree-kind="member"
        :data-tree-key="memberKey(member)"
        :data-member-id="member.id"
        :aria-label="member.name"
        :aria-level="level + 1"
        :aria-selected="mode === 'select' ? selectedMemberIds.has(member.id) : selectedKey === memberKey(member)"
        :aria-disabled="disabledMemberIds.has(member.id) || undefined"
        :tabindex="focusedKey === memberKey(member) ? 0 : -1"
        @focus.stop="emit('focus', memberKey(member))"
        @click.stop="activateMember(member, $event)"
      >
        <span class="im-org-tree__member-row" :style="{ paddingInlineStart: `${level * 16}px` }" aria-hidden="true">
          <span v-if="mode === 'select'" class="im-org-tree__check">{{ selectedMemberIds.has(member.id) ? '✓' : '' }}</span>
          <ImAvatar :src="member.avatar" :name="member.name" size="md" />
          <span class="im-org-tree__member-copy">
            <b>{{ member.name }}</b>
            <!-- Figma 好友页：状态点 + 在线/忙碌/离线；选择模式沿用部门信息行 -->
            <span v-if="onlineLabel" :class="['im-org-tree__presence', { 'im-org-tree__presence--online': member.presence === 'online', 'im-org-tree__presence--busy': member.presence === 'busy' }]"><i />{{ member.presence === 'online' ? onlineLabel : member.presence === 'busy' ? busyLabel : offlineLabel }}</span>
            <small v-else>{{ member.departments.join(' · ') }}</small>
          </span>
        </span>
      </div>
      <ImOrganizationTreeNode
        v-for="child in unit.children"
        :key="child.id"
        :unit="child"
        :level="level + 1"
        :expanded-ids="expandedIds"
        :focused-key="focusedKey"
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
        @focus="emit('focus', $event)"
        @toggle="emit('toggle', $event)"
        @activate-unit="(child, element) => emit('activate-unit', child, element)"
        @activate-member="(member, element) => emit('activate-member', member, element)"
        @retry="emit('retry', $event)"
      />
      <div
        v-if="errorUnitIds.has(unit.id)"
        class="im-org-tree__item im-org-tree__error"
        role="treeitem"
        data-tree-kind="retry"
        :data-tree-key="retryKey()"
        :aria-label="`${errorLabel}，${retryLabel}`"
        :aria-level="level + 1"
        aria-selected="false"
        :tabindex="focusedKey === retryKey() ? 0 : -1"
        @focus.stop="emit('focus', retryKey())"
        @click.stop="emit('retry', unit)"
      >{{ errorLabel }} · {{ retryLabel }}</div>
    </div>
  </div>
</template>

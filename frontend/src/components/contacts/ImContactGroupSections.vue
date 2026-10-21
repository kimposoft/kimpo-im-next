<script setup lang="ts">
import { reactive } from 'vue';
import type { Conversation } from '../../domain/types';
import ImIcon from '../primitives/ImIcon.vue';
import ImAvatar from '../primitives/ImAvatar.vue';

export interface ImContactGroupSectionLabels {
  departmentGroups: string;
  ordinaryGroups: string;
  loading: string;
  error: string;
  retry: string;
  emptyDepartment: string;
  emptyOrdinary: string;
  organizationSource: string;
  manualSource: string;
  businessSource: string;
}

const props = defineProps<{
  departmentGroups: readonly Conversation[];
  ordinaryGroups: readonly Conversation[];
  status: 'loading' | 'ready' | 'error';
  labels: ImContactGroupSectionLabels;
}>();

const emit = defineEmits<{ open: [conversation: Conversation, event: MouseEvent]; retry: [] }>();

// Figma 通讯录-群聊页：两个分组均可折叠，默认展开
const collapsed = reactive({ department: false, ordinary: false });

function sourceLabel(group: Conversation): string {
  if (group.kind === 'department' || group.currentMemberSource === 'organization') return props.labels.organizationSource;
  if (group.currentMemberSource === 'business') return props.labels.businessSource;
  return props.labels.manualSource;
}
</script>

<template>
  <section class="contact-groups" :aria-label="labels.departmentGroups">
    <p v-if="status === 'loading'" class="contact-groups__state" aria-live="polite">{{ labels.loading }}</p>
    <p v-else-if="status === 'error'" class="contact-groups__state contact-groups__state--error" role="alert">
      {{ labels.error }} <button type="button" @click="emit('retry')">{{ labels.retry }}</button>
    </p>
    <template v-else>
      <section class="contact-groups__section" role="group" :aria-label="labels.departmentGroups">
        <button type="button" class="contact-groups__head" :aria-expanded="!collapsed.department" @click="collapsed.department = !collapsed.department">
          <span :class="['contact-groups__chevron', { 'contact-groups__chevron--collapsed': collapsed.department }]"><ImIcon name="chevron" :size="10" /></span>
          <h3>{{ labels.departmentGroups }}</h3>
          <small>{{ departmentGroups.length }}</small>
        </button>
        <template v-if="!collapsed.department">
          <button v-for="group in departmentGroups" :key="group.id" type="button" class="contact-group" :title="sourceLabel(group)" @click="emit('open', group, $event)">
            <ImAvatar class="contact-group__avatar" :src="group.avatar" :name="group.title" size="md" />
            <span><b>{{ group.title }}</b></span>
          </button>
          <p v-if="!departmentGroups.length" class="contact-groups__empty">{{ labels.emptyDepartment }}</p>
        </template>
      </section>
      <section class="contact-groups__section" role="group" :aria-label="labels.ordinaryGroups">
        <button type="button" class="contact-groups__head" :aria-expanded="!collapsed.ordinary" @click="collapsed.ordinary = !collapsed.ordinary">
          <span :class="['contact-groups__chevron', { 'contact-groups__chevron--collapsed': collapsed.ordinary }]"><ImIcon name="chevron" :size="10" /></span>
          <h3>{{ labels.ordinaryGroups }}</h3>
          <small>{{ ordinaryGroups.length }}</small>
        </button>
        <template v-if="!collapsed.ordinary">
          <button v-for="group in ordinaryGroups" :key="group.id" type="button" class="contact-group" :title="sourceLabel(group)" @click="emit('open', group, $event)">
            <ImAvatar class="contact-group__avatar" :src="group.avatar" :name="group.title" size="md" />
            <span><b>{{ group.title }}</b></span>
          </button>
          <p v-if="!ordinaryGroups.length" class="contact-groups__empty">{{ labels.emptyOrdinary }}</p>
        </template>
      </section>
    </template>
  </section>
</template>

<style scoped>
/* Figma 通讯录-群聊页定版：分组头（折叠箭头+标题+右侧计数）+ 头像36 群行 */
.contact-groups { display:grid;gap:8px;margin:0 16px;padding:0 0 10px; }
.contact-groups__section { display:grid;gap:8px; }
.contact-groups__head { display:flex;width:100%;align-items:center;gap:4px;border:0;border-radius:var(--im-uikit-radius-xs,4px);padding:2px 0;background:transparent;cursor:pointer;text-align:left; }
.contact-groups__head:focus-visible { outline:none;box-shadow:var(--im-uikit-focus-ring); }
.contact-groups__head h3 { margin:0;color:var(--im-uikit-text-primary,#1f1f1f);font-size:var(--im-uikit-font-size-md,14px);font-weight:400;line-height:20px; }
.contact-groups__head small { margin-left:auto;color:var(--im-uikit-text-tertiary,#999);font-size:var(--im-uikit-font-size-sm,12px); }
/* 切图箭头本体朝上：展开=旋转180（朝下）、折叠=旋转90（朝右） */
.contact-groups__chevron { display:grid;width:24px;height:24px;flex:0 0 24px;place-items:center;color:var(--im-uikit-text-secondary,#666);transform:rotate(180deg); }
.contact-groups__chevron--collapsed { transform:rotate(90deg); }
.contact-group { display:flex;width:100%;align-items:center;gap:8px;border:0;border-radius:var(--im-uikit-radius-md,8px);padding:0;text-align:left;background:transparent;cursor:pointer; }
.contact-group:hover,.contact-group:focus-visible { background:var(--im-uikit-bg-list-hover,rgba(31,31,31,.05)); }
.contact-group:focus-visible { outline:none;box-shadow:var(--im-uikit-focus-ring); }
.contact-group__avatar { flex:0 0 auto; }
.contact-group>span:last-child { display:grid;min-width:0; }
.contact-group b { overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--im-uikit-text-primary,#1f1f1f);font-size:var(--im-uikit-font-size-sm,12px);font-weight:500;line-height:17px; }
.contact-groups__empty,.contact-groups__state { margin:2px 8px;color:var(--im-uikit-text-tertiary,#999);font-size:11px; }
.contact-groups__state--error { color:var(--im-uikit-text-error,#e84f4f); }
.contact-groups__state button { margin-left:6px;color:var(--im-uikit-text-link,#0877f4);background:transparent;border:0;cursor:pointer; }
</style>

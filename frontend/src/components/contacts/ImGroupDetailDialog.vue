<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue';
import type { Conversation } from '../../domain/types';
import ImDialogHeader from '../primitives/ImDialogHeader.vue';

export interface ImGroupDetailLabels {
  title: string;
  close: string;
  type: string;
  departmentType: string;
  ordinaryType: string;
  members: string;
  departmentRule: string;
  ordinaryRule: string;
  enter: string;
}

const props = defineProps<{
  conversation: Conversation;
  labels: ImGroupDetailLabels;
  returnFocus?: HTMLElement | null;
}>();
const emit = defineEmits<{ close: []; enter: [] }>();
const dialog = ref<HTMLElement>();

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') {
    event.preventDefault();
    emit('close');
    return;
  }
  if (event.key !== 'Tab' || !dialog.value) return;
  const focusable = [...dialog.value.querySelectorAll<HTMLElement>('button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])')];
  if (!focusable.length) { event.preventDefault(); dialog.value.focus(); return; }
  const first = focusable[0];
  const last = focusable.at(-1)!;
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
}

onMounted(() => { window.addEventListener('keydown', onKeydown); void nextTick(() => dialog.value?.querySelector<HTMLButtonElement>('[data-initial-focus]')?.focus()); });
onBeforeUnmount(() => { window.removeEventListener('keydown', onKeydown); void nextTick(() => props.returnFocus?.focus()); });
</script>

<template>
  <div class="group-detail-overlay" role="presentation" @click.self="emit('close')">
    <section ref="dialog" class="group-detail" role="dialog" aria-modal="true" :aria-label="labels.title" tabindex="-1">
      <!-- 统一弹窗头：macOS 关闭在左、其他平台在右；副标题放群名 -->
      <ImDialogHeader :title="labels.title" :subtitle="conversation.title" :close-label="labels.close" @close="emit('close')" />
      <div class="group-detail__identity"><span aria-hidden="true">{{ conversation.title[0] }}</span><strong>{{ conversation.title }}</strong></div>
      <dl>
        <div><dt>{{ labels.type }}</dt><dd>{{ conversation.kind === 'department' ? labels.departmentType : labels.ordinaryType }}</dd></div>
        <div><dt>{{ labels.members }}</dt><dd>{{ conversation.memberCount ?? 0 }}</dd></div>
      </dl>
      <p :class="['group-detail__rule', { 'group-detail__rule--department': conversation.kind === 'department' }]">{{ conversation.kind === 'department' ? labels.departmentRule : labels.ordinaryRule }}</p>
      <footer><button data-initial-focus type="button" @click="emit('enter')">{{ labels.enter }}</button></footer>
    </section>
  </div>
</template>

<style scoped>
.group-detail-overlay { position:fixed;inset:0;z-index:2147483645;display:grid;place-items:center;background:#11182752; }
.group-detail { width:min(400px,calc(100vw - 32px));border-radius:12px;background:var(--im-uikit-bg-operate);box-shadow:0 18px 55px #11182738;overflow:hidden; }
.group-detail__identity { display:flex;align-items:center;gap:12px;padding:18px 16px 8px; }
.group-detail__identity span { display:grid;width:44px;height:44px;place-items:center;border-radius:10px;color:#fff;background:var(--im-uikit-text-link);font-size:18px;font-weight:700; }
.group-detail dl { display:grid;gap:8px;margin:12px 16px; }
.group-detail dl div { display:grid;grid-template-columns:96px minmax(0,1fr);gap:12px; }
.group-detail dt { color:var(--im-uikit-text-secondary); }
.group-detail dd { margin:0; }
.group-detail__rule { margin:12px 16px;padding:10px 12px;border-radius:8px;color:var(--im-uikit-text-secondary);background:var(--im-uikit-bg-list-hover); }
/* 部门规则条走品牌浅底 token：写死浅蓝底会在暗色下变成浅底浅字（文字已是 token） */
.group-detail__rule--department { color:var(--im-uikit-text-primary);background:var(--im-uikit-bg-brand-soft,#eef5ff); }
.group-detail footer { display:flex;justify-content:flex-end;padding:12px 16px 16px; }
.group-detail footer button { border-radius:7px;padding:8px 14px;color:#fff;background:var(--im-uikit-text-link); }
.group-detail button:focus-visible { outline:none;box-shadow:var(--im-uikit-focus-ring); }
</style>

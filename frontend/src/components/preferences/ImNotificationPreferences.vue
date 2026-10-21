<script setup lang="ts">
import type {
  NahidaCategoryPreference,
  NahidaDndPreference,
  NahidaNotificationCategory,
  NahidaPreferenceClient
} from '@kimposoft/plugin-sdk/nahida-im';
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, useId } from 'vue';
import ImSwitch from '../primitives/ImSwitch.vue';
import ImDialogHeader from '../primitives/ImDialogHeader.vue';
import {
  dndDraft,
  dndPreferenceInput,
  enforceCategoryPreference,
  notificationCategories,
  notificationChannels,
  requiresInApp,
  validateDndPreference,
  type DndPreferenceDraft,
  type DndValidationError,
  type NotificationChannel
} from './notification-preference-model';

export interface NotificationPreferenceLabels {
  title: string;
  close: string;
  loading: string;
  loadError: string;
  retry: string;
  dnd: string;
  dndEnabled: string;
  startTime: string;
  endTime: string;
  timezone: string;
  timezonePlaceholder: string;
  urgentBypassDnd: string;
  save: string;
  categoriesTitle: string;
  inApp: string;
  mail: string;
  sms: string;
  pending: string;
  success: string;
  failed: string;
  validation: Record<DndValidationError, string>;
  categories: Record<NahidaNotificationCategory, string>;
}

type LoadState = 'loading' | 'ready' | 'error';
type OperationState = { status: 'idle' | 'pending' | 'success' | 'error'; error?: string };
type CategoryPreferences = Record<NahidaNotificationCategory, NahidaCategoryPreference>;

const props = defineProps<{
  client: NahidaPreferenceClient;
  labels: NotificationPreferenceLabels;
  returnFocus?: HTMLElement | null;
}>();
const emit = defineEmits<{ close: [] }>();

const titleId = `im-notification-preferences-${useId()}`;
const dialog = ref<HTMLElement>();
// 关闭按钮在统一弹窗头里（按平台分左右），打开时初始聚焦到它
const header = ref<InstanceType<typeof ImDialogHeader>>();
const loadState = ref<LoadState>('loading');
const loadError = ref('');
const dnd = reactive<DndPreferenceDraft>({ enabled: false, startTime: '', endTime: '', timezone: '', urgentBypassDnd: true });
const categories = ref<CategoryPreferences>();
const dndOperation = ref<OperationState>({ status: 'idle' });
const categoryOperations = reactive<Record<NahidaNotificationCategory, OperationState>>({
  chat: { status: 'idle' }, todo: { status: 'idle' }, mention: { status: 'idle' },
  announcement: { status: 'idle' }, system: { status: 'idle' }
});
const anySaving = computed(() => dndOperation.value.status === 'pending'
  || notificationCategories.some(category => categoryOperations[category].status === 'pending'));

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : props.labels.failed;
}

function applyAuthoritative(dndPreference: NahidaDndPreference, categoryPreferences: Readonly<CategoryPreferences>): void {
  Object.assign(dnd, dndDraft(dndPreference));
  categories.value = Object.fromEntries(notificationCategories.map(category => [
    category,
    enforceCategoryPreference(category, categoryPreferences[category])
  ])) as CategoryPreferences;
}

async function loadPreferences(): Promise<void> {
  loadState.value = 'loading';
  loadError.value = '';
  try {
    const [dndPreference, categoryPreferences] = await Promise.all([
      props.client.getDnd(),
      props.client.getCategoryPrefs()
    ]);
    applyAuthoritative(dndPreference, categoryPreferences);
    loadState.value = 'ready';
  } catch (error) {
    loadError.value = errorText(error);
    loadState.value = 'error';
  }
}

async function saveDnd(): Promise<void> {
  if (anySaving.value) return;
  const validation = validateDndPreference(dnd);
  if (validation) {
    dndOperation.value = { status: 'error', error: props.labels.validation[validation] };
    return;
  }
  dndOperation.value = { status: 'pending' };
  try {
    await props.client.updateDnd(dndPreferenceInput(dnd));
    dndOperation.value = { status: 'success' };
  } catch (error) {
    const message = errorText(error);
    await loadPreferences();
    dndOperation.value = { status: 'error', error: message };
  }
}

function categoryValue(category: NahidaNotificationCategory, channel: NotificationChannel): boolean {
  const value = categories.value?.[category];
  if (!value) return false;
  return channel === 'inApp' && requiresInApp(category) ? true : value[channel];
}

async function updateCategory(
  category: NahidaNotificationCategory,
  channel: NotificationChannel,
  value: boolean
): Promise<void> {
  const current = categories.value?.[category];
  if (!current || anySaving.value || (channel === 'inApp' && requiresInApp(category))) return;
  const next = enforceCategoryPreference(category, { ...current, [channel]: value });
  categories.value = { ...categories.value!, [category]: next };
  categoryOperations[category] = { status: 'pending' };
  try {
    await props.client.updateCategoryPrefs(category, next);
    categoryOperations[category] = { status: 'success' };
  } catch (error) {
    const message = errorText(error);
    await loadPreferences();
    categoryOperations[category] = { status: 'error', error: message };
  }
}

function operationText(operation: OperationState): string {
  if (operation.status === 'pending') return props.labels.pending;
  if (operation.status === 'success') return props.labels.success;
  if (operation.status === 'error') return operation.error ? `${props.labels.failed}: ${operation.error}` : props.labels.failed;
  return '';
}

function trapFocus(event: KeyboardEvent): void {
  if (!dialog.value) return;
  const focusable = [...dialog.value.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled])')];
  if (!focusable.length) return;
  const first = focusable[0];
  const last = focusable.at(-1)!;
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
}

onMounted(() => {
  void loadPreferences();
  void nextTick(() => header.value?.focusClose());
});
onBeforeUnmount(() => props.returnFocus?.focus());
</script>

<template>
  <div class="im-notification-preferences-overlay" role="presentation" @click.self="emit('close')">
    <section
      ref="dialog"
      class="im-notification-preferences"
      role="dialog"
      aria-modal="true"
      :aria-labelledby="titleId"
      @keydown.esc.stop.prevent="emit('close')"
      @keydown.tab="trapFocus"
    >
      <ImDialogHeader ref="header" :title="labels.title" :title-id="titleId" :close-label="labels.close" @close="emit('close')" />

      <div v-if="loadState === 'loading'" class="notification-state" aria-live="polite">{{ labels.loading }}</div>
      <div v-else-if="loadState === 'error'" class="notification-state notification-state--error" role="alert">
        <strong>{{ labels.loadError }}</strong><small>{{ loadError }}</small><button type="button" @click="loadPreferences">{{ labels.retry }}</button>
      </div>
      <div v-else class="notification-body">
        <section class="notification-section">
          <h3>{{ labels.dnd }}</h3>
          <label class="notification-switch-row"><span>{{ labels.dndEnabled }}</span><ImSwitch v-model="dnd.enabled" :label="labels.dndEnabled" :disabled="anySaving" /></label>
          <div class="notification-time-grid">
            <label><span>{{ labels.startTime }}</span><input v-model="dnd.startTime" type="time" :disabled="!dnd.enabled || anySaving" /></label>
            <label><span>{{ labels.endTime }}</span><input v-model="dnd.endTime" type="time" :disabled="!dnd.enabled || anySaving" /></label>
          </div>
          <label class="notification-field"><span>{{ labels.timezone }}</span><input v-model="dnd.timezone" type="text" :placeholder="labels.timezonePlaceholder" :disabled="anySaving" /></label>
          <label class="notification-switch-row"><span>{{ labels.urgentBypassDnd }}</span><ImSwitch v-model="dnd.urgentBypassDnd" :label="labels.urgentBypassDnd" :disabled="anySaving" /></label>
          <div class="notification-save-row">
            <span :class="['notification-feedback', { error: dndOperation.status === 'error' }]" aria-live="polite">{{ operationText(dndOperation) }}</span>
            <button type="button" :disabled="anySaving" @click="saveDnd">{{ labels.save }}</button>
          </div>
        </section>

        <section class="notification-section">
          <h3>{{ labels.categoriesTitle }}</h3>
          <div class="notification-category-table">
            <div class="notification-category-head"><span /><span>{{ labels.inApp }}</span><span>{{ labels.mail }}</span><span>{{ labels.sms }}</span></div>
            <div v-for="category in notificationCategories" :key="category" class="notification-category-row">
              <strong>{{ labels.categories[category] }}</strong>
              <ImSwitch
                v-for="channel in notificationChannels"
                :key="channel"
                :model-value="categoryValue(category, channel)"
                :label="`${labels.categories[category]} · ${labels[channel]}`"
                :disabled="anySaving || (channel === 'inApp' && requiresInApp(category))"
                @change="updateCategory(category, channel, $event)"
              />
              <small :class="{ error: categoryOperations[category].status === 'error' }" aria-live="polite">{{ operationText(categoryOperations[category]) }}</small>
            </div>
          </div>
        </section>
      </div>
    </section>
  </div>
</template>

<style scoped>
.im-notification-preferences-overlay { position:absolute;z-index:24;inset:0;display:grid;place-items:center;padding:24px;background:rgba(17,24,39,.62);font-family:var(--im-uikit-font-family,Arial,"PingFang SC",sans-serif); }
.im-notification-preferences { display:flex;width:min(620px,100%);max-height:100%;min-height:360px;flex-direction:column;overflow:hidden;border-radius:var(--im-uikit-radius-dialog,16px);color:var(--im-uikit-text-primary);background:var(--im-uikit-bg-operate,#fff);box-shadow:0 20px 70px rgba(0,0,0,.28); }
.im-notification-preferences h3 { margin:0;font-size:15px;font-weight:700; }
.notification-body { min-height:0;overflow:auto;padding:22px 24px 26px; }.notification-section+.notification-section { margin-top:28px;padding-top:24px;border-top:1px solid var(--im-uikit-border-lighter,rgba(0,0,0,.08)); }
.notification-switch-row { display:flex;min-height:48px;align-items:center;justify-content:space-between;gap:16px;font-size:14px; }.notification-time-grid { display:grid;grid-template-columns:1fr 1fr;gap:12px; }.notification-time-grid label,.notification-field { display:grid;gap:6px;color:var(--im-uikit-text-secondary);font-size:12px; }.notification-field { margin-top:12px; }
.notification-time-grid input,.notification-field input { height:36px;box-sizing:border-box;border:1px solid transparent;border-radius:var(--im-uikit-radius-md,8px);padding:0 10px;outline:0;color:var(--im-uikit-text-primary);background:var(--im-uikit-bg-input); }.notification-time-grid input:focus,.notification-field input:focus { border-color:var(--im-uikit-text-link);box-shadow:var(--im-uikit-focus-ring); }.notification-time-grid input:disabled,.notification-field input:disabled { opacity:.55; }
.notification-save-row { display:flex;min-height:40px;align-items:center;justify-content:space-between;gap:12px;margin-top:12px; }.notification-save-row button,.notification-state button { min-height:34px;border:0;border-radius:var(--im-uikit-radius-md,8px);padding:0 16px;color:var(--im-uikit-text-on-primary);background:var(--im-uikit-text-link);cursor:pointer; }.notification-save-row button:disabled { opacity:.45;cursor:not-allowed; }
.notification-feedback,.notification-category-row small { color:var(--im-uikit-text-secondary);font-size:12px; }.error { color:var(--im-uikit-text-error)!important; }
.notification-category-table { display:grid;margin-top:14px; }.notification-category-head,.notification-category-row { display:grid;grid-template-columns:minmax(120px,1fr) repeat(3,56px);align-items:center;gap:8px; }.notification-category-head { min-height:30px;color:var(--im-uikit-text-tertiary);font-size:11px;text-align:center; }.notification-category-row { position:relative;min-height:52px;border-top:1px solid var(--im-uikit-border-lighter,rgba(0,0,0,.06)); }.notification-category-row strong { overflow:hidden;font-size:13px;font-weight:500;text-overflow:ellipsis;white-space:nowrap; }.notification-category-row :deep(.im-switch) { justify-self:center; }.notification-category-row small { position:absolute;right:0;bottom:1px; }
.notification-state { flex:1;display:grid;place-content:center;justify-items:center;gap:10px;padding:28px;text-align:center;color:var(--im-uikit-text-secondary); }.notification-state small { max-width:420px;overflow-wrap:anywhere; }
.notification-save-row button:focus-visible,.notification-state button:focus-visible { outline:none;box-shadow:var(--im-uikit-focus-ring); }
@media (max-width:560px) { .notification-time-grid { grid-template-columns:1fr; }.notification-category-head,.notification-category-row { grid-template-columns:minmax(92px,1fr) repeat(3,48px); } }
</style>

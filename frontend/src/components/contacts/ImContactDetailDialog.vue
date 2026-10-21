<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useId } from 'vue';
import ImAvatar from '../primitives/ImAvatar.vue';
import ImDialogHeader from '../primitives/ImDialogHeader.vue';
import {
  buildContactDetailViewModel,
  type ContactDetail,
  type ContactDetailLabels
} from './contact-detail-model';

const props = withDefaults(defineProps<{
  contact: ContactDetail;
  labels: ContactDetailLabels;
  initialFocus?: 'send-message' | 'close';
  returnFocus?: HTMLElement | null;
  restoreFocusOnUnmount?: boolean;
  canSendMessage?: boolean;
}>(), {
  initialFocus: 'send-message',
  returnFocus: null,
  restoreFocusOnUnmount: true,
  canSendMessage: true
});

const emit = defineEmits<{
  close: [reason: 'button' | 'escape' | 'backdrop'];
  'send-message': [userId: string];
}>();

const titleId = `im-contact-detail-${useId()}`;
const dialog = ref<HTMLElement>();
// The close button lives in the shared dialog header (left on macOS, right elsewhere); focus it via the exposed ref.
const header = ref<InstanceType<typeof ImDialogHeader>>();
const sendButton = ref<HTMLButtonElement>();
const view = computed(() => buildContactDetailViewModel(props.contact, props.labels));

function focusInitial(): void {
  const target = props.initialFocus === 'close' ? header.value?.closeButton : sendButton.value;
  target?.focus();
}

function restoreFocus(): void {
  props.returnFocus?.focus();
}

function requestClose(reason: 'button' | 'escape' | 'backdrop'): void {
  emit('close', reason);
}

function sendMessage(): void {
  emit('send-message', props.contact.userId);
}

function keepFocusInside(event: KeyboardEvent): void {
  if (event.key !== 'Tab' || !dialog.value) return;
  const focusable = [...dialog.value.querySelectorAll<HTMLElement>('button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])')];
  if (!focusable.length) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

onMounted(() => void nextTick(focusInitial));
onBeforeUnmount(() => {
  if (props.restoreFocusOnUnmount) restoreFocus();
});

defineExpose({ focusInitial, restoreFocus });
</script>

<template>
  <div class="im-contact-detail-backdrop" role="presentation" @click.self="requestClose('backdrop')">
    <section
      ref="dialog"
      class="im-contact-detail"
      role="dialog"
      aria-modal="true"
      :aria-labelledby="titleId"
      @keydown.esc.stop.prevent="requestClose('escape')"
      @keydown.tab="keepFocusInside"
    >
      <ImDialogHeader ref="header" :title="labels.title" :title-id="titleId" :close-label="labels.close" @close="requestClose('button')" />

      <div class="im-contact-detail__body">
        <div class="im-contact-detail__identity">
          <ImAvatar :src="contact.avatar" :name="view.displayName" size="md" />
          <strong class="im-contact-detail__name">{{ view.displayName }}</strong>
        </div>

        <dl class="im-contact-detail__facts">
          <template v-for="row in view.rows" :key="row.key">
            <dt>{{ row.label }}</dt>
            <dd>{{ row.value }}</dd>
          </template>
        </dl>

        <section v-if="view.departments.length" class="im-contact-detail__departments" :aria-label="labels.departments">
          <h3>{{ labels.departments }}</h3>
          <ul>
            <li v-for="department in view.departments" :key="`${department.id}:${department.path}`">
              <span>{{ department.path }}</span>
              <span v-if="department.primary" class="im-contact-detail__primary">{{ labels.primaryDepartment }}</span>
            </li>
          </ul>
        </section>
      </div>

      <footer v-if="canSendMessage" class="im-contact-detail__footer">
        <button ref="sendButton" type="button" class="im-contact-detail__send" @click="sendMessage">
          {{ labels.sendMessage }}
        </button>
      </footer>
    </section>
  </div>
</template>

<style scoped>
.im-contact-detail-backdrop {
  position: absolute;
  z-index: 20;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  padding: 24px;
  background: rgba(0, 0, 0, 0.28);
  font-family: var(--im-uikit-font-family, Arial, "PingFang SC", sans-serif);
}
.im-contact-detail {
  display: flex;
  width: min(420px, 100%);
  max-height: 100%;
  min-height: 0;
  flex-direction: column;
  overflow: hidden;
  border-radius: var(--im-uikit-radius-dialog, 16px);
  color: var(--im-uikit-text-primary, rgba(0, 0, 0, 0.9));
  background: var(--im-uikit-bg-operate, #fff);
  box-shadow: 0 16px 48px rgba(0, 0, 0, 0.18);
}
.im-contact-detail__departments h3 {
  margin: 0;
  font-size: 16px;
  font-weight: 700;
  line-height: 22px;
}
.im-contact-detail__body {
  min-height: 0;
  overflow-y: auto;
  padding: 24px;
}
.im-contact-detail__identity {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
}
.im-contact-detail__identity :deep(.im-avatar) {
  width: 72px;
  height: 72px;
  font-size: 24px;
}
.im-contact-detail__name { font-size: 20px; line-height: 28px; }
.im-contact-detail__facts {
  display: grid;
  grid-template-columns: minmax(92px, auto) minmax(0, 1fr);
  gap: 14px 18px;
  margin: 28px 0 0;
  font-size: 14px;
  line-height: 20px;
}
.im-contact-detail__facts dt { color: var(--im-uikit-text-tertiary, rgba(0, 0, 0, 0.4)); }
.im-contact-detail__facts dd { min-width: 0; margin: 0; overflow-wrap: anywhere; }
.im-contact-detail__departments { margin-top: 28px; }
.im-contact-detail__departments h3 { font-size: 14px; }
.im-contact-detail__departments ul {
  display: flex;
  margin: 12px 0 0;
  flex-direction: column;
  gap: 8px;
  padding: 0;
  list-style: none;
}
.im-contact-detail__departments li {
  display: flex;
  min-width: 0;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  border-radius: var(--im-uikit-radius-md, 8px);
  padding: 10px 12px;
  background: var(--im-uikit-bg-input, #f0f2f7);
  font-size: 13px;
  line-height: 18px;
}
.im-contact-detail__departments li > span:first-child { min-width: 0; overflow-wrap: anywhere; }
.im-contact-detail__primary {
  flex: 0 0 auto;
  border-radius: var(--im-uikit-radius-pill, 999px);
  padding: 2px 8px;
  color: var(--im-uikit-text-link, #147aff);
  background: var(--im-uikit-bg-dropdown-active, #e6f2ff);
  font-size: 11px;
}
.im-contact-detail__footer {
  display: flex;
  justify-content: flex-end;
  padding: 16px 20px;
  border-top: 1px solid var(--im-uikit-border-lighter, rgba(0, 0, 0, 0.08));
}
.im-contact-detail__send {
  min-width: 112px;
  height: 36px;
  border: 0;
  border-radius: var(--im-uikit-radius-md, 8px);
  padding: 0 18px;
  color: var(--im-uikit-text-on-primary, #fff);
  background: var(--im-uikit-text-link, #147aff);
  font-size: 14px;
  cursor: pointer;
}
.im-contact-detail__send:focus-visible {
  outline: none;
  box-shadow: var(--im-uikit-focus-ring, 0 0 0 2px rgba(20, 122, 255, 0.28));
}
</style>

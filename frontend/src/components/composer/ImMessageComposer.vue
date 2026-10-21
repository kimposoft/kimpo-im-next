<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import { shouldSendFromKeydown } from '../../controller';
import type { GroupMember, Message, UploadState } from '../../domain/types';
import ImFloatingMenu from '../primitives/ImFloatingMenu.vue';
import ImIconButton from '../primitives/ImIconButton.vue';
import ImIcon from '../primitives/ImIcon.vue';

export interface ImComposerLabels {
  placeholder: string;
  send: string;
  emoji: string;
  emojiDevelopment: string;
  attachment: string;
  attachmentMenu: string;
  image: string;
  file: string;
  video: string;
  history: string;
  reply: string;
  closeReply: string;
  uploading: string;
  uploadFailed: string;
  retry: string;
  cancel: string;
  mentions: string;
  mentionAll: string;
  readonly: string;
  muted: string;
}
export interface ImComposerUploadFailure { id: number; conversationId: string; file: File; error: string; }

const props = defineProps<{
  modelValue: string;
  canWrite: boolean;
  readonly?: boolean;
  replyTo?: Pick<Message, 'sender' | 'text'>;
  upload?: UploadState;
  uploadFailures: readonly ImComposerUploadFailure[];
  activeConversationId: string;
  mentionCandidates: readonly GroupMember[];
  canMentionAll: boolean;
  labels: ImComposerLabels;
}>();

const emit = defineEmits<{
  'update:modelValue': [value: string];
  send: [];
  files: [files: readonly File[]];
  cancelUpload: [];
  retryUpload: [failure: ImComposerUploadFailure];
  dismissUploadFailure: [id: number];
  clearReply: [];
  mention: [member: GroupMember, token: string];
  mentionAll: [token: string];
  /** Figma 定版入口（聊天记录，待开发），能力未落地时由面板提示建设中 */
  history: [];
}>();

const input = ref<HTMLTextAreaElement>();
const fileInput = ref<HTMLInputElement>();
const emojiButton = ref<InstanceType<typeof ImIconButton>>();
const emojiOpen = ref(false);
const mentionDismissed = ref(false);
const mentionActiveIndex = ref(0);
const fileAccept = ref('');
const emojiChoices = [
  '🙂', '😉', '😊', '😄', '😁', '😅', '😐', '😣', '😋',
  '😎', '🥰', '😏', '😜', '😈', '👿', '😶', '😳', '😭',
  '😘', '🫡', '😱', '😬', '😡', '😂', '💩', '😵', '🤓',
  '💀', '😷', '🤗', '🤔', '🤭', '🤫', '🥳', '🤩', '🥺',
  '😴', '🤤', '🙄', '😇', '🤠', '🤯', '🥵', '🥶', '😤',
  '😔', '😞', '😟', '🙁', '☹️', '😖', '😫', '🤒', '🤕',
  '🤢', '🤮', '🤧', '🥴', '😺', '👍'
];

const mentionSearch = computed(() => props.modelValue.match(/(?:^|\s)@([^\s@]*)$/)?.[1]);
const filteredMentions = computed(() => {
  if (mentionSearch.value === undefined) return [];
  const keyword = mentionSearch.value.toLocaleLowerCase();
  return props.mentionCandidates
    .filter(member => member.displayName.toLocaleLowerCase().includes(keyword))
    .slice(0, 12);
});
const mentionOpen = computed(() => !mentionDismissed.value && mentionSearch.value !== undefined && (filteredMentions.value.length > 0 || props.canMentionAll));
const visibleUploadFailures = computed(() => props.uploadFailures.filter(failure => failure.conversationId === props.activeConversationId));
const emojiAnchor = computed(() => emojiButton.value?.$el as HTMLElement | undefined);

function updateDraft(value: string): void { mentionDismissed.value = false; emit('update:modelValue', value); }
function onKeydown(event: KeyboardEvent): void {
  if (mentionOpen.value && !event.isComposing) {
    const itemCount = filteredMentions.value.length + (props.canMentionAll ? 1 : 0);
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const step = event.key === 'ArrowDown' ? 1 : -1;
      mentionActiveIndex.value = (mentionActiveIndex.value + step + itemCount) % itemCount;
      return;
    }
    if (event.key === 'Escape') { event.preventDefault(); mentionDismissed.value = true; return; }
    if (event.key === 'Enter' && itemCount) {
      event.preventDefault();
      if (props.canMentionAll && mentionActiveIndex.value === 0) selectMentionAll();
      else {
        const memberIndex = mentionActiveIndex.value - (props.canMentionAll ? 1 : 0);
        const member = filteredMentions.value[memberIndex];
        if (member) selectMention(member);
      }
      return;
    }
  }
  if (!shouldSendFromKeydown(event)) return;
  event.preventDefault();
  emit('send');
}
function insertAtSelection(value: string): void {
  const start = input.value?.selectionStart ?? props.modelValue.length;
  const end = input.value?.selectionEnd ?? start;
  updateDraft(`${props.modelValue.slice(0, start)}${value}${props.modelValue.slice(end)}`);
  void nextTick(() => {
    input.value?.focus();
    input.value?.setSelectionRange(start + value.length, start + value.length);
  });
}
function insertEmoji(emoji: string): void {
  emojiOpen.value = false;
  insertAtSelection(emoji);
}
function replaceMentionToken(token: string): void {
  updateDraft(props.modelValue.replace(/@[^\s@]*$/, `${token} `));
  void nextTick(() => input.value?.focus());
}
function selectMention(member: GroupMember): void {
  const token = `@${member.displayName}`;
  replaceMentionToken(token);
  emit('mention', member, token);
}
function selectMentionAll(): void {
  replaceMentionToken(props.labels.mentionAll);
  emit('mentionAll', props.labels.mentionAll);
}
function openFilePicker(accept: string): void {
  fileAccept.value = accept;
  void nextTick(() => fileInput.value?.click());
}
function onFileChange(event: Event): void {
  const target = event.target as HTMLInputElement;
  if (target.files?.length) emit('files', [...target.files]);
  target.value = '';
}
function onPaste(event: ClipboardEvent): void {
  const images = [...(event.clipboardData?.files ?? [])].filter(file => file.type.startsWith('image/'));
  if (!images.length) return;
  event.preventDefault();
  emit('files', images);
}
function onDrop(event: DragEvent): void {
  const files = [...(event.dataTransfer?.files ?? [])];
  if (files.length) emit('files', files);
}
function updateMentionOpen(open: boolean): void { if (!open) mentionDismissed.value = true; }

/** Focus is intentionally controlled by the panel after an explicit user navigation. */
function focusInput(): void { input.value?.focus({ preventScroll: true }); }

defineExpose({ focusInput });

watch(mentionOpen, open => { if (open) mentionActiveIndex.value = 0; });
</script>

<template>
  <!-- Figma 底部输入区定版：180px、与消息区同底、顶描边；工具行(44) + 无边框输入 + 引用条 -->
  <footer class="im-composer" @dragover.prevent @drop.prevent="onDrop">
    <!-- 只读会话不再重复提示：占位符已写明「当前会话只读」，此处只保留禁言场景的提醒 -->
    <p v-if="!canWrite && !readonly" class="im-composer__notice">{{ labels.muted }}</p>
    <div v-if="upload" class="im-composer__upload" aria-live="polite">
      <span><b>{{ labels.uploading }}</b> {{ upload.fileName }}</span>
      <progress v-if="upload.progress !== null" :value="upload.progress" max="1" />
      <span v-else class="im-composer__upload-indeterminate" aria-hidden="true" />
      <button type="button" @click="emit('cancelUpload')">{{ labels.cancel }}</button>
    </div>
    <div v-for="failure in visibleUploadFailures" :key="failure.id" class="im-composer__upload-failure" role="alert">
      <span><b>{{ labels.uploadFailed }}</b> {{ failure.file.name }}<small>{{ failure.error }}</small></span>
      <button type="button" :disabled="Boolean(upload) || failure.conversationId !== activeConversationId" @click="emit('retryUpload', failure)">{{ labels.retry }}</button>
      <button type="button" @click="emit('dismissUploadFailure', failure.id)">{{ labels.cancel }}</button>
    </div>

    <div class="im-composer__toolbar">
      <div class="im-composer__tools">
        <ImIconButton
          ref="emojiButton"
          :label="labels.emoji"
          :title="labels.emojiDevelopment"
          tone="neutral"
          size="md"
          :disabled="!canWrite"
          :pressed="emojiOpen"
          @click="emojiOpen = !emojiOpen"
        ><ImIcon name="emoji" :size="16" /></ImIconButton>
        <!-- 截图入口按产品定版仅 Electron 壳实现（开源组件），web 端不显示 -->
        <ImIconButton
          :label="labels.file"
          :title="labels.file"
          tone="neutral"
          size="md"
          :disabled="!canWrite || Boolean(upload)"
          @click="openFilePicker('')"
        ><ImIcon name="file" :size="16" /></ImIconButton>
        <ImIconButton
          :label="labels.image"
          :title="labels.image"
          tone="neutral"
          size="md"
          :disabled="!canWrite || Boolean(upload)"
          @click="openFilePicker('image/*')"
        ><ImIcon name="photo" :size="16" /></ImIconButton>
      </div>
      <ImIconButton
        :label="labels.history"
        :title="labels.history"
        tone="neutral"
        size="md"
        @click="emit('history')"
      ><ImIcon name="history" :size="16" /></ImIconButton>
    </div>

    <div class="im-composer__row">
      <textarea
        ref="input"
        :value="modelValue"
        :disabled="!canWrite"
        :placeholder="labels.placeholder"
        rows="1"
        @input="updateDraft(($event.target as HTMLTextAreaElement).value)"
        @keydown="onKeydown"
        @paste="onPaste"
      />
      <button type="button" class="im-composer__send" :disabled="!canWrite || !modelValue.trim()" :aria-label="labels.send" @click="emit('send')">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m3.4 4.5 17.4 7.1a.5.5 0 0 1 0 .8L3.4 19.5a.5.5 0 0 1-.7-.6l1.4-5.4 9.4-1.5-9.4-1.5-1.4-5.4a.5.5 0 0 1 .7-.6Z" /></svg>
      </button>
    </div>

    <Transition name="im-composer-quote">
      <div v-if="replyTo" class="im-composer__quote">
        <span class="im-composer__quote-copy"><b>{{ labels.reply }}</b><small>“{{ replyTo.text || replyTo.sender.name || '…' }}”</small></span>
        <button type="button" class="im-composer__quote-close" :aria-label="labels.closeReply" @click="emit('clearReply')">
          <ImIcon name="quoteClose" :size="12" />
        </button>
      </div>
    </Transition>

    <ImFloatingMenu v-model:open="emojiOpen" :anchor="emojiAnchor" placement="top-start" variant="emoji" :label="labels.emojiDevelopment">
      <!-- System Unicode characters only; no Tencent emoji asset-fidelity claim. -->
      <div class="im-composer__emoji-grid">
        <button v-for="emoji in emojiChoices" :key="emoji" type="button" role="menuitem" @click="insertEmoji(emoji)">{{ emoji }}</button>
      </div>
    </ImFloatingMenu>
    <ImFloatingMenu :open="mentionOpen" :anchor="input" :auto-focus="false" placement="top-start" variant="conversation" :label="labels.mentions" @update:open="updateMentionOpen">
      <button v-if="canMentionAll" type="button" role="menuitem" :data-active="mentionActiveIndex === 0" @mouseenter="mentionActiveIndex = 0" @click="selectMentionAll">{{ labels.mentionAll }}</button>
      <button v-for="(member, index) in filteredMentions" :key="member.userId" type="button" role="menuitem" :data-active="mentionActiveIndex === index + (canMentionAll ? 1 : 0)" @mouseenter="mentionActiveIndex = index + (canMentionAll ? 1 : 0)" @click="selectMention(member)">{{ member.displayName }}</button>
    </ImFloatingMenu>
    <input ref="fileInput" class="im-composer__file-input" type="file" multiple :accept="fileAccept" :aria-label="labels.attachmentMenu" @change="onFileChange" />
  </footer>
</template>

<style scoped>
.im-composer { display:flex;height:180px;box-sizing:border-box;flex:0 0 180px;flex-direction:column;border-top:1px solid var(--im-uikit-border-lighter,#ebeef5);padding:0;background:transparent; }
.im-composer__toolbar { display:flex;flex:0 0 44px;align-items:center;justify-content:space-between;padding:8px 16px; }
.im-composer__tools { display:flex;align-items:center;gap:4px; }
.im-composer__toolbar :deep(.im-icon-button) { width:28px;height:28px;padding:6px;color:var(--im-uikit-text-primary,#1f1f1f); }
.im-composer__row { position:relative;display:flex;min-height:0;flex:1;align-items:stretch;padding:4px 16px 8px; }
.im-composer__row textarea { min-width:0;height:100%;box-sizing:border-box;flex:1;margin-right:36px;resize:none;overflow:auto;border:0;border-radius:0;padding:0;outline:0;color:var(--im-uikit-text-primary,#1f1f1f);background:transparent;font:400 var(--im-uikit-font-size-sm,12px)/var(--im-uikit-line-height-composer,22px) var(--im-uikit-font-family); }
.im-composer__row textarea::placeholder { color:var(--im-uikit-text-tertiary,#999); }
.im-composer__row textarea:disabled { cursor:not-allowed; }
.im-composer__send { position:absolute;right:12px;bottom:8px;display:flex;width:28px;height:28px;align-items:center;justify-content:center;border:0;border-radius:var(--im-uikit-radius-xs,4px);padding:5px;color:var(--im-uikit-text-link);background:transparent;cursor:pointer; }
.im-composer__send svg { width:100%;height:100%;fill:currentColor; }
.im-composer__send:focus-visible { outline:none;box-shadow:var(--im-uikit-focus-ring); }
.im-composer__send:disabled { color:var(--im-uikit-text-disabled);background:transparent;cursor:not-allowed; }
/* Figma 引用条：#ebebeb 圆角8、12px 提示灰、右侧 16px 关闭 */
.im-composer__quote { display:flex;min-height:25px;flex:0 0 auto;align-items:center;justify-content:space-between;gap:10px;margin:0 16px 12px;border-radius:var(--im-uikit-radius-md,8px);padding:4px 8px;background:var(--im-uikit-bg-field,#ebebeb); }
.im-composer-quote-enter-active,.im-composer-quote-leave-active { transition:opacity .2s ease-out,transform .2s ease-out;transform-origin:bottom; }
.im-composer-quote-enter-from,.im-composer-quote-leave-to { opacity:0;transform:translateY(10px); }
.im-composer__quote-copy { display:flex;min-width:0;align-items:center;gap:4px;overflow:hidden;color:var(--im-uikit-text-tertiary,#999);font-size:var(--im-uikit-font-size-sm,12px);line-height:17px; }
.im-composer__quote-copy b,.im-composer__quote-copy small { overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:inherit;font-weight:400; }
.im-composer__quote-close { display:flex;width:16px;height:16px;flex:0 0 auto;align-items:center;justify-content:center;border:0;border-radius:50%;padding:0;color:var(--im-uikit-text-tertiary,#999);background:transparent;cursor:pointer; }
.im-composer__quote-close:focus-visible { outline:none;box-shadow:var(--im-uikit-focus-ring); }
.im-composer__notice { margin:8px 16px 0;color:var(--im-uikit-text-error);font-size:var(--im-uikit-font-size-sm);line-height:var(--im-uikit-line-height-sm); }
.im-composer__upload { display:grid;grid-template-columns:minmax(0,1fr) 96px auto;align-items:center;gap:8px;margin:8px 16px 0;color:var(--im-uikit-text-secondary);font-size:var(--im-uikit-font-size-sm);line-height:var(--im-uikit-line-height-sm); }
.im-composer__upload>span:first-child { overflow:hidden;text-overflow:ellipsis;white-space:nowrap; }
.im-composer__upload progress { width:96px;height:4px;accent-color:var(--im-uikit-text-link); }
.im-composer__upload button { border:0;padding:2px 6px;color:var(--im-uikit-text-link);background:transparent;cursor:pointer; }
.im-composer__upload-failure { display:grid;grid-template-columns:minmax(0,1fr) auto auto;align-items:center;gap:8px;margin:8px 16px 0;color:var(--im-uikit-text-error);font-size:var(--im-uikit-font-size-sm);line-height:var(--im-uikit-line-height-sm); }
.im-composer__upload-failure>span { display:grid;min-width:0; }
.im-composer__upload-failure b,.im-composer__upload-failure small { overflow:hidden;text-overflow:ellipsis;white-space:nowrap; }
.im-composer__upload-failure small { color:var(--im-uikit-text-tertiary);font-weight:400; }
.im-composer__upload-failure button { border:0;padding:2px 6px;color:var(--im-uikit-text-link);background:transparent;cursor:pointer; }
.im-composer__upload-failure button:disabled { color:var(--im-uikit-text-disabled);cursor:not-allowed; }
.im-composer__upload-indeterminate { width:96px;height:4px;overflow:hidden;border-radius:2px;background:linear-gradient(90deg,var(--im-uikit-bg-field) 0 35%,var(--im-uikit-text-link) 50%,var(--im-uikit-bg-field) 65% 100%);background-size:200% 100%;animation:im-composer-upload 1.2s linear infinite; }
@keyframes im-composer-upload { to { background-position:-200% 0; } }
@media (prefers-reduced-motion: reduce) {
  .im-composer-quote-enter-active,.im-composer-quote-leave-active { transition-duration:.001ms!important; }
  .im-composer__upload-indeterminate { animation-duration:.001ms!important;animation-iteration-count:1!important; }
}
.im-composer__emoji-grid { display:grid;grid-template-columns:repeat(9,24px);gap:8px; }
.im-composer__emoji-grid button { width:24px!important;height:24px!important;min-height:24px!important;flex-basis:24px!important;justify-content:center!important;padding:1px!important;font-size:16px!important;line-height:22px!important; }
:global(.im-floating-menu [role="menuitem"][data-active="true"]) { background:var(--im-uikit-bg-dropdown-hover); }
.im-composer__file-input { position:fixed;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap; }
</style>

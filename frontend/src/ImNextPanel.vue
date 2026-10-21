<script setup lang="ts">
import { computed, inject, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { canSend } from './domain/rules';
import { canForwardMessage, localizeMergedMessagesCard } from './domain/forward';
import { buildCardDisplayModel, type CardDisplayAction, type CardDisplayModel } from './domain/card-renderer-registry';
import { localizeEditRequestCard as localizeTypedEditRequestCard } from './domain/edit-request-card';
import { highlightParts } from './domain/search';
import { buildMessagePresentations, linkifyMessageText } from './domain/message-presentation';
import { formatSystemMessage } from './domain/system-message';
import { shouldAutoFocusComposer } from './domain/composer-focus';
import { formatImClock, formatImDivider, imCalendarDay, isImSameCalendarDay, normalizeIanaTimezone } from './domain/time-format';
import { revokeErrorMessageKey } from './domain/revoke-error';
import { useImController } from './controller';
import type { Attachment, Conversation, Message, OrgUnit, User } from './domain/types';
import { readHostCapability, report, type ImNextHostBridge } from './host-bridge';
import { IM_WINDOW_PLATFORM } from './domain/window-platform';
import { createHostUi, type OpenConfirmRequest } from '@kimposoft/plugin-sdk/ui';
import ImSearchBar from './components/conversations/ImSearchBar.vue';
import ImAvatar from './components/primitives/ImAvatar.vue';
import ImConversationList from './components/conversations/ImConversationList.vue';
import ImChatHeader from './components/chat/ImChatHeader.vue';
import { conversationHeaderSubtitle } from './components/chat/chat-header-model';
import ImIconButton from './components/primitives/ImIconButton.vue';
import ImFloatingMenu from './components/primitives/ImFloatingMenu.vue';
import ImVirtualMessageList from './components/messages/ImVirtualMessageList.vue';
import ImMessageItem, { type ImMessageAction } from './components/messages/ImMessageItem.vue';
import ImMessageStatus from './components/messages/ImMessageStatus.vue';
import ImBusinessCard from './components/cards/ImBusinessCard.vue';
import ImMessageComposer, { type ImComposerUploadFailure } from './components/composer/ImMessageComposer.vue';
import ImChatSetting from './components/settings/ImChatSetting.vue';
import ImSettingSection from './components/settings/ImSettingSection.vue';
import ImSettingSwitchRow from './components/settings/ImSettingSwitchRow.vue';
import ImImagePreviewToolbar from './components/preview/ImImagePreviewToolbar.vue';
import ImContactDetailDialog from './components/contacts/ImContactDetailDialog.vue';
import ImContactGroupSections from './components/contacts/ImContactGroupSections.vue';
import ImGroupDetailDialog from './components/contacts/ImGroupDetailDialog.vue';
import ImOrganizationTree from './components/contacts/ImOrganizationTree.vue';
import { contactDetailFromUser } from './components/contacts/contact-detail-model';
import ImNotificationPreferences from './components/preferences/ImNotificationPreferences.vue';
import ImIcon from './components/primitives/ImIcon.vue';
import ImDialogHeader from './components/primitives/ImDialogHeader.vue';
import ImBrandLogo from './components/primitives/ImBrandLogo.vue';
import ImBrandWatermark from './components/primitives/ImBrandWatermark.vue';
import ImChatHistoryDialog from './components/history/ImChatHistoryDialog.vue';
import {
  adjacentImagePreviewIndex,
  imagePreviewIndex,
  stepImagePreviewZoom,
  uniqueImagePreviewAttachments
} from './components/preview/image-preview-model';
import './ui/im-uikit-tokens.css';
import zh from '../locales/zh-CN.json';
import en from '../locales/en-US.json';

const props = defineProps<{ hostBridge?: ImNextHostBridge }>();
const c = useImController(props.hostBridge);
// 确认框、输入框走宿主界面服务总线（SDK 门面），禁止原生 window.confirm / prompt。
const hostUi = createHostUi(props.hostBridge);
/**
 * 弹宿主确认框；取消/关闭=false。服务取不到（单测、无宿主）或调用失败时按「取消」处理并上报日志，
 * 不回退原生弹框。
 */
async function confirmAction(req: OpenConfirmRequest): Promise<boolean> {
  try {
    return (await hostUi.openConfirm(req)).confirmed;
  } catch (err) {
    report(props.hostBridge, 'warn', 'im_next.ui_confirm_unavailable', { error: String(err) });
    return false;
  }
}
/** 弹宿主输入框；取消/服务不可用返回 null（调用方据此中止），确认返回输入原文（空串合法）。 */
async function promptText(req: Parameters<typeof hostUi.openPrompt>[0]): Promise<string | null> {
  try {
    const result = await hostUi.openPrompt(req);
    return result.confirmed ? result.value : null;
  } catch (err) {
    report(props.hostBridge, 'warn', 'im_next.ui_prompt_unavailable', { error: String(err) });
    return null;
  }
}
const messageList = ref<InstanceType<typeof ImVirtualMessageList>>();
const composer = ref<InstanceType<typeof ImMessageComposer>>();
const sidebarSearch = ref<InstanceType<typeof ImSearchBar>>();
const chatSettingsButton = ref<InstanceType<typeof ImIconButton>>();
const chatTabButton = ref<HTMLButtonElement>();
const contactsTabButton = ref<HTMLButtonElement>();
const createMenuButton = ref<HTMLButtonElement>();
const createMenuOpen = ref(false);
const memberList = ref<HTMLElement>();
const previewDialog = ref<HTMLElement>();
const expandedUnits = ref(new Set<string>());
const reactionTargetId = ref<string>();
const mergedViewer = ref<Message>();
const receiptDetailId = ref<string>();
// 需求7（2026-08-11）：当天分隔线的展开态，按 message.id 记录。消息区走虚拟滚动，行组件会随
// 滚动被回收/复用/重建，状态若存在行内部会随行回收丢失；提到这层外层 ref 后与 message.id 绑定，
// 不管某条消息此刻是否仍挂在 DOM 上，只要它还在 c.messages.value 里，展开态就不会丢。
const expandedDividers = ref(new Set<string>());
const liveAnnouncement = ref('');
const unreadBoundary = ref(0);
const groupDialog = ref<'create' | 'invite'>();
const groupDialogSurface = ref<HTMLElement>();
const groupDialogExpandedUnits = ref(new Set<string>());
const groupDialogUnitErrors = ref(new Set<string>());
const groupName = ref('');
const groupEditName = ref('');
const groupAvatarFile = ref<File>();
const failedUploads = ref<ImComposerUploadFailure[]>([]);
const previewZoom = ref(1);
const cardActionBusy = ref(new Set<string>());
const selectedContact = ref<User>();
const contactReturnFocus = ref<HTMLElement | null>(null);
const selectedGroupDetail = ref<Conversation>();
const groupDetailReturnFocus = ref<HTMLElement | null>(null);
const notificationSettingsTrigger = ref<HTMLButtonElement>();
const notificationPreferencesOpen = ref(false);
// Figma 改版新增：rail 汉堡菜单开合 + 通讯录页「通讯录/群聊」分段页签
const moreMenuOpen = ref(false);
const contactsTab = ref<'directory' | 'groups'>('directory');
// 2026-08-11 增量：头像在线状态菜单 + 聊天记录浮层
const presenceMenuOpen = ref(false);
const selfAvatarButton = ref<HTMLButtonElement>();
const historyOpen = ref(false);
// 手动在线状态模式（auto/busy/invisible，用户级多端共享，经 SDK preferences 读写）
const presenceMode = ref<'auto' | 'busy' | 'invisible'>('auto');
// 单聊自己消息的常驻已读/未读：按消息惰性拉取回执（有缓存），此集合防止重复在途请求
const receiptRequested = new Set<string>();
let failedUploadId = 0;
const emojiChoices = ['😀', '😂', '🥰', '😮', '😢', '👍', '👏', '🎉'];
let previewReturnFocus: HTMLElement | null = null;
let groupDialogReturnFocus: HTMLElement | null = null;
let chatSettingReturnFocus: HTMLElement | null = null;
let highlightTimer: ReturnType<typeof setTimeout> | undefined;
let stopRealtime: (() => void) | undefined;
let historyRequestPending = false;
let viewportSyncVersion = 0;
let panelMounted = false;
let initialRefreshPromise: Promise<void> | undefined;
let consumingPendingId: string | undefined;
const dictionary = computed(() => readHostCapability(props.hostBridge, 'locale') === 'en-US' ? en : zh);
const t = (key: keyof typeof zh): string => dictionary.value[key] ?? key;
/**
 * 「打开桌面端」入口是否可用：宿主注入了 openDesktopApp 能力才渲染。
 *
 * 🔴 唤起逻辑（一次性配对码、kimpo-chat:// deep link、失败降级到下载弹窗）**全在宿主**，
 * 插件只出一个菜单项并把点击转交出去——那属于宿主的客户端分发业务，不是 IM 的职责。
 * 宿主在桌面壳内、或未启用云端分发时不注入本能力，此处即不渲染，避免留下点了没反应的死入口。
 */
const canOpenDesktopApp = computed(() => typeof readHostCapability(props.hostBridge, 'openDesktopApp') === 'function');

function handleOpenDesktopApp(): void {
  moreMenuOpen.value = false;
  try {
    readHostCapability(props.hostBridge, 'openDesktopApp')?.();
  } catch (err) {
    report(props.hostBridge, 'warn', 'im.rail.open_desktop_failed', { error: String(err) });
  }
}

const displayLocale = computed(() => readHostCapability(props.hostBridge, 'locale') === 'en-US' ? 'en-US' : 'zh-CN');
const displayTimezone = computed(() => {
  try { return normalizeIanaTimezone(readHostCapability(props.hostBridge, 'im')?.time.currentTimezone()); }
  catch { return 'UTC'; }
});
const online = computed(() => {
  try { return readHostCapability(props.hostBridge, 'ws')?.getState() === 'open'; } catch { return false; }
});
const chatHeaderSubtitle = computed(() => c.activeConversation.value
  ? conversationHeaderSubtitle(c.activeConversation.value, {
    online: t('presence.online'), busy: t('presence.busy'), connecting: t('presence.connecting'), offline: t('presence.offline'),
    department: t('department'), members: t('members')
  })
  : undefined);
const chatHeaderPresence = computed(() => {
  const conversation = c.activeConversation.value;
  return conversation?.kind === 'single'
    && (conversation.connection === 'online' || conversation.connection === 'busy' || conversation.connection === 'offline')
    ? conversation.connection
    : undefined;
});
const messagePresentations = computed(() => buildMessagePresentations(
  c.messages.value,
  unreadBoundary.value,
  5 * 60_000,
  displayTimezone.value
));
const composerMentionCandidates = computed(() => c.mentionCandidates.value.filter(member => member.userId !== c.snapshot.value.self?.id));
const previewImageAttachments = computed(() => uniqueImagePreviewAttachments(c.messages.value.flatMap(message => message.kind === 'image' && message.attachment ? [message.attachment] : [])));
const previewAssetIsImage = computed(() => c.preview.value.status !== 'closed' && c.preview.value.asset.mimeType.startsWith('image/'));
const previewImageIndex = computed(() => c.preview.value.status === 'closed' ? -1 : imagePreviewIndex(previewImageAttachments.value, c.preview.value.asset.assetId));
const previewImageStageStyle = computed(() => previewZoom.value >= 1
  ? { width: `${previewZoom.value * 100}%`, height: `${previewZoom.value * 100}%` }
  : { width: '100%', height: '100%' });
const previewImageStyle = computed(() => previewZoom.value >= 1
  ? { width: '100%', height: '100%' }
  : { width: `${previewZoom.value * 100}%`, height: `${previewZoom.value * 100}%` });
const groupExistingMemberIds = computed(() => groupDialog.value === 'invite' ? new Set(c.groupMembers.value.map(member => member.userId)) : new Set<string>());
const groupDisabledMemberIds = computed(() => new Set([
  ...(c.snapshot.value.self ? [c.snapshot.value.self.id] : []),
  ...groupExistingMemberIds.value
]));
const groupSearchCandidates = computed(() => c.groupCandidateSearch.value.users);
const singleSettingUser = computed<User | undefined>(() => {
  const conversation = c.activeConversation.value;
  if (conversation?.kind !== 'single' || !conversation.peerUserId) return undefined;
  return c.loadedContacts.value.find(user => user.id === conversation.peerUserId) ?? {
    id: conversation.peerUserId, name: conversation.title, avatar: conversation.avatar, departments: []
  };
});
// Group sections always project from the complete conversation snapshot, never from contact search/tree expansion.
const contactDepartmentGroups = computed(() => c.snapshot.value.conversations.filter(item => item.kind === 'department' && !item.hidden));
const contactOrdinaryGroups = computed(() => c.snapshot.value.conversations.filter(item => item.kind === 'group' && !item.hidden));
const selectedContactDetail = computed(() => selectedContact.value ? contactDetailFromUser(selectedContact.value) : undefined);
const canMessageSelectedContact = computed(() => Boolean(selectedContact.value && selectedContact.value.id !== c.snapshot.value.self?.id));
const notificationPreferenceClient = computed(() => {
  try { return readHostCapability(props.hostBridge, 'im')?.preferences; }
  catch { return undefined; }
});
const createMenuAnchor = computed(() => createMenuButton.value);
const settingMemberPreview = computed(() => c.groupMembers.value.slice(0, 8));
// 标题栏自己头像（2026-10-17 由 rail 底部移到顶部标题栏）：presence 点 = 手动模式 + WS 连接态合成（与他人所见一致）
const selfUser = computed(() => c.snapshot.value.self);
// 标题栏部门：多部门用「 · 」连接，过长由 CSS 省略、悬停 title 看全称
const selfDepartments = computed(() => (selfUser.value?.departments ?? []).filter(Boolean).join(' · '));
// 窗口形态平台由外壳 provide（见 ImFloatingShell）；单独挂载面板（单测）时没有外壳，按 'other' 排布
const windowPlatform = inject(IM_WINDOW_PLATFORM, computed(() => 'other' as const));
const selfPresence = computed<'online' | 'busy' | 'offline'>(() => {
  if (presenceMode.value === 'invisible') return 'offline';
  if (presenceMode.value === 'busy') return online.value ? 'busy' : 'offline';
  return online.value ? 'online' : 'offline';
});
// 菜单勾选项：在线=auto / 忙碌=busy / 离线（隐身）=invisible
const presenceMenuChecked = computed<'online' | 'busy' | 'offline'>(() =>
  presenceMode.value === 'busy' ? 'busy' : presenceMode.value === 'invisible' ? 'offline' : 'online');

/** 视觉规范已画、能力尚未落地的入口统一提示建设中 */
function notifyDeveloping(): void {
  readHostCapability(props.hostBridge, 'message')?.warning(t('feature.developing'));
}

/** 头像状态菜单：菜单项 → 手动模式，乐观更新，失败回滚并提示 */
async function selectPresence(target: 'online' | 'busy' | 'offline'): Promise<void> {
  const mode = target === 'online' ? 'auto' : target === 'busy' ? 'busy' : 'invisible';
  if (mode === presenceMode.value) return;
  const client = notificationPreferenceClient.value;
  // 方法级探测（而非只判 preferences 对象存在）：宿主前端产物比插件旧时，preferences 对象在、
  // 但没有 updatePresenceMode 方法，调用会抛 TypeError 被下面 catch 吞掉，误报成「稍后重试」
  // 这种网络故障口径。2026-08-11 真机就踩过一次（宿主 dist 落后插件一天），此处如实报「宿主不支持」。
  if (!client || typeof client.updatePresenceMode !== 'function') {
    readHostCapability(props.hostBridge, 'message')?.error(t('preference.unavailable'));
    return;
  }
  const previous = presenceMode.value;
  presenceMode.value = mode;
  try {
    await client.updatePresenceMode(mode);
  } catch {
    presenceMode.value = previous;
    readHostCapability(props.hostBridge, 'message')?.error(t('presence.switchFailed'));
  }
}

/** 初始加载自己的手动状态模式（失败静默保持 auto，不阻塞面板） */
async function loadPresenceMode(): Promise<void> {
  try {
    const mode = await notificationPreferenceClient.value?.getPresenceMode();
    if (mode) presenceMode.value = mode;
  } catch {
    report(props.hostBridge, 'warn', 'im_next.presence_mode_load_failed', {});
  }
}

/**
 * 时钟入口：普通会话=消息 seq 游标翻页；系统通知会话=通知 offset 翻页。
 * 游标由此处闭包持有，浮层只调用无参 fetchPage——两种分页形态不泄漏进浮层。
 */
const historySource = ref<'messages' | 'notifications'>('messages');
let historyFetcher: (() => Promise<{ items: Message[]; done: boolean }>) | undefined;
function openChatHistory(): void {
  const conversation = c.activeConversation.value;
  if (!conversation) return;
  if (conversation.kind === 'system') {
    historySource.value = 'notifications';
    let offset = 0;
    historyFetcher = async () => {
      const page = await c.fetchNotificationSlice(conversation.id, offset, 100);
      offset += page.items.length;
      return { items: page.items, done: page.items.length === 0 || offset >= page.total };
    };
  } else {
    historySource.value = 'messages';
    let beforeSeq = conversation.lastSeq + 1;
    historyFetcher = async () => {
      const items = await c.fetchHistorySlice(conversation.id, beforeSeq, 100);
      if (items.length) beforeSeq = Math.min(...items.map(item => item.seq));
      return { items, done: items.length < 100 || beforeSeq <= 1 };
    };
  }
  historyOpen.value = true;
}
function historyFetchPage(): Promise<{ items: Message[]; done: boolean }> {
  return historyFetcher ? historyFetcher() : Promise.resolve({ items: [], done: true });
}

/** 单聊自己消息的常驻回执标签；仅在回执已就绪且未被禁用时给出文案 */
function inlineReceiptLabel(message: Message): string | undefined {
  if (c.activeConversation.value?.kind !== 'single') return undefined;
  if (message.sender.id !== c.snapshot.value.self?.id) return undefined;
  const receipt = message.receipt;
  if (!receipt || receipt.status !== 'ready' || receipt.mode === 'disabled') return undefined;
  return (receipt.readCount || receipt.readUserIds?.length) ? t('receipt.read') : t('receipt.unread');
}
function inlineReceiptUnread(message: Message): boolean {
  const receipt = message.receipt;
  return Boolean(receipt && receipt.status === 'ready' && !(receipt.readCount || receipt.readUserIds?.length));
}

function activateSidebarTab(tab: 'chats' | 'contacts'): void {
  c.activeTab.value = tab;
}
function onSidebarTabKeydown(event: KeyboardEvent): void {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
  event.preventDefault();
  const target = event.key === 'ArrowLeft' || event.key === 'Home' ? 'chats' : 'contacts';
  activateSidebarTab(target);
  void nextTick(() => (target === 'chats' ? chatTabButton.value : contactsTabButton.value)?.focus());
}

async function startSingleFromCreateMenu(): Promise<void> {
  createMenuOpen.value = false;
  c.activeTab.value = 'contacts';
  c.query.value = '';
  await nextTick();
  // The create menu opts out of trigger restoration because this selection
  // navigates to a new workflow; land keyboard users in its search field.
  requestAnimationFrame(() => sidebarSearch.value?.focus());
}
function createGroupFromCreateMenu(): void {
  createMenuOpen.value = false;
  openGroupDialog('create');
}
function revealMemberList(): void {
  memberList.value?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  memberList.value?.focus({ preventScroll: true });
}

function openNotificationPreferences(): void {
  if (!notificationPreferenceClient.value) {
    readHostCapability(props.hostBridge, 'message')?.error(t('preference.unavailable'));
    return;
  }
  notificationPreferencesOpen.value = true;
}

function modalSurfaceOpen(): boolean {
  return Boolean(c.drawerOpen.value || selectedContact.value || selectedGroupDetail.value || notificationPreferencesOpen.value
    || groupDialog.value || c.forwardOpen.value || mergedViewer.value || c.preview.value.status !== 'closed');
}

async function focusComposerAfterUserSelection(): Promise<void> {
  await nextTick();
  const coarsePointer = typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;
  if (!shouldAutoFocusComposer({
    canWrite: c.canWrite.value,
    modalOpen: modalSurfaceOpen(),
    viewportWidth: window.innerWidth,
    coarsePointer
  })) return;
  composer.value?.focusInput();
}

function openChatSetting(): void {
  const trigger = chatSettingsButton.value?.$el;
  chatSettingReturnFocus = trigger instanceof HTMLElement ? trigger : document.activeElement instanceof HTMLElement ? document.activeElement : null;
  groupEditName.value = c.activeConversation.value?.title ?? '';
  groupAvatarFile.value = undefined;
  c.drawerOpen.value = true;
}
function closeChatSetting(): void {
  c.drawerOpen.value = false;
  const target = chatSettingReturnFocus;
  chatSettingReturnFocus = null;
  void nextTick(() => target?.isConnected && target.focus());
}

async function toggleSettingPreference(action: 'pin' | 'mute'): Promise<void> {
  const conversation = c.activeConversation.value;
  if (!conversation) return;
  try {
    if (action === 'pin') await c.togglePinned(conversation);
    else await c.toggleMuted(conversation);
  } catch {
    readHostCapability(props.hostBridge, 'message')?.error(t('error.conversationAction'));
  }
}

function openGroupDialog(mode: 'create' | 'invite'): void {
  const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  groupDialogReturnFocus = mode === 'create' ? createMenuButton.value ?? active : active;
  groupDialog.value = mode;
  groupName.value = '';
  groupDialogExpandedUnits.value = new Set();
  groupDialogUnitErrors.value = new Set();
  c.resetGroupCandidateSearch();
  c.resetGroupCandidateSelection();
  // The create menu restores its own trigger after selection, so focus the
  // modal on the next frame after the teleported menu has fully closed.
  requestAnimationFrame(() => groupDialogSurface.value?.querySelector<HTMLElement>('button:not([disabled]), input:not([disabled])')?.focus());
}
function closeGroupDialog(): void {
  groupDialog.value = undefined;
  c.resetGroupCandidateSearch();
  c.resetGroupCandidateSelection();
  const target = groupDialogReturnFocus;
  groupDialogReturnFocus = null;
  void nextTick(() => target?.isConnected && target.focus());
}
function trapGroupDialogFocus(event: KeyboardEvent): void {
  const dialog = groupDialogSurface.value;
  if (!dialog) return;
  const focusable = [...dialog.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex="-1"])')];
  if (!focusable.length) { event.preventDefault(); dialog.focus(); return; }
  const first = focusable[0];
  const last = focusable.at(-1)!;
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
}
function isGroupCandidateDisabled(user: User): boolean {
  return user.id === c.snapshot.value.self?.id || groupExistingMemberIds.value.has(user.id);
}
function toggleVisibleGroupCandidate(user: User): void {
  if (!isGroupCandidateDisabled(user)) c.toggleGroupCandidate(user);
}
async function toggleGroupDialogUnit(unit: OrgUnit): Promise<void> {
  if (groupDialogExpandedUnits.value.has(unit.id)) {
    const next = new Set(groupDialogExpandedUnits.value);
    next.delete(unit.id);
    groupDialogExpandedUnits.value = next;
    return;
  }
  await retryGroupDialogUnit(unit);
}
async function retryGroupDialogUnit(unit: OrgUnit): Promise<void> {
  const errors = new Set(groupDialogUnitErrors.value);
  errors.delete(unit.id);
  groupDialogUnitErrors.value = errors;
  const loaded = await c.expandDepartment(unit);
  if (!loaded) {
    const failed = new Set(groupDialogUnitErrors.value);
    failed.add(unit.id);
    groupDialogUnitErrors.value = failed;
    // Keep the failed branch exposed so its retry treeitem remains reachable.
    const expanded = new Set(groupDialogExpandedUnits.value);
    expanded.add(unit.id);
    groupDialogExpandedUnits.value = expanded;
    return;
  }
  const expanded = new Set(groupDialogExpandedUnits.value);
  expanded.add(unit.id);
  groupDialogExpandedUnits.value = expanded;
}
async function submitGroupDialog(): Promise<void> {
  try {
    if (groupDialog.value === 'create') await c.createGroup(groupName.value, [...c.groupCandidateSelectedIds.value]);
    else await c.inviteGroupMembers([...c.groupCandidateSelectedIds.value]);
    if (c.groupOperation.value.status === 'success') closeGroupDialog();
  } catch { readHostCapability(props.hostBridge, 'message')?.error(c.groupOperation.value.error || t('group.operation.error')); }
}
async function kickMember(member: typeof c.groupMembers.value[number]): Promise<void> {
  // 踢出成员不可恢复，用 error 档
  if (!(await confirmAction({ content: t('group.kickConfirm'), type: 'error' }))) return;
  await c.kickGroupMembers([member]);
}
function isGroupRolePending(member: typeof c.groupMembers.value[number]): boolean {
  return c.groupRoleOperation.value.status === 'pending' && c.groupRoleOperation.value.userId === member.userId;
}
async function toggleMemberAdmin(member: typeof c.groupMembers.value[number]): Promise<void> {
  try { await c.setGroupMemberAdmin(member, member.role !== 'admin'); }
  catch { readHostCapability(props.hostBridge, 'message')?.error(c.groupRoleOperation.value.error || t('group.roleError')); }
}
async function transferOwnership(member: typeof c.groupMembers.value[number]): Promise<void> {
  try {
    await c.transferGroupOwnership(member, () => confirmAction({ content: `${t('group.transferOwnerConfirm')}\n${member.displayName}`, type: 'error' }));
  } catch { readHostCapability(props.hostBridge, 'message')?.error(c.groupRoleOperation.value.error || t('group.roleError')); }
}
async function toggleGroupMuteAll(enabled: boolean): Promise<void> {
  try { await c.setGroupMuteAll(enabled); }
  catch { readHostCapability(props.hostBridge, 'message')?.error(c.groupGovernanceError.value || t('group.governanceError')); }
}
async function toggleMemberSendMuted(member: typeof c.groupMembers.value[number]): Promise<void> {
  try { await c.setGroupMemberSendMuted(member, !member.sendMuted); }
  catch { readHostCapability(props.hostBridge, 'message')?.error(c.groupGovernanceError.value || t('group.governanceError')); }
}
async function saveAnnouncement(): Promise<void> {
  try { await c.saveAnnouncement(); }
  catch { readHostCapability(props.hostBridge, 'message')?.error(c.groupGovernanceError.value || t('group.governanceError')); }
}
async function clearAnnouncement(): Promise<void> {
  try { await c.clearAnnouncement(); }
  catch { readHostCapability(props.hostBridge, 'message')?.error(c.groupGovernanceError.value || t('group.governanceError')); }
}
async function saveGroupInfo(): Promise<void> {
  try { await c.updateGroupInfo(groupEditName.value, groupAvatarFile.value); groupAvatarFile.value = undefined; }
  catch { readHostCapability(props.hostBridge, 'message')?.error(c.groupOperation.value.error || t('group.operation.error')); }
}
async function leaveGroup(): Promise<void> { if (await confirmAction({ content: t('group.leaveConfirm'), type: 'warning' })) await c.leaveGroup(); }
async function dissolveGroup(): Promise<void> { if (await confirmAction({ content: t('group.dissolveConfirm'), type: 'error' })) await c.dissolveGroup(); }
async function markVisibleNotificationsRead(): Promise<void> {
  try { await c.markVisibleNotificationsRead(); }
  catch (error) { readHostCapability(props.hostBridge, 'message')?.error(error instanceof Error ? error.message : t('group.operation.error')); }
}
function groupOperationLabel(): string {
  const state = c.groupOperation.value;
  const base = t(`group.operation.${state.status}` as keyof typeof zh);
  if (state.status !== 'partial') return state.error ? `${base}：${state.error}` : base;
  return `${base}：${t('group.operation.counts').replace('{success}', String(state.succeededIds?.length ?? 0)).replace('{failed}', String(state.failedIds?.length ?? 0))}`;
}

async function sendFiles(files: readonly File[]): Promise<void> {
  const conversationId = c.activeConversation.value?.id;
  if (!conversationId) return;
  for (const file of files) {
    if (c.activeConversation.value?.id !== conversationId) {
      failedUploads.value.push({ id: ++failedUploadId, conversationId, file, error: t('upload.conversationChanged') });
      continue;
    }
    try { await c.sendFile(file); }
    catch (error) {
      const message = error instanceof Error ? error.message : t('error.upload');
      failedUploads.value.push({ id: ++failedUploadId, conversationId, file, error: message });
      readHostCapability(props.hostBridge, 'message')?.error(message);
    }
  }
}
async function retryUpload(failure: ImComposerUploadFailure): Promise<void> {
  if (failure.conversationId !== c.activeConversation.value?.id) return;
  dismissUploadFailure(failure.id);
  await sendFiles([failure.file]);
}
function dismissUploadFailure(id: number): void {
  failedUploads.value = failedUploads.value.filter(item => item.id !== id);
}
function registerMention(member: typeof c.groupMembers.value[number], token: string): void {
  c.addMention(member.userId, token);
}
function registerMentionAll(token: string): void {
  c.addMentionAll(token);
}
async function preview(attachment: Attachment): Promise<void> {
  if (typeof document !== 'undefined' && document.activeElement instanceof HTMLElement) previewReturnFocus = document.activeElement;
  await c.openAttachment(attachment);
  await nextTick();
  previewDialog.value?.focus();
}
async function navigatePreview(direction: -1 | 1): Promise<void> {
  const index = adjacentImagePreviewIndex(previewImageIndex.value, previewImageAttachments.value.length, direction);
  if (index === undefined) return;
  const attachment = previewImageAttachments.value[index];
  if (attachment) await c.openAttachment(attachment);
}
function changePreviewZoom(direction: -1 | 1): void {
  previewZoom.value = stepImagePreviewZoom(previewZoom.value, direction);
}
function resetPreviewZoom(): void { previewZoom.value = 1; }
function closePreview(): void {
  c.closePreview();
  void nextTick(() => previewReturnFocus?.focus());
}
function trapPreviewFocus(event: KeyboardEvent): void {
  const dialog = previewDialog.value;
  if (!dialog) return;
  const focusable = [...dialog.querySelectorAll<HTMLElement>('button:not([disabled]),a[href],video[controls],iframe')];
  if (!focusable.length) { event.preventDefault(); dialog.focus(); return; }
  const first = focusable[0]; const last = focusable.at(-1)!;
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
}
function labelAttachment(attachment: Attachment): string { return attachment.mimeType.startsWith('video/') ? `${t('video')} · ${attachment.fileName}` : attachment.fileName; }
function messageTime(message: Message): string {
  return formatImClock(message.createdAt, displayTimezone.value, displayLocale.value);
}
/**
 * 聊天记录浮层的日期分组头（2026/07/01 式，微信同款，随宿主时区/语言）。
 * 2026-08-11：改为先用 imCalendarDay 折算日历日（与浮层内部的日期筛选 key 完全同源），
 * 再用 UTC 正午锚点本地化渲染——避免"分组头"文案与"筛选 key"因走不同格式化路径而错位。
 */
function historyDateLabel(message: Message): string {
  const day = imCalendarDay(message.createdAt, displayTimezone.value); // 'YYYY-MM-DD'
  const [year, month, date] = day.split('-').map(Number);
  return new Intl.DateTimeFormat(displayLocale.value, {
    timeZone: 'UTC', year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(new Date(Date.UTC(year, month - 1, date, 12)));
}
/**
 * 需求7：分隔线"当天"判据必须走宿主时区（displayTimezone），不能用浏览器本地时区。
 * isImSameCalendarDay 是纯函数，"现在"由这里显式传入（new Date().toISOString()），
 * 时区折算全部发生在该函数内部，与 imCalendarDay 同源，不会与分隔线文案本身错位。
 */
function isTodayDivider(message: Message): boolean {
  return isImSameCalendarDay(message.createdAt, new Date().toISOString(), displayTimezone.value);
}
/** 分隔线的完整日期时间文案，非当天恒定展示；当天仅在展开态展示，同时兼作 title/aria-label 兜底。 */
function dividerFullLabel(message: Message): string {
  return formatImDivider(message.createdAt, displayTimezone.value, displayLocale.value);
}
/** 分隔线展示文案：当天默认短时间「15:42」，点击展开或非当天消息则用完整「8月11日 15:42」。 */
function dividerText(message: Message): string {
  if (!isTodayDivider(message) || expandedDividers.value.has(message.id)) return dividerFullLabel(message);
  return formatImClock(message.createdAt, displayTimezone.value, displayLocale.value);
}
/** 当天分隔线的点击态切换（沿用 toggleUnit 一样的不可变 Set 更新写法）；非当天分隔线模板里根本不渲染成按钮，不会调用到这里。 */
function toggleDivider(message: Message): void {
  const next = new Set(expandedDividers.value);
  next.has(message.id) ? next.delete(message.id) : next.add(message.id);
  expandedDividers.value = next;
}
function conversationTime(conversation: Conversation): string { return formatImClock(conversation.updatedAt, displayTimezone.value, displayLocale.value); }
function messageActions(message: Message): ImMessageAction[] {
  // Figma 定版菜单顺序：引用/转发/多选/…/撤回（红字）；删除因 SDK 无对应能力暂缺
  const actions: ImMessageAction[] = [{ key: 'reply', label: t('quote') }];
  if (canForwardMessage(message)) actions.push({ key: 'forward', label: t('message.forward') });
  if (c.activeConversation.value?.kind !== 'system' && !c.selectionMode.value) actions.push({ key: 'multiselect', label: t('multi.select') });
  if (message.kind === 'text') actions.push({ key: 'copy', label: t('message.copy') });
  // 单聊回执改为气泡旁常驻展示（见 inlineReceiptLabel），仅群聊保留菜单入口
  if (c.canLoadReceipt(message) && c.activeConversation.value?.kind !== 'single') actions.push({ key: 'receipt', label: t('receipt.action') });
  actions.push({ key: 'reaction', label: t('message.react') });
  if (c.canRevoke(message)) actions.push({ key: 'revoke', label: t('message.revoke'), tone: 'danger' });
  return actions;
}
function handleMessageAction(message: Message, action: string): void {
  if (action === 'reply') c.setReply(message);
  else if (action === 'copy') void copyMessage(message);
  else if (action === 'forward') c.openForward([message]);
  else if (action === 'multiselect') c.setSelectionMode(true);
  else if (action === 'receipt') void c.loadReadReceipt(message);
  else if (action === 'reaction') reactionTargetId.value = reactionTargetId.value === message.id ? undefined : message.id;
  else if (action === 'revoke') void revokeMessage(message);
}
function captureUnreadBoundary(): void {
  unreadBoundary.value = c.activeConversation.value?.readSeq ?? 0;
}
async function toggleUnit(unit: OrgUnit): Promise<void> {
  if (!expandedUnits.value.has(unit.id)) {
    const loaded = await c.expandDepartment(unit);
    if (!loaded) {
      readHostCapability(props.hostBridge, 'message')?.error(t('error.departmentLoad'));
      return;
    }
  }
  const next = new Set(expandedUnits.value);
  next.has(unit.id) ? next.delete(unit.id) : next.add(unit.id);
  expandedUnits.value = next;
}
function openContactDetail(user: User, event: Event | HTMLElement): void {
  contactReturnFocus.value = event instanceof HTMLElement
    ? event
    : event.currentTarget instanceof HTMLElement ? event.currentTarget : null;
  selectedContact.value = user;
}
function closeContactDetail(): void {
  selectedContact.value = undefined;
}
async function messageSelectedContact(): Promise<void> {
  const user = selectedContact.value;
  if (!user || user.id === c.snapshot.value.self?.id) return;
  try {
    await c.openUser(user);
    selectedContact.value = undefined;
    c.activeTab.value = 'chats';
    captureUnreadBoundary();
    c.query.value = '';
    await syncMessageViewport();
    await focusComposerAfterUserSelection();
  }
  catch { readHostCapability(props.hostBridge, 'message')?.error(t('error.startConversation')); }
}
function openGroupDetail(conversation: Conversation, event: Event): void {
  groupDetailReturnFocus.value = event.currentTarget instanceof HTMLElement ? event.currentTarget : null;
  selectedGroupDetail.value = conversation;
}
function closeGroupDetail(): void { selectedGroupDetail.value = undefined; }
async function enterGroupConversation(): Promise<void> {
  const conversation = selectedGroupDetail.value;
  if (!conversation) return;
  selectedGroupDetail.value = undefined;
  c.activeTab.value = 'chats';
  c.query.value = '';
  await c.selectConversation(conversation.id);
  captureUnreadBoundary();
  await syncMessageViewport();
  await focusComposerAfterUserSelection();
}
async function toggleReaction(message: Message, reaction: NonNullable<Message['reactions']>[number]): Promise<void> {
  try { await c.toggleReaction(message, reaction); }
  catch { readHostCapability(props.hostBridge, 'message')?.error(t('error.reaction')); }
}
async function chooseReaction(message: Message, emoji: string): Promise<void> {
  try { await c.setReactionEmoji(message, emoji); reactionTargetId.value = undefined; }
  catch { readHostCapability(props.hostBridge, 'message')?.error(t('error.reaction')); }
}
async function conversationAction(item: Conversation, action: 'pin' | 'mute' | 'hide'): Promise<void> {
  if (action === 'hide' && !(await confirmAction({ content: t('conversation.hideConfirm'), type: 'warning' }))) return;
  try {
    if (action === 'pin') await c.togglePinned(item);
    else if (action === 'mute') await c.toggleMuted(item);
    else await c.hideConversation(item);
  } catch {
    readHostCapability(props.hostBridge, 'message')?.error(t('error.conversationAction'));
  }
}
function openSingleSettingContact(event: Event): void {
  if (singleSettingUser.value) openContactDetail(singleSettingUser.value, event);
}
async function hideActiveFromSettings(): Promise<void> {
  const conversation = c.activeConversation.value;
  if (!conversation || conversation.kind === 'system') return;
  if (!(await confirmAction({ content: t('conversation.hideConfirm'), type: 'warning' }))) return;
  try {
    c.drawerOpen.value = false;
    await c.hideConversation(conversation);
  } catch {
    readHostCapability(props.hostBridge, 'message')?.error(t('error.conversationAction'));
  }
}
async function locateConversationMention(conversationId: string, seq: number): Promise<void> {
  try {
    const target = await c.focusAround(conversationId, seq);
    await nextTick();
    if (!target) { readHostCapability(props.hostBridge, 'message')?.warning(t('search.messageNotFound')); return; }
    messageList.value?.scrollToMessage(target.id, 'center');
    await nextTick();
    c.markMessageViewReady();
    c.setAtBottom(false);
  } catch (error) {
    readHostCapability(props.hostBridge, 'message')?.error(error instanceof Error ? error.message : t('search.error'));
  }
}
async function copyMessage(message: Message): Promise<void> {
  try { await c.copyMessageText(message); readHostCapability(props.hostBridge, 'message')?.success(t('message.copied')); }
  catch { readHostCapability(props.hostBridge, 'message')?.error(t('error.copy')); }
}
async function revokeMessage(message: Message): Promise<void> {
  if (!(await confirmAction({ content: t('message.revokeConfirm'), type: 'warning' }))) return;
  try { await c.revokeMessage(message); }
  // 2026-08-11：撤回超窗（ERR_IM_REVOKE_WINDOW_EXPIRED）给专属提示，其余沿用笼统"撤回失败"
  catch (error) { readHostCapability(props.hostBridge, 'message')?.error(t(revokeErrorMessageKey(error))); }
}
/** 是否为自己发出的消息，逻辑与传给 ImMessageItem 的 :own 保持一致（气泡镜像方向 / 引用行对齐方向共用同一判据）。 */
function isOwnMessage(message: Message): boolean {
  return message.sender.id === c.snapshot.value.self?.id;
}
/**
 * 需求8：气泡下方引用行文案，微信/企微式「发送者: 内容」（英文冒号+空格，不带"引用 ·"前缀）。
 * 发送者名缺失回退 system.someone；引用内容缺失（如引用了图片/文件消息）回退 #序号。
 */
function quoteLineText(message: Message): string {
  const replyTo = message.replyTo;
  if (!replyTo) return '';
  const sender = replyTo.sender.name || t('system.someone');
  const content = replyTo.text || `#${replyTo.seq}`;
  return `${sender}: ${content}`;
}
async function locateQuotedMessage(message: Message): Promise<void> {
  let target: Message | undefined;
  try { target = await c.locateReply(message); }
  catch (error) { readHostCapability(props.hostBridge, 'message')?.error(error instanceof Error ? error.message : t('search.error')); return; }
  if (!target) { readHostCapability(props.hostBridge, 'message')?.warning(t('reply.notFound')); return; }
  await nextTick();
  messageList.value?.scrollToMessage(target.id, 'center');
  await nextTick();
  if (!c.messageViewReady.value) {
    c.markMessageViewReady();
    c.setAtBottom(false);
  }
  if (highlightTimer) clearTimeout(highlightTimer);
  highlightTimer = setTimeout(() => c.clearHighlight(), 1800);
}
async function openSearchConversation(item: Conversation): Promise<void> {
  await c.openSearchConversation(item);
  captureUnreadBoundary();
  c.query.value = '';
  await syncMessageViewport();
  await focusComposerAfterUserSelection();
}
async function openSearchMessage(message: Message): Promise<void> {
  try {
    const target = await c.openSearchMessage(message);
    captureUnreadBoundary();
    c.query.value = '';
    await nextTick();
    if (!target) { readHostCapability(props.hostBridge, 'message')?.warning(t('search.messageNotFound')); return; }
    messageList.value?.scrollToMessage(target.id, 'center');
    await nextTick();
    c.markMessageViewReady();
    c.setAtBottom(false);
  } catch (error) {
    readHostCapability(props.hostBridge, 'message')?.error(error instanceof Error ? error.message : t('search.error'));
  }
}
async function confirmForward(mode: 'individual' | 'merged'): Promise<void> {
  if (!(await confirmAction({ content: mode === 'merged' ? t('forward.confirmMerged') : t('forward.confirmIndividual'), type: 'info' }))) return;
  try { await c.executeForward(mode); }
  catch (error) { readHostCapability(props.hostBridge, 'message')?.error(error instanceof Error ? error.message : t('forward.error')); }
}
function mergedItems(message: Message): Array<{ senderName: string; summary: string; msgType: number; seq: number }> {
  const raw = message.card?.data.items;
  if (!Array.isArray(raw)) return [];
  return raw.flatMap(item => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
    const value = item as Record<string, unknown>;
    return [{
      senderName: typeof value.senderName === 'string' ? value.senderName : '',
      summary: typeof value.summary === 'string' ? value.summary : '',
      msgType: typeof value.msgType === 'number' ? value.msgType : 0,
      seq: typeof value.seq === 'number' ? value.seq : 0
    }];
  });
}
function onVirtualAtBottom(value: boolean): void { c.setAtBottom(value); }
function onVirtualViewportReady(): void {
  if (!c.messageViewReady.value) void syncMessageViewport();
}
async function onVirtualTopReached(): Promise<void> {
  if (!c.messageViewReady.value || c.historyLoading.value || historyRequestPending) return;
  historyRequestPending = true;
  try { await c.loadHistory(); }
  finally { historyRequestPending = false; }
}
async function syncMessageViewport(): Promise<void> {
  const version = ++viewportSyncVersion;
  const conversationId = c.activeConversation.value?.id;
  await nextTick();
  for (let pass = 0; pass < 3; pass += 1) {
    if (version !== viewportSyncVersion || conversationId !== c.activeConversation.value?.id) return;
    messageList.value?.scrollToBottom();
    await new Promise<void>(resolve => window.requestAnimationFrame(() => resolve()));
    await nextTick();
  }
  const viewport = messageList.value?.getViewport();
  if (version === viewportSyncVersion && conversationId === c.activeConversation.value?.id && viewport?.atBottom) {
    c.markMessageViewReady();
    c.setAtBottom(true);
  }
}
async function selectChat(id: string): Promise<void> { await c.selectConversation(id); captureUnreadBoundary(); await syncMessageViewport(); await focusComposerAfterUserSelection(); }
function clearPendingConversation(expectedId: string): void {
  const state = readHostCapability(props.hostBridge, 'imWindowState');
  if (state?.pendingConvId !== expectedId) return;
  const clear = readHostCapability(props.hostBridge, 'clearPendingConvId');
  if (clear) clear();
  else state.pendingConvId = null;
}
async function consumePendingConversation(conversationId: string): Promise<void> {
  if (consumingPendingId === conversationId) return;
  consumingPendingId = conversationId;
  try {
    await initialRefreshPromise;
    const state = readHostCapability(props.hostBridge, 'imWindowState');
    if (!panelMounted || state?.pendingConvId !== conversationId) return;
    await selectChat(conversationId);
  } catch (error) {
    report(props.hostBridge, 'warn', 'im.pending_conversation_failed', {
      conversationId,
      message: error instanceof Error ? error.message : 'unknown'
    });
  } finally {
    clearPendingConversation(conversationId);
    if (consumingPendingId === conversationId) consumingPendingId = undefined;
  }
}
function jumpToLatest(): void {
  messageList.value?.scrollToBottom();
  const viewport = messageList.value?.getViewport();
  c.setAtBottom(Boolean(viewport?.atBottom));
}
function systemLabel(message: Message): string {
  return formatSystemMessage(message, key => t(key as keyof typeof zh));
}
function cardBusyKey(message: Message): string {
  return message.notification?.id ?? `${message.id}:${message.card?.rendererKey ?? 'card'}`;
}
function setCardActionBusy(key: string, busy: boolean): void {
  const next = new Set(cardActionBusy.value);
  if (busy) next.add(key);
  else next.delete(key);
  cardActionBusy.value = next;
}
type ImLocale = 'zh-CN' | 'zh-TW' | 'en-US' | 'ja-JP';
function imLocale(): ImLocale {
  return readHostCapability(props.hostBridge, 'locale') ?? 'zh-CN';
}
function cardStateText(state: CardDisplayModel['state']): string {
  if (!state) return '';
  const values: Record<ImLocale, Record<string, string>> = {
    'zh-CN': { pending: '待处理', done: '已完成', ignored: '已处理', agreed: '已同意', expired: '已失效' },
    'zh-TW': { pending: '待處理', done: '已完成', ignored: '已處理', agreed: '已同意', expired: '已失效' },
    'en-US': { pending: 'Pending', done: 'Completed', ignored: 'Handled', agreed: 'Agreed', expired: 'Expired' },
    'ja-JP': { pending: '対応待ち', done: '完了', ignored: '処理済み', agreed: '同意済み', expired: '失効' }
  };
  return values[imLocale()][state] ?? state;
}
/** 类别行文字（卡片样式规范第二节①）：按 variant / cardType 本地化，替代旧的笼统「业务卡片」 */
function cardKindLabel(model: CardDisplayModel): string {
  const locale = imLocale();
  const key = model.rendererKey.startsWith('edit_request.') ? 'editRequest' : model.variant;
  const values: Record<ImLocale, Record<string, string>> = {
    'zh-CN': { approval: '流程审批', todo: '待办', merged: '聊天记录', editRequest: '编辑申请', extension: '业务卡片' },
    'zh-TW': { approval: '流程審批', todo: '待辦', merged: '聊天記錄', editRequest: '編輯申請', extension: '業務卡片' },
    'en-US': { approval: 'Workflow approval', todo: 'To-do', merged: 'Chat history', editRequest: 'Edit request', extension: 'Business card' },
    'ja-JP': { approval: 'フロー承認', todo: 'タスク', merged: 'チャット履歴', editRequest: '編集申請', extension: '業務カード' }
  };
  return values[locale][key] ?? t('card.business');
}
/** 合并转发卡的「查看 N 条聊天记录」按钮文案；非合并卡回落到通用文案 */
function mergedViewLabel(message: Message): string {
  const merged = message.card ? localizeMergedMessagesCard(message.card, { title: '', detailRows: [] }, imLocale()) : undefined;
  return merged?.viewLabel ?? t('merged.view');
}
function cardDisplayModel(message: Message): CardDisplayModel {
  if (!message.card) throw new Error('card_required');
  const model = buildCardDisplayModel(message.card, {
    actionSource: message.notification ? 'nahida-notification' : message.cardAction ? 'nahida-message' : 'none',
    busy: cardActionBusy.value.has(cardBusyKey(message)) || message.cardAction?.busy
  });
  const merged = localizeMergedMessagesCard(message.card, model, imLocale());
  if (merged) return { ...model, title: merged.title, detailRows: merged.detailRows };
  return localizeTypedEditRequestCard(message.card, model, imLocale());
}
async function runCardAction(message: Message, action: CardDisplayAction): Promise<void> {
  if ((!message.notification && !message.cardAction) || action.disabled || action.blockReason !== 'allowed') return;
  const key = cardBusyKey(message);
  if (cardActionBusy.value.has(key)) return;
  setCardActionBusy(key, true);
  let preparedRequestId = '';
  try {
    let comment: string | undefined;
    if (action.requiresComment) {
      // 备注可多行；取消（含服务不可用）返回 null，中止动作；空串合法由后端判定
      const entered = await promptText({ content: t('card.commentPrompt'), multiline: true });
      if (entered === null) return;
      comment = entered;
    }
    if (message.notification) await c.runNotificationCardAction(message, action.key, comment);
    else {
      if (action.key === 'agree' && message.card?.cardType?.startsWith('edit_request.') && !message.card.cardType.startsWith('edit_request.released.')) {
        const data = message.card.data as Record<string, unknown>;
        const requestId = String(data.requestId ?? '').trim();
        const resourceKind = String(data.resourceKind ?? '').trim();
        const appId = String(data.appId ?? '').trim();
        if (!requestId || !appId || !['workflow_definition', 'template_design', 'business_record'].includes(resourceKind)) throw new Error('invalid_edit_request_card');
        const prepare = readHostCapability(props.hostBridge, 'prepareEditRequestAgreement');
        if (prepare) {
          const result = await prepare({
            requestId,
            resource: {
              resourceKind: resourceKind as 'workflow_definition' | 'template_design' | 'business_record',
              appId,
              definitionId: String(data.definitionId ?? '').trim() || undefined,
              templateId: String(data.templateId ?? '').trim() || undefined,
              templateVersionNo: String(data.templateVersionNo ?? '').trim() || undefined,
				designerType: String(data.designerType ?? '').trim() || undefined,
				pluginId: String(data.pluginId ?? '').trim() || undefined,
				runtimeMode: data.runtimeMode === 'test' ? 'test' : data.runtimeMode === 'production' ? 'production' : undefined,
				testSessionId: String(data.testSessionId ?? '').trim() || undefined,
              recordId: String(data.recordId ?? '').trim() || undefined
            }
          });
          if (!result.proceed) return;
          if (result.local) preparedRequestId = requestId;
        }
      }
      await c.runMessageCardAction(message, action.key);
      if (preparedRequestId) await readHostCapability(props.hostBridge, 'completeEditRequestAgreement')?.(preparedRequestId);
      preparedRequestId = '';
    }
  } catch (error) {
    if (preparedRequestId) await readHostCapability(props.hostBridge, 'cancelEditRequestAgreement')?.(preparedRequestId);
    // 这条 catch 同时兜住"卡片数据不合法"（本地抛出、一个请求都不会发）和"服务端拒绝"两类
    // 失败，只弹一句通用文案的话，前者在 network 面板里查无踪迹、无从定位——按宿主日志约定
    // 上报原始 reason 与卡片类型。
    report(props.hostBridge, 'error', 'im.card_action_failed', {
      cardType: message.card?.cardType ?? '',
      actionKey: action.key,
      reason: error instanceof Error ? error.message : String(error)
    });
    readHostCapability(props.hostBridge, 'message')?.error(t('error.cardAction'));
  } finally {
    setCardActionBusy(key, false);
  }
}
function viewBusinessCard(message: Message, safeInternalLink?: string): void {
  if (safeInternalLink) {
    if (!/^\/(?![\\/])/.test(safeInternalLink)) return;
    const navigate = readHostCapability(props.hostBridge, 'navigate');
    if (!navigate) {
      report(props.hostBridge, 'warn', 'im.card_navigation_unavailable', { route: safeInternalLink });
      return;
    }
    try { navigate(safeInternalLink); }
    catch { report(props.hostBridge, 'error', 'im.card_navigation_failed', { route: safeInternalLink }); }
    return;
  }
  if (message.card && cardDisplayModel(message).localView === 'merged') mergedViewer.value = message;
}
function onEscape(event: KeyboardEvent): void {
  if (c.preview.value.status === 'closed') return;
  if (event.key === 'Escape') { event.preventDefault(); closePreview(); return; }
  if (!previewAssetIsImage.value) return;
  if (event.key === 'ArrowLeft') { event.preventDefault(); void navigatePreview(-1); }
  else if (event.key === 'ArrowRight') { event.preventDefault(); void navigatePreview(1); }
  else if (event.key === '+' || event.key === '=') { event.preventDefault(); changePreviewZoom(1); }
  else if (event.key === '-') { event.preventDefault(); changePreviewZoom(-1); }
  else if (event.key === '0') { event.preventDefault(); resetPreviewZoom(); }
}
let searchVersion = 0;
watch([() => c.query.value, () => c.activeTab.value], ([keyword, tab]) => {
  const version = ++searchVersion;
  if (tab === 'chats') { c.scheduleUnifiedSearch(keyword); return; }
  void c.searchContacts(keyword).catch(error => {
    if (version === searchVersion) report(props.hostBridge, 'warn', 'im_next.contact_search_failed', { message: error instanceof Error ? error.message : 'unknown' });
  });
});
watch(() => c.draft.value, value => c.pruneMentions(value));
watch(() => c.preview.value.status === 'closed' ? undefined : c.preview.value.asset.assetId, () => resetPreviewZoom());
watch(() => {
  const items = c.messages.value;
  return { conversationId: c.activeConversation.value?.id, firstSeq: items[0]?.seq, lastSeq: items.at(-1)?.seq, length: items.length };
}, async (current, previous) => {
  const prepended = current.conversationId === previous?.conversationId
    && current.firstSeq !== undefined && previous.firstSeq !== undefined && current.firstSeq < previous.firstSeq
    && current.lastSeq === previous.lastSeq;
  if (prepended) return;
  const followLatest = c.messageViewReady.value && c.isAtBottom.value;
  const appended = current.conversationId === previous?.conversationId
    && current.lastSeq !== undefined && previous?.lastSeq !== undefined && current.lastSeq > previous.lastSeq;
  if (appended) {
    const latest = c.messages.value.at(-1);
    liveAnnouncement.value = latest?.text || latest?.attachment?.fileName || latest?.card?.title || '';
  } else if (current.conversationId !== previous?.conversationId) liveAnnouncement.value = '';
  await nextTick();
  if (!c.messageViewReady.value) return;
  if (followLatest) messageList.value?.scrollToBottom();
  const viewport = messageList.value?.getViewport();
  if (viewport) c.setAtBottom(viewport.atBottom);
});
// 单聊常驻已读/未读：对当前会话中自己发送、尚无回执数据的消息惰性拉取回执。
// 仅取尾部 30 条，防止长历史批量拉取；回执一次加载后不做实时翻转
// （对端已读的实时推送面尚无消息级信号，重进会话即刷新）。
watch(
  () => ({
    conversationId: c.activeConversation.value?.id,
    kind: c.activeConversation.value?.kind,
    lastSeq: c.messages.value.at(-1)?.seq
  }),
  () => {
    const conversation = c.activeConversation.value;
    if (conversation?.kind !== 'single') return;
    const selfId = c.snapshot.value.self?.id;
    if (!selfId) return;
    for (const message of c.messages.value.slice(-30)) {
      if (message.sender.id !== selfId) continue;
      if (message.receipt || receiptRequested.has(message.id)) continue;
      if (!c.canLoadReceipt(message)) continue;
      receiptRequested.add(message.id);
      void c.loadReadReceipt(message).finally(() => receiptRequested.delete(message.id));
    }
  },
  { immediate: true }
);
watch(
  () => readHostCapability(props.hostBridge, 'imWindowState')?.pendingConvId,
  conversationId => { if (panelMounted && conversationId) void consumePendingConversation(conversationId); }
);
watch(
  () => c.activeConversation.value?.id,
  conversationId => {
    const state = readHostCapability(props.hostBridge, 'imWindowState');
    if (state) state.activeConversationId = conversationId ?? null;
  },
  { immediate: true }
);
// 通讯录默认展开第一级：目录（`refresh()` 首次加载或重建后 directory 为新数组，watch 会重新触发）就绪后，
// 直接把所有根部门 id 并入 expandedUnits（沿用 toggleUnit 的不可变更新写法），无需用户手点即可看到组织结构最外层。
// 仅展开根部门自身不够——根部门的子部门尚未拉取（childrenLoaded=false），若不补拉，展开后只见成员看不到下级部门，
// 因此对每个未加载过子部门的根部门顺带调用 c.expandDepartment 补拉；根部门成员在 loadDirectory 阶段已加载
// （membersLoaded=true），expandDepartment 内部会自动跳过重复请求。此处刻意不 await：默认展开是锦上添花的体验优化，
// 不应阻塞面板渲染，失败也静默（expandDepartment 内部已 report warn 上报宿主，无需在此重复弹错）。
//
// 🔴 数据源必须是 c.snapshot.value.directory（结构真身数组），**不能**换成 c.directory.value
// （叠加在线态的投影 computed）。投影每次重算都产出新数组，而 expandDepartment 一进门就同步
// 置 target.loading=true 会让投影失效 ⇒ 本 watch 被触发 ⇒ 把根部门 id 又加回 expandedUnits；
// 此时 toggleUnit 还停在 `await c.expandDepartment(unit)` 上，await 让出的微任务正好让 watch 先跑完，
// 恢复执行时它看到 id 已存在 → 走 delete 分支 → 一次点击被反转两次，表现为「顶级分类收起后再也展不开」。
// 结构真身数组只在 refresh() 重建目录时换引用，loading/members 等字段的原地改写不会误触发本 watch。
watch(
  () => c.snapshot.value.directory,
  directory => {
    if (!directory.length) return;
    const next = new Set(expandedUnits.value);
    for (const unit of directory) next.add(unit.id);
    expandedUnits.value = next;
    void Promise.all(directory.filter(unit => !unit.childrenLoaded).map(unit => c.expandDepartment(unit)));
  },
  { immediate: true }
);
onMounted(() => {
  panelMounted = true;
  window.addEventListener('keydown', onEscape);
  initialRefreshPromise = c.refresh();
  void loadPresenceMode();
  void initialRefreshPromise.then(async () => {
    captureUnreadBoundary();
    await syncMessageViewport();
    stopRealtime = c.startRealtime();
    const pending = readHostCapability(props.hostBridge, 'imWindowState')?.pendingConvId;
    if (pending) await consumePendingConversation(pending);
  });
});
onBeforeUnmount(() => {
  panelMounted = false;
  const state = readHostCapability(props.hostBridge, 'imWindowState');
  if (state) state.activeConversationId = null;
  window.removeEventListener('keydown', onEscape);
  stopRealtime?.();
  c.dispose();
  if (highlightTimer) clearTimeout(highlightTimer);
});
</script>

<template>
  <main class="im-next im-uikit-theme" :aria-label="t('aria.main')">
    <!-- 顶部标题栏（2026-10-17 改版，Figma 2835:115469 + 用户四点要求）：整条可拖动（data-im-drag-handle，外壳统一处理），
         双击切最大化（外壳按 data-im-titlebar 识别）。窗口按钮由外壳经 window-controls 插槽提供；
         macOS 按钮在左、头像/姓名/部门紧跟其后，其他平台头像组对齐内容区左缘、按钮在右。
         加载 / 出错 / 空态也保留标题栏，保证任何状态下都能关窗、最小化。 -->
    <header class="im-titlebar" :class="`im-titlebar--${windowPlatform}`" data-im-drag-handle data-im-titlebar :aria-label="t('titlebar.aria')">
      <slot name="window-controls" />
      <button v-if="selfUser" ref="selfAvatarButton" type="button" class="im-titlebar__self" :title="t('presence.menu')" :aria-label="t('presence.menu')" :aria-expanded="presenceMenuOpen" aria-haspopup="menu" @click="presenceMenuOpen = !presenceMenuOpen">
        <ImAvatar :src="selfUser.avatar" :name="selfUser.name" :presence="selfPresence" size="xs" decorative />
        <span class="im-titlebar__name">{{ selfUser.name }}</span>
        <span v-if="selfDepartments" class="im-titlebar__dept" :title="selfDepartments">{{ selfDepartments }}</span>
      </button>
    </header>
    <section v-if="c.screen.value === 'loading'" class="state-screen"><span class="spinner" /><strong>{{ t('loading') }}</strong></section>
    <section v-else-if="c.screen.value === 'error'" class="state-screen error">
      <svg class="state-illustration" viewBox="0 0 180 132" aria-hidden="true"><path class="state-illustration__back" d="M29 30h122a12 12 0 0 1 12 12v61a12 12 0 0 1-12 12H29a12 12 0 0 1-12-12V42a12 12 0 0 1 12-12Z"/><path class="state-illustration__paper" d="M49 17h82a10 10 0 0 1 10 10v72a10 10 0 0 1-10 10H49a10 10 0 0 1-10-10V27a10 10 0 0 1 10-10Z"/><circle class="state-illustration__accent" cx="90" cy="58" r="20"/><path class="state-illustration__mark" d="M90 46v15m0 10h.01"/></svg>
      <strong>{{ t('error.missing') }}</strong><code>{{ c.loadError.value }}</code><button @click="c.refresh">{{ t('retry') }}</button>
    </section>
    <section v-else-if="c.screen.value === 'empty'" class="state-screen">
      <svg class="state-illustration" viewBox="0 0 180 132" aria-hidden="true"><path class="state-illustration__back" d="M18 39a13 13 0 0 1 13-13h118a13 13 0 0 1 13 13v66a13 13 0 0 1-13 13H31a13 13 0 0 1-13-13Z"/><path class="state-illustration__paper" d="M40 19h100a10 10 0 0 1 10 10v67a10 10 0 0 1-10 10H40a10 10 0 0 1-10-10V29a10 10 0 0 1 10-10Z"/><circle class="state-illustration__accent" cx="70" cy="59" r="15"/><path class="state-illustration__line" d="M96 48h31M96 59h25M52 86h75"/></svg>
      <strong>{{ t('empty') }}</strong><small>{{ t('empty.description') }}</small><button @click="c.refresh">{{ t('retry') }}</button>
    </section>
    <template v-else>
      <!-- 左侧窄条 rail（Figma 84px）：logo / 消息 / 通讯录 / 底部汉堡菜单（自己头像已移到顶部标题栏）。
           data-im-drag-handle：rail 整个区域（除 button 交互控件外）可拖动窗口（外壳统一处理，见 ImFloatingShell） -->
      <!-- 标题栏下方的主体行：左侧窄条 + 内容区卡片 -->
      <div class="im-main">
      <nav class="im-rail" data-im-drag-handle :aria-label="t('title')">
        <!-- 36 圆形容器内 logo 25×17（保持原 44×30 的宽高比，随 rail 一同缩到参考窗比例） -->
        <span class="im-rail__logo" aria-hidden="true"><ImBrandLogo :width="25" :height="17" /></span>
        <div class="im-rail__nav tabs" data-kimpo-extension="conversation-contact-tabs" role="tablist" :aria-label="t('aria.tabs')">
          <button ref="chatTabButton" type="button" role="tab" class="im-rail__nav-btn" :aria-selected="c.activeTab.value === 'chats'" :tabindex="c.activeTab.value === 'chats' ? 0 : -1" :class="{ active: c.activeTab.value === 'chats' }" :aria-label="t('chats')" :title="t('chats')" @click="activateSidebarTab('chats')" @keydown="onSidebarTabKeydown"><ImIcon :name="c.activeTab.value === 'chats' ? 'navMessageActive' : 'navMessageIdle'" :size="20" /></button>
          <button ref="contactsTabButton" type="button" role="tab" class="im-rail__nav-btn" :aria-selected="c.activeTab.value === 'contacts'" :tabindex="c.activeTab.value === 'contacts' ? 0 : -1" :class="{ active: c.activeTab.value === 'contacts' }" :aria-label="t('contacts')" :title="t('contacts')" @click="activateSidebarTab('contacts')" @keydown="onSidebarTabKeydown"><ImIcon :name="c.activeTab.value === 'contacts' ? 'navContactsActive' : 'navContactsIdle'" :size="20" /></button>
        </div>
        <div class="im-rail__footer">
          <button ref="notificationSettingsTrigger" type="button" class="im-rail__nav-btn global-settings-button" :aria-label="t('rail.more')" :title="t('rail.more')" :aria-expanded="moreMenuOpen" aria-haspopup="menu" @click="moreMenuOpen = !moreMenuOpen"><ImIcon name="hamburger" :size="20" /></button>
        </div>
      </nav>
      <ImFloatingMenu v-model:open="moreMenuOpen" :anchor="notificationSettingsTrigger" placement="top-start" variant="conversation" :label="t('rail.more')">
        <button type="button" role="menuitem" @click="openNotificationPreferences"><ImIcon name="settings" :size="16" />{{ t('rail.settings') }}</button>
        <!--
          「打开桌面端」常驻入口（用户 2026-08-22 要求）：侧栏底部那条推荐横幅点过 × 之后
          会被 localStorage 永久记住，用户从此再也找不到入口——这里给一个不会被关掉的常驻入口。
          🔴 唤起逻辑在宿主（openDesktopApp 能力），插件只渲染；宿主没注入就不渲染，
          不留死入口（桌面壳内、或宿主未启用云端分发时即如此）。
        -->
        <button v-if="canOpenDesktopApp" type="button" role="menuitem" data-menu-key="open-desktop-app" @click="handleOpenDesktopApp"><ImIcon name="desktopApp" :size="16" />{{ t('rail.openDesktop') }}</button>
      </ImFloatingMenu>
      <!-- 头像在线状态菜单：在线=auto / 忙碌=busy（联动免打扰） / 离线=隐身 -->
      <!-- 头像在标题栏：菜单向下弹出，贴头像组左缘 -->
      <ImFloatingMenu v-model:open="presenceMenuOpen" :anchor="selfAvatarButton" placement="bottom-start" variant="conversation" :label="t('presence.menu')">
        <button type="button" role="menuitem" data-menu-key="presence-online" @click="selectPresence('online')"><i class="presence-option presence-option--online" aria-hidden="true" />{{ t('presence.online') }}<span v-if="presenceMenuChecked === 'online'" class="presence-check" aria-hidden="true">✓</span></button>
        <button type="button" role="menuitem" data-menu-key="presence-busy" @click="selectPresence('busy')"><i class="presence-option presence-option--busy" aria-hidden="true" />{{ t('presence.busy') }}<span v-if="presenceMenuChecked === 'busy'" class="presence-check" aria-hidden="true">✓</span></button>
        <button type="button" role="menuitem" data-menu-key="presence-offline" @click="selectPresence('offline')"><i class="presence-option presence-option--offline" aria-hidden="true" />{{ t('presence.offline') }}<span v-if="presenceMenuChecked === 'offline'" class="presence-check" aria-hidden="true">✓</span></button>
      </ImFloatingMenu>
      <!-- 内容区圆角卡片（Figma #f5f5f5 / 圆角16） -->
      <div class="im-body">
      <aside class="sidebar">
        <!-- data-im-drag-handle：搜索行非交互空白可拖动窗口（外壳统一处理，见 ImFloatingShell） -->
        <div class="sidebar-search-row" data-im-drag-handle>
          <ImSearchBar ref="sidebarSearch" v-model="c.query.value" class="sidebar-search" :label="t('search')" :placeholder="t('search')" />
          <button ref="createMenuButton" type="button" class="create-menu-button" data-kimpo-extension="conversation-create" :aria-label="t('create.menu')" :aria-expanded="createMenuOpen" aria-haspopup="menu" @click="createMenuOpen = !createMenuOpen">
            <ImIcon name="plus" :size="16" />
          </button>
        </div>
        <ImFloatingMenu v-model:open="createMenuOpen" :anchor="createMenuAnchor" placement="bottom-end" variant="conversation" :label="t('create.menu')" :restore-focus-on-select="false">
          <button type="button" role="menuitem" @click="createGroupFromCreateMenu"><ImIcon name="createGroup" :size="16" />{{ t('create.group') }}</button>
          <button type="button" role="menuitem" @click="startSingleFromCreateMenu"><ImIcon name="addFriend" :size="16" />{{ t('create.single') }}</button>
        </ImFloatingMenu>
        <section v-if="c.activeTab.value === 'chats' && c.query.value.trim()" class="unified-search" :aria-label="t('search.results')">
          <p v-if="c.unifiedSearch.value.status === 'loading'">{{ t('search.loading') }}</p><p v-else-if="c.unifiedSearch.value.status === 'empty'">{{ t('search.empty') }}</p><p v-else-if="c.unifiedSearch.value.status === 'error'" class="search-error">{{ t('search.error') }}：{{ c.unifiedSearch.value.error }}</p>
          <template v-else-if="c.unifiedSearch.value.status === 'ready'">
            <section v-if="c.unifiedSearch.value.users.length"><h3>{{ t('search.users') }}</h3><button v-for="user in c.unifiedSearch.value.users" :key="user.id" @click="openContactDetail(user, $event)"><span v-for="(part, partIndex) in highlightParts(user.name, c.unifiedSearch.value.query)" :key="partIndex"><mark v-if="part.match">{{ part.text }}</mark><template v-else>{{ part.text }}</template></span></button></section>
            <section v-if="c.unifiedSearch.value.groups.length"><h3>{{ t('search.groups') }}</h3><button v-for="item in c.unifiedSearch.value.groups" :key="`group-${item.id}`" @click="openSearchConversation(item)"><span v-for="(part, partIndex) in highlightParts(item.title, c.unifiedSearch.value.query)" :key="partIndex"><mark v-if="part.match">{{ part.text }}</mark><template v-else>{{ part.text }}</template></span></button></section>
            <section v-if="c.unifiedSearch.value.conversations.length"><h3>{{ t('search.conversations') }}</h3><button v-for="item in c.unifiedSearch.value.conversations" :key="`conversation-${item.id}`" @click="openSearchConversation(item)"><span v-for="(part, partIndex) in highlightParts(item.title, c.unifiedSearch.value.query)" :key="partIndex"><mark v-if="part.match">{{ part.text }}</mark><template v-else>{{ part.text }}</template></span></button></section>
            <section v-if="c.unifiedSearch.value.messages.length"><h3>{{ t('search.messages') }}</h3><button v-for="message in c.unifiedSearch.value.messages" :key="`message-${message.id}`" @click="openSearchMessage(message)"><b>{{ message.sender.name }}</b> · <span v-for="(part, partIndex) in highlightParts(message.text || message.attachment?.fileName || '', c.unifiedSearch.value.query)" :key="partIndex"><mark v-if="part.match">{{ part.text }}</mark><template v-else>{{ part.text }}</template></span></button></section>
          </template>
        </section>
        <ImConversationList
          v-if="c.activeTab.value === 'chats' && !c.query.value.trim()"
          class="conversation-list"
          :conversations="c.conversations.value"
          :active-conversation-id="c.activeConversation.value?.id"
          :list-label="t('chats')"
          :drafts="c.conversationDrafts.value"
          :draft-label="t('conversation.draft')"
          :format-time="conversationTime"
          :labels="{
            actions: t('conversation.actions'), pin: t('conversation.pin'), unpin: t('conversation.unpin'),
            mute: t('conversation.mute'), unmute: t('conversation.unmute'), hide: t('conversation.hide'), mutedState: t('muted'), mentioned: t('conversation.mentioned'),
            presenceBusy: t('presence.busy'), presenceOffline: t('presence.offline')
          }"
          @select="selectChat"
          @action="conversationAction"
          @locate-mention="locateConversationMention"
        />
        <div v-else class="contacts" :aria-label="t('aria.contacts')">
          <!-- Figma 通讯录分段页签：通讯录=组织架构树（产品定版：通讯录即组织树）/ 群聊=群分组
               需求B（2026-08-11）：页签固定在下方滚动容器（.contacts__scroll）之外，
               不随组织树/群分组内容变长被滚出可视区 -->
          <div class="contacts-tabs" role="tablist" :aria-label="t('aria.contacts')">
            <button type="button" role="tab" :aria-selected="contactsTab === 'directory'" :class="{ active: contactsTab === 'directory' }" @click="contactsTab = 'directory'">{{ t('tab.contacts') }}</button>
            <button type="button" role="tab" :aria-selected="contactsTab === 'groups'" :class="{ active: contactsTab === 'groups' }" @click="contactsTab = 'groups'">{{ t('tab.groups') }}</button>
          </div>
          <!-- 滚动容器：只装页签下方的内容（组织树/群分组/搜索结果/空态），滚动条不再贯穿页签 -->
          <div class="contacts__scroll">
            <template v-if="c.query.value.trim()">
              <button v-for="member in c.contacts.value" :key="member.id" class="contact search-result" @click="openContactDetail(member, $event)"><span class="avatar tiny">{{ member.name[0] }}<i v-if="member.presence === 'online'" class="presence" /></span><span>{{ member.name }}<small>{{ member.departments.join(' · ') }}</small></span></button>
            </template>
            <template v-else>
              <!-- 产品定版（2026-08-11）：通讯录点部门只展开/收起下级，不再打开部门群聊——
                   群聊分段页签已有部门群入口，两处重复且容易点错；activate-unit 与 toggle
                   走同一个 toggleUnit，键盘 Enter/Space（触发 activate-unit）与点击展开箭头
                   （触发 toggle）行为保持一致，符合 tree 控件的通用语义 -->
              <ImOrganizationTree
                v-if="contactsTab === 'directory'"
                :units="c.directory.value"
                :expanded-ids="expandedUnits"
                :label="t('aria.contacts')"
                :error-label="t('group.treeLoadError')"
                :retry-label="t('retry')"
                :online-label="t('presence.online')"
                :offline-label="t('presence.offline')"
                :busy-label="t('presence.busy')"
                @toggle="toggleUnit"
                @activate-unit="toggleUnit"
                @activate-member="openContactDetail"
              />
              <ImContactGroupSections
                v-else
                :department-groups="contactDepartmentGroups"
                :ordinary-groups="contactOrdinaryGroups"
                status="ready"
                :labels="{
                  departmentGroups: t('contact.departmentGroups'), ordinaryGroups: t('contact.ordinaryGroups'),
                  loading: t('contact.groupsLoading'), error: t('contact.groupsError'), retry: t('retry'),
                  emptyDepartment: t('contact.departmentGroupsEmpty'), emptyOrdinary: t('contact.ordinaryGroupsEmpty'),
                  organizationSource: t('group.source.organization'), manualSource: t('group.source.manual'), businessSource: t('group.source.business')
                }"
                @open="openGroupDetail"
                @retry="c.refresh"
              />
            </template>
            <p v-if="c.query.value.trim() && !c.contacts.value.length" class="empty-contacts">{{ t('noContacts') }}</p>
          </div>
        </div>
        <!--
          宿主插槽（UI 扩展点，非业务耦合）：侧栏底部固定区，供宿主 Teleport 挂载自己的内容
          （当前用途=KimpoChat 桌面版提示横幅）。插件只提供这个带稳定契约属性的空容器，
          不感知宿主往里放什么；宿主不往里放时该容器高度为 0、完全不占位。
          契约键 data-kimpo-host-slot="sidebar-footer" 属对外稳定 API，改名视为破坏性变更。
        -->
        <div class="host-slot-sidebar-footer" data-kimpo-host-slot="sidebar-footer" />
      </aside>

      <section class="chat">
        <template v-if="c.activeConversation.value">
          <ImChatHeader
            :title="c.activeConversation.value.title"
            :avatar="c.activeConversation.value.avatar"
            :subtitle="chatHeaderSubtitle"
            :presence="chatHeaderPresence"
          >
            <template #actions>
              <button
                v-if="c.activeConversation.value.kind === 'system' && c.activeConversation.value.unread"
                class="chat-header-text-action"
                data-kimpo-extension="system-mark-read"
                @click="markVisibleNotificationsRead"
              >{{ t('notification.markVisibleRead') }}</button>
              <ImIconButton
                ref="chatSettingsButton"
                :label="t('settings')"
                tone="neutral"
                data-kimpo-extension="chat-settings"
                @click="openChatSetting"
              >
                <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="1.7" /><circle cx="12" cy="12" r="1.7" /><circle cx="19" cy="12" r="1.7" /></svg>
              </ImIconButton>
            </template>
          </ImChatHeader>
          <section
            v-if="c.announcementText.value"
            class="group-announcement"
            role="note"
            :aria-label="t('group.announcement')"
          >
            <strong>{{ t('group.announcement') }}</strong>
            <span>{{ c.announcementText.value }}</span>
          </section>
          <!-- 多选入口已按 Figma 移入消息右键菜单，此工具条负责批量操作与退出 -->
          <div v-if="c.selectionMode.value" class="selection-toolbar" role="toolbar" :aria-label="t('multi.toolbar')" data-kimpo-extension="message-selection"><span>{{ c.selectedMessages.value.length }} {{ t('multi.selected') }}</span><button :disabled="!c.selectedMessages.value.length" @click="c.openForward(c.selectedMessages.value)">{{ t('forward.individual') }}</button><button :disabled="!c.selectedMessages.value.length" @click="c.openForward(c.selectedMessages.value)">{{ t('forward.merged') }}</button><button class="selection-toolbar__cancel" @click="c.setSelectionMode(false)">{{ t('multi.cancel') }}</button></div>
          <p v-if="c.historyLoading.value" class="history-loading" aria-live="polite">{{ t('loading') }}</p>
          <ImVirtualMessageList
            ref="messageList"
            class="message-scroll"
            :messages="c.messages.value"
            :ariaLabel="t('aria.messages')"
            :live-text="liveAnnouncement"
            @at-bottom="onVirtualAtBottom"
            @top-reached="onVirtualTopReached"
            @viewport-ready="onVirtualViewportReady"
          >
            <template #default="{ message, index }">
              <div v-if="messagePresentations[index]?.showTimeDivider" class="message-time-divider">
                <!-- 需求7：当天分隔线可点击展开/收起完整日期时间；非当天恒为完整文案且不可交互（普通文本，不做成点了没反应的按钮）。 -->
                <button
                  v-if="isTodayDivider(message)"
                  type="button"
                  class="message-time-divider__toggle"
                  :aria-expanded="expandedDividers.has(message.id)"
                  :aria-label="dividerFullLabel(message)"
                  :title="dividerFullLabel(message)"
                  @click="toggleDivider(message)"
                >{{ dividerText(message) }}</button>
                <span v-else>{{ dividerText(message) }}</span>
              </div>
              <div v-if="messagePresentations[index]?.showUnreadDivider" class="message-unread-divider"><span>{{ t('message.unreadDivider') }}</span></div>
              <!-- data-notification-id：宿主顶栏通知中心移除后，系统通知会话是唯一通知入口，E2E 靠此定位单条通知。 -->
              <section v-if="message.notification" :class="['message-standalone', 'notification-message', { 'notification-message--card': Boolean(message.card), 'message-standalone--highlighted': c.highlightedSeq.value === message.seq }]" :data-seq="message.seq" :data-notification-id="message.notification.id" :aria-label="t('notification.aria')">
                <!-- 卡片类通知的 content 即卡片 JSON 载体（宿主由此解析出 card），
                     有卡片时标题/正文全由卡片本体呈现，不再渲染原文防 JSON 外露。 -->
                <template v-if="!message.card"><b>{{ message.notification.title }}</b><p>{{ message.notification.content }}</p></template>
                <ImBusinessCard
                  v-if="message.card"
                  :model="cardDisplayModel(message)"
                  :fallback-label="t('card.unsupported')"
                  :business-label="cardKindLabel(cardDisplayModel(message))"
                  :untitled-label="t('card.untitled')"
                  :no-summary-label="t('card.noSummary')"
                  :view-label="t('card.view')"
                  :merged-view-label="mergedViewLabel(message)"
                  @action="runCardAction(message, $event)"
                  @view="viewBusinessCard(message, $event)"
                ><template #state="{ state }">{{ cardStateText(state) }}</template></ImBusinessCard>
                <!-- 无业务卡但携带内部链接的通知（原宿主通知抽屉点击即跳转的能力，由此处接管）：
                     复用卡片同款导航守卫 viewBusinessCard（仅放行 / 开头的站内路由）。 -->
                <div v-else-if="message.notification.link" class="card-actions"><button type="button" @click="viewBusinessCard(message, message.notification.link)">{{ t('card.view') }} ›</button></div>
              </section>
              <p v-else-if="message.kind === 'system'" :class="['message-standalone', 'system-message', { 'message-standalone--highlighted': c.highlightedSeq.value === message.seq }]" :data-seq="message.seq">{{ systemLabel(message) }}</p>
              <p v-else-if="message.kind === 'recall'" :class="['message-standalone', 'system-message', { 'message-standalone--highlighted': c.highlightedSeq.value === message.seq }]" :data-seq="message.seq">{{ t('recalled') }}</p>
              <ImMessageItem
                v-else
                :message="message"
                :own="message.sender.id === c.snapshot.value.self?.id"
                :show-sender="c.activeConversation.value?.kind !== 'single'"
                :grouped="Boolean(messagePresentations[index]?.grouped)"
                :highlighted="c.highlightedSeq.value === message.seq"
                :actions="messageActions(message)"
                :menu-label="t('message.actions')"
                :time-label="messageTime(message)"
                :edited-label="message.editedAt ? t('message.edited') : undefined"
                :selectable="c.selectionMode.value && canForwardMessage(message)"
                :selected="c.selectedMessageIds.value.has(message.id)"
                :selection-label="t('multi.selectMessage')"
                @update:selected="c.toggleMessageSelection(message)"
                @action="handleMessageAction(message, $event)"
              >
                <template #bubble>
                  <span v-if="message.kind === 'text'" class="message-text"><template v-for="(part, partIndex) in linkifyMessageText(message.text || '')" :key="partIndex"><a v-if="part.kind === 'link'" :href="part.href" target="_blank" rel="noopener noreferrer">{{ part.text }}</a><template v-else>{{ part.text }}</template></template></span>
                  <ImBusinessCard
                    v-else-if="message.kind === 'card' && message.card"
                    :model="cardDisplayModel(message)"
                    :fallback-label="t('card.unsupported')"
                    :business-label="cardKindLabel(cardDisplayModel(message))"
                    :untitled-label="t('card.untitled')"
                    :no-summary-label="t('card.noSummary')"
                    :view-label="t('card.view')"
                    :merged-view-label="mergedViewLabel(message)"
                    :aria-label="t('card.aria')"
                    @action="runCardAction(message, $event)"
                    @view="viewBusinessCard(message, $event)"
                  ><template #state="{ state }">{{ cardStateText(state) }}</template></ImBusinessCard>
                  <button v-else-if="message.kind === 'image' && message.attachment" class="image-bubble" :aria-label="t('image.preview')" @click="preview(message.attachment)"><img v-if="message.imagePreviewUrl" :src="message.imagePreviewUrl" :alt="message.attachment.fileName" /><span v-else>{{ t('image.loading') }}</span></button>
                  <button v-else-if="message.attachment" class="file" @click="preview(message.attachment)">▣ <span>{{ labelAttachment(message.attachment) }}</span><small>{{ t('file.preview') }}</small></button>
                </template>
                <template #status>
                  <ImMessageStatus v-if="message.sendState === 'sending' || message.sendState === 'failed'" :state="message.sendState" :label="t(`send.${message.sendState}` as keyof typeof zh)" :retry-label="t('send.retry')" @retry="c.retry(message)" />
                  <!-- Figma 单聊常驻回执：已读=提示灰 / 未读=品牌蓝，位于气泡内侧下角 -->
                  <span v-else-if="inlineReceiptLabel(message)" :class="['receipt-inline', { 'receipt-inline--unread': inlineReceiptUnread(message) }]">{{ inlineReceiptLabel(message) }}</span>
                </template>
                <template #after>
                  <!-- 需求8（2026-08-11）：引用行从气泡内部移到气泡下方，微信/企微式灰色小字，own 消息右对齐；
                       须排在 #after 内容最前面（回执/表情选择器/reaction 之后）。 -->
                  <button
                    v-if="message.replyTo"
                    type="button"
                    :class="['message-quote', { 'message-quote--own': isOwnMessage(message) }]"
                    :title="quoteLineText(message)"
                    @click="locateQuotedMessage(message)"
                  >{{ quoteLineText(message) }}</button>
                  <!-- 群聊回执仍走菜单加载 + 明细展开；单聊回执改为气泡旁常驻（见 #status 槽） -->
                  <div v-if="message.receipt && c.activeConversation.value?.kind !== 'single'" class="receipt-state" aria-live="polite"><span v-if="message.receipt.status === 'loading'">{{ t('receipt.loading') }}</span><span v-else-if="message.receipt.status === 'error'">{{ t('receipt.error') }}：{{ message.receipt.error }}</span><span v-else-if="message.receipt.mode === 'disabled'">{{ t('receipt.disabled') }}</span><template v-else><button v-if="message.receipt.mode === 'roster'" @click="receiptDetailId = receiptDetailId === message.id ? undefined : message.id">{{ message.receipt.readUserIds?.length || 0 }} {{ t('receipt.peopleRead') }}</button><span v-else>{{ message.receipt.readCount || 0 }} {{ t('receipt.peopleRead') }}</span><ul v-if="receiptDetailId === message.id && message.receipt.mode === 'roster'"><li v-for="userId in message.receipt.readUserIds" :key="userId">{{ c.groupMembers.value.find(member => member.userId === userId)?.displayName || userId }}</li></ul></template></div>
                  <div v-if="reactionTargetId === message.id" class="reaction-picker"><button v-for="emoji in emojiChoices" :key="emoji" @click="chooseReaction(message, emoji)">{{ emoji }}</button></div>
                  <footer v-if="message.reactions?.length" class="message-reactions"><button v-for="reaction in message.reactions" :key="reaction.emoji" :class="['reaction', { mine: reaction.mine }]" :aria-pressed="Boolean(reaction.mine)" @click="toggleReaction(message, reaction)">{{ reaction.emoji }} {{ reaction.count }}</button></footer>
                </template>
              </ImMessageItem>
            </template>
          </ImVirtualMessageList>
          <button v-if="c.newMessageCount.value" class="new-message" @click="jumpToLatest">{{ c.newMessageCount.value }} {{ t('newMessages') }}</button>
          <ImMessageComposer
            ref="composer"
            v-model="c.draft.value"
            :can-write="c.canWrite.value"
            :readonly="c.activeConversation.value.readonly && !['admin', 'owner'].includes(c.activeConversation.value.currentMemberRole || '')"
            :reply-to="c.replyTo.value"
            :upload="c.upload.value"
            :upload-failures="failedUploads"
            :active-conversation-id="c.activeConversation.value.id"
            :mention-candidates="composerMentionCandidates"
            :can-mention-all="c.canMentionAll.value"
            :labels="{
              placeholder: c.canWrite.value ? t('placeholder') : c.activeConversation.value.readonly && !['admin', 'owner'].includes(c.activeConversation.value.currentMemberRole || '') ? t('placeholder.readonly') : t('placeholder.muted'), send: t('send'), emoji: t('emoji.development'), emojiDevelopment: t('emoji.development'),
              attachment: t('attachment'), attachmentMenu: t('attachment.menu'), image: t('attachment.image'), file: t('attachment.file'), video: t('attachment.video'),
              history: t('composer.history'),
              reply: t('quote'), closeReply: t('reply.close'), uploading: t('uploading'), uploadFailed: t('upload.failed'), retry: t('upload.retry'), cancel: t('cancel'), mentions: t('mention.candidates'),
              mentionAll: t('mention.allToken'), readonly: t('readonly'), muted: t('muted')
            }"
            @history="openChatHistory"
            @send="c.send"
            @files="sendFiles"
            @cancel-upload="c.upload.value?.cancel()"
            @retry-upload="retryUpload"
            @dismiss-upload-failure="dismissUploadFailure"
            @clear-reply="c.replyTo.value = undefined"
            @mention="registerMention"
            @mention-all="registerMentionAll"
          />
        </template>
          <!-- 无会话空态：Figma KO 灰调水印 -->
          <section v-else class="state-screen state-screen--chat state-screen--watermark"><ImBrandWatermark :width="147" :height="100" /></section>
          <!-- 通讯录页时右侧为空态水印（Figma 通讯录两稿），v-show 覆盖避免消息视口重挂 -->
          <div v-show="c.activeTab.value === 'contacts'" class="chat-watermark-overlay" aria-hidden="true"><ImBrandWatermark :width="147" :height="100" /></div>
      </section>

      <!-- 聊天记录浮层（2026-08-11）：分类页签+搜索+日期分组，附件点击复用现有预览链路 -->
      <ImChatHistoryDialog
        v-if="historyOpen && c.activeConversation.value"
        :title="`${c.activeConversation.value.title} · ${t('composer.history')}`"
        :fetch-page="historyFetchPage"
        :source="historySource"
        :format-date="historyDateLabel"
        :format-time="messageTime"
        :timezone="displayTimezone"
        :locale="displayLocale"
        :labels="{
          title: t('composer.history'), close: t('close'), search: t('search'),
          tabAll: t('history.tab.all'), tabMedia: t('history.tab.media'), tabFile: t('history.tab.file'), tabLink: t('history.tab.link'),
          empty: t('history.empty'), loading: t('loading'), loadMore: t('history.loadMore'), end: t('history.end'),
          image: t('history.image'), video: t('history.video'), card: t('history.card'), system: t('history.system'),
          dateFilter: t('history.date.filter'), dateClear: t('history.date.clear'),
          datePrevMonth: t('history.date.prevMonth'), dateNextMonth: t('history.date.nextMonth'), dateContinue: t('history.date.continue')
        }"
        @close="historyOpen = false"
        @preview="preview"
      />

      <Transition name="setting-slide"><ImChatSetting
        v-if="c.drawerOpen.value && c.activeConversation.value"
        class="chat-setting-overlay"
        :title="t('settings')"
        :close-label="t('close')"
        :content-label="t('aria.settings')"
        @close="closeChatSetting"
      >
        <ImSettingSection
          v-if="['group', 'department'].includes(c.activeConversation.value.kind)"
          :title="`${c.groupMembers.value.length || c.activeConversation.value.memberCount || 0} ${t('members')}`"
        >
          <div class="setting-member-grid" :aria-label="t('group.memberOverview')">
            <span v-for="member in settingMemberPreview" :key="`preview-${member.userId}`" class="setting-member-tile"><span class="avatar tiny">{{ member.displayName[0] }}</span><small>{{ member.displayName }}</small></span>
            <button v-if="c.activeConversation.value.kind === 'group' && c.canInvite.value" type="button" class="setting-member-tile setting-member-tile--action" @click="openGroupDialog('invite')"><span>＋</span><small>{{ t('group.inviteShort') }}</small></button>
          </div>
          <button v-if="c.groupMembers.value.length > settingMemberPreview.length" type="button" class="setting-member-more" @click="revealMemberList">{{ t('group.viewAllMembers') }}</button>
          <p v-if="c.activeConversation.value.kind === 'department'" class="setting-managed-note">{{ t('group.departmentManaged') }} {{ t('group.departmentSource') }}</p>
        </ImSettingSection>
        <ImSettingSection
          v-if="['group', 'department'].includes(c.activeConversation.value.kind)"
          :title="t('setting.groupInfo')"
        >
          <dl class="setting-facts">
            <div><dt>{{ t('setting.groupId') }}</dt><dd>{{ c.activeConversation.value.id }}</dd></div>
            <div><dt>{{ t('setting.groupType') }}</dt><dd>{{ c.activeConversation.value.kind === 'department' ? t('setting.groupType.department') : t('setting.groupType.ordinary') }}</dd></div>
          </dl>
        </ImSettingSection>

        <ImSettingSection v-if="c.activeConversation.value.kind === 'single' && singleSettingUser" :title="t('setting.contactInfo')">
          <button class="setting-action" @click="openSingleSettingContact">{{ t('setting.viewContact') }}</button>
        </ImSettingSection>

        <ImSettingSection
          v-if="['group', 'department'].includes(c.activeConversation.value.kind)"
          :title="`${c.groupMembers.value.length || c.activeConversation.value.memberCount || 0} ${t('members')}`"
        >
          <div ref="memberList" class="setting-member-list" aria-live="polite" tabindex="-1">
            <span v-if="c.groupMembersLoading.value" class="setting-state">{{ t('group.membersLoading') }}</span>
            <span v-else-if="c.groupMembersError.value" class="setting-state setting-danger" role="alert">{{ t('group.membersError') }}</span>
            <div v-for="member in c.groupMembers.value" :key="member.userId" class="setting-member-row">
              <span class="avatar tiny">{{ member.displayName[0] }}<i v-if="member.presence === 'online'" class="presence" /></span>
              <span class="setting-member-copy">
                <b>{{ member.displayName }}</b>
                <small>{{ t(`group.role.${member.role}` as keyof typeof zh) }} · {{ t(`group.source.${member.source}` as keyof typeof zh) }}<template v-if="member.presence"> · {{ t(`presence.${member.presence}` as keyof typeof zh) }}</template></small>
                <small v-if="c.groupRoleOperation.value.status === 'error' && c.groupRoleOperation.value.userId === member.userId" class="setting-danger" role="alert">{{ t('group.roleError') }}：{{ c.groupRoleOperation.value.error }}</small>
              </span>
              <span v-if="c.activeConversation.value.kind === 'group'" class="setting-member-actions">
                <button v-if="c.canSetMemberAdmin(member)" class="setting-compact-action" :disabled="c.groupRoleOperation.value.status === 'pending'" @click="toggleMemberAdmin(member)">{{ isGroupRolePending(member) ? t('group.rolePending') : member.role === 'admin' ? t('group.removeAdmin') : t('group.makeAdmin') }}</button>
                <button v-if="c.canTransferOwnership(member)" class="setting-compact-action setting-danger" :disabled="c.groupRoleOperation.value.status === 'pending'" @click="transferOwnership(member)">{{ isGroupRolePending(member) ? t('group.rolePending') : t('group.transferOwner') }}</button>
                <button v-if="c.canKickMember(member)" class="setting-compact-action setting-danger" @click="kickMember(member)">{{ t('group.kick') }}</button>
                <button
                  v-if="c.canMuteMember.value && member.role !== 'owner'"
                  class="setting-compact-action"
                  :disabled="c.groupGovernancePending.value"
                  :aria-label="`${member.sendMuted ? t('group.memberUnmute') : t('group.memberMute')} ${member.displayName}`"
                  @click="toggleMemberSendMuted(member)"
                >{{ member.sendMuted ? t('group.memberUnmute') : t('group.memberMute') }}</button>
              </span>
            </div>
          </div>
        </ImSettingSection>

        <ImSettingSection
          v-if="['group', 'department'].includes(c.activeConversation.value.kind)"
          :title="t('group.announcement')"
        >
          <p v-if="c.announcementLoading.value" class="setting-state" aria-live="polite">{{ t('loading') }}</p>
          <p v-else-if="!c.announcementText.value && !c.canGovernGroup.value" class="setting-state">{{ t('group.announcementEmpty') }}</p>
          <p v-else-if="!c.canGovernGroup.value" class="setting-announcement-current">{{ c.announcementText.value }}</p>
          <template v-else>
            <label class="setting-field">
              <span class="sr-only">{{ t('group.announcement') }}</span>
              <textarea
                v-model="c.announcementDraft.value"
                rows="4"
                maxlength="4000"
                :placeholder="t('group.announcementPlaceholder')"
                :disabled="c.groupGovernancePending.value"
              />
            </label>
            <div class="setting-inline-actions">
              <button class="setting-action setting-action--primary" :disabled="c.groupGovernancePending.value || !c.announcementDraft.value.trim()" @click="saveAnnouncement">{{ t('group.announcementSave') }}</button>
              <button class="setting-action" :disabled="c.groupGovernancePending.value || !c.announcementText.value" @click="clearAnnouncement">{{ t('group.announcementClear') }}</button>
            </div>
          </template>
        </ImSettingSection>

        <ImSettingSection
          v-if="['group', 'department'].includes(c.activeConversation.value.kind)"
          :title="t('group.muteAll')"
          :description="t('group.muteAllDescription')"
        >
          <div :title="c.canGovernGroup.value ? undefined : t('group.muteAllDescription')">
            <ImSettingSwitchRow
              :model-value="Boolean(c.activeConversation.value.allMuted)"
              :label="t('group.muteAll')"
              :disabled="!c.canGovernGroup.value || c.groupGovernancePending.value"
              @change="toggleGroupMuteAll"
            />
          </div>
          <p v-if="c.groupGovernanceError.value" class="setting-state setting-danger" role="alert">{{ t('group.governanceError') }}：{{ c.groupGovernanceError.value }}</p>
        </ImSettingSection>

        <ImSettingSection :title="t('setting.conversation')">
          <ImSettingSwitchRow
            :model-value="Boolean(c.activeConversation.value.pinned)"
            :label="t('setting.pinned')"
            @change="toggleSettingPreference('pin')"
          />
          <ImSettingSwitchRow
            v-if="c.activeConversation.value.kind !== 'system'"
            :model-value="Boolean(c.activeConversation.value.muted)"
            :label="t('setting.muted')"
            @change="toggleSettingPreference('mute')"
          />
          <!-- 产品定版（2026-08-10）：不提供清空聊天记录/删除消息，仅保留撤回（2 分钟窗） -->
          <button v-if="c.activeConversation.value.kind !== 'system'" class="setting-action setting-action--danger" @click="hideActiveFromSettings">{{ t('conversation.hide') }}</button>
        </ImSettingSection>

        <template v-if="c.activeConversation.value.kind === 'group'">
          <ImSettingSection v-if="c.canInvite.value || c.canEditGroup.value" :title="t('group.management')">
            <button v-if="c.canInvite.value" class="setting-action" @click="openGroupDialog('invite')">{{ t('group.invite') }}</button>
            <div v-if="c.canEditGroup.value" class="setting-group-edit">
              <label class="setting-field"><span>{{ t('group.name') }}</span><input v-model="groupEditName" :placeholder="c.activeConversation.value.title" /></label>
              <label class="setting-file"><span>{{ t('group.avatar') }}</span><input type="file" accept="image/*" @change="groupAvatarFile = ($event.target as HTMLInputElement).files?.[0]" /></label>
              <button class="setting-action setting-action--primary" :disabled="c.groupOperation.value.status === 'pending'" @click="saveGroupInfo">{{ t('group.save') }}</button>
            </div>
          </ImSettingSection>
          <ImSettingSection v-if="c.canLeaveGroup.value || c.canDissolveGroup.value" :title="t('group.otherActions')" :divided="false">
            <button v-if="c.canLeaveGroup.value" class="setting-action" @click="leaveGroup">{{ t('group.leave') }}</button>
            <button v-if="c.canDissolveGroup.value" class="setting-action setting-action--danger" @click="dissolveGroup">{{ t('group.dissolve') }}</button>
          </ImSettingSection>
          <p v-if="c.groupOperation.value.status !== 'idle'" class="setting-operation" aria-live="polite">{{ groupOperationLabel() }}</p>
        </template>
      </ImChatSetting></Transition>
      </div>
      </div>
    </template>

    <ImContactDetailDialog
      v-if="selectedContact && selectedContactDetail"
      :contact="selectedContactDetail"
      :labels="{
        title: t('contact.detailTitle'), close: t('close'), userId: t('contact.userId'), email: t('contact.email'),
        phone: t('contact.phone'), departments: t('contact.departments'), primaryDepartment: t('contact.primaryDepartment'),
        sendMessage: t('contact.sendMessage')
      }"
      :can-send-message="canMessageSelectedContact"
      :initial-focus="canMessageSelectedContact ? 'send-message' : 'close'"
      :return-focus="contactReturnFocus"
      @close="closeContactDetail"
      @send-message="messageSelectedContact"
    />

    <ImGroupDetailDialog
      v-if="selectedGroupDetail"
      :conversation="selectedGroupDetail"
      :return-focus="groupDetailReturnFocus"
      :labels="{
        title: t('contact.groupDetailTitle'), close: t('close'), type: t('contact.groupType'),
        departmentType: t('contact.departmentGroups'), ordinaryType: t('contact.ordinaryGroups'), members: t('members'),
        departmentRule: t('contact.departmentGroupRule'), ordinaryRule: t('contact.ordinaryGroupRule'), enter: t('contact.enterGroup')
      }"
      @close="closeGroupDetail"
      @enter="enterGroupConversation"
    />

    <ImNotificationPreferences
      v-if="notificationPreferencesOpen && notificationPreferenceClient"
      :client="notificationPreferenceClient"
      :return-focus="notificationSettingsTrigger"
      :labels="{
        title: t('preference.title'), close: t('close'), loading: t('preference.loading'), loadError: t('preference.loadError'), retry: t('retry'),
        dnd: t('preference.dnd'), dndEnabled: t('preference.dndEnabled'), startTime: t('preference.startTime'), endTime: t('preference.endTime'),
        timezone: t('preference.timezone'), timezonePlaceholder: t('preference.timezonePlaceholder'), urgentBypassDnd: t('preference.urgentBypassDnd'),
        save: t('preference.save'), categoriesTitle: t('preference.categories'), inApp: t('preference.inApp'), mail: t('preference.mail'), sms: t('preference.sms'),
        pending: t('preference.pending'), success: t('preference.success'), failed: t('preference.failed'),
        validation: {
          'time-required': t('preference.validation.timeRequired'), 'time-same': t('preference.validation.timeSame'),
          'timezone-required': t('preference.validation.timezoneRequired'), 'timezone-invalid': t('preference.validation.timezoneInvalid')
        },
        categories: {
          chat: t('preference.category.chat'), todo: t('preference.category.todo'), mention: t('preference.category.mention'),
          announcement: t('preference.category.announcement'), system: t('preference.category.system')
        }
      }"
      @close="notificationPreferencesOpen = false"
    />

    <div v-if="c.forwardOpen.value" class="preview-overlay" role="presentation">
      <section class="forward-dialog" role="dialog" aria-modal="true" :aria-label="t('forward.dialog')">
        <!-- 统一弹窗头（macOS 关闭在左、其他平台在右，见 ImDialogHeader）；四个面板内弹窗同此 -->
        <ImDialogHeader :title="t('forward.dialog')" :subtitle="`${c.forwardSources.value.length} ${t('multi.selected')}`" :close-label="t('close')" @close="c.closeForward" />
        <div class="forward-targets"><label v-for="item in c.conversations.value.filter(value => value.kind !== 'system' && canSend(value))" :key="item.id"><input type="checkbox" :checked="c.forwardTargetIds.value.has(item.id)" @change="c.toggleForwardTarget(item.id)" />{{ item.title }}</label></div>
        <div v-if="c.forwardResults.value.length" class="forward-results" aria-live="polite"><p v-for="result in c.forwardResults.value" :key="result.conversationId" :class="result.status"><b>{{ c.snapshot.value.conversations.find(item => item.id === result.conversationId)?.title || result.conversationId }}</b>：{{ t(`forward.status.${result.status}` as keyof typeof zh) }}<small v-if="result.error">{{ result.error }}</small></p></div>
        <footer><button :disabled="!c.forwardTargetIds.value.size" @click="confirmForward('individual')">{{ t('forward.individual') }}</button><button :disabled="!c.forwardTargetIds.value.size || c.forwardSources.value.length > 50" @click="confirmForward('merged')">{{ t('forward.merged') }}</button></footer>
      </section>
    </div>

    <div v-if="groupDialog" class="preview-overlay" role="presentation" @click.self="closeGroupDialog">
      <section ref="groupDialogSurface" class="group-dialog" role="dialog" aria-modal="true" :aria-label="groupDialog === 'create' ? t('group.createTitle') : t('group.invite')" tabindex="-1" @keydown.esc.stop.prevent="closeGroupDialog" @keydown.tab="trapGroupDialogFocus">
        <ImDialogHeader :title="groupDialog === 'create' ? t('group.createTitle') : t('group.invite')" :close-label="t('close')" @close="closeGroupDialog" />
        <label v-if="groupDialog === 'create'">{{ t('group.name') }}<input v-model="groupName" /></label><b>{{ t('group.selectMembers') }}</b>
        <label>{{ t('group.searchMembers') }}<input :value="c.groupCandidateQuery.value" :placeholder="t('group.searchPlaceholder')" @input="c.scheduleGroupCandidateSearch(($event.target as HTMLInputElement).value)" /></label>
        <p v-if="c.groupCandidateSearch.value.status === 'loading'">{{ t('group.searchLoading') }}</p><p v-else-if="c.groupCandidateSearch.value.status === 'empty'">{{ t('group.searchEmpty') }}</p><p v-else-if="c.groupCandidateSearch.value.status === 'error'">{{ t('group.searchError') }}：{{ c.groupCandidateSearch.value.error }}</p>
        <div v-if="c.groupCandidateQuery.value.trim() && groupSearchCandidates.length" class="group-candidates" :aria-label="t('group.searchResults')">
          <b>{{ t('group.searchResults') }}</b>
          <label v-for="user in groupSearchCandidates" :key="`search-${user.id}`">
            <input type="checkbox" :checked="c.groupCandidateSelectedIds.value.has(user.id)" :disabled="isGroupCandidateDisabled(user)" @change="toggleVisibleGroupCandidate(user)" />{{ user.name }}
            <small>{{ isGroupCandidateDisabled(user) ? t('group.alreadyMember') : user.departments.join(' · ') }}</small>
          </label>
        </div>
        <div v-if="c.groupCandidateSelectedUsers.value.size" class="group-candidates" :aria-label="t('group.selectedMembers')"><b>{{ t('group.selectedMembers') }}</b><label v-for="user in c.groupCandidateSelectedUsers.value.values()" :key="`selected-${user.id}`"><input type="checkbox" checked @change="c.toggleGroupCandidate(user)" />{{ user.name }}<small>{{ user.departments.join(' · ') }}</small></label></div>
        <ImOrganizationTree
          class="group-directory"
          :units="c.directory.value"
          :expanded-ids="groupDialogExpandedUnits"
          :selected-member-ids="c.groupCandidateSelectedIds.value"
          :disabled-member-ids="groupDisabledMemberIds"
          :error-unit-ids="groupDialogUnitErrors"
          :label="t('group.organizationTree')"
          :error-label="t('group.treeLoadError')"
          :retry-label="t('retry')"
          mode="select"
          @toggle="toggleGroupDialogUnit"
          @activate-unit="toggleGroupDialogUnit"
          @activate-member="toggleVisibleGroupCandidate"
          @retry="retryGroupDialogUnit"
        />
        <p v-if="c.groupOperation.value.status !== 'idle'" aria-live="polite">{{ groupOperationLabel() }}</p>
        <footer><button :disabled="c.groupOperation.value.status === 'pending' || !c.groupCandidateSelectedIds.value.size || (groupDialog === 'create' && !groupName.trim())" @click="submitGroupDialog">{{ groupDialog === 'create' ? t('group.create') : t('group.invite') }}</button></footer>
      </section>
    </div>

    <div v-if="mergedViewer" class="preview-overlay" role="presentation" @click.self="mergedViewer = undefined">
      <section class="merged-dialog" role="dialog" aria-modal="true" :aria-label="t('merged.dialog')"><ImDialogHeader :title="mergedViewer.card?.title || t('merged.dialog')" :close-label="t('close')" @close="mergedViewer = undefined" /><ol><li v-for="item in mergedItems(mergedViewer)" :key="`${item.seq}-${item.senderName}`"><b>{{ item.senderName }}</b><p>{{ item.summary }}</p><small>{{ t(`merged.type.${item.msgType}` as keyof typeof zh) }} · #{{ item.seq }}</small></li></ol></section>
    </div>

    <div v-if="c.preview.value.status !== 'closed'" class="preview-overlay" role="presentation" @click.self="closePreview">
      <section ref="previewDialog" class="preview-dialog" role="dialog" aria-modal="true" :aria-label="t('preview.aria')" tabindex="-1" @keydown.tab="trapPreviewFocus">
        <ImDialogHeader :title="c.preview.value.asset.fileName" :subtitle="c.preview.value.asset.mimeType" :close-label="t('close')" @close="closePreview" />
        <ImImagePreviewToolbar
          v-if="previewAssetIsImage"
          :index="previewImageIndex"
          :total="previewImageAttachments.length"
          :zoom="previewZoom"
          :toolbar-label="t('preview.image.toolbar')"
          :previous-label="t('preview.image.previous')"
          :next-label="t('preview.image.next')"
          :zoom-in-label="t('preview.image.zoomIn')"
          :zoom-out-label="t('preview.image.zoomOut')"
          :reset-label="t('preview.image.reset')"
          @previous="navigatePreview(-1)"
          @next="navigatePreview(1)"
          @zoom-in="changePreviewZoom(1)"
          @zoom-out="changePreviewZoom(-1)"
          @reset="resetPreviewZoom"
        />
        <div v-if="c.preview.value.status === 'loading'" class="preview-state"><span class="spinner" />{{ t('preview.loading') }}</div>
        <div v-else-if="c.preview.value.status === 'error'" class="preview-state error"><strong>{{ t('preview.error') }}</strong><small>{{ c.preview.value.message }}</small><button @click="preview(c.preview.value.asset)">{{ t('retry') }}</button></div>
        <div v-else class="preview-content">
          <div v-if="c.preview.value.descriptor.kind === 'image'" class="preview-image-scroll">
            <div class="preview-image-stage" :style="previewImageStageStyle"><img :src="c.preview.value.descriptor.url" :alt="c.preview.value.asset.fileName" :style="previewImageStyle" /></div>
          </div>
          <video v-else-if="c.preview.value.descriptor.kind === 'video'" :src="c.preview.value.descriptor.url" controls :aria-label="c.preview.value.asset.fileName" />
          <iframe v-else-if="c.preview.value.descriptor.kind === 'pdf'" :src="c.preview.value.descriptor.url" :title="c.preview.value.asset.fileName" sandbox="" referrerpolicy="no-referrer" />
          <div v-else-if="c.preview.value.descriptor.kind === 'text'" class="preview-text"><pre>{{ c.preview.value.descriptor.text }}</pre><small v-if="c.preview.value.descriptor.truncated">{{ t('preview.text.truncated') }}</small></div>
          <div v-else class="preview-state"><p>{{ t('preview.unsupported') }}</p><a :href="c.preview.value.descriptor.url" :download="c.preview.value.descriptor.downloadFileName || c.preview.value.asset.fileName" rel="noopener noreferrer" referrerpolicy="no-referrer">{{ t('preview.download') }}</a></div>
        </div>
      </section>
    </div>
  </main>
</template>

<style scoped>
.im-next {
  position:relative;
  display:flex;
  flex-direction:column;
  width:100%;
  min-width:0;
  height:100%;
  overflow:hidden;
  border:0;
  border-radius:0;
  color:var(--im-uikit-text-primary);
  background:var(--im-uikit-bg-shell,var(--im-uikit-bg-operate));
  box-shadow:none;
  font-family:var(--im-uikit-font-family);
}
.im-next * { box-sizing:border-box; }
.im-next button,.im-next input,.im-next textarea { font:inherit; }
.im-next button { border:0;cursor:pointer; }
/* —— 顶部标题栏（2026-10-17 改版）——
   Figma 原稿 60 高、头像 40、姓名 16 / 部门 14 上下两行；按用户要求改为单行：
   高 44、头像 28、姓名 14 中粗 + 部门 12 提示色同行基线对齐（间距 8），底色沿用 Figma 浅蓝。
   macOS：窗口三灯在左（左 16），头像组紧跟其后（间距 16）；
   其他平台：头像组对齐内容区左缘（rail 宽 60 − 头像组内边距 4 = 56），窗口按钮贴顶贴右（Windows 系统标题按钮形态）。 */
.im-titlebar { display:flex;height:44px;flex:0 0 44px;align-items:center;gap:16px;padding:0 0 0 56px;background:var(--im-uikit-bg-titlebar,rgba(230,246,255,.5)); }
.im-titlebar--mac { padding:0 16px; }
.im-titlebar--other :deep(.im-floating-shell__winctl) { order:2;margin-left:auto; }
.im-titlebar__self { display:flex;min-width:0;height:36px;align-items:center;gap:8px;border-radius:var(--im-uikit-radius-md,8px);padding:0 8px 0 4px;color:inherit;background:transparent;transition:background-color var(--im-uikit-transition-interaction); }
.im-titlebar__self:hover { background:var(--im-uikit-bg-list-hover); }
.im-titlebar__self:focus-visible { outline:none;box-shadow:var(--im-uikit-focus-ring); }
.im-titlebar__self :deep(.im-avatar) { --im-avatar-size:28px; }
.im-titlebar__name { flex:0 0 auto;color:var(--im-uikit-text-primary);font-size:14px;font-weight:500;line-height:22px;white-space:nowrap; }
.im-titlebar__dept { min-width:0;max-width:180px;overflow:hidden;color:var(--im-uikit-text-tertiary);font-size:12px;line-height:22px;text-overflow:ellipsis;white-space:nowrap; }
.im-main { display:flex;min-height:0;flex:1; }
/* —— Figma 左侧窄条 rail：logo + 导航 + 底部（窗控已移到顶部标题栏） —— */
/* 尺寸基准：改按参考应用（微信 Mac）实测比例，整体为 Figma 定稿的 0.75 倍——
   参考窗 rail 宽 60（12+36+12）、按钮盒 36、字形 20、行中心距 48。Figma 定稿那套是 80/48/24/56，
   偏大。此处以用户实测为准，若后续回 Figma 改稿需同步。 */
.im-rail { display:flex;width:60px;flex:0 0 60px;flex-direction:column;align-items:center;padding:8px 12px 16px;background:transparent; }
.im-rail__logo { display:grid;width:36px;height:36px;flex:0 0 36px;place-items:center;overflow:hidden;border-radius:50%; }
/* logo 与导航组之间无间距（沿用定稿关系）；组内间距 12——按钮 36 + 间距 12 = 参考窗实测的行中心距 48 */
.im-rail__nav { display:flex;flex-direction:column;gap:12px;margin-top:0; }
.im-rail__nav-btn { display:flex;width:36px;height:36px;align-items:center;justify-content:center;border-radius:7.2px;color:var(--im-uikit-text-tertiary);background:transparent;transition:background-color var(--im-uikit-transition-interaction); }
.im-rail__nav-btn:hover { background:var(--im-uikit-bg-list-hover); }
.im-rail__nav-btn:focus-visible { outline:none;box-shadow:var(--im-uikit-focus-ring); }
.im-rail__footer { display:flex;flex-direction:column;align-items:center;gap:12px;margin-top:auto; }
/* 头像状态菜单：状态色点 + 当前态勾选 */
.presence-option { width:8px;height:8px;flex:0 0 auto;border-radius:50%;background:var(--im-uikit-presence-offline,#999); }
.presence-option--online { background:var(--im-uikit-presence-online,#67c23a); }
.presence-option--busy { background:var(--im-uikit-error,#e84f4f); }
.presence-check { margin-left:auto;color:var(--im-uikit-text-link,#0877f4); }
/* 静态守卫要求的通知偏好唯一入口类名，挂在 rail 汉堡按钮上 */
.global-settings-button { color:var(--im-uikit-text-tertiary); }
/* —— 内容区圆角卡片（#f5f5f5 / 圆角16），rail 外的全部内容都在这张卡上 —— */
.im-body { position:relative;display:flex;min-width:0;flex:1;margin:8px 8px 8px 0;overflow:hidden;border-radius:var(--im-uikit-radius-dialog,16px);background:var(--im-uikit-bg-surface,#f5f5f5); }
.sidebar {
  display:flex;
  width:298px;
  flex:0 0 298px;
  flex-direction:column;
  overflow:hidden;
  border-right:1px solid var(--im-uikit-border-lighter,#ebeef5);
  padding:0;
  background:transparent;
}
.sidebar-search-row { display:flex;align-items:center;gap:8px;padding:12px;border-bottom:1px solid var(--im-uikit-border-lighter,#ebeef5); }
.sidebar-search-row .sidebar-search { min-width:0;flex:1;width:auto;margin:0; }
.create-menu-button { display:flex;width:36px;height:36px;flex:0 0 36px;align-items:center;justify-content:center;border-radius:var(--im-uikit-radius-md,8px);padding:0;color:var(--im-uikit-text-tertiary);background:var(--im-uikit-bg-field,#ebebeb);transition:background-color var(--im-uikit-transition-interaction),transform var(--im-uikit-transition-interaction); }
.create-menu-button:hover { color:var(--im-uikit-text-link);background:var(--im-uikit-bg-dropdown-hover); }
.create-menu-button:active { transform:scale(.94); }
.create-menu-button:focus-visible { outline:none;box-shadow:var(--im-uikit-focus-ring); }
/* —— 通讯录「通讯录/群聊」分段页签（Figma 266×36，底 #ebebeb，选中白底圆角4） —— */
/* 需求B（2026-08-11）：页签挪到 .contacts__scroll 滚动容器之外，不再吃得到该容器右侧的
   scrollbar-gutter 预留槽，右侧留白需要自己补回 margin-right:16px，与左侧 16px 对称
   （原先 margin-right:0 是"整块滚动+预留槽在最外层"结构下的产物，结构改了这里要跟着改） */
.contacts-tabs { display:flex;flex:0 0 auto;margin:12px 16px;padding:4px;border-radius:var(--im-uikit-radius-md,8px);background:var(--im-uikit-bg-field,#ebebeb); }
.contacts-tabs button { flex:1;min-width:0;padding:4px;border-radius:var(--im-uikit-radius-xs,4px);color:var(--im-uikit-text-tertiary);background:transparent;font-size:var(--im-uikit-font-size-md,14px);line-height:20px;transition:color var(--im-uikit-transition-interaction),background-color var(--im-uikit-transition-interaction); }
.contacts-tabs button.active { color:var(--im-uikit-text-primary);background:var(--im-uikit-bg-bubble,#fff); }
.contacts-tabs button:focus-visible { outline:none;box-shadow:var(--im-uikit-focus-ring); }
/* .contacts 本身不再滚动：纵向 flex 容器，.contacts-tabs 固定在顶部（flex:0 0 auto），
   下方 .contacts__scroll 独占剩余空间并承担滚动——用户反馈滚动条贯穿到页签会把页签一起
   滚出可视区，改成这个两段结构后页签恒定可见 */
.contacts { display:flex;flex:1;min-height:0;flex-direction:column;overflow:hidden; }
/* 需求A（2026-08-11）：滚动条占位修布局跳动——部门树「折叠(无滚动条)/展开(有滚动条)」切换时，
   scrollbar-gutter:stable 让滚动条槽宽恒定预留（不管当前是否真的溢出），内容区宽度不再因滚动条
   有无而突变，侧栏不再左右跳。副作用：预留槽会常驻占掉一段右侧空间，若子项仍保留原来的
   margin-right:16px，右侧视觉留白会变成"margin+槽宽"（约 31~33px），比左侧 16px 明显更宽；
   下面把树/联系人行的 margin-right 收到 0，改由预留槽（各浏览器约 15~17px）充当右侧留白，
   与左侧 16px 基本对称——不硬编码具体槽宽像素，靠浏览器原生预留值自然对齐。
   需求B（2026-08-11）：这份 overflow/scrollbar-gutter 原先挂在 .contacts 整体上，会连带
   .contacts-tabs 一起滚动；现在收窄到这个专职的滚动容器（页签下方内容区），.contacts 自身
   改回不滚动，.contacts-tabs 固定不动 —— 详见上方 .contacts 与 .contacts-tabs 的注释 */
.contacts__scroll { display:flex;flex:1;min-height:0;flex-direction:column;overflow-y:auto;padding:0 0 10px;scrollbar-gutter:stable; }
.contacts__scroll > .im-org-tree,.contacts__scroll > .contact,.contacts__scroll > .empty-contacts { margin:0 0 0 16px; }
.unit,.contact { display:flex;width:100%;align-items:center;gap:8px;border-radius:7px;padding:8px;text-align:left;background:transparent; }
.unit small { margin-left:auto;color:var(--im-uikit-text-secondary); }
.contact { padding-left:20px; }
.contact>span:last-child { display:grid; }
.contact small { color:var(--im-uikit-text-secondary);font-size:11px; }
.avatar.tiny { display:inline-grid;width:28px;height:28px;flex:none;place-items:center;border-radius:50%;color:var(--im-uikit-text-on-primary,#fff);background:var(--im-uikit-brand,#6b8afd);font-size:12px;font-weight:500; }
/* 状态点描边跟随容器底色（把圆点从底上"抠"出来）：写死 #fff 会在暗色下变成一圈白环 */
.presence { position:absolute;right:-1px;bottom:-1px;width:9px;height:9px;border:2px solid var(--im-uikit-bg-surface,#fff);border-radius:50%;background:var(--im-uikit-presence-online,#25b36b); }
.tree-toggle { width:24px;flex:none;color:var(--im-uikit-text-secondary);background:transparent; }
.unit-name { display:flex;min-width:0;flex:1;align-items:center;text-align:left;background:transparent; }
.unit-name small { margin-left:auto; }
.empty-contacts { color:var(--im-uikit-text-secondary);text-align:center; }
.chat { position:relative;display:flex;min-width:0;flex:1;flex-direction:column;background:transparent; }
/* 通讯录页/无会话时的 KO 水印空态（Figma 160px 圆域居中） */
.chat-watermark-overlay { position:absolute;inset:0;z-index:5;display:grid;place-items:center;background:var(--im-uikit-bg-surface,#f5f5f5); }
.state-screen--watermark { background:transparent; }
html.dark .chat-watermark-overlay svg,html.dark .state-screen--watermark svg { opacity:.25; }
.state-screen { display:grid;width:100%;min-height:0;flex:1;place-content:center;justify-items:center;gap:10px;padding:32px;color:var(--im-uikit-text-secondary);background:transparent;text-align:center; }
.state-screen strong { color:var(--im-uikit-text-primary);font-size:16px;line-height:24px; }
.state-screen small { max-width:360px;color:var(--im-uikit-text-tertiary);font-size:13px;line-height:20px; }
.state-illustration { width:180px;height:132px;margin-bottom:8px; }
.state-illustration__back { fill:#f0f5ff; }
.state-illustration__paper { fill:#fff;stroke:#dce8ff;stroke-width:2; }
.state-illustration__accent { fill:#d8e7ff; }
.state-illustration__line { fill:none;stroke:#9dbbf5;stroke-width:5;stroke-linecap:round; }
.state-illustration__mark { fill:none;stroke:#e45a66;stroke-width:5;stroke-linecap:round; }
.state-screen button { border-radius:7px;padding:8px 14px;color:#fff;background:var(--im-uikit-text-link); }
.state-screen.error strong { color:var(--im-uikit-text-error); }
.state-screen code { color:var(--im-uikit-text-secondary);font-size:12px; }
.spinner { width:24px;height:24px;border:3px solid var(--im-uikit-bg-input);border-top-color:var(--im-uikit-text-link);border-radius:50%;animation:im-next-spinner .8s linear infinite; }
@keyframes im-next-spinner { to { transform:rotate(360deg); } }
.preview-overlay { position:absolute;z-index:20;inset:0;display:grid;place-items:center;padding:28px;background:rgba(17,24,39,.72); }
.preview-dialog { display:flex;width:min(780px,92%);height:min(620px,90%);flex-direction:column;overflow:hidden;border-radius:12px;background:var(--im-uikit-bg-card,#fff);box-shadow:0 20px 70px rgba(0,0,0,.4); }
.preview-content { display:grid;min-height:0;flex:1;place-items:center;background:var(--im-uikit-bg-muted,#f7f8fa); }
.preview-content img,.preview-content video { max-width:100%;max-height:100%;object-fit:contain; }
.preview-content iframe { width:100%;height:100%;border:0;background:var(--im-uikit-bg-card,#fff); }
.preview-text { display:flex;width:100%;height:100%;min-height:0;flex-direction:column;align-items:stretch;padding:16px;overflow:hidden;background:var(--im-uikit-bg-card,#fff); }
.preview-text pre { min-height:0;flex:1;margin:0;overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere;font:13px/1.6 ui-monospace,SFMono-Regular,Menlo,monospace;text-align:left; }
.preview-text small { flex:none;padding-top:8px;color:var(--im-uikit-text-secondary);text-align:left; }
.preview-state { display:grid;flex:1;place-content:center;justify-items:center;gap:12px;padding:28px;text-align:center; }
.preview-state a,.preview-state button { border-radius:7px;padding:8px 14px;color:#fff;background:var(--im-uikit-text-link);text-decoration:none; }
.preview-state.error strong { color:var(--im-uikit-text-error); }
/* 业务卡片（.notification-message）与图片占位底一律走 token：写死 #fff/#e5e8ef 会在暗色下白底贴深色背景 */
.image-bubble { display:block;padding:0!important;overflow:hidden;border-radius:8px!important;background:var(--im-uikit-bg-image-placeholder,#eef1f5)!important; }.image-bubble img { display:block;max-width:360px;max-height:260px;object-fit:cover; }.image-bubble span { display:block;padding:28px;color:var(--im-uikit-text-secondary,#697386); }.notification-message { display:grid;gap:8px;margin:14px auto;padding:12px 14px;width:min(90%,460px);background:var(--im-uikit-bg-card,#fff);border:1px solid var(--im-uikit-border-lighter,#e5e8ef);border-radius:var(--im-uikit-radius-md,8px);box-shadow:0 1px 3px #1f23290d;font-size:var(--im-uikit-font-size-md,14px);line-height:var(--im-uikit-line-height-md,20px); }.notification-message b { font-weight:600; }.notification-message p { margin:0;color:var(--im-uikit-text-secondary,#697386);font-size:13px;white-space:pre-wrap;overflow-wrap:anywhere; }
/* 卡片规范：外框由卡片自带，通知容器放入卡片时退为透明无框，且放开卡片到通知宽度 460 */
.notification-message--card { padding:0;border:0;background:transparent;box-shadow:none; }.notification-message--card :deep(.im-business-card) { max-width:none; }
.card-actions { display:flex;flex-wrap:wrap;gap:8px; }.card-actions button { padding:0;background:none;color:var(--im-uikit-text-link,#0877f4);font-size:var(--im-uikit-font-size-sm,12px);line-height:28px; }.card-actions button:hover { text-decoration:underline; }.card-actions button:disabled { opacity:.45;cursor:not-allowed; }
.conversation-row { position:relative;display:flex;align-items:center; }.conversation-row>.conversation { padding-right:32px; }.conversation-actions { position:absolute;right:4px;z-index:3; }.conversation-actions summary { list-style:none;padding:5px;color:#697386;cursor:pointer; }.conversation-actions summary::-webkit-details-marker { display:none; }.conversation-actions>div { position:absolute;right:0;top:24px;min-width:126px;padding:5px;background:#fff;border:1px solid #e5e8ef;border-radius:7px;box-shadow:0 8px 24px #1f232926; }.conversation-actions button { display:block;width:100%;padding:6px 8px;text-align:left;background:transparent;white-space:nowrap; }.conversation-actions .danger { color:#d92d35; }.reaction-picker button,.emoji-picker button { padding:3px 6px;border-radius:5px;background:#eef1f5;color:#596273; }.reaction-picker,.emoji-picker { display:flex;flex-wrap:wrap;gap:4px;padding:6px;width:max-content;background:#fff;border:1px solid #e5e8ef;border-radius:7px;box-shadow:0 5px 16px #1f23291f; }.emoji-picker { margin-bottom:6px; }.member-list { display:grid;gap:8px;padding-top:14px;max-height:300px;overflow:auto; }.member-row { display:flex;gap:8px;align-items:center; }.member-row>span:last-child { display:grid; }.member-row small { color:#8b919c; }
.unified-search { display:grid;gap:10px;padding:4px;max-height:calc(100% - 120px);overflow:auto; }.unified-search h3 { margin:5px 4px;color:var(--im-uikit-text-secondary,#697386);font-size:12px; }.unified-search section { display:grid;gap:3px; }.unified-search button { padding:8px;text-align:left;background:var(--im-uikit-bg-card,#fff);border-radius:6px; }.unified-search mark { padding:0;background:var(--im-uikit-bg-warning-soft,#fff0a6);color:inherit; }.search-error { color:var(--im-uikit-error,#d92d35);word-break:break-word; }.header-actions { display:flex;align-items:center;gap:8px; }.selection-toolbar { display:flex;align-items:center;gap:8px;padding:7px 20px;background:var(--im-uikit-bg-list-focused,rgba(8,119,244,.05)); }.selection-toolbar button { padding:5px 8px;border-radius:var(--im-uikit-radius-xs,4px);background:var(--im-uikit-bg-bubble,#fff);color:var(--im-uikit-text-link,#0877f4); }.selection-toolbar button:disabled { opacity:.45; }.selection-toolbar__cancel { margin-left:auto; }.message-select { flex:none;align-self:center; }.forward-dialog,.merged-dialog { width:min(520px,92%);max-height:80%;display:flex;flex-direction:column;background:var(--im-uikit-bg-card,#fff);border-radius:11px;overflow:hidden; }.forward-targets { display:grid;gap:7px;padding:14px;overflow:auto; }.forward-targets label { display:flex;gap:8px;align-items:center; }.forward-results { padding:0 14px; }.forward-results p { display:grid;margin:5px 0;padding:6px;background:var(--im-uikit-bg-muted,#f5f6f8);border-radius:5px; }.forward-results .failed { color:var(--im-uikit-error,#d92d35); }.forward-results .success { color:var(--im-uikit-success,#16875d); }.forward-results small { word-break:break-word; }.forward-dialog>footer { display:flex;justify-content:flex-end;gap:8px;padding:14px;border-top:1px solid var(--im-uikit-border-lighter,#edf0f3); }.forward-dialog>footer button { padding:7px 11px;border-radius:6px;background:var(--im-uikit-brand,#3d7cff);color:var(--im-uikit-text-on-primary,#fff); }.forward-dialog>footer button:disabled { opacity:.45; }.merged-dialog ol { margin:0;padding:12px 24px;overflow:auto; }.merged-dialog li { padding:8px 0;border-bottom:1px solid var(--im-uikit-border-lighter,#edf0f3); }.merged-dialog p { margin:3px 0;white-space:pre-wrap;word-break:break-word; }.merged-dialog small { color:var(--im-uikit-text-tertiary,#8b919c); }
.mention-picker { display:grid;max-height:190px;overflow:auto;margin-bottom:6px;padding:5px;background:var(--im-uikit-bg-card,#fff);border:1px solid var(--im-uikit-border-lighter,#e5e8ef);border-radius:7px;box-shadow:0 5px 16px #1f23291f; }.mention-picker button { display:flex;justify-content:space-between;padding:6px 8px;text-align:left;background:transparent; }.mention-picker small { color:#8b919c; }.receipt-state { margin-top:4px;padding:5px 7px;width:max-content;max-width:100%;border-radius:5px;background:#f5f7fa;color:#697386;font-size:11px; }.receipt-state button { color:#2e65df;background:transparent; }.receipt-state ul { margin:4px 0 0;padding-left:18px; }.message.own .receipt-state { margin-left:auto; }
.group-create { width:calc(100% - 8px);margin:0 4px 8px;padding:7px;border-radius:6px;background:var(--im-uikit-bg-brand-soft,#eef4ff);color:var(--im-uikit-text-link-accessible,#2e65df); }.member-row>button { margin-left:auto!important;width:auto!important;padding:4px!important;font-size:11px; }.group-edit { display:grid;gap:6px;margin:10px 0;padding:9px;background:#f7f8fa;border-radius:7px; }.group-edit input { min-width:0;padding:6px;border:1px solid #dfe3e8;border-radius:5px; }.group-dialog { width:min(440px,92%);max-height:80%;display:flex;flex-direction:column;gap:12px;padding:16px;background:#fff;border-radius:11px; }.group-dialog>.im-dialog-header { margin:-16px -16px 0; }.group-dialog>label { display:grid;gap:5px; }.group-dialog>label>input { padding:7px;border:1px solid #dfe3e8;border-radius:5px; }.group-candidates { display:grid;gap:7px;max-height:300px;overflow:auto; }.group-candidates label { display:flex;gap:8px;align-items:center; }.group-dialog>footer { display:flex;justify-content:flex-end; }.group-dialog>footer button { padding:7px 11px;border-radius:6px;background:#3d7cff;color:#fff; }.group-dialog>footer button:disabled { opacity:.45; }
.im-next.im-uikit-theme { color:var(--im-uikit-text-primary);font-family:var(--im-uikit-font-family); }
.sidebar { display:flex;flex-direction:column;overflow:hidden; }
/* 宿主插槽：钉在侧栏底部（flex 末项 + margin-top:auto 让它始终贴底），宿主没往里
   Teleport 内容时 :empty 命中、高度为 0，完全不占位也不画边框。 */
.host-slot-sidebar-footer { flex:0 0 auto;margin-top:auto;border-top:1px solid var(--im-uikit-border-lighter,#ebeef5); }
.host-slot-sidebar-footer:empty { border-top:0; }
.sidebar-search { flex:0 0 auto; }
.group-create { width:calc(100% - 28px);margin-right:14px;margin-left:14px; }
.conversation-list { width:100%;margin:0; }
/* Figma 定稿：聊天顶部「更多」字形 24×24。按钮外框保持 28（--im-uikit-icon-button-md，
   留足点击区、也不动其它复用该 token 的按钮），把内边距从 4 收到 2，让字形恰好 28-2*2=24。 */
[data-kimpo-extension="chat-settings"] { padding:2px; }
.chat-header-text-action { min-height:32px;padding:4px 8px;border-radius:var(--im-uikit-radius-md,8px);color:var(--im-uikit-text-secondary);background:transparent;font-size:12px;line-height:18px;white-space:nowrap; }
.chat-header-text-action:hover { color:var(--im-uikit-text-link);background:var(--im-uikit-bg-dropdown-hover); }
.chat-header-text-action:focus-visible { outline:none;box-shadow:var(--im-uikit-focus-ring); }
.message-scroll { min-height:0;flex:1;padding:12px 0 0;background:transparent; }
.history-loading { flex:0 0 auto;margin:0;padding:5px 12px;text-align:center;color:var(--im-uikit-text-tertiary);background:transparent;font-size:12px;animation:im-next-fade-in .3s ease-out forwards; }
@keyframes im-next-fade-in { from { opacity:0; } to { opacity:1; } }
/* 单聊常驻回执：10px，未读=品牌蓝 */
.receipt-inline { color:var(--im-uikit-text-tertiary);font-size:10px;line-height:22px;white-space:nowrap; }
.receipt-inline--unread { color:var(--im-uikit-text-link); }
.message-time-divider,.message-unread-divider { display:flex;align-items:center;gap:12px;padding:10px 24px;color:var(--im-uikit-text-tertiary);font-size:12px;line-height:22px; }
.message-time-divider { justify-content:center; }
/* 需求7：当天分隔线是可点击 button，样式需与旁边的纯文本 <span> 完全一致——清除按钮默认边框/背景，字号行高继承父级 */
.message-time-divider__toggle { padding:0;border:0;color:inherit;background:transparent;font:inherit;cursor:pointer; }
.message-time-divider__toggle:hover,.message-time-divider__toggle:focus-visible { color:var(--im-uikit-text-link); }
.message-time-divider__toggle:focus-visible { outline:none;box-shadow:var(--im-uikit-focus-ring); }
.message-unread-divider::before,.message-unread-divider::after { content:"";height:1px;flex:1;background:rgb(var(--primary-color, 8 119 244) / 0.22); }
.message-unread-divider { color:var(--im-uikit-text-link); }
.message-standalone { box-sizing:border-box; }
.message-standalone--highlighted { box-shadow:0 0 0 4px var(--im-uikit-bg-warning-soft,#fff3bf); }
/* 需求6：群内事件通知(system/recall)与上面的 .message-time-divider 视觉完全对齐——
   居中、12px、三级灰文字、同样的内边距/行高，并清掉 <p> 默认外边距；长文本走 overflow-wrap 换行而非裁切。 */
.system-message { margin:0;padding:10px 24px;color:var(--im-uikit-text-tertiary);font-size:12px;line-height:22px;text-align:center;overflow-wrap:anywhere; }
/* 需求8：引用行——透明背景、无边框、12px 三级灰，单行超长省略号截断，own 消息右对齐（父容器 .message-layout__after 是 width:100%，对齐只能靠自身 text-align 切） */
.message-quote { display:block;width:100%;box-sizing:border-box;padding:0;border:0;overflow:hidden;color:var(--im-uikit-text-tertiary);background:transparent;font-size:12px;line-height:18px;text-align:left;text-overflow:ellipsis;white-space:nowrap;cursor:pointer; }
.message-quote:hover { text-decoration:underline; }
.message-quote--own { text-align:right; }
.message-reactions { display:flex;flex-wrap:wrap;gap:4px; }
.message-scroll :deep(.message-layout__bubble a) { color:var(--im-uikit-text-link);text-decoration:none; }
.message-scroll :deep(.message-layout__bubble a:hover) { text-decoration:underline; }
.setting-member-list { display:grid;gap:2px; }
.setting-member-list:focus-visible { outline:none;box-shadow:var(--im-uikit-focus-ring); }
.setting-member-grid { display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px 8px;padding:4px 0 8px; }
.setting-member-tile { display:grid;min-width:0;justify-items:center;gap:5px;color:var(--im-uikit-text-secondary); }
.setting-member-tile>small { width:100%;overflow:hidden;text-align:center;text-overflow:ellipsis;white-space:nowrap;font-size:11px;line-height:16px; }
.setting-member-tile--action { padding:0;background:transparent; }
.setting-member-tile--action>span { display:grid;width:32px;height:32px;place-items:center;border:1px dashed var(--im-uikit-text-tertiary);border-radius:50%;font-size:20px;line-height:1; }
.setting-member-tile--action:hover>span { color:var(--im-uikit-text-link);border-color:var(--im-uikit-text-link);background:var(--im-uikit-bg-dropdown-hover); }
.setting-member-more { width:100%;padding:5px;color:var(--im-uikit-text-link);background:transparent;font-size:12px; }
.setting-slide-enter-active,.setting-slide-leave-active { transition:transform .3s ease-in-out,opacity .3s ease-in-out; }
.setting-slide-enter-from,.setting-slide-leave-to { opacity:0;transform:translateX(24px); }
/* 聊天设置浮层（Figma 353×753：#f5f5f5 底 + #ebeef5 描边 + 圆角8 + 投影），覆盖在聊天区右侧 */
.chat-setting-overlay { position:absolute;top:69px;right:10px;bottom:40px;z-index:12; }
.setting-state { padding:10px 0;color:var(--im-uikit-text-tertiary);font-size:12px;line-height:18px; }
.setting-member-row { display:grid;grid-template-columns:32px minmax(0,1fr);align-items:center;gap:10px;min-height:52px;padding:6px 0; }
.setting-member-copy { display:grid;min-width:0;gap:1px; }
.setting-member-copy b,.setting-member-copy small { overflow:hidden;text-overflow:ellipsis;white-space:nowrap; }
.setting-member-copy b { color:var(--im-uikit-text-primary);font-size:14px;font-weight:400;line-height:20px; }
.setting-member-copy small { color:var(--im-uikit-text-tertiary);font-size:11px;line-height:16px; }
.setting-member-actions { display:flex;grid-column:2;flex-wrap:wrap;gap:4px;margin-top:-3px;padding-bottom:4px; }
.setting-compact-action { min-height:26px;padding:3px 7px;border-radius:var(--im-uikit-radius-sm);color:var(--im-uikit-text-link);background:var(--im-uikit-bg-list-hover);font-size:11px;line-height:16px; }
.setting-compact-action:hover { background:var(--im-uikit-bg-dropdown-hover); }
.setting-compact-action:disabled,.setting-action:disabled { color:var(--im-uikit-text-disabled);cursor:not-allowed; }
.setting-danger { color:var(--im-uikit-text-error)!important; }
.setting-managed-note,.setting-operation { margin:8px 0 0;color:var(--im-uikit-text-tertiary);font-size:12px;line-height:18px; }
.setting-group-edit { display:grid;gap:12px;margin-top:12px; }
.group-announcement { display:flex;flex:0 0 auto;align-items:flex-start;gap:8px;margin:0 16px 8px;border-radius:var(--im-uikit-radius-md);padding:9px 12px;color:var(--im-uikit-text-secondary);background:var(--im-uikit-bg-list-hover);font-size:12px;line-height:18px; }
.group-announcement strong { flex:0 0 auto;color:var(--im-uikit-text-primary); }
.group-announcement span { min-width:0;overflow-wrap:anywhere;white-space:pre-wrap; }
.setting-announcement-current { margin:0;overflow-wrap:anywhere;white-space:pre-wrap;color:var(--im-uikit-text-secondary);font-size:12px;line-height:18px; }
.setting-inline-actions { display:grid;grid-template-columns:1fr 1fr;gap:8px; }
.setting-inline-actions .setting-action { text-align:center; }
.sr-only { position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap; }
.setting-facts { display:grid;gap:8px;margin:0; }
.setting-facts div { display:grid;grid-template-columns:72px minmax(0,1fr);gap:8px; }
.setting-facts dt { color:var(--im-uikit-text-tertiary); }
.setting-facts dd { min-width:0;margin:0;overflow-wrap:anywhere;color:var(--im-uikit-text-primary); }
.setting-field,.setting-file { display:grid;gap:6px;color:var(--im-uikit-text-secondary);font-size:12px;line-height:18px; }
.setting-field input { width:100%;height:36px;border:1px solid transparent;border-radius:var(--im-uikit-radius-md);padding:0 10px;outline:0;color:var(--im-uikit-text-primary);background:var(--im-uikit-bg-input); }
.setting-field textarea { width:100%;box-sizing:border-box;resize:vertical;border:1px solid transparent;border-radius:var(--im-uikit-radius-md);padding:9px 10px;outline:0;color:var(--im-uikit-text-primary);background:var(--im-uikit-bg-input);font:inherit; }
.setting-field input:focus { border-color:var(--im-uikit-text-link);box-shadow:var(--im-uikit-focus-ring); }
.setting-field textarea:focus { border-color:var(--im-uikit-text-link);box-shadow:var(--im-uikit-focus-ring); }
.setting-file input { min-width:0;color:var(--im-uikit-text-tertiary);font-size:11px; }
.setting-action { display:block;width:100%;min-height:40px;margin-top:8px;border-radius:var(--im-uikit-radius-md);padding:9px 12px;text-align:left;color:var(--im-uikit-text-primary);background:var(--im-uikit-bg-list-hover);font-size:14px;line-height:20px; }
.setting-action:hover { background:var(--im-uikit-bg-dropdown-hover); }
.setting-action--primary { text-align:center;color:var(--im-uikit-text-on-primary);background:var(--im-uikit-text-link); }
.setting-action--primary:hover { background:var(--im-uikit-text-link-accessible,#006eff); }
.setting-action--danger { color:var(--im-uikit-text-error); }
.setting-action--danger:hover { background:var(--im-uikit-bg-danger-hover); }
@media (prefers-reduced-motion: reduce) {
  .tabs button,.setting-slide-enter-active,.setting-slide-leave-active { transition-duration:.001ms!important; }
  .spinner,.history-loading { animation-duration:.001ms!important;animation-iteration-count:1!important; }
}
.group-directory { display:grid;min-height:120px;max-height:230px;overflow:auto;border:1px solid var(--im-uikit-border-lighter,#e5e8ef);border-radius:7px;padding:5px; }
.group-directory__unit { display:grid;min-height:34px;grid-template-columns:24px minmax(0,1fr) auto;align-items:center;gap:4px; }
.group-directory__unit button { width:24px;height:24px;border-radius:5px;color:var(--im-uikit-text-secondary);background:transparent; }
.group-directory__unit button:hover { background:var(--im-uikit-bg-dropdown-hover); }
.group-directory__unit small,.group-directory__member small { color:var(--im-uikit-text-tertiary);font-size:11px; }
.group-directory__member { display:flex;min-height:32px;align-items:center;gap:7px;border-radius:5px; }
.group-directory__member:hover { background:var(--im-uikit-bg-list-hover); }
.group-directory__member span { display:grid;min-width:0; }
.group-directory__error { margin-top:2px;margin-bottom:4px;color:var(--im-uikit-text-error);font-size:11px; }
.group-directory__error button { margin-left:4px;color:var(--im-uikit-text-link);background:transparent; }
.preview-image-scroll { width:100%;height:100%;overflow:auto;background:var(--im-uikit-bg-muted,#f7f8fa); }
.preview-image-stage { display:flex;min-width:100%;min-height:100%;align-items:center;justify-content:center; }
.preview-image-stage img { display:block;max-width:none;max-height:none;flex:0 0 auto;object-fit:contain; }
.im-next { width:100%;min-width:0;height:100%;border:0;border-radius:0;box-shadow:none; }
</style>

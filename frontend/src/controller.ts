import type { AssetUploadTask, NahidaClientError, NahidaMentions, NahidaMessageContent, NahidaMessageKind } from '@kimposoft/plugin-sdk/nahida-im';
import { computed, reactive, ref, watch } from 'vue';
import { canManageDepartmentGroup, canSend, sortConversations, uniqueDirectoryUsers } from './domain/rules';
import { canDissolveOrdinaryGroup, canEditGroupInfo, canInviteGroup, canKickOrdinaryGroupMember, canLeaveOrdinaryGroup, canSetOrdinaryGroupAdmin, canTransferOrdinaryGroupOwnership } from './domain/group-permissions';
import { buildMergedMessagesCard, canForwardMessage } from './domain/forward';
import type { Attachment, ConnectionState, Conversation, ForwardTargetResult, GroupCandidateSearchState, GroupMember, GroupOperationState, GroupRoleOperationState, ImViewState, Message, OrgUnit, PreviewState, Reaction, UnifiedSearchState, UploadState, User } from './domain/types';
import { probeCapabilities, readHostCapability, report, type ImNextCapabilities, type ImNextHostBridge } from './host-bridge';
import { mapConversation, mapDepartment, mapGroupMember, mapMessage, mapNotification, mapOrgMember } from './transport-mapper';
import { hydrateStoredDrafts, writeStoredDraft, type ImDraftStorage } from './domain/draft-storage';

/** 撤回时间窗（产品定版 2026-08-10）：消息发出 2 分钟内可撤回，过窗后菜单不再提供撤回 */
export const REVOKE_WINDOW_MS = 2 * 60_000;

/**
 * 通讯录/群成员在线态定时兜底刷新间隔（产品定版 2026-08-11：presence.update 帧只扇给单聊对端
 * ——服务端只向单聊对端扇出，通讯录/群成员没有实时推送，只能定时轮询
 * 兜底）。30 秒是"够新鲜但不过度打后端"的折中：presence 查询走 100 一批、并发上限 3 的
 * queryPresence，30 秒一轮即便通讯录上千人也在可接受的调用量级内；更短的间隔对"在线状态延迟"
 * 的可感知改善有限，却会成倍放大后端查询量。
 */
const PRESENCE_POLL_INTERVAL_MS = 30_000;
/**
 * 定时轮询与 refresh()/resyncAll() 的去重窗口：明显小于轮询间隔本身，只用来吸收"两者恰好
 * 前后脚触发"的重复查询（例如标签页刚从隐藏恢复可见，正好撞上一次 refresh()/resyncAll() 已经
 * 做过的同类刷新），不影响真正到点、且确实需要新鲜数据的轮询。
 */
const PRESENCE_POLL_DEDUP_WINDOW_MS = 5_000;

export type ScreenState = 'loading' | 'ready' | 'empty' | 'error';
export function shouldSendFromKeydown(event: Pick<KeyboardEvent, 'key' | 'shiftKey' | 'isComposing'>): boolean {
  return event.key === 'Enter' && !event.shiftKey && !event.isComposing;
}

function defaultClientMsgId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `im-next-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function wsConversationId(data: unknown): string | undefined {
  if (typeof data !== 'object' || data === null) return undefined;
  const value = 'conversationId' in data ? data.conversationId : 'convId' in data ? data.convId : undefined;
  return typeof value === 'string' ? value : undefined;
}

async function runBounded<T>(items: readonly T[], limit: number, task: (item: T) => Promise<void>): Promise<void> {
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const item = items[cursor++];
      await task(item);
    }
  }));
}

function frameRecord(data: unknown): Record<string, unknown> | undefined {
  return typeof data === 'object' && data !== null && !Array.isArray(data) ? data as Record<string, unknown> : undefined;
}

function frameString(data: unknown, key: string): string | undefined {
  const value = frameRecord(data)?.[key];
  return typeof value === 'string' ? value : typeof value === 'number' && Number.isSafeInteger(value) ? String(value) : undefined;
}

function frameNumber(data: unknown, key: string): number | undefined {
  const value = frameRecord(data)?.[key];
  return typeof value === 'number' && Number.isSafeInteger(value) ? value : undefined;
}

export function isSafePreviewURL(url: string, baseOrigin = globalThis.location?.origin ?? 'http://localhost'): boolean {
  const value = url.trim();
  if (!value || value.startsWith('//')) return false;
  try {
    const parsed = new URL(value, baseOrigin);
    if (parsed.protocol === 'blob:') return true;
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
    const isRelative = !/^[a-z][a-z\d+.-]*:/i.test(value);
    return !isRelative || parsed.origin === new URL(baseOrigin).origin;
  } catch {
    return false;
  }
}

export function isFreshAssetDescriptor(expiresAt?: string, now = Date.now()): boolean {
  if (!expiresAt) return true;
  const expires = Date.parse(expiresAt);
  return Number.isFinite(expires) && expires > now;
}

export interface ImControllerOptions {
  clientMsgId?: () => string;
  draftStorage?: ImDraftStorage;
}

interface DeliveredCursorState {
  observed: number;
  acknowledged: number;
  inFlight: boolean;
  retryAttempt: number;
  retryTimer?: ReturnType<typeof setTimeout>;
}

function browserDraftStorage(): ImDraftStorage | undefined {
  try { return typeof globalThis.localStorage === 'undefined' ? undefined : globalThis.localStorage; }
  catch { return undefined; }
}

export function useImController(host: ImNextHostBridge | undefined, options?: ImControllerOptions) {
  const screen = ref<ScreenState>('loading');
  const snapshot = ref<ImViewState>({ conversations: [], messages: [], directory: [] });
  const activeId = ref<string>();
  const activeTab = ref<'chats' | 'contacts'>('chats');
  const query = ref('');
  const drawerOpen = ref(false);
  const replyTo = ref<Message>();
  const draft = ref('');
  const newMessageCount = ref(0);
  const isAtBottom = ref(true);
  const messageViewReady = ref(false);
  const loadError = ref('');
  const historyLoading = ref(false);
  const upload = ref<UploadState>();
  const preview = ref<PreviewState>({ status: 'closed' });
  // 群成员结构性状态（角色/来源/静音等）；presence 不再存在这里，读时由下方 groupMembers
  // 投影 computed 从 presenceById 查表叠加，避免 loadGroupMembers 整体替换数组时把 presence 冲掉。
  const groupMembersState = ref<GroupMember[]>([]);
  const groupMembersLoading = ref(false);
  const groupMembersError = ref('');
  const groupOperation = ref<GroupOperationState>({ status: 'idle' });
  const groupRoleOperation = ref<GroupRoleOperationState>({ status: 'idle' });
  const announcementText = ref('');
  const announcementDraft = ref('');
  const announcementLoading = ref(false);
  const groupGovernancePending = ref(false);
  const groupGovernanceError = ref('');
  const highlightedSeq = ref<number>();
  const contactSearchResults = ref<User[]>([]);
  const unifiedSearch = ref<UnifiedSearchState>({ query: '', status: 'idle', users: [], groups: [], conversations: [], messages: [] });
  const groupCandidateQuery = ref('');
  const groupCandidateSearch = ref<GroupCandidateSearchState>({ query: '', status: 'idle', users: [] });
  const groupCandidateSelectedIds = ref(new Set<string>());
  const groupCandidateSelectedUsers = ref(new Map<string, User>());
  const selectionMode = ref(false);
  const selectedMessageIds = ref(new Set<string>());
  const forwardOpen = ref(false);
  const forwardSources = ref<Message[]>([]);
  const forwardTargetIds = ref(new Set<string>());
  const forwardResults = ref<ForwardTargetResult[]>([]);
  const mentionUserIds = ref(new Set<string>());
  const mentionAll = ref(false);
  const mentionTokens = new Map<string, string>();
  const drafts = reactive(new Map<string, string>());
  const draftStorage = options?.draftStorage ?? browserDraftStorage();
  const sendingDrafts = new Set<string>();
  let draftOwnerId: string | undefined;
  let draftsHydrated = false;
  let caps: ImNextCapabilities | undefined;
  let contactSearchRequest = 0;
  let notificationOffset = 0;
  let notificationTotal = 0;
  let unifiedSearchRequest = 0;
  let unifiedSearchTimer: ReturnType<typeof setTimeout> | undefined;
  let groupCandidateSearchRequest = 0;
  let groupCandidateSearchTimer: ReturnType<typeof setTimeout> | undefined;
  let forwardOperationId = '';
  const forwardClientIds = new Map<string, string>();
  let resyncPromise: Promise<void> | undefined;
  let disposed = false;
  let lifecycleGeneration = 0;
  let refreshRequest = 0;
  let selectionRequest = 0;
  let realtimeCleanup: (() => void) | undefined;
  // presence 定时轮询兜底（B 半）的定时器句柄与"最近一次已同步"时间戳；后者供轮询与
  // refresh()/resyncAll() 互相去重（见 pollVisiblePresence 与 markPresenceSynced 注释）。
  let presencePollTimer: ReturnType<typeof setInterval> | undefined;
  let lastPresenceSyncAt = 0;
  const activeUploadTasks = new Set<AssetUploadTask>();
  const deliveredCursors = new Map<string, DeliveredCursorState>();
  // presence 唯一权威存储：userId → 在线态。此前 conversation.connection / member.presence /
  // groupMember.presence 各自独立持有一份在线态副本，且都写在"会被整体替换的实体对象"上——
  // mapConversation/mapOrgMember/mapGroupMember 均不映射 presence 字段，一旦 replaceConversation
  // 等整体替换点用 mapper 产物整体替换旧实体，写在旧实体上的在线态必然被抹除（最严重的一处是
  // syncConversation 在每一帧 im.message 上都会触发）。收敛成这一张表后，读取方一律在下方
  // conversations/activeConversation/directory/groupMembers 四个投影 computed 里查表取值，
  // 实体被整体替换不再影响在线态的可见性；domain/types.ts 上的 connection/presence 字段仍保留
  // （兼容既有类型/读取方引用），但已不是权威来源。
  const presenceById = ref(new Map<string, ConnectionState>());

  const isLifecycleCurrent = (generation: number): boolean => !disposed && generation === lifecycleGeneration;
  const isSelectionCurrent = (generation: number, request: number, conversationId: string): boolean =>
    isLifecycleCurrent(generation) && request === selectionRequest && activeId.value === conversationId;

  async function awaitTrackedUpload(task: AssetUploadTask): Promise<Awaited<typeof task.result>> {
    activeUploadTasks.add(task);
    try { return await task.result; }
    finally { activeUploadTasks.delete(task); }
  }

  /**
   * 在线态投影（会话）：只在有 peerUserId（单聊）的会话上叠加 connection 字段，从 presenceById
   * 查表取值；群聊/部门群/系统通知没有 peerUserId，原样透传原对象引用（不拷贝，省一次分配）。
   * patchConversation 等需要乐观更新/回滚的写路径已改为按 id 回源到 snapshot.value.conversations
   * 查真实对象，不依赖这里返回的引用是否被克隆。
   */
  function projectConversationPresence(conversation: Conversation): Conversation {
    return conversation.peerUserId
      ? { ...conversation, connection: presenceById.value.get(conversation.peerUserId) }
      : conversation;
  }
  const activeConversation = computed(() => {
    const found = snapshot.value.conversations.find(item => item.id === activeId.value);
    return found ? projectConversationPresence(found) : undefined;
  });
  const messages = computed(() => snapshot.value.messages
    .filter(item => item.conversationId === activeId.value)
    .sort((a, b) => a.seq - b.seq));
  const conversations = computed(() => sortConversations(snapshot.value.conversations)
    .filter(item => !item.hidden)
    .filter(item => !query.value || `${item.title} ${item.summary}`.toLowerCase().includes(query.value.toLowerCase()))
    .map(projectConversationPresence));
  const conversationDrafts = computed<ReadonlyMap<string, string>>(() => new Map(drafts));
  const loadedContacts = computed(() => uniqueDirectoryUsers(snapshot.value.directory));
  const contacts = computed(() => {
    if (query.value.trim()) return contactSearchResults.value;
    return loadedContacts.value;
  });
  /**
   * 通讯录（组织树）在线态投影：递归克隆 unit/member，把 member.presence 从 presenceById 查表
   * 叠加上去。结构字段（loading/membersLoaded/childrenLoaded/children 等）也会被浅拷贝到新对象
   * 上——这意味着模板从这里拿到的 unit 引用与 snapshot.value.directory 里的原始可变对象不是
   * 同一个对象。expandDepartment 需要原地改写这些结构字段，因此已经改为按 id 回源查找真实对象
   * （见 findDirectoryUnit），不再依赖这里传出去的引用。
   * 性能：只在 snapshot.value.directory 结构变化或 presenceById 更新时重算（用户交互/重连触发，
   * 不是逐帧/逐次渲染触发）；组织树规模到千人级也只是一次性的浅拷贝，不在热路径上。
   */
  function projectOrgUnit(unit: OrgUnit): OrgUnit {
    return {
      ...unit,
      members: unit.members.map(member => ({ ...member, presence: presenceById.value.get(member.id) })),
      children: unit.children.map(projectOrgUnit)
    };
  }
  const directory = computed(() => snapshot.value.directory.map(projectOrgUnit));
  /**
   * 群成员在线态投影：presence 从 presenceById 查表叠加，替代直接写在 groupMembersState 元素上
   * ——loadGroupMembers 每次都会整体替换 groupMembersState.value，写在旧成员对象上的 presence
   * 会跟着旧对象一起被丢弃，是同一类"整体替换冲掉字段"缺陷。
   */
  const groupMembers = computed<GroupMember[]>(() => groupMembersState.value.map(member => ({
    ...member,
    presence: presenceById.value.get(member.userId)
  })));
  const canWrite = computed(() => canSend(activeConversation.value));
  const isDepartment = computed(() => Boolean(activeConversation.value && !canManageDepartmentGroup(activeConversation.value)));
  const canManageGroup = computed(() => activeConversation.value?.kind === 'group'
    && ['admin', 'owner'].includes(activeConversation.value.currentMemberRole ?? ''));
  const canInvite = computed(() => canInviteGroup(activeConversation.value));
  const canEditGroup = computed(() => canEditGroupInfo(activeConversation.value));
  const canLeaveGroup = computed(() => canLeaveOrdinaryGroup(activeConversation.value));
  const canDissolveGroup = computed(() => canDissolveOrdinaryGroup(activeConversation.value));
  const selectedMessages = computed(() => snapshot.value.messages
    .filter(item => item.conversationId === activeId.value && selectedMessageIds.value.has(item.id) && canForwardMessage(item))
    .sort((a, b) => a.seq - b.seq));
  const mentionCandidates = computed(() => ['group', 'department'].includes(activeConversation.value?.kind ?? '') ? groupMembers.value : []);
  const canMentionAll = computed(() => {
    const selfId = snapshot.value.self?.id;
    const role = activeConversation.value?.currentMemberRole ?? groupMembers.value.find(item => item.userId === selfId)?.role;
    return role === 'owner' || role === 'admin';
  });
  const canGovernGroup = computed(() => ['admin', 'owner'].includes(activeConversation.value?.currentMemberRole ?? ''));
  const canMuteMember = computed(() => activeConversation.value?.currentMemberRole === 'owner');

  function syncDraft(conversationId: string, value: string): void {
    if (value.trim()) drafts.set(conversationId, value);
    else drafts.delete(conversationId);
    if (draftsHydrated && draftOwnerId) writeStoredDraft(draftStorage, draftOwnerId, conversationId, value);
  }

  function hydrateDrafts(userId: string, conversationIds: readonly string[]): void {
    if (draftOwnerId !== userId) {
      drafts.clear();
      draftOwnerId = userId;
    }
    const stored = hydrateStoredDrafts(draftStorage, userId, conversationIds);
    for (const [conversationId, value] of stored) if (!drafts.has(conversationId)) drafts.set(conversationId, value);
    draftsHydrated = true;
  }

  watch(draft, value => {
    if (activeId.value) syncDraft(activeId.value, value);
  }, { flush: 'sync' });

  function mergeMessages(incoming: readonly Message[]): void {
    const byIdentity = new Map(snapshot.value.messages.map(item => [item.id, item]));
    for (const item of incoming) {
      const optimistic = snapshot.value.messages.find(old => old.clientMsgId === item.clientMsgId);
      if (optimistic) byIdentity.delete(optimistic.id);
      byIdentity.set(item.id, item);
    }
    snapshot.value.messages = [...byIdentity.values()];
    for (const item of snapshot.value.messages) {
      if (!item.replyTo) continue;
      const target = snapshot.value.messages.find(candidate => candidate.conversationId === item.conversationId && candidate.seq === item.replyTo!.seq);
      if (target) item.replyTo = { id: target.id, seq: target.seq, sender: target.sender, text: target.text };
    }
    observeDeliveredMessages(incoming);
  }

  function deliveredCursor(conversationId: string): DeliveredCursorState {
    const existing = deliveredCursors.get(conversationId);
    if (existing) return existing;
    const created: DeliveredCursorState = { observed: 0, acknowledged: 0, inFlight: false, retryAttempt: 0 };
    deliveredCursors.set(conversationId, created);
    return created;
  }

  function seedDeliveredCursor(conversationId: string, kind: Conversation['kind'], deliveredSeq: number): void {
    if (kind === 'system') return;
    const state = deliveredCursor(conversationId);
    const authoritative = Number.isSafeInteger(deliveredSeq) && deliveredSeq >= 0 ? deliveredSeq : 0;
    state.acknowledged = Math.max(state.acknowledged, authoritative);
    state.observed = Math.max(state.observed, state.acknowledged);
  }

  function isRealtimeOpen(): boolean {
    try { return caps?.ws.getState() === 'open'; }
    catch { return false; }
  }

  function scheduleDeliveredRetry(conversationId: string, state: DeliveredCursorState): void {
    if (disposed || state.retryTimer || state.retryAttempt >= 4 || !isRealtimeOpen() || state.observed <= state.acknowledged) return;
    const delay = Math.min(2000, 250 * 2 ** Math.min(state.retryAttempt, 3));
    state.retryAttempt += 1;
    state.retryTimer = setTimeout(() => {
      state.retryTimer = undefined;
      void flushDeliveredCursor(conversationId);
    }, delay);
  }

  /**
   * delivered 表示“这个客户端已经拿到权威消息”，与当前会话是否可见、是否已读无关。
   * 每个会话只允许一个在途 ACK；新消息到达时只提高 observed，成功后再补送更高值。
   */
  async function flushDeliveredCursor(conversationId: string): Promise<void> {
    const state = deliveredCursors.get(conversationId);
    if (!caps || !state || disposed || state.inFlight || !isRealtimeOpen() || state.observed <= state.acknowledged) return;
    const target = state.observed;
    state.inFlight = true;
    let succeeded = false;
    try {
      await caps.im.messages.ackDelivered(conversationId, target);
      if (disposed) return;
      state.acknowledged = Math.max(state.acknowledged, target);
      state.retryAttempt = 0;
      if (state.retryTimer) clearTimeout(state.retryTimer);
      state.retryTimer = undefined;
      succeeded = true;
    } catch (error) {
      if (!disposed) {
        report(host, 'warn', 'im_next.delivered_ack_failed', {
          conversationId,
          seq: target,
          message: error instanceof Error ? error.message : 'unknown'
        });
      }
    } finally {
      state.inFlight = false;
      if (!disposed && state.observed > state.acknowledged) {
        if (succeeded) void flushDeliveredCursor(conversationId);
        else scheduleDeliveredRetry(conversationId, state);
      }
    }
  }

  function observeDeliveredMessages(incoming: readonly Message[]): void {
    if (!caps || disposed) return;
    const highestByConversation = new Map<string, number>();
    for (const message of incoming) {
      if (message.sendState === 'sending' || message.seq <= 0) continue;
      const conversation = snapshot.value.conversations.find(item => item.id === message.conversationId);
      if (conversation?.kind === 'system') continue;
      highestByConversation.set(message.conversationId, Math.max(highestByConversation.get(message.conversationId) ?? 0, message.seq));
    }
    for (const [conversationId, seq] of highestByConversation) {
      const state = deliveredCursor(conversationId);
      if (seq <= state.observed) continue;
      state.observed = seq;
      void flushDeliveredCursor(conversationId);
    }
  }

  async function flushPendingDeliveredCursors(): Promise<void> {
    if (!isRealtimeOpen()) return;
    await Promise.all([...deliveredCursors.keys()].map(conversationId => flushDeliveredCursor(conversationId)));
  }

  function replaceConversation(conversation: Conversation): void {
    const index = snapshot.value.conversations.findIndex(item => item.id === conversation.id);
    if (index < 0) snapshot.value.conversations.push(conversation);
    else {
      const previous = snapshot.value.conversations[index];
      const readSeq = Math.max(previous.readSeq, conversation.readSeq);
      const lastSeq = Math.max(previous.lastSeq, conversation.lastSeq);
      snapshot.value.conversations[index] = {
        ...conversation,
        readSeq,
        lastSeq,
        unread: readSeq >= lastSeq ? 0 : conversation.unread
      };
    }
  }

  async function patchConversation(conversation: Conversation, patch: Pick<Conversation, 'pinned'> | Pick<Conversation, 'muted'>): Promise<void> {
    if (!caps || (conversation.kind === 'system' && 'muted' in patch)) return;
    // conversation 参数可能来自 conversations/activeConversation 投影 computed（presence 叠加
    // 产生的克隆，见上方 projectConversationPresence），乐观更新与失败回滚都必须落在
    // snapshot.value.conversations 里的真实对象上——只改传入的克隆不会被任何人读到。
    const target = snapshot.value.conversations.find(item => item.id === conversation.id);
    if (!target) return;
    const previous = { pinned: target.pinned, muted: target.muted };
    Object.assign(target, patch);
    try {
      replaceConversation(mapConversation(await caps.im.conversations.patch(conversation.id, patch)));
    } catch (error) {
      Object.assign(target, previous);
      report(host, 'warn', 'im_next.conversation_patch_failed', { conversationId: conversation.id });
      throw error;
    }
  }

  async function togglePinned(conversation: Conversation): Promise<void> {
    await patchConversation(conversation, { pinned: !conversation.pinned });
  }

  async function toggleMuted(conversation: Conversation): Promise<void> {
    if (conversation.kind === 'system') return;
    await patchConversation(conversation, { muted: !conversation.muted });
  }

  async function hideConversation(conversation: Conversation): Promise<void> {
    if (!caps || conversation.kind === 'system') return;
    const previousConversations = [...snapshot.value.conversations];
    const previousActiveId = activeId.value;
    snapshot.value.conversations = snapshot.value.conversations.filter(item => item.id !== conversation.id);
    const nextId = previousActiveId === conversation.id ? sortConversations(snapshot.value.conversations)[0]?.id : undefined;
    if (previousActiveId === conversation.id) activeId.value = undefined;
    try {
      await caps.im.conversations.hide(conversation.id);
      if (nextId) await selectConversation(nextId);
    } catch (error) {
      snapshot.value.conversations = previousConversations;
      activeId.value = previousActiveId;
      report(host, 'warn', 'im_next.conversation_hide_failed', { conversationId: conversation.id });
      throw error;
    }
  }

  async function loadGroupMembers(commitGuard: () => boolean = () => !disposed): Promise<void> {
    if (disposed) return;
    const conversation = activeConversation.value;
    groupMembersState.value = [];
    groupMembersError.value = '';
    if (!caps || !conversation || !['group', 'department'].includes(conversation.kind)) return;
    groupMembersLoading.value = true;
    try {
      const loaded: GroupMember[] = [];
      const seenCursors = new Set<string>();
      let cursor: string | undefined;
      do {
        const page = await caps.im.groups.listMembers(conversation.id, { cursor, limit: 100 });
        loaded.push(...page.items.map(mapGroupMember));
        const next = page.nextCursor ?? undefined;
        if (!next) break;
        if (seenCursors.has(next)) throw new Error('group_member_cursor_cycle');
        seenCursors.add(next);
        cursor = next;
      } while (true);
      if (!commitGuard()) return;
      groupMembersState.value = [...new Map(loaded.map(member => [member.userId, member])).values()];
      await updateMemberPresence(commitGuard);
    } catch (error) {
      if (!commitGuard()) return;
      groupMembersError.value = error instanceof Error ? error.message : 'group_members_failed';
      report(host, 'warn', 'im_next.group_members_failed', { conversationId: conversation.id });
    } finally {
      if (commitGuard()) groupMembersLoading.value = false;
    }
  }

  async function loadAnnouncement(commitGuard: () => boolean = () => !disposed): Promise<void> {
    const conversation = activeConversation.value;
    if (!caps || !conversation || !['group', 'department'].includes(conversation.kind)) {
      announcementText.value = '';
      announcementDraft.value = '';
      return;
    }
    announcementLoading.value = true;
    try {
      const message = await caps.im.groups.getAnnouncement(conversation.id);
      if (!commitGuard()) return;
      const text = typeof message?.content.systemParams?.text === 'string' ? message.content.systemParams.text : '';
      announcementText.value = text;
      announcementDraft.value = text;
    } finally {
      if (commitGuard()) announcementLoading.value = false;
    }
  }

  async function queryPresence(userIds: readonly string[]): Promise<Record<string, 'online' | 'busy' | 'offline'>> {
    if (!caps || disposed) return {};
    const ids = [...new Set(userIds.filter(Boolean))];
    const chunks = Array.from({ length: Math.ceil(ids.length / 100) }, (_, index) => ids.slice(index * 100, (index + 1) * 100));
    const result: Record<string, 'online' | 'busy' | 'offline'> = {};
    await runBounded(chunks, 3, async chunk => {
      try { Object.assign(result, await caps!.im.presence.queryUsers(chunk)); }
      catch (error) { if (!disposed) report(host, 'warn', 'im_next.presence_failed', { message: error instanceof Error ? error.message : 'unknown', batchSize: chunk.length }); }
    });
    return result;
  }

  /**
   * presence 唯一权威存储的统一写入口：查询给定 userId 批次，写入 presenceById（不再写任何实体
   * 字段）。三个调用点各自收集自己关心的一批 userId（会话对端 / 群成员 / 通讯录成员），语义不变，
   * 只是落库目标从"各自的实体字段"收敛成这一张表。
   * fallback 用于保留通讯录此前的既有语义：查询响应里缺席的 userId 一律回落为 'offline'（代表
   * "已经查过、确实不在线"，区别于"压根没查过"，对应 chat-header-model 等读取方在 undefined 时
   * 会退化展示 summary 而非离线文案的差异）；会话对端 / 群成员不传 fallback，缺席时保持原样不写，
   * 不用一次不完整/失败的批次覆盖已知的真实状态——三者共享同一张表后，这一差异只影响"要不要
   * 主动补一个 'offline'"，不会互相污染彼此的数据。
   */
  async function refreshPresence(userIds: readonly string[], commitGuard: () => boolean = () => !disposed, fallback?: ConnectionState): Promise<void> {
    const ids = [...new Set(userIds.filter(Boolean))];
    if (!ids.length) return;
    const presence = await queryPresence(ids);
    if (!commitGuard()) return;
    for (const id of ids) {
      const state = presence[id] ?? fallback;
      if (state) presenceById.value.set(id, state);
    }
  }

  async function updateConversationPresence(commitGuard: () => boolean = () => !disposed): Promise<void> {
    const peers = snapshot.value.conversations.flatMap(item => item.peerUserId ? [item.peerUserId] : []);
    await refreshPresence(peers, commitGuard);
  }

  async function updateMemberPresence(commitGuard: () => boolean = () => !disposed): Promise<void> {
    await refreshPresence(groupMembersState.value.map(item => item.userId), commitGuard);
  }

  /**
   * 通讯录（组织树）成员在线态刷新：递归收集传入 OrgUnit 树（含已加载的子部门）上的全部成员，
   * 批量查询后写入 presenceById。组织树此前从未查询过在线态，是"通讯录所有人恒显示离线"的根因，
   * updateConversationPresence/updateMemberPresence 分别只覆盖会话列表对端与群成员列表，覆盖不到这里。
   * 缺席的 userId 一律回落为 'offline'——语义与用法见 refreshPresence 的 fallback 说明。
   */
  async function updateDirectoryPresence(units: readonly OrgUnit[], commitGuard: () => boolean = () => !disposed): Promise<void> {
    const members: User[] = [];
    const collect = (list: readonly OrgUnit[]): void => { for (const unit of list) { members.push(...unit.members); if (unit.children.length) collect(unit.children); } };
    collect(units);
    if (!members.length) return;
    await refreshPresence(members.map(item => item.id), commitGuard, 'offline');
  }

  /** 记录"刚刚做过一轮 presence 同步"，供 pollVisiblePresence 判定是否要跳过本轮定时刷新。 */
  function markPresenceSynced(): void { lastPresenceSyncAt = Date.now(); }

  /**
   * 浏览器标签页是否可见。插件对宿主 IM 悬浮窗自身的显隐（宿主用 v-show 收起/展开，组件不会
   * 卸载）没有感知信号——已向宿主确认过，宿主没有把这个状态透传给插件，且本任务明令不得为此
   * 改宿主代码（宿主侧有并行任务在改）。因此这里只能做浏览器标签页级别的门控，是已知的能力
   * 边界而非遗漏：面板收起但标签页仍可见时，轮询不会停。
   * document 在本插件的单测环境（vite test environment: 'node'）里不存在，用可选链兜底为
   * "可见"，与 isSafePreviewURL 里 globalThis.location 的兜底风格一致。
   */
  function isTabVisible(): boolean {
    return globalThis.document?.visibilityState !== 'hidden';
  }

  /**
   * presence 定时轮询兜底的实际执行体：覆盖会话列表单聊对端 + 当前已展开的组织树成员 + 当前
   * 会话的群成员（三者分别复用既有的 updateConversationPresence/updateDirectoryPresence/
   * updateMemberPresence，语义与 refresh()/resyncAll() 里调用的是同一套，不另起一份逻辑）。
   * 去重判据：距上一次任意来源的 presence 同步（本函数自身、refresh()、resyncAll()）不足
   * PRESENCE_POLL_DEDUP_WINDOW_MS 时跳过——避免"标签页恢复可见"与"重连补拉"这类事件前后脚
   * 撞在一起时重复发起同一批查询。
   */
  async function pollVisiblePresence(): Promise<void> {
    if (disposed) return;
    if (Date.now() - lastPresenceSyncAt < PRESENCE_POLL_DEDUP_WINDOW_MS) return;
    markPresenceSynced();
    await Promise.all([updateConversationPresence(), updateDirectoryPresence(snapshot.value.directory), updateMemberPresence()]);
  }

  /**
   * 启动 presence 定时轮询兜底：setInterval 常驻整个 realtime 生命周期（不因标签页隐藏而反复
   * clear/重建——隐藏期间 tick 只是判空退出，开销可忽略；这样恢复可见时最坏也只差一个 tick
   * 粒度，且下面的 visibilitychange 监听会在恢复的一瞬间立即补一次，实际感知不到差异）。
   * visibilitychange 监听是"立即补一次"的关键：没有它，标签页从隐藏切回可见后要等到下一个
   * 30 秒整点才会刷新，用户会看到几十秒的旧态。
   */
  function startPresencePolling(): () => void {
    const tick = (): void => { if (isTabVisible()) void pollVisiblePresence(); };
    presencePollTimer = setInterval(tick, PRESENCE_POLL_INTERVAL_MS);
    const onVisibilityChange = (): void => { if (isTabVisible()) void pollVisiblePresence(); };
    const doc = globalThis.document;
    doc?.addEventListener?.('visibilitychange', onVisibilityChange);
    return () => {
      if (presencePollTimer) { clearInterval(presencePollTimer); presencePollTimer = undefined; }
      doc?.removeEventListener?.('visibilitychange', onVisibilityChange);
    };
  }

  async function loadDirectory(capabilities: ImNextCapabilities): Promise<ImViewState['directory']> {
    const departments = await capabilities.org.listDepartments();
    return Promise.all(departments.map(async dept => {
      const members = await capabilities.org.listMembers(dept.id, { includeChildren: false });
      const unit = mapDepartment(dept, members);
      unit.membersLoaded = true;
      return unit;
    }));
  }

  /**
   * 按 id 在 snapshot.value.directory 里回源查找真实可变的 OrgUnit 对象。directory 投影 computed
   * （见上方 projectOrgUnit）会为渲染层生成克隆树，模板事件（toggle/activate-unit）回传的 unit
   * 参数可能就是这份克隆——expandDepartment 需要原地改写 loading/members/children 等结构字段，
   * 不能信任传入引用，必须先按 id 回源，否则改写只发生在渲染期的临时克隆上，视图一旦重新投影
   * （比如下一次 presenceById 更新）就会丢失。
   */
  function findDirectoryUnit(id: string, units: readonly OrgUnit[] = snapshot.value.directory): OrgUnit | undefined {
    for (const item of units) {
      if (item.id === id) return item;
      const found = findDirectoryUnit(id, item.children);
      if (found) return found;
    }
    return undefined;
  }

  async function expandDepartment(unit: OrgUnit): Promise<boolean> {
    if (!caps || disposed) return false;
    const target = findDirectoryUnit(unit.id) ?? unit;
    if (target.loading) return false;
    const generation = lifecycleGeneration;
    target.loading = true;
    try {
      const [members, children] = await Promise.all([
        target.membersLoaded ? Promise.resolve(undefined) : caps.org.listMembers(target.id, { includeChildren: false }),
        target.childrenLoaded ? Promise.resolve(undefined) : caps.org.listDepartments(target.id)
      ]);
      if (!isLifecycleCurrent(generation)) return false;
      if (members) target.members = members.map(mapOrgMember);
      if (children) target.children = children.map(child => mapDepartment(child, []));
      target.membersLoaded = true;
      target.childrenLoaded = true;
      // 该部门刚展开出新成员，单独为其发起一次在线态查询；fire-and-forget，不阻塞展开操作本身。
      void updateDirectoryPresence([target], () => isLifecycleCurrent(generation));
      return true;
    } catch (error) {
      if (isLifecycleCurrent(generation)) report(host, 'warn', 'im_next.department_expand_failed', { departmentId: target.id, message: error instanceof Error ? error.message : 'unknown' });
      return false;
    } finally {
      if (isLifecycleCurrent(generation)) target.loading = false;
    }
  }

  async function searchContacts(keyword: string): Promise<void> {
    if (!caps || disposed) return;
    const generation = lifecycleGeneration;
    const request = ++contactSearchRequest;
    const normalized = keyword.trim();
    if (!normalized) {
      contactSearchResults.value = [];
      return;
    }
    const members = await caps.org.searchUsers(normalized, 100);
    if (!isLifecycleCurrent(generation) || request !== contactSearchRequest) return;
    contactSearchResults.value = uniqueDirectoryUsers([{
      id: '__search__', name: '', members: members.map(mapOrgMember), childCount: 0,
      children: [], membersLoaded: true, childrenLoaded: true
    }]);
  }

  function resetGroupCandidateSearch(): void {
    if (groupCandidateSearchTimer) clearTimeout(groupCandidateSearchTimer);
    groupCandidateSearchTimer = undefined;
    groupCandidateSearchRequest += 1;
    groupCandidateQuery.value = '';
    groupCandidateSearch.value = { query: '', status: 'idle', users: [] };
  }

  function resetGroupCandidateSelection(): void {
    groupCandidateSelectedIds.value = new Set();
    groupCandidateSelectedUsers.value = new Map();
  }

  function toggleGroupCandidate(user: User): void {
    if (disposed) return;
    const ids = new Set(groupCandidateSelectedIds.value);
    const users = new Map(groupCandidateSelectedUsers.value);
    if (ids.has(user.id)) { ids.delete(user.id); users.delete(user.id); }
    else { ids.add(user.id); users.set(user.id, user); }
    groupCandidateSelectedIds.value = ids;
    groupCandidateSelectedUsers.value = users;
  }

  async function runGroupCandidateSearch(keyword: string, scheduledRequest?: number): Promise<void> {
    if (!caps || disposed) return;
    const normalized = keyword.trim();
    const generation = lifecycleGeneration;
    const request = scheduledRequest ?? ++groupCandidateSearchRequest;
    if (request !== groupCandidateSearchRequest) return;
    groupCandidateQuery.value = keyword;
    if (!normalized) {
      groupCandidateSearch.value = { query: '', status: 'idle', users: [] };
      return;
    }
    groupCandidateSearch.value = { query: normalized, status: 'loading', users: [] };
    try {
      const members = await caps.org.searchUsers(normalized, 100);
      if (!isLifecycleCurrent(generation) || request !== groupCandidateSearchRequest) return;
      const users = uniqueDirectoryUsers([{
        id: '__group_candidate_search__', name: '', members: members.map(mapOrgMember), childCount: 0,
        children: [], membersLoaded: true, childrenLoaded: true
      }]);
      groupCandidateSearch.value = { query: normalized, status: users.length ? 'ready' : 'empty', users };
    } catch (error) {
      if (!isLifecycleCurrent(generation) || request !== groupCandidateSearchRequest) return;
      groupCandidateSearch.value = { query: normalized, status: 'error', error: error instanceof Error ? error.message : 'group_candidate_search_failed', users: [] };
    }
  }

  function scheduleGroupCandidateSearch(keyword: string): void {
    if (disposed) return;
    if (groupCandidateSearchTimer) clearTimeout(groupCandidateSearchTimer);
    groupCandidateSearchTimer = undefined;
    groupCandidateQuery.value = keyword;
    const normalized = keyword.trim();
    const request = ++groupCandidateSearchRequest;
    if (!normalized) {
      groupCandidateSearch.value = { query: '', status: 'idle', users: [] };
      return;
    }
    groupCandidateSearch.value = { query: normalized, status: 'loading', users: [] };
    groupCandidateSearchTimer = setTimeout(() => {
      groupCandidateSearchTimer = undefined;
      void runGroupCandidateSearch(keyword, request);
    }, 300);
  }

  async function runUnifiedSearch(keyword: string): Promise<void> {
    if (!caps || disposed) return;
    const generation = lifecycleGeneration;
    const normalized = keyword.trim();
    const request = ++unifiedSearchRequest;
    if (!normalized) {
      unifiedSearch.value = { query: '', status: 'idle', users: [], groups: [], conversations: [], messages: [] };
      return;
    }
    unifiedSearch.value = { query: normalized, status: 'loading', users: [], groups: [], conversations: [], messages: [] };
    try {
      const [users, groups, conversationsPage, messagesPage] = await Promise.all([
        caps.im.search.searchUsers(normalized, { limit: 30 }),
        caps.im.search.searchGroups(normalized, { limit: 30 }),
        caps.im.search.searchConversations(normalized, { limit: 30 }),
        caps.im.search.searchMessages(normalized, { limit: 50 })
      ]);
      if (!isLifecycleCurrent(generation) || request !== unifiedSearchRequest) return;
      const result: UnifiedSearchState = {
        query: normalized,
        status: 'ready',
        users: users.items.map(user => ({ id: user.userId, name: user.displayName, avatar: user.avatarAssetId, departments: [] })),
        groups: groups.items.map(mapConversation).filter(item => !item.hidden),
        conversations: conversationsPage.items.map(mapConversation).filter(item => !item.hidden),
        messages: messagesPage.items.map(item => mapMessage(item, snapshot.value.self))
      };
      if (![result.users, result.groups, result.conversations, result.messages].some(items => items.length)) result.status = 'empty';
      unifiedSearch.value = result;
    } catch (error) {
      if (!isLifecycleCurrent(generation) || request !== unifiedSearchRequest) return;
      unifiedSearch.value = {
        query: normalized, status: 'error', error: error instanceof Error ? error.message : 'search_failed',
        users: [], groups: [], conversations: [], messages: []
      };
    }
  }

  function scheduleUnifiedSearch(keyword: string): void {
    if (disposed) return;
    if (unifiedSearchTimer) clearTimeout(unifiedSearchTimer);
    const normalized = keyword.trim();
    if (!normalized) {
      ++unifiedSearchRequest;
      unifiedSearch.value = { query: '', status: 'idle', users: [], groups: [], conversations: [], messages: [] };
      return;
    }
    unifiedSearch.value = { query: normalized, status: 'loading', users: [], groups: [], conversations: [], messages: [] };
    unifiedSearchTimer = setTimeout(() => { unifiedSearchTimer = undefined; void runUnifiedSearch(normalized); }, 300);
  }

  async function focusAround(conversationId: string, seq: number): Promise<Message | undefined> {
    if (!caps || disposed) return undefined;
    const generation = lifecycleGeneration;
    if (!snapshot.value.conversations.some(item => item.id === conversationId)) {
      const found = await caps.im.conversations.get(conversationId);
      if (!isLifecycleCurrent(generation)) return undefined;
      replaceConversation(mapConversation(found));
    }
    if (activeId.value !== conversationId) await selectConversation(conversationId);
    const page = await caps.im.messages.listAround(conversationId, seq, 100);
    const mapped = page.items.map(item => mapMessage(item, snapshot.value.self));
    await prepareImagePreviews(mapped);
    if (!isLifecycleCurrent(generation) || activeId.value !== conversationId) return undefined;
    snapshot.value.messages = snapshot.value.messages.filter(item => item.conversationId !== conversationId);
    mergeMessages(mapped);
    highlightedSeq.value = seq;
    messageViewReady.value = false;
    isAtBottom.value = false;
    return mapped.find(item => item.seq === seq);
  }

  async function openSearchConversation(conversation: Conversation): Promise<void> {
    replaceConversation(conversation);
    await selectConversation(conversation.id);
  }

  async function openSearchMessage(message: Message): Promise<Message | undefined> {
    return focusAround(message.conversationId, message.seq);
  }

  function addMention(userId: string, token: string): void {
    if (!mentionCandidates.value.some(item => item.userId === userId)) return;
    const next = new Set(mentionUserIds.value);
    next.add(userId);
    mentionUserIds.value = next;
    mentionTokens.set(userId, token);
  }

  function addMentionAll(token: string): void {
    if (!canMentionAll.value) return;
    mentionAll.value = true;
    mentionTokens.set('__all__', token);
  }

  function pruneMentions(text: string): void {
    const next = new Set(mentionUserIds.value);
    for (const userId of next) if (!text.includes(mentionTokens.get(userId) ?? '\u0000')) next.delete(userId);
    mentionUserIds.value = next;
    const allToken = mentionTokens.get('__all__');
    if (mentionAll.value && (!allToken || !text.includes(allToken))) mentionAll.value = false;
  }

  async function openUser(user: User): Promise<void> {
    if (!caps || disposed) return;
    // A self conversation is invalid even if a caller bypasses the detail UI guard.
    if (user.id === snapshot.value.self?.id) return;
    const generation = lifecycleGeneration;
    const conversation = mapConversation(await caps.im.conversations.createSingle(user.id));
    if (!isLifecycleCurrent(generation)) return;
    replaceConversation(conversation);
    activeTab.value = 'chats';
    await selectConversation(conversation.id);
  }

  async function openDepartment(unit: OrgUnit): Promise<void> {
    if (!caps || disposed) return;
    const generation = lifecycleGeneration;
    const dto = await caps.im.conversations.getDepartmentConversation(unit.id);
    if (!isLifecycleCurrent(generation)) return;
    if (!dto) throw new Error('department_conversation_unavailable');
    replaceConversation(mapConversation(dto));
    activeTab.value = 'chats';
    await selectConversation(dto.id);
  }

  async function loadSince(conversationId: string, afterSeq: number, commitGuard: () => boolean = () => !disposed): Promise<Message[]> {
    if (!caps || disposed) return [];
    const page = await caps.im.messages.listSince(conversationId, afterSeq, 100);
    const mapped = page.items.map(item => mapMessage(item, snapshot.value.self));
    await prepareImagePreviews(mapped);
    if (!commitGuard()) return [];
    mergeMessages(mapped);
    return mapped;
  }

  async function loadLatest(conversationId: string, commitGuard: () => boolean = () => !disposed): Promise<Message[]> {
    if (!caps || disposed) return [];
    const conversation = snapshot.value.conversations.find(item => item.id === conversationId);
    if (!conversation || conversation.lastSeq <= 0) return [];
    const page = await caps.im.messages.listBefore(conversationId, conversation.lastSeq + 1, 100);
    const mapped = page.items.map(item => mapMessage(item, snapshot.value.self));
    await prepareImagePreviews(mapped);
    if (!commitGuard()) return [];
    mergeMessages(mapped);
    return mapped;
  }

  async function prepareImagePreviews(items: readonly Message[]): Promise<void> {
    if (!caps || disposed) return;
    const generation = lifecycleGeneration;
    await Promise.all(items.filter(item => item.kind === 'image' && item.attachment).map(async item => {
      try {
        const descriptor = await caps!.im.assets.openPreview(item.attachment!);
        if (isLifecycleCurrent(generation) && descriptor.kind === 'image' && descriptor.url && isSafePreviewURL(descriptor.url) && isFreshAssetDescriptor(descriptor.expiresAt)) item.imagePreviewUrl = descriptor.url;
      } catch (error) {
        if (isLifecycleCurrent(generation)) report(host, 'warn', 'im_next.image_thumbnail_failed', { messageId: item.id });
      }
    }));
  }

  async function loadNotifications(conversationId: string, reset: boolean, commitGuard: () => boolean = () => !disposed): Promise<void> {
    if (!caps || disposed) return;
    const offset = reset ? 0 : notificationOffset;
    const [page, unreadCount] = await Promise.all([
      caps.im.notifications.list({ offset, limit: 50 }),
      caps.im.notifications.unreadCount()
    ]);
    const mapped = page.items.map(item => mapNotification(item, conversationId));
    if (!commitGuard()) return;
    const retained = reset ? snapshot.value.messages.filter(item => item.conversationId !== conversationId) : snapshot.value.messages;
    snapshot.value.messages = retained;
    mergeMessages(mapped);
    notificationOffset = offset + page.items.length;
    notificationTotal = page.total;
    const conversation = snapshot.value.conversations.find(item => item.id === conversationId);
    if (conversation) {
      conversation.unread = unreadCount;
      // 首页（offset 0）的第一条就是最新通知：顺带刷新会话时间。
      if (offset === 0) syncSystemConversationTime(conversation, page.items[0]?.createdAt);
    }
  }

  /**
   * 系统通知会话的时间 = 最新一条通知的 created_at，没有通知时为空串——与宿主初始投影
   * 同一口径。新通知到达 / 撤回后都按它重算，
   * 否则会话列表时间停在打开面板那一刻，排序也不会随新通知前移。
   */
  function syncSystemConversationTime(conversation: Conversation, latestCreatedAt: string | undefined): void {
    conversation.updatedAt = latestCreatedAt ?? '';
  }

  async function markVisibleNotificationsRead(): Promise<void> {
    const conversation = activeConversation.value;
    if (!caps || !conversation || conversation.kind !== 'system') return;
    const unread = messages.value.flatMap(message => message.notification?.readAt === null ? [message.notification.id] : []);
    if (!unread.length) return;
    const generation = lifecycleGeneration;
    await caps.im.notifications.markRead({ ids: unread });
    if (!isLifecycleCurrent(generation)) return;
    const now = new Date().toISOString();
    for (const message of messages.value) if (message.notification && unread.includes(message.notification.id)) message.notification.readAt = now;
    const count = await caps.im.notifications.unreadCount();
    if (isLifecycleCurrent(generation)) {
      conversation.unread = count;
      try { readHostCapability(host, 'notifyUnreadMaybeChanged')?.(); }
      catch { report(host, 'warn', 'im_next.unread_notify_failed'); }
    }
  }

  async function acknowledgeActive(conversationId: string): Promise<void> {
    if (!caps || disposed || activeId.value !== conversationId) return;
    const generation = lifecycleGeneration;
    if (activeConversation.value?.kind === 'system') return;
    const latest = snapshot.value.messages
      .filter(item => item.conversationId === conversationId)
      .reduce((seq, item) => Math.max(seq, item.seq), 0);
    if (latest <= 0) return;
    try {
      await caps.im.messages.ackRead(conversationId, latest);
    } catch (error) {
      const code = error && typeof error === 'object' ? (error as Partial<NahidaClientError>).code : undefined;
      if (code === 'NAHIDA_CAPABILITY_UNAVAILABLE') {
        report(host, 'warn', 'im_next.ack_deferred', { conversationId, seq: latest });
        return;
      }
      throw error;
    }
    if (!isLifecycleCurrent(generation) || activeId.value !== conversationId) return;
    const conversation = snapshot.value.conversations.find(item => item.id === conversationId);
    if (conversation) Object.assign(conversation, { readSeq: latest, unread: 0 });
    try { readHostCapability(host, 'notifyUnreadMaybeChanged')?.(); }
    catch { report(host, 'warn', 'im_next.unread_notify_failed'); }
  }

  async function syncConversation(conversationId: string): Promise<void> {
    if (!caps || disposed) return;
    const generation = lifecycleGeneration;
    const guard = () => isLifecycleCurrent(generation);
    const knownConversation = snapshot.value.conversations.find(item => item.id === conversationId);
    if (knownConversation?.kind === 'system') {
      if (activeId.value === conversationId) await loadNotifications(conversationId, true, guard);
      return;
    }
    // 会话本体优先于消息增量拉取（先于 loadSince）：一个会话本地未知（典型场景=本端已隐藏，
    // 等待"新消息复位隐藏"回补，见后端 resetHiddenMembersTx）时，"是否重新出现在最近会话
    // 列表里"是这次同步唯一用户可感知的结果，必须优先落地、且不能被后面的消息增量拉取拖累。
    // 旧实现是 loadSince→conversations.get 严格串行，一旦 loadSince 失败（网络抖动等）整条
    // syncConversation 直接抛出，conversations.get 永远不会跑到，于是出现"消息可能已经在别处
    // 拉到、但会话始终没回到列表"的半更新态——与宿主约定强调的"不允许消息落库与会话
    // 复位之间存在中间态"精神相悖。这里镜像 focusAround() 对"未知会话"的既有处理顺序：
    // 会话拉取独立 try/catch，失败只记警告、不阻断后面的消息增量尝试；成功则立刻
    // replaceConversation 让它马上出现在列表里，再继续原有的消息增量流程。
    try {
      const refreshed = await caps.im.conversations.get(conversationId);
      if (!guard()) return;
      replaceConversation(mapConversation(refreshed));
    } catch (error) {
      if (guard()) report(host, 'warn', 'im_next.ws_conversation_restore_failed', { conversationId, message: error instanceof Error ? error.message : 'unknown' });
    }
    const previousSeq = snapshot.value.messages
      .filter(item => item.conversationId === conversationId && item.sendState !== 'sending')
      .reduce((seq, item) => Math.max(seq, item.seq), 0);
    const incoming = await loadSince(conversationId, previousSeq, guard);
    if (!guard()) return;
    if (activeId.value === conversationId && (!messageViewReady.value || !isAtBottom.value)) newMessageCount.value += incoming.length;
  }

  async function listAllConversations(capabilities: ImNextCapabilities, generation: number): Promise<Conversation[] | undefined> {
    const loaded: Conversation[] = [];
    const seenCursors = new Set<string>();
    let cursor: string | undefined;
    let pageNumber = 1;
    do {
      let page;
      try { page = await capabilities.im.conversations.list({ cursor, limit: 100 }); }
      catch (error) {
        const message = error instanceof Error ? error.message : 'unknown';
        throw new Error(`conversation_list_page_failed:${pageNumber}:${cursor ?? 'start'}:${message}`);
      }
      if (!isLifecycleCurrent(generation)) return undefined;
      loaded.push(...page.items.map(item => {
        const mapped = mapConversation(item);
        seedDeliveredCursor(mapped.id, mapped.kind, item.deliveredSeq);
        return mapped;
      }).filter(item => !item.hidden));
      const next = page.nextCursor ?? undefined;
      if (!next) break;
      if (seenCursors.has(next)) throw new Error(`conversation_cursor_cycle:${next}`);
      seenCursors.add(next);
      cursor = next;
      pageNumber += 1;
    } while (true);
    return [...new Map(loaded.map(conversation => [conversation.id, conversation])).values()];
  }

  async function refresh(): Promise<void> {
    if (disposed) return;
    const generation = lifecycleGeneration;
    const request = ++refreshRequest;
    const selectionAtStart = selectionRequest;
    const guard = () => isLifecycleCurrent(generation) && request === refreshRequest && selectionAtStart === selectionRequest;
    const probe = probeCapabilities(host);
    if (!probe.capabilities) {
      loadError.value = probe.missing.join(', ');
      screen.value = 'error';
      report(host, 'error', 'im_next.host_cap_missing', { missing: loadError.value });
      return;
    }
    caps = probe.capabilities;
    screen.value = 'loading';
    messageViewReady.value = false;
    try {
      const [loadedConversations, me, directory] = await Promise.all([
        listAllConversations(caps, generation), caps.org.me(), loadDirectory(caps)
      ]);
      if (!guard() || !loadedConversations) return;
      const self = mapOrgMember(me);
      snapshot.value = {
        conversations: loadedConversations,
        messages: [],
        directory,
        self
      };
      hydrateDrafts(self.id, loadedConversations.map(conversation => conversation.id));
      await updateConversationPresence(guard);
      markPresenceSynced();
      // 通讯录在线态是独立展示需求，不阻塞首屏就绪；刻意 fire-and-forget（不 await），
      // 避免拖慢 screen.value = 'ready' 的达成时间，回写通过响应式代理直接触发视图更新。
      void updateDirectoryPresence(snapshot.value.directory, guard);
      if (!guard()) return;
      if (!activeId.value || !snapshot.value.conversations.some(item => item.id === activeId.value)) {
        activeId.value = sortConversations(snapshot.value.conversations)[0]?.id;
      }
      draft.value = activeId.value ? drafts.get(activeId.value) ?? '' : '';
      replyTo.value = undefined;
      if (activeId.value) {
        if (activeConversation.value?.kind === 'system') await loadNotifications(activeId.value, true, guard);
        else {
          await loadLatest(activeId.value, guard);
        }
        if (!guard()) return;
        await loadGroupMembers(guard);
      }
      if (!guard()) return;
      screen.value = snapshot.value.conversations.length ? 'ready' : 'empty';
      report(host, 'info', 'im_next.loaded', { conversations: snapshot.value.conversations.length });
    } catch (error) {
      if (!guard()) return;
      loadError.value = error instanceof Error ? error.message : 'load_failed';
      screen.value = 'error';
      report(host, 'error', 'im_next.load_failed', { message: loadError.value });
    }
  }

  async function selectConversation(id: string): Promise<void> {
    if (disposed) return;
    const generation = lifecycleGeneration;
    const request = ++selectionRequest;
    const guard = () => isSelectionCurrent(generation, request, id);
    if (activeId.value) syncDraft(activeId.value, draft.value);
    activeId.value = id;
    draft.value = drafts.get(id) ?? '';
    replyTo.value = undefined;
    highlightedSeq.value = undefined;
    groupRoleOperation.value = { status: 'idle' };
    setSelectionMode(false);
    mentionUserIds.value = new Set();
    mentionAll.value = false;
    mentionTokens.clear();
    messageViewReady.value = false;
    newMessageCount.value = 0;
    isAtBottom.value = true;
    historyLoading.value = false;
    // 会话进入视野时顺带刷新一次对端在线态（仅单聊有 peerUserId，群聊/部门群/系统通知天然跳过）。
    // openUser/openSearchConversation/focusAround 等"把会话带进视野"的路径最终都会走到这里
    // （分别见各自实现），统一在这一处补齐即可覆盖全部入口，不需要在每个调用点各自补一次查询。
    // 这是"通讯录点『发消息』进单聊、头部无状态点"症状的直接修复点：此前只有整页 refresh()/
    // resyncAll() 才会批量刷新会话列表的在线态，单条新开/切换的会话从未被覆盖到。
    const peerUserId = activeConversation.value?.peerUserId;
    const presenceRefresh = peerUserId ? refreshPresence([peerUserId], guard) : Promise.resolve();
    if (activeConversation.value?.kind === 'system') {
      await loadNotifications(id, true, guard);
      if (guard()) await Promise.all([loadGroupMembers(guard), loadAnnouncement(guard), presenceRefresh]);
      return;
    }
    await loadLatest(id, guard);
    if (guard()) await Promise.all([loadGroupMembers(guard), loadAnnouncement(guard), presenceRefresh]);
  }

  /**
   * 聊天记录浮层的独立分页取数（2026-08-11）：与主消息视口完全隔离，
   * 不写 snapshot/messages 状态，浮层自持游标按需向前翻页。
   */
  async function fetchHistorySlice(conversationId: string, beforeSeq: number, limit = 100): Promise<Message[]> {
    if (!caps) return [];
    const page = await caps.im.messages.listBefore(conversationId, beforeSeq, limit);
    return page.items.map(item => mapMessage(item, snapshot.value.self));
  }

  /**
   * 系统通知会话的聊天记录浮层取数：通知走 offset/limit 分页（与消息 seq 游标是两条
   * 独立路径）。刻意不复用 loadNotifications——那条路径带模块级游标与会话未读数副作用，
   * 浮层必须零副作用。返回 total 供调用方判定是否到底。
   */
  async function fetchNotificationSlice(conversationId: string, offset: number, limit = 100): Promise<{ items: Message[]; total: number }> {
    if (!caps) return { items: [], total: 0 };
    const page = await caps.im.notifications.list({ offset, limit });
    return { items: page.items.map(item => mapNotification(item, conversationId)), total: page.total };
  }

  async function loadHistory(): Promise<void> {
    if (!caps || disposed || !activeId.value || historyLoading.value) return;
    const generation = lifecycleGeneration;
    const request = selectionRequest;
    const conversationId = activeId.value;
    const guard = () => isSelectionCurrent(generation, request, conversationId);
    if (activeConversation.value?.kind === 'system') {
      if (notificationOffset >= notificationTotal) return;
      historyLoading.value = true;
      try { await loadNotifications(conversationId, false, guard); }
      finally { if (guard()) historyLoading.value = false; }
      return;
    }
    const beforeSeq = messages.value.reduce((seq, item) => Math.min(seq, item.seq), Number.POSITIVE_INFINITY);
    if (!Number.isFinite(beforeSeq) || beforeSeq <= 1) return;
    historyLoading.value = true;
    try {
      const older = await caps.im.messages.listBefore(conversationId, beforeSeq, 100);
      if (guard()) mergeMessages(older.items.map(item => mapMessage(item, snapshot.value.self)));
    } catch (error) {
      if (guard()) report(host, 'warn', 'im_next.history_failed', { message: error instanceof Error ? error.message : 'unknown' });
    } finally { if (guard()) historyLoading.value = false; }
  }

  function optimisticMessage(conversationId: string, clientMsgId: string, kind: Message['kind'], content: NahidaMessageContent, mentions?: NahidaMentions): Message {
    const seq = snapshot.value.messages.filter(item => item.conversationId === conversationId).reduce((max, item) => Math.max(max, item.seq), activeConversation.value?.lastSeq ?? 0) + 1;
    return {
      id: `pending:${clientMsgId}`,
      conversationId,
      seq,
      clientMsgId,
      sender: snapshot.value.self ?? { id: '', name: '', departments: [] },
      kind,
      text: content.text,
      attachment: content.asset,
      createdAt: new Date().toISOString(),
      sendState: 'sending',
      mentions,
      replyTo: replyTo.value ? { id: replyTo.value.id, seq: replyTo.value.seq, sender: replyTo.value.sender, text: replyTo.value.text } : undefined
    };
  }

  async function deliver(message: Message, kind: Exclude<NahidaMessageKind, 'system' | 'recall-tombstone'>, content: NahidaMessageContent): Promise<boolean> {
    if (!caps || disposed) return false;
    const generation = lifecycleGeneration;
    message.sendState = 'sending';
    try {
      const result = await caps.im.messages.send({
        conversationId: message.conversationId,
        clientMsgId: message.clientMsgId,
        kind,
        content,
        mentions: message.mentions,
        replyToSeq: message.replyTo?.seq
      });
      if (!isLifecycleCurrent(generation)) return false;
      const saved = mapMessage(result.message, snapshot.value.self);
      await prepareImagePreviews([saved]);
      mergeMessages([saved]);
      const conversation = snapshot.value.conversations.find(item => item.id === message.conversationId);
      if (conversation) Object.assign(conversation, {
        lastSeq: Math.max(conversation.lastSeq, saved.seq),
        summary: saved.text ?? saved.attachment?.fileName ?? conversation.summary,
        updatedAt: saved.createdAt
      });
      report(host, 'info', 'im_next.message_sent', { conversationId: message.conversationId, clientMsgId: message.clientMsgId });
      return true;
    } catch (error) {
      if (!isLifecycleCurrent(generation)) return false;
      message.sendState = 'failed';
      report(host, 'error', 'im_next.message_send_failed', { clientMsgId: message.clientMsgId, message: error instanceof Error ? error.message : 'unknown' });
      return false;
    }
  }

  async function send(): Promise<void> {
    const text = draft.value.trim();
    if (!caps || disposed || !text || !activeId.value || !canWrite.value || sendingDrafts.has(activeId.value)) return;
    const conversationId = activeId.value;
    const sourceDraft = draft.value;
    sendingDrafts.add(conversationId);
    const mentions: NahidaMentions | undefined = mentionAll.value
      ? { all: true }
      : mentionUserIds.value.size ? [...mentionUserIds.value].map(userId => ({ userId })) : undefined;
    const message = optimisticMessage(conversationId, options?.clientMsgId?.() ?? defaultClientMsgId(), 'text', { text }, mentions);
    snapshot.value.messages.push(message);
    replyTo.value = undefined;
    mentionUserIds.value = new Set();
    mentionAll.value = false;
    mentionTokens.clear();
    try {
      const sent = await deliver(message, 'text', { text });
      if (!sent) return;
      const unchanged = (activeId.value === conversationId ? draft.value : drafts.get(conversationId) ?? '') === sourceDraft;
      if (!unchanged) return;
      syncDraft(conversationId, '');
      if (activeId.value === conversationId) draft.value = '';
    } finally {
      sendingDrafts.delete(conversationId);
    }
  }

  async function retry(message: Message): Promise<void> {
    if (disposed || message.sendState !== 'failed') return;
    const content: NahidaMessageContent = { text: message.text, asset: message.attachment };
    const sent = await deliver(message, message.kind === 'image' ? 'image' : message.attachment ? 'file' : 'text', content);
    if (!sent || message.kind !== 'text' || !message.text) return;
    const current = activeId.value === message.conversationId ? draft.value : drafts.get(message.conversationId) ?? '';
    if (current.trim() !== message.text) return;
    syncDraft(message.conversationId, '');
    if (activeId.value === message.conversationId) draft.value = '';
  }

  async function sendFile(file: File): Promise<void> {
    if (!caps || disposed || !activeId.value || !canWrite.value) return;
    const generation = lifecycleGeneration;
    const conversationId = activeId.value;
    let uploadId = '';
    const task = caps.im.assets.upload({
      file,
      fileName: file.name,
      mimeType: file.type || 'application/octet-stream',
      onProgress: progress => { if (isLifecycleCurrent(generation) && upload.value?.uploadId === uploadId) upload.value.progress = progress.totalBytes ? progress.loadedBytes / progress.totalBytes : null; }
    });
    uploadId = task.uploadId;
    upload.value = { uploadId: task.uploadId, fileName: file.name, progress: 0, cancel: () => task.cancel('user_cancelled') };
    try {
      const asset = await awaitTrackedUpload(task);
      if (!isLifecycleCurrent(generation)) return;
      const kind = asset.mimeType.startsWith('image/') ? 'image' : 'file';
      const message = optimisticMessage(conversationId, options?.clientMsgId?.() ?? defaultClientMsgId(), kind, { asset });
      snapshot.value.messages.push(message);
      await deliver(message, kind, { asset });
      report(host, 'info', 'im_next.asset_sent', { assetId: asset.assetId, mimeType: asset.mimeType });
    } catch (error) {
      if (!isLifecycleCurrent(generation)) return;
      report(host, 'error', 'im_next.asset_upload_failed', { message: error instanceof Error ? error.message : 'unknown' });
      throw error;
    } finally { if (isLifecycleCurrent(generation) && upload.value?.uploadId === task.uploadId) upload.value = undefined; }
  }

  async function openAttachment(attachment: Attachment): Promise<void> {
    if (!caps || disposed) return;
    const generation = lifecycleGeneration;
    preview.value = { status: 'loading', asset: attachment };
    try {
      let descriptor = await caps.im.assets.openPreview(attachment);
      if (!isLifecycleCurrent(generation)) return;
      if (descriptor.kind === 'download') {
        const download = await caps.im.assets.getDownloadURL(attachment);
        if (!isLifecycleCurrent(generation)) return;
        descriptor = { ...descriptor, url: download.url, expiresAt: download.expiresAt, downloadFileName: download.fileName };
      }
      if (!isFreshAssetDescriptor(descriptor.expiresAt)) throw new Error('expired_asset_descriptor');
      if (descriptor.kind === 'text') {
        if (typeof descriptor.text !== 'string' || descriptor.url) throw new Error('invalid_text_preview_descriptor');
      } else if (!descriptor.url || !isSafePreviewURL(descriptor.url)) throw new Error('unsafe_preview_url');
      preview.value = { status: 'ready', asset: attachment, descriptor };
    } catch (error) {
      if (!isLifecycleCurrent(generation)) return;
      preview.value = { status: 'error', asset: attachment, message: error instanceof Error ? error.message : 'preview_failed' };
      report(host, 'error', 'im_next.asset_preview_failed', { assetId: attachment.assetId });
    }
  }

  function closePreview(): void { preview.value = { status: 'closed' }; }

  function setAtBottom(value: boolean): void {
    isAtBottom.value = value;
    if (value) {
      newMessageCount.value = 0;
      if (messageViewReady.value && activeId.value) void acknowledgeActive(activeId.value);
    }
  }

  function markMessageViewReady(): void { messageViewReady.value = true; }

  function setReply(message: Message): void {
    if (message.notification || ['system', 'recall'].includes(message.kind)) return;
    replyTo.value = message;
  }

  async function locateReply(message: Message): Promise<Message | undefined> {
    const targetSeq = message.replyTo?.seq;
    if (targetSeq === undefined) return undefined;
    const target = snapshot.value.messages.find(item => item.conversationId === message.conversationId && item.seq === targetSeq);
    if (target) {
      highlightedSeq.value = target.seq;
      return target;
    }
    return focusAround(message.conversationId, targetSeq);
  }

  function clearHighlight(): void { highlightedSeq.value = undefined; }

  function canRevoke(message: Message): boolean {
    if (!(snapshot.value.self && message.sender.id === snapshot.value.self.id && message.sendState === 'sent'
      && !message.notification && !['system', 'recall'].includes(message.kind))) return false;
    // 产品定版（2026-08-10）：仅发出 2 分钟内可撤回；createdAt 解析失败时放行交由服务端判定
    const createdAt = Date.parse(message.createdAt);
    return Number.isNaN(createdAt) || Date.now() - createdAt <= REVOKE_WINDOW_MS;
  }

  async function revokeMessage(message: Message): Promise<void> {
    if (!caps || !canRevoke(message)) return;
    await caps.im.messages.revoke(message.id);
    Object.assign(message, {
      kind: 'recall' as const,
      revoked: true,
      text: undefined,
      attachment: undefined,
      imagePreviewUrl: undefined,
      replyTo: undefined,
      reactions: []
    });
    report(host, 'info', 'im_next.message_revoked', { messageId: message.id, conversationId: message.conversationId });
  }

  async function copyMessageText(message: Message, writeText?: (text: string) => Promise<void>): Promise<void> {
    const text = message.kind === 'text' ? message.text : undefined;
    if (!text) throw new Error('message_text_unavailable');
    const writer = writeText ?? (globalThis.navigator?.clipboard
      ? (value: string) => globalThis.navigator.clipboard.writeText(value)
      : undefined);
    if (!writer) throw new Error('clipboard_unavailable');
    await writer(text);
  }

  function canLoadReceipt(message: Message): boolean {
    return message.sendState === 'sent' && message.sender.id === snapshot.value.self?.id
      && !message.notification && !['system', 'recall'].includes(message.kind);
  }

  async function loadReadReceipt(message: Message): Promise<void> {
    if (!caps || !canLoadReceipt(message)) return;
    message.receipt = { status: 'loading' };
    try {
      const receipt = await caps.im.messages.getReadReceipt(message.conversationId, message.seq);
      message.receipt = {
        status: 'ready', mode: receipt.mode, readCount: receipt.readCount,
        readUserIds: receipt.readUserIds ? [...receipt.readUserIds] : undefined
      };
    } catch (error) {
      message.receipt = { status: 'error', error: error instanceof Error ? error.message : 'receipt_failed' };
    }
  }

  async function toggleReaction(message: Message, reaction: Reaction): Promise<void> {
    if (!caps || message.sendState === 'sending') return;
    const prior = { ...reaction };
    const active = !reaction.mine;
    Object.assign(reaction, { mine: active, count: Math.max(0, reaction.count + (active ? 1 : -1)) });
    try {
      const saved = await caps.im.messages.setReaction(message.id, reaction.emoji, active);
      Object.assign(reaction, { emoji: saved.emoji, count: saved.count, mine: saved.reactedByMe });
    } catch (error) {
      Object.assign(reaction, prior);
      report(host, 'warn', 'im_next.reaction_failed', { messageId: message.id, emoji: reaction.emoji });
      throw error;
    }
  }

  async function setReactionEmoji(message: Message, emoji: string): Promise<void> {
    const existing = message.reactions?.find(item => item.emoji === emoji);
    if (existing) {
      await toggleReaction(message, existing);
      return;
    }
    if (!caps || message.sendState === 'sending') return;
    const reaction: Reaction = { emoji, count: 1, mine: true };
    message.reactions ??= [];
    message.reactions.push(reaction);
    try {
      const saved = await caps.im.messages.setReaction(message.id, emoji, true);
      Object.assign(reaction, { emoji: saved.emoji, count: saved.count, mine: saved.reactedByMe });
    } catch (error) {
      message.reactions = message.reactions.filter(item => item !== reaction);
      report(host, 'warn', 'im_next.reaction_failed', { messageId: message.id, emoji });
      throw error;
    }
  }

  function setSelectionMode(active: boolean): void {
    selectionMode.value = active;
    if (!active) selectedMessageIds.value = new Set();
  }

  function toggleMessageSelection(message: Message): void {
    if (!selectionMode.value || !canForwardMessage(message)) return;
    const next = new Set(selectedMessageIds.value);
    next.has(message.id) ? next.delete(message.id) : next.add(message.id);
    selectedMessageIds.value = next;
  }

  function openForward(messagesToForward: readonly Message[]): void {
    const eligible = [...messagesToForward].filter(canForwardMessage).sort((a, b) => a.seq - b.seq);
    if (!eligible.length) return;
    forwardOperationId = options?.clientMsgId?.() ?? defaultClientMsgId();
    forwardSources.value = eligible;
    forwardTargetIds.value = new Set();
    forwardResults.value = [];
    forwardOpen.value = true;
  }

  function closeForward(): void {
    const prefix = `${forwardOperationId}:`;
    for (const key of forwardClientIds.keys()) if (key.startsWith(prefix)) forwardClientIds.delete(key);
    forwardOperationId = '';
    forwardOpen.value = false;
    forwardSources.value = [];
    forwardTargetIds.value = new Set();
    forwardResults.value = [];
  }

  function toggleForwardTarget(conversationId: string): void {
    const next = new Set(forwardTargetIds.value);
    next.has(conversationId) ? next.delete(conversationId) : next.add(conversationId);
    forwardTargetIds.value = next;
  }

  function stableForwardClientId(targetId: string, sourceKey: string): string {
    const key = `${forwardOperationId}:${targetId}:${sourceKey}`;
    let id = forwardClientIds.get(key);
    if (!id) {
      id = options?.clientMsgId?.() ?? defaultClientMsgId();
      forwardClientIds.set(key, id);
    }
    return id;
  }

  async function executeForward(mode: 'individual' | 'merged'): Promise<void> {
    if (!caps || !forwardSources.value.length || !forwardTargetIds.value.size) return;
    const sources = [...forwardSources.value].filter(canForwardMessage).sort((a, b) => a.seq - b.seq);
    const mergedCard = mode === 'merged' ? buildMergedMessagesCard(sources) : undefined;
    forwardResults.value = [...forwardTargetIds.value].map(conversationId => ({ conversationId, status: 'pending' }));
    for (const result of forwardResults.value) {
      let firstError = '';
      if (mode === 'merged') {
        try {
          await caps.im.messages.send({
            conversationId: result.conversationId,
            clientMsgId: stableForwardClientId(result.conversationId, 'merged'),
            kind: 'card',
            content: { card: mergedCard }
          });
        } catch (error) { firstError = error instanceof Error ? error.message : 'forward_failed'; }
      } else {
        for (const source of sources) {
          try {
            await caps.im.messages.forward({
              conversationId: result.conversationId,
              clientMsgId: stableForwardClientId(result.conversationId, `${source.conversationId}:${source.seq}`),
              source: { conversationId: source.conversationId, seq: source.seq }
            });
          } catch (error) {
            firstError ||= error instanceof Error ? error.message : 'forward_failed';
          }
        }
      }
      Object.assign(result, firstError ? { status: 'failed' as const, error: firstError } : { status: 'success' as const, error: undefined });
    }
  }

  async function runNotificationCardAction(message: Message, key: string, comment?: string): Promise<void> {
    if (!caps || !message.notification) return;
    await caps.im.notifications.cardAction(message.notification.id, { key, comment });
    await loadNotifications(message.conversationId, true);
  }

  async function runMessageCardAction(message: Message, key: string): Promise<void> {
    if (!caps || !message.cardAction) return;
    await caps.im.messages.cardAction(message.id, { key });
    const page = await caps.im.messages.listAround(message.conversationId, message.seq, 30);
    mergeMessages(page.items.map(item => mapMessage(item, snapshot.value.self)));
  }

  function beginGroupOperation(action: NonNullable<GroupOperationState['action']>): void {
    groupOperation.value = { status: 'pending', action };
  }

  function failGroupOperation(action: NonNullable<GroupOperationState['action']>, error: unknown): void {
    groupOperation.value = { status: 'error', action, error: error instanceof Error ? error.message : 'group_operation_failed' };
  }

  async function createGroup(name: string, memberUserIds: readonly string[]): Promise<void> {
    if (!caps || disposed) return;
    const generation = lifecycleGeneration;
    const normalizedName = name.trim();
    const ids = [...new Set(memberUserIds.filter(Boolean))];
    if (!normalizedName || !ids.length) return;
    beginGroupOperation('create');
    try {
      const conversation = mapConversation(await caps.im.conversations.createGroup({ name: normalizedName, memberUserIds: ids }));
      if (!isLifecycleCurrent(generation)) return;
      replaceConversation(conversation);
      groupOperation.value = { status: 'success', action: 'create', succeededIds: ids };
      await selectConversation(conversation.id);
    } catch (error) {
      if (!isLifecycleCurrent(generation)) return;
      failGroupOperation('create', error);
      throw error;
    }
  }

  async function inviteGroupMembers(userIds: readonly string[]): Promise<void> {
    const conversation = activeConversation.value;
    if (!caps || disposed || !conversation || !canInviteGroup(conversation)) return;
    const generation = lifecycleGeneration;
    const requested = [...new Set(userIds.filter(Boolean))];
    if (!requested.length) return;
    beginGroupOperation('invite');
    try {
      const accepted = [...new Set(await caps.im.groups.addMembers(conversation.id, requested))];
      if (!isLifecycleCurrent(generation)) return;
      const acceptedSet = new Set(accepted);
      const failed = requested.filter(id => !acceptedSet.has(id));
      groupOperation.value = { status: failed.length ? 'partial' : 'success', action: 'invite', succeededIds: accepted, failedIds: failed };
      await loadGroupMembers();
      const refreshed = await caps.im.conversations.get(conversation.id);
      if (!isLifecycleCurrent(generation)) return;
      replaceConversation(mapConversation(refreshed));
    } catch (error) {
      if (!isLifecycleCurrent(generation)) return;
      failGroupOperation('invite', error);
      throw error;
    }
  }

  function canKickMember(member: GroupMember): boolean {
    return canKickOrdinaryGroupMember(activeConversation.value, member, snapshot.value.self?.id);
  }

  function canSetMemberAdmin(member: GroupMember): boolean {
    return canSetOrdinaryGroupAdmin(activeConversation.value, member, snapshot.value.self?.id);
  }

  function canTransferOwnership(member: GroupMember): boolean {
    return canTransferOrdinaryGroupOwnership(activeConversation.value, member, snapshot.value.self?.id);
  }

  async function refreshGroupRoleState(conversationId: string, generation: number): Promise<void> {
    const refreshed = await caps!.im.conversations.get(conversationId);
    if (!isLifecycleCurrent(generation)) return;
    replaceConversation(mapConversation(refreshed));
    if (activeId.value !== conversationId) return;
    await loadGroupMembers(() => isLifecycleCurrent(generation) && activeId.value === conversationId);
    if (groupMembersError.value) throw new Error(groupMembersError.value);
  }

  async function setGroupMemberAdmin(member: GroupMember, enabled: boolean): Promise<void> {
    const conversation = activeConversation.value;
    if (!caps || disposed || !conversation || groupRoleOperation.value.status === 'pending' || !canSetMemberAdmin(member)) return;
    const generation = lifecycleGeneration;
    const action = enabled ? 'grant-admin' : 'revoke-admin';
    const role = enabled ? 'admin' : 'member';
    groupRoleOperation.value = { status: 'pending', action, userId: member.userId };
    try {
      await caps.im.groups.setRole(conversation.id, member.userId, role);
      if (!isLifecycleCurrent(generation)) return;
      await refreshGroupRoleState(conversation.id, generation);
      if (!isLifecycleCurrent(generation)) return;
      groupRoleOperation.value = { status: 'success', action, userId: member.userId };
    } catch (error) {
      if (!isLifecycleCurrent(generation)) return;
      groupRoleOperation.value = { status: 'error', action, userId: member.userId, error: error instanceof Error ? error.message : 'group_role_failed' };
      throw error;
    }
  }

  async function transferGroupOwnership(member: GroupMember, confirmTransfer: () => boolean | Promise<boolean>): Promise<void> {
    const conversation = activeConversation.value;
    if (!caps || disposed || !conversation || groupRoleOperation.value.status === 'pending' || !canTransferOwnership(member)) return;
    if (!(await confirmTransfer())) return;
    // 确认框是异步的：等待期间可能已有另一次转让进入 pending 或会话已销毁/切换，确认后重新校验
    if (disposed || activeConversation.value?.id !== conversation.id || (groupRoleOperation.value.status as string) === 'pending') return;
    const generation = lifecycleGeneration;
    groupRoleOperation.value = { status: 'pending', action: 'transfer-owner', userId: member.userId };
    try {
      await caps.im.groups.setRole(conversation.id, member.userId, 'owner');
      if (!isLifecycleCurrent(generation)) return;
      await refreshGroupRoleState(conversation.id, generation);
      if (!isLifecycleCurrent(generation)) return;
      groupRoleOperation.value = { status: 'success', action: 'transfer-owner', userId: member.userId };
    } catch (error) {
      if (!isLifecycleCurrent(generation)) return;
      groupRoleOperation.value = { status: 'error', action: 'transfer-owner', userId: member.userId, error: error instanceof Error ? error.message : 'group_owner_transfer_failed' };
      throw error;
    }
  }

  async function kickGroupMembers(members: readonly GroupMember[]): Promise<void> {
    const conversation = activeConversation.value;
    if (!caps || disposed || !conversation || conversation.kind !== 'group') return;
    const generation = lifecycleGeneration;
    const allowed = [...new Map(members.filter(canKickMember).map(member => [member.userId, member])).values()];
    if (!allowed.length) return;
    beginGroupOperation('kick');
    const succeededIds: string[] = [];
    const failedIds: string[] = [];
    let firstError = '';
    await runBounded(allowed, 3, async member => {
      try { await caps!.im.groups.kick(conversation.id, member.userId); succeededIds.push(member.userId); }
      catch (error) { failedIds.push(member.userId); firstError ||= error instanceof Error ? error.message : 'group_kick_failed'; }
    });
    if (!isLifecycleCurrent(generation)) return;
    groupOperation.value = {
      status: failedIds.length ? succeededIds.length ? 'partial' : 'error' : 'success',
      action: 'kick', succeededIds, failedIds, error: firstError || undefined
    };
    await loadGroupMembers();
    const refreshed = await caps.im.conversations.get(conversation.id);
    if (!isLifecycleCurrent(generation)) return;
    replaceConversation(mapConversation(refreshed));
  }

  async function updateGroupInfo(name?: string, avatarFile?: File): Promise<void> {
    const conversation = activeConversation.value;
    if (!caps || disposed || !conversation || !canEditGroupInfo(conversation)) return;
    const generation = lifecycleGeneration;
    const normalizedName = name?.trim() || undefined;
    if (!normalizedName && !avatarFile) return;
    beginGroupOperation('update');
    try {
      let avatarAssetId: string | undefined;
      if (avatarFile) {
        const uploadTask = caps.im.assets.upload({ file: avatarFile, fileName: avatarFile.name, mimeType: avatarFile.type || 'application/octet-stream' });
        avatarAssetId = (await awaitTrackedUpload(uploadTask)).assetId;
      }
      if (!isLifecycleCurrent(generation)) return;
      const refreshed = await caps.im.groups.updateInfo(conversation.id, { name: normalizedName, avatarAssetId });
      if (!isLifecycleCurrent(generation)) return;
      replaceConversation(mapConversation(refreshed));
      groupOperation.value = { status: 'success', action: 'update' };
    } catch (error) {
      if (!isLifecycleCurrent(generation)) return;
      failGroupOperation('update', error);
      throw error;
    }
  }

  async function setGroupMuteAll(enabled: boolean): Promise<void> {
    const conversation = activeConversation.value;
    if (!caps || !conversation || !canGovernGroup.value || groupGovernancePending.value) return;
    groupGovernancePending.value = true;
    groupGovernanceError.value = '';
    try {
      await caps.im.groups.setMuteAll(conversation.id, enabled);
      const refreshed = await caps.im.conversations.get(conversation.id);
      replaceConversation(mapConversation(refreshed));
    } catch (error) {
      groupGovernanceError.value = error instanceof Error ? error.message : 'group_governance_failed';
      throw error;
    } finally {
      groupGovernancePending.value = false;
    }
  }

  async function setGroupMemberSendMuted(member: GroupMember, muted: boolean): Promise<void> {
    const conversation = activeConversation.value;
    if (!caps || !conversation || !canMuteMember.value || member.role === 'owner' || groupGovernancePending.value) return;
    groupGovernancePending.value = true;
    groupGovernanceError.value = '';
    try {
      await caps.im.groups.setMemberSendMuted(conversation.id, member.userId, muted);
      // member 参数可能来自 groupMembers 投影 computed（presence 叠加产生的克隆），必须按 userId
      // 回源改写 groupMembersState 里的真实对象，否则只改了渲染期的临时克隆，下一次投影重算就会
      // 被覆盖丢失。
      const target = groupMembersState.value.find(item => item.userId === member.userId);
      if (target) target.sendMuted = muted;
    } catch (error) {
      groupGovernanceError.value = error instanceof Error ? error.message : 'group_governance_failed';
      throw error;
    } finally {
      groupGovernancePending.value = false;
    }
  }

  async function saveAnnouncement(): Promise<void> {
    const conversation = activeConversation.value;
    const text = announcementDraft.value.trim();
    if (!caps || !conversation || !canGovernGroup.value || !text || groupGovernancePending.value) return;
    groupGovernancePending.value = true;
    groupGovernanceError.value = '';
    try {
      const result = await caps.im.groups.setAnnouncement(conversation.id, { mutationId: defaultClientMsgId(), text });
      const authoritativeText = result.message.content.systemParams?.text;
      announcementText.value = typeof authoritativeText === 'string' ? authoritativeText : text;
      announcementDraft.value = announcementText.value;
      const refreshed = await caps.im.conversations.get(conversation.id);
      replaceConversation(mapConversation(refreshed));
    } catch (error) {
      groupGovernanceError.value = error instanceof Error ? error.message : 'announcement_failed';
      throw error;
    } finally {
      groupGovernancePending.value = false;
    }
  }

  async function clearAnnouncement(): Promise<void> {
    const conversation = activeConversation.value;
    if (!caps || !conversation || !canGovernGroup.value || !announcementText.value || groupGovernancePending.value) return;
    groupGovernancePending.value = true;
    groupGovernanceError.value = '';
    try {
      await caps.im.groups.clearAnnouncement(conversation.id, defaultClientMsgId());
      announcementText.value = '';
      announcementDraft.value = '';
      const refreshed = await caps.im.conversations.get(conversation.id);
      replaceConversation(mapConversation(refreshed));
    } catch (error) {
      groupGovernanceError.value = error instanceof Error ? error.message : 'announcement_failed';
      throw error;
    } finally {
      groupGovernancePending.value = false;
    }
  }

  async function leaveGroup(): Promise<void> {
    const conversation = activeConversation.value;
    if (!caps || disposed || !conversation || !canLeaveOrdinaryGroup(conversation)) return;
    const generation = lifecycleGeneration;
    await caps.im.groups.leave(conversation.id);
    if (!isLifecycleCurrent(generation)) return;
    snapshot.value.conversations = snapshot.value.conversations.filter(item => item.id !== conversation.id);
    activeId.value = sortConversations(snapshot.value.conversations)[0]?.id;
    report(host, 'info', 'im_next.group_left', { conversationId: conversation.id });
  }

  async function dissolveGroup(): Promise<void> {
    const conversation = activeConversation.value;
    if (!caps || disposed || !conversation || !canDissolveOrdinaryGroup(conversation)) return;
    const generation = lifecycleGeneration;
    await caps.im.groups.dissolve(conversation.id);
    if (!isLifecycleCurrent(generation)) return;
    snapshot.value.conversations = snapshot.value.conversations.filter(item => item.id !== conversation.id);
    activeId.value = sortConversations(snapshot.value.conversations)[0]?.id;
    report(host, 'warn', 'im_next.group_dissolved', { conversationId: conversation.id });
  }

  async function handleWsMessage(data: unknown): Promise<void> {
    if (disposed) return;
    const conversationId = wsConversationId(data);
    if (!conversationId) {
      report(host, 'warn', 'im_next.ws_message_invalid');
      return;
    }
    try { await syncConversation(conversationId); }
    catch (error) { if (!disposed) report(host, 'error', 'im_next.ws_incremental_failed', { conversationId, message: error instanceof Error ? error.message : 'unknown' }); }
  }

  function handleWsRead(data: unknown): void {
    if (disposed) return;
    const conversationId = frameString(data, 'convId');
    const readSeq = frameNumber(data, 'readSeq');
    if (!conversationId || readSeq === undefined) return;
    const conversation = snapshot.value.conversations.find(item => item.id === conversationId);
    if (!conversation) return;
    conversation.readSeq = Math.max(conversation.readSeq, readSeq);
    if (conversation.readSeq >= conversation.lastSeq) conversation.unread = 0;
  }

  /**
   * WS 帧 im.read.peer：仅单聊场景，对端推进已读游标时由服务端推给消息发送方，用于常驻「已读/未读」标签的实时翻转。
   * payload: { convId, readerId, readSeq }。命中范围与 canLoadReceipt 判定一致（自己发出、非撤回/系统的已发送消息），
   * 就地把 seq<=readSeq 的消息回执翻为「已读」，不发起网络请求——与 loadReadReceipt 惰性拉取写的是同一 receipt 字段，
   * 二者互为对等写者、后写为准，天然幂等无需额外协调。
   */
  function handleWsReadPeer(data: unknown): void {
    if (disposed) return;
    const conversationId = frameString(data, 'convId');
    const readerId = frameString(data, 'readerId');
    const readSeq = frameNumber(data, 'readSeq');
    if (!conversationId || !readerId || readSeq === undefined) return;
    for (const message of snapshot.value.messages) {
      if (message.conversationId !== conversationId || message.seq > readSeq) continue;
      if (!canLoadReceipt(message)) continue;
      const receipt = message.receipt;
      if (receipt?.status === 'ready') {
        if (receipt.mode === 'disabled') continue; // 会话已声明禁用回执标签，不覆盖既有状态
        if (receipt.readCount || receipt.readUserIds?.length) continue; // 已是已读态，幂等跳过
      }
      message.receipt = { status: 'ready', mode: 'count', readCount: 1 };
    }
  }

  /**
   * WS 帧 presence.update：单聊对端上下线的实时推送（产品定版 2026-08-11"单聊对端走推送，
   * 通讯录/群成员走定时刷新兜底"）。三个触发点是 WS 连接建立/断开/手动切换 presence_mode（服务端在线态变更通知）；
   * 扇出面只到"与该用户有单聊会话的对端"，因此这条通道天然覆盖不到通讯录/群成员，
   * 那部分由上面的 pollVisiblePresence 定时轮询兜底。
   * payload 形状 { userId: string, status: number }（0=offline/1=online/2=busy），与宿主
   * im.presence.queryUsers 背后那条查询接口的合成态编码完全同源（服务端同一份 composePresenceStatus）。
   * 宿主 IM WS 客户端按 kind 分发
   * 时只做了 JSON.parse，未对 data 做任何值域转换——交给插件的是原始 wire 帧，status 仍是数字，
   * 不是已解码的字符串枚举，因此这里必须自己按 0/1/2 解码，不能假设宿主已经转换过。
   * 推送值本身就是服务端合成好的权威态：直接写 presenceById，绝不为此发起 HTTP 查询回补
   * ——那样等于把"推送省一次查询"的收益打回原形。
   * 字段缺失/类型不对时静默忽略、只报一条 warn，不抛错打断实时链路（同 handleWsMessage 对
   * 非法帧的处理原则）。
   */
  function handleWsPresenceUpdate(data: unknown): void {
    if (disposed) return;
    const userId = frameString(data, 'userId');
    const status = frameNumber(data, 'status');
    if (!userId || status === undefined) {
      report(host, 'warn', 'im_next.ws_presence_frame_invalid');
      return;
    }
    const state: ConnectionState = status === 1 ? 'online' : status === 2 ? 'busy' : 'offline';
    presenceById.value.set(userId, state);
  }

  function handleWsRevoke(data: unknown): void {
    if (disposed) return;
    const conversationId = frameString(data, 'convId');
    const seq = frameNumber(data, 'seq');
    if (!conversationId || seq === undefined) return;
    const message = snapshot.value.messages.find(item => item.conversationId === conversationId && item.seq === seq);
    if (!message) return;
    Object.assign(message, {
      kind: 'recall' as const, revoked: true, text: undefined, attachment: undefined,
      imagePreviewUrl: undefined, replyTo: undefined, reactions: [], receipt: undefined
    });
  }

  async function handleWsCardUpdate(data: unknown): Promise<void> {
    if (!caps || disposed) return;
    const generation = lifecycleGeneration;
    const messageId = frameString(data, 'messageId');
    if (messageId) {
      const current = snapshot.value.messages.find(item => item.id === messageId);
      if (!current) return;
      const page = await caps.im.messages.listAround(current.conversationId, current.seq, 30);
      if (!isLifecycleCurrent(generation)) return;
      mergeMessages(page.items.map(item => mapMessage(item, snapshot.value.self)));
      return;
    }
    const conversationId = frameString(data, 'convId');
    const seq = frameNumber(data, 'seq');
    const state = frameString(data, 'state');
    if (!conversationId || seq === undefined || !state || !['pending', 'done', 'expired'].includes(state)) return;
    let message = snapshot.value.messages.find(item => item.conversationId === conversationId && item.seq === seq);
    if (!message && activeId.value === conversationId) {
      const page = await caps.im.messages.listAround(conversationId, seq, 30);
      if (!isLifecycleCurrent(generation)) return;
      const mapped = page.items.map(item => mapMessage(item, snapshot.value.self));
      mergeMessages(mapped);
      message = snapshot.value.messages.find(item => item.conversationId === conversationId && item.seq === seq);
    }
    if (message?.card) message.card.state = state as 'pending' | 'done' | 'expired';
  }

  async function removeConversation(conversationId: string): Promise<void> {
    const wasActive = activeId.value === conversationId;
    snapshot.value.conversations = snapshot.value.conversations.filter(item => item.id !== conversationId);
    snapshot.value.messages = snapshot.value.messages.filter(item => item.conversationId !== conversationId);
    if (!wasActive) return;
    activeId.value = undefined;
    const nextId = sortConversations(snapshot.value.conversations)[0]?.id;
    if (nextId) await selectConversation(nextId);
  }

  async function handleWsMemberChange(data: unknown): Promise<void> {
    if (!caps || disposed) return;
    const generation = lifecycleGeneration;
    const record = frameRecord(data);
    const conversationId = frameString(data, 'convId');
    const kind = frameString(data, 'kind');
    if (!record || !conversationId || !kind) return;
    const targets = Array.isArray(record.targets)
      ? record.targets.flatMap(value => typeof value === 'string' ? [value] : typeof value === 'number' && Number.isSafeInteger(value) ? [String(value)] : [])
      : [];
    const selfRemoved = kind === 'dissolved' || (['kicked', 'left'].includes(kind) && Boolean(snapshot.value.self?.id && targets.includes(snapshot.value.self.id)));
    if (selfRemoved) { await removeConversation(conversationId); return; }
    try {
      const refreshed = await caps.im.conversations.get(conversationId);
      if (!isLifecycleCurrent(generation)) return;
      replaceConversation(mapConversation(refreshed));
    }
    catch { await removeConversation(conversationId); return; }
    if (activeId.value === conversationId) await loadGroupMembers();
  }

  async function refreshNotificationProjection(): Promise<void> {
    if (!caps || disposed) return;
    const generation = lifecycleGeneration;
    const conversation = snapshot.value.conversations.find(item => item.kind === 'system');
    if (!conversation) return;
    if (activeId.value === conversation.id) await loadNotifications(conversation.id, true);
    else {
      // 未打开系统通知会话时只拉未读数 + 最新一条（limit 1），同时刷新未读与会话时间。
      const [count, latest] = await Promise.all([
        caps.im.notifications.unreadCount(),
        caps.im.notifications.list({ offset: 0, limit: 1 })
      ]);
      if (!isLifecycleCurrent(generation)) return;
      conversation.unread = count;
      syncSystemConversationTime(conversation, latest.items[0]?.createdAt);
    }
  }

  async function resyncAll(): Promise<void> {
    if (disposed) return;
    if (resyncPromise) return resyncPromise;
    const generation = lifecycleGeneration;
    const guard = () => isLifecycleCurrent(generation);
    resyncPromise = (async () => {
      const ids = [...new Set(snapshot.value.conversations.map(item => item.id))];
      await runBounded(ids, 4, async id => {
        try { await syncConversation(id); }
        catch (error) { report(host, 'warn', 'im_next.resync_conversation_failed', { conversationId: id, message: error instanceof Error ? error.message : 'unknown' }); }
      });
      if (guard()) { await updateConversationPresence(guard); markPresenceSynced(); }
      // 重连补拉（resync）时同步刷新通讯录在线态；fire-and-forget，不拖慢 resyncAll 的整体完成时机。
      if (guard()) void updateDirectoryPresence(snapshot.value.directory, guard);
    })().finally(() => { resyncPromise = undefined; });
    return resyncPromise;
  }

  function startRealtime(): () => void {
    if (!caps || disposed) return () => {};
    if (realtimeCleanup) return realtimeCleanup;
    const run = (event: string, task: Promise<void>): void => { void task.catch(error => { if (!disposed) report(host, 'warn', 'im_next.realtime_event_failed', { event, message: error instanceof Error ? error.message : 'unknown' }); }); };
    const stops = [
      caps.ws.subscribe('im.message', data => { void handleWsMessage(data); }),
      caps.ws.subscribe('im.read', handleWsRead),
      caps.ws.subscribe('im.read.peer', handleWsReadPeer),
      caps.ws.subscribe('im.revoke', handleWsRevoke),
      caps.ws.subscribe('presence.update', handleWsPresenceUpdate),
      caps.ws.subscribe('card.update', data => { run('card.update', handleWsCardUpdate(data)); }),
      caps.ws.subscribe('im.member_change', data => { run('im.member_change', handleWsMemberChange(data)); }),
      caps.ws.subscribe('notify.push', () => { run('notify.push', refreshNotificationProjection()); }),
      caps.ws.subscribe('notify.revoke', () => { run('notify.revoke', refreshNotificationProjection()); }),
      caps.ws.subscribe('resync', () => { run('resync', resyncAll()); })
    ];
    const stopState = caps.ws.onStateChange(state => {
      if (state === 'open') run('connection.open', (async () => {
        // 先补送断线前已经观察到的最高值，再补拉消息；补拉完成后再兜底一次竞态窗口。
        await flushPendingDeliveredCursors();
        await resyncAll();
        await flushPendingDeliveredCursors();
      })());
    });
    const stopPolling = startPresencePolling();
    let stopped = false;
    const cleanup = () => {
      if (stopped) return;
      stopped = true;
      stops.forEach(stop => stop());
      stopState();
      stopPolling();
      if (realtimeCleanup === cleanup) realtimeCleanup = undefined;
    };
    realtimeCleanup = cleanup;
    return cleanup;
  }

  function dispose(): void {
    if (disposed) return;
    if (activeId.value) syncDraft(activeId.value, draft.value);
    disposed = true;
    lifecycleGeneration += 1;
    refreshRequest += 1;
    selectionRequest += 1;
    contactSearchRequest += 1;
    unifiedSearchRequest += 1;
    groupCandidateSearchRequest += 1;
    if (unifiedSearchTimer) clearTimeout(unifiedSearchTimer);
    unifiedSearchTimer = undefined;
    if (groupCandidateSearchTimer) clearTimeout(groupCandidateSearchTimer);
    groupCandidateSearchTimer = undefined;
    for (const state of deliveredCursors.values()) if (state.retryTimer) clearTimeout(state.retryTimer);
    deliveredCursors.clear();
    realtimeCleanup?.();
    for (const task of activeUploadTasks) task.cancel('controller_disposed');
    activeUploadTasks.clear();
    upload.value = undefined;
  }

  return {
    screen, snapshot, activeTab, query, drawerOpen, replyTo, draft, newMessageCount, isAtBottom, messageViewReady, loadError,
    historyLoading, upload, preview, groupMembers, groupMembersLoading, groupMembersError, groupOperation, groupRoleOperation,
    announcementText, announcementDraft, announcementLoading, groupGovernancePending, groupGovernanceError,
    highlightedSeq, contactSearchResults, unifiedSearch,
    groupCandidateQuery, groupCandidateSearch, groupCandidateSelectedIds, groupCandidateSelectedUsers,
    selectionMode, selectedMessageIds, selectedMessages, forwardOpen, forwardSources, forwardTargetIds, forwardResults,
    mentionUserIds, mentionAll, mentionCandidates, canMentionAll,
    activeConversation, messages, conversations, directory, conversationDrafts, contacts, loadedContacts, canWrite, isDepartment, canManageGroup, canInvite, canEditGroup, canLeaveGroup, canDissolveGroup, canGovernGroup, canMuteMember,
    refresh, selectConversation, loadHistory, fetchHistorySlice, fetchNotificationSlice, send, retry, sendFile, openAttachment, closePreview, setAtBottom, markMessageViewReady,
    expandDepartment, searchContacts, runUnifiedSearch, scheduleUnifiedSearch, resetGroupCandidateSearch, resetGroupCandidateSelection, toggleGroupCandidate, runGroupCandidateSearch, scheduleGroupCandidateSearch, openSearchConversation, openSearchMessage, focusAround,
    openUser, openDepartment, togglePinned, toggleMuted, hideConversation,
    addMention, addMentionAll, pruneMentions, setReply, locateReply, clearHighlight, canRevoke, revokeMessage, copyMessageText,
    canLoadReceipt, loadReadReceipt, toggleReaction, setReactionEmoji,
    setSelectionMode, toggleMessageSelection, openForward, closeForward, toggleForwardTarget, executeForward,
    loadGroupMembers, loadAnnouncement, queryPresence, markVisibleNotificationsRead, runNotificationCardAction, runMessageCardAction, createGroup, inviteGroupMembers, canKickMember, kickGroupMembers, canSetMemberAdmin, setGroupMemberAdmin, canTransferOwnership, transferGroupOwnership, updateGroupInfo,
    setGroupMuteAll, setGroupMemberSendMuted, saveAnnouncement, clearAnnouncement, leaveGroup, dissolveGroup,
    handleWsMessage, handleWsRead, handleWsReadPeer, handleWsRevoke, handleWsPresenceUpdate, handleWsCardUpdate, handleWsMemberChange, refreshNotificationProjection,
    resyncAll, startRealtime, dispose
  };
}

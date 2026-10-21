import type {
  AssetOpenDescriptor, AssetUploadInput, NahidaCategoryPreference, NahidaConversation, NahidaDndPreference,
  NahidaImClient, NahidaMessage, NahidaMessageContent, NahidaMessageKind, NahidaNotificationCategory
} from '@kimposoft/plugin-sdk/nahida-im';
import type { NahidaWSClient, NahidaWSState } from '@kimposoft/plugin-sdk/nahida-ws';
import type { OrgDept, OrgDirectoryClient, OrgMember } from '@kimposoft/plugin-sdk/org-directory';
import type { ImNextHostBridge } from '../host-bridge';

const timestamp = '2026-07-22T09:00:00.000Z';
const self: OrgMember = {
  userId: 'u-me', displayName: 'Current User', email: 'current.user@example.test', mobile: '13800000000', memberships: [
    { orgUnitId: 'd-rd', orgUnitName: 'R&D', primary: true },
    { orgUnitId: 'd-product', orgUnitName: 'Product', primary: false }
  ]
};
const peers: OrgMember[] = [
  { userId: 'u-lin', displayName: 'Lin', email: 'lin@example.test', mobile: '13800000001', memberships: [{ orgUnitId: 'd-rd', orgUnitName: 'R&D', primary: true }] },
  { userId: 'u-chen', displayName: 'Chen', email: 'chen@example.test', memberships: [
    { orgUnitId: 'd-rd', orgUnitName: 'R&D', primary: true },
    { orgUnitId: 'd-product', orgUnitName: 'Product', primary: false }
  ] }
];
const departments: OrgDept[] = [
  { id: 'd-rd', parentId: null, name: 'R&D', path: 'd-rd', childCount: 1, memberCount: 3 },
  { id: 'd-product', parentId: null, name: 'Product', path: 'd-product', childCount: 0, memberCount: 2 }
];
const childDepartments: OrgDept[] = [
  { id: 'd-platform', parentId: 'd-rd', name: 'Platform', path: 'd-rd/d-platform', childCount: 0, memberCount: 1 }
];

export const demoMessages: NahidaMessage[] = [
  { id: 'm1', conversationId: 'c-team', seq: 1, senderId: 'u-lin', senderDisplayName: 'Lin', clientMsgId: 'demo-1', kind: 'text', content: { text: 'Release checklist updated.' }, reactions: [{ emoji: '👍', count: 1, reactedByMe: false }], createdAt: timestamp },
  { id: 'm2', conversationId: 'c-team', seq: 2, senderId: 'u-chen', senderDisplayName: 'Chen', clientMsgId: 'demo-2', kind: 'file', content: { asset: { assetId: 'a-video', fileName: 'walkthrough.mp4', byteSize: 2048, mimeType: 'video/mp4' } }, createdAt: '2026-07-22T09:05:00.000Z' }
];

export const demoConversations: NahidaConversation[] = [
  { id: 'c-team', kind: 'department', displayName: 'R&D', department: { orgUnitId: 'd-rd', includeChildren: false }, memberCount: 23, lastSeq: 2, readSeq: 0, deliveredSeq: 2, mentionSeq: 0, unreadCount: 2, hasMention: false, muted: false, pinned: true, hidden: false, readonly: false, currentMemberRole: 'owner', currentMemberSource: 'organization', lastMessage: demoMessages[1], updatedAt: '2026-07-22T09:05:00.000Z' },
  { id: 'c-lin', kind: 'single', displayName: 'Lin', peerUserId: 'u-lin', memberCount: 2, lastSeq: 0, readSeq: 0, deliveredSeq: 0, mentionSeq: 0, unreadCount: 0, hasMention: false, muted: false, pinned: false, hidden: false, readonly: false, currentMemberRole: null, currentMemberSource: null, updatedAt: '2026-07-22T08:40:00.000Z' }
];

export interface DemoHarness {
  readonly host: ImNextHostBridge;
  readonly sent: Array<{ conversationId: string; clientMsgId: string; kind: string; content: NahidaMessageContent; mentions?: import('@kimposoft/plugin-sdk/nahida-im').NahidaMentions; replyToSeq?: number }>;
  readonly ackReads: Array<{ conversationId: string; seq: number }>;
  readonly ackDeliveries: Array<{ conversationId: string; seq: number }>;
  readonly beforeSeqs: number[];
  readonly aroundSeqs: number[];
  readonly sinceCalls: Array<{ conversationId: string; afterSeq: number }>;
  readonly uploads: AssetUploadInput[];
  readonly previews: AssetOpenDescriptor[];
  readonly groupActions: Array<{ action: 'leave' | 'dissolve'; conversationId: string }>;
  readonly reactionCalls: Array<{ messageId: string; emoji: string; active: boolean }>;
  readonly conversationActions: Array<{ action: 'patch' | 'hide'; conversationId: string; patch?: Record<string, boolean | undefined> }>;
  readonly revokedMessageIds: string[];
  readonly groupMemberCalls: string[];
  readonly orgCalls: Array<{ method: 'departments' | 'members'; id?: string; includeChildren?: false }>;
  readonly dndPreferenceUpdates: NahidaDndPreference[];
  readonly categoryPreferenceUpdates: Array<{ category: NahidaNotificationCategory; prefs: NahidaCategoryPreference }>;
  failNextSend(): void;
  failNextReaction(): void;
  pushIncoming(message: NahidaMessage): void;
  emitMessage(data: unknown): void;
  emit(kind: string, data: unknown): void;
  emitState(state: NahidaWSState): void;
  listenerCount(kind: string): number;
  stateListenerCount(): number;
}

export function createDemoHarness(): DemoHarness {
  const conversations = structuredClone(demoConversations);
  const messages = structuredClone(demoMessages);
  const sent: DemoHarness['sent'] = [];
  const ackReads: DemoHarness['ackReads'] = [];
  const ackDeliveries: DemoHarness['ackDeliveries'] = [];
  const beforeSeqs: number[] = [];
  const aroundSeqs: number[] = [];
  const sinceCalls: DemoHarness['sinceCalls'] = [];
  const uploads: AssetUploadInput[] = [];
  const previews: AssetOpenDescriptor[] = [];
  const groupActions: DemoHarness['groupActions'] = [];
  const wsHandlers = new Map<string, Set<(data: unknown) => void>>();
  const stateHandlers = new Set<(state: NahidaWSState) => void>();
  let shouldFailSend = false;
  let shouldFailReaction = false;
  const reactionCalls: DemoHarness['reactionCalls'] = [];
  const conversationActions: DemoHarness['conversationActions'] = [];
  const revokedMessageIds: string[] = [];
  const groupMemberCalls: string[] = [];
  const orgCalls: DemoHarness['orgCalls'] = [];
  const dndPreferenceUpdates: DemoHarness['dndPreferenceUpdates'] = [];
  const categoryPreferenceUpdates: DemoHarness['categoryPreferenceUpdates'] = [];
  let dndPreference: NahidaDndPreference = { enabled: false, startTime: null, endTime: null, timezone: 'Asia/Shanghai', urgentBypassDnd: true };
  let categoryPreferences: Record<NahidaNotificationCategory, NahidaCategoryPreference> = {
    chat: { inApp: true, mail: false, sms: false },
    todo: { inApp: true, mail: true, sms: false },
    mention: { inApp: true, mail: false, sms: false },
    announcement: { inApp: true, mail: false, sms: true },
    system: { inApp: true, mail: true, sms: false }
  };
  let currentAnnouncement: NahidaMessage | null = null;

  const im: NahidaImClient = {
    conversations: {
      async list() { return { items: structuredClone(conversations), nextCursor: null }; },
      async get(id) { const found = conversations.find(item => item.id === id); if (!found) throw new Error('conversation_not_found'); return structuredClone(found); },
      async createSingle() { return structuredClone(conversations[1]); },
      async createGroup() { return structuredClone(conversations[0]); },
      async patch(id, patch) { conversationActions.push({ action: 'patch', conversationId: id, patch: { ...patch } }); const item = conversations.find(value => value.id === id)!; Object.assign(item, patch); return structuredClone(item); },
      async hide(id) { conversationActions.push({ action: 'hide', conversationId: id }); },
      async getDepartmentConversation() { return structuredClone(conversations[0]); }
    },
    messages: {
      async listSince(conversationId, afterSeq) { sinceCalls.push({ conversationId, afterSeq }); const items = messages.filter(item => item.conversationId === conversationId && item.seq > afterSeq); return { items: structuredClone(items), nextCursor: null, latestSeq: Math.max(0, ...items.map(item => item.seq)) }; },
      async listBefore(conversationId, beforeSeq, limit = 100) { beforeSeqs.push(beforeSeq); const items = messages.filter(item => item.conversationId === conversationId && item.seq < beforeSeq).slice(-limit); return { items: structuredClone(items), nextCursor: null, latestSeq: Math.max(0, ...items.map(item => item.seq)) }; },
      async listAround(conversationId, aroundSeq) { aroundSeqs.push(aroundSeq); const items = messages.filter(item => item.conversationId === conversationId); return { items: structuredClone(items), nextCursor: null, latestSeq: Math.max(0, ...items.map(item => item.seq)) }; },
      async send(input) {
        sent.push({ conversationId: input.conversationId, clientMsgId: input.clientMsgId, kind: input.kind, content: input.content, mentions: input.mentions, replyToSeq: input.replyToSeq });
        if (shouldFailSend) { shouldFailSend = false; throw new Error('retryable_send_failure'); }
        const message: NahidaMessage = {
          id: `saved-${input.clientMsgId}`, conversationId: input.conversationId,
          seq: Math.max(0, ...messages.filter(item => item.conversationId === input.conversationId).map(item => item.seq)) + 1,
          senderId: self.userId, senderDisplayName: self.displayName, clientMsgId: input.clientMsgId,
          kind: input.kind as NahidaMessageKind, content: input.content, replyToSeq: input.replyToSeq, createdAt: new Date().toISOString()
        };
        messages.push(message);
        const conversation = conversations.find(item => item.id === input.conversationId);
        if (conversation) Object.assign(conversation, { lastSeq: message.seq, lastMessage: message, updatedAt: message.createdAt });
        return { message: structuredClone(message), isNew: true };
      },
      async revoke(id) { revokedMessageIds.push(id); }, async forward() { return { message: structuredClone(messages[0]), isNew: true }; },
      async setReaction(messageId, emoji, active) {
        reactionCalls.push({ messageId, emoji, active });
        if (shouldFailReaction) { shouldFailReaction = false; throw new Error('reaction_failed'); }
        return { emoji, count: active ? 2 : 0, reactedByMe: active };
      }, async listReactions() { return []; },
      async getReadReceipt() { return { mode: 'disabled' }; },
      async ackRead(conversationId, seq) { ackReads.push({ conversationId, seq }); },
      async ackDelivered(conversationId, seq) { ackDeliveries.push({ conversationId, seq }); },
      async cardAction() { return { state: 'agreed' as const }; }
    },
    groups: {
      async listMembers(conversationId) {
        groupMemberCalls.push(conversationId);
        return { items: [
          { userId: 'u-me', displayName: 'Current User', role: 'owner' as const, source: 'organization' as const, joinedAt: timestamp },
          { userId: 'u-lin', displayName: 'Lin', role: 'member' as const, source: 'organization' as const, joinedAt: timestamp }
        ], nextCursor: null };
      }, async addMembers() { return []; }, async kick() {}, async setRole() {},
      async setMuteAll(conversationId, enabled) {
        const conversation = conversations.find(item => item.id === conversationId);
        if (conversation) Object.assign(conversation, { muteAll: enabled });
        return { changed: true };
      },
      async setMemberSendMuted() { return { changed: true }; },
      async getAnnouncement() { return currentAnnouncement ? structuredClone(currentAnnouncement) : null; },
      async setAnnouncement(conversationId, input) {
        const message: NahidaMessage = {
          id: `announcement-${input.mutationId}`,
          conversationId,
          seq: Math.max(0, ...messages.filter(item => item.conversationId === conversationId).map(item => item.seq)) + 1,
          senderId: self.userId,
          senderDisplayName: self.displayName,
          clientMsgId: `announcement:${self.userId}:${input.mutationId}`,
          kind: 'system',
          content: { systemCode: 'IM_ANNOUNCEMENT_PUBLISHED', systemParams: { operator: self.displayName, text: input.text } },
          createdAt: new Date().toISOString()
        };
        currentAnnouncement = message;
        messages.push(message);
        return { message: structuredClone(message), isNew: true };
      },
      async clearAnnouncement(conversationId, mutationId) {
        const event: NahidaMessage = {
          id: `announcement-clear-${mutationId}`,
          conversationId,
          seq: Math.max(0, ...messages.filter(item => item.conversationId === conversationId).map(item => item.seq)) + 1,
          senderId: self.userId,
          senderDisplayName: self.displayName,
          clientMsgId: `announcement:${self.userId}:${mutationId}`,
          kind: 'system',
          content: { systemCode: 'IM_ANNOUNCEMENT_CLEARED' },
          createdAt: new Date().toISOString()
        };
        currentAnnouncement = null;
        messages.push(event);
        return { event: structuredClone(event), isNew: true };
      },
      async leave(conversationId) { groupActions.push({ action: 'leave', conversationId }); },
      async dissolve(conversationId) { groupActions.push({ action: 'dissolve', conversationId }); },
      async updateInfo() { return structuredClone(conversations[0]); }
    },
    search: {
      async searchUsers() { return { items: [], nextCursor: null }; }, async searchGroups() { return { items: [], nextCursor: null }; }, async searchConversations() { return { items: [], nextCursor: null }; }, async searchMessages() { return { items: [], nextCursor: null }; }
    },
    notifications: {
      async list() { return { items: [], total: 0, offset: 0, limit: 20 }; }, async unreadCount() { return 0; }, async markRead() { return 0; }, async cardAction() { return { forwarded: false }; }
    },
    presence: { async queryUsers() { return {}; } },
    preferences: {
      async getMuted() { return false; }, async updateMuted() {},
      async getPresenceMode() { return 'auto' as const; }, async updatePresenceMode() {},
      async getDnd() { return structuredClone(dndPreference); },
      async updateDnd(input) { dndPreferenceUpdates.push(structuredClone(input)); dndPreference = structuredClone(input); },
      async getCategoryPrefs() { return structuredClone(categoryPreferences); },
      async updateCategoryPrefs(category, prefs) {
        categoryPreferenceUpdates.push({ category, prefs: structuredClone(prefs) });
        categoryPreferences = { ...categoryPreferences, [category]: structuredClone(prefs) };
      }
    },
    assets: {
      upload(input) {
        uploads.push(input);
        const asset = { assetId: `asset-${uploads.length}`, fileName: input.fileName, byteSize: input.file.size, mimeType: input.mimeType };
        input.onProgress?.({ loadedBytes: input.file.size, totalBytes: input.file.size });
        return { uploadId: `upload-${uploads.length}`, result: Promise.resolve(asset), cancel() {} };
      },
      cancel() {},
      async openPreview(asset) {
        const kind = asset.mimeType.startsWith('image/') ? 'image' as const
          : asset.mimeType.startsWith('video/') ? 'video' as const
            : asset.mimeType.startsWith('text/') ? 'text' as const : 'download' as const;
        const descriptor: AssetOpenDescriptor = kind === 'text'
          ? { asset, kind, text: 'demo text', truncated: false, originalByteSize: asset.byteSize }
          : kind === 'download' ? { asset, kind } : { asset, kind, url: `/secure-preview/${asset.assetId}`, expiresAt: '2099-01-01T00:00:00Z' };
        previews.push(descriptor);
        return descriptor;
      },
      async getDownloadURL(asset) { return { url: `/secure-download/${asset.assetId}`, expiresAt: '2099-01-01T00:00:00Z', fileName: asset.fileName, mimeType: asset.mimeType }; }
    },
    time: { currentTimezone: () => 'Asia/Tokyo' },
    logger: { debug() {}, info() {}, warn() {}, error() {} }
  };

  const org: OrgDirectoryClient = {
    async listDepartments(parentId) {
      orgCalls.push({ method: 'departments', id: parentId });
      return structuredClone(parentId === 'd-rd' ? childDepartments : parentId ? [] : departments);
    },
    async listMembers(deptId, options) {
      if (options?.includeChildren !== false) throw new Error('includeChildren_must_be_false');
      orgCalls.push({ method: 'members', id: deptId, includeChildren: options.includeChildren });
      if (deptId === 'd-platform') return structuredClone([peers[0]]);
      return structuredClone([self, ...peers].filter(member => member.memberships.some(item => item.orgUnitId === deptId)));
    },
    async searchUsers() { return structuredClone([self, ...peers]); }, async me() { return structuredClone(self); }
  };
  let wsState: NahidaWSState = 'open';
  const ws: NahidaWSClient = {
    subscribe(kind, handler) { const handlers = wsHandlers.get(kind) ?? new Set(); handlers.add(handler); wsHandlers.set(kind, handlers); return () => handlers.delete(handler); },
    send() {}, getState() { return wsState; }, onStateChange(handler) { stateHandlers.add(handler); return () => stateHandlers.delete(handler); }
  };
  const host: ImNextHostBridge = { im, org, ws, locale: 'en-US' };
  return {
    host, sent, ackReads, ackDeliveries, beforeSeqs, aroundSeqs, sinceCalls, uploads, previews, groupActions, reactionCalls, conversationActions, revokedMessageIds, groupMemberCalls, orgCalls, dndPreferenceUpdates, categoryPreferenceUpdates,
    failNextSend() { shouldFailSend = true; },
    failNextReaction() { shouldFailReaction = true; },
    pushIncoming(message) {
      messages.push(structuredClone(message));
      const conversation = conversations.find(item => item.id === message.conversationId);
      if (conversation) Object.assign(conversation, { lastSeq: message.seq, unreadCount: conversation.unreadCount + 1, lastMessage: message, updatedAt: message.createdAt });
    },
    emitMessage(data) { wsHandlers.get('im.message')?.forEach(handler => handler(data)); },
    emit(kind, data) { wsHandlers.get(kind)?.forEach(handler => handler(data)); },
    emitState(state) { wsState = state; stateHandlers.forEach(handler => handler(state)); },
    listenerCount(kind) { return wsHandlers.get(kind)?.size ?? 0; },
    stateListenerCount() { return stateHandlers.size; }
  };
}

export function createDemoHostBridge(): ImNextHostBridge { return createDemoHarness().host; }

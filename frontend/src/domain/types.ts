/** UI model deliberately differs from a transport DTO; all IDs stay strings. */
/** busy=手动忙碌（服务端按 presence_mode 合成）；connecting 仅本端 WS 中间态 */
export type ConnectionState = 'online' | 'busy' | 'connecting' | 'offline';
export type ConversationKind = 'single' | 'group' | 'department' | 'system' | 'object';
export type MessageKind = 'text' | 'image' | 'file' | 'system' | 'card' | 'recall';
export type SendState = 'sending' | 'sent' | 'failed';

export interface UserMembership {
  orgUnitId: string;
  orgUnitName?: string;
  primary: boolean;
}
export interface User {
  id: string; name: string; avatar?: string; departments: string[]; presence?: ConnectionState;
  email?: string; mobile?: string; memberships?: UserMembership[];
}
export interface Conversation {
  id: string; title: string; avatar?: string; kind: ConversationKind; summary: string; updatedAt: string;
  unread: number; pinned?: boolean; muted?: boolean; connection?: ConnectionState; memberCount?: number; departmentId?: string;
  lastSeq: number; readSeq: number; mentionSeq?: number; hasMention?: boolean; peerUserId?: string; currentMemberRole?: 'member' | 'admin' | 'owner' | null; currentMemberSource?: 'manual' | 'organization' | 'business' | null; readonly?: boolean; allMuted?: boolean; currentMemberSendMuted?: boolean; announcementMessageId?: string; hidden?: boolean; archived?: boolean;
}
export interface GroupMember {
  userId: string; displayName: string; role: 'member' | 'admin' | 'owner'; source: 'manual' | 'organization' | 'business'; joinedAt: string; presence?: ConnectionState; sendMuted?: boolean;
}
export interface Attachment { assetId: string; fileName: string; byteSize: number; mimeType: string; width?: number; height?: number; durationMs?: number; checksumSha256?: string; }
export interface Reaction { emoji: string; count: number; mine?: boolean; }
export interface BusinessCard {
  cardType?: string; schemaVersion?: 1; rendererKey: string; title?: string; summary?: string; state?: 'pending' | 'done' | 'ignored' | 'agreed' | 'expired';
  link?: string; actions: Array<{ key: string; label: string; style?: 'default' | 'primary' | 'danger'; disabled?: boolean; requiresComment?: boolean }>;
  data: import('@kimposoft/plugin-sdk/nahida-im').NahidaJsonObject;
}
export interface Message {
  id: string; conversationId: string; seq: number; clientMsgId: string; sender: User; kind: MessageKind; text?: string; attachment?: Attachment;
  createdAt: string; editedAt?: string; sendState?: SendState; replyTo?: Pick<Message, 'id' | 'seq' | 'sender' | 'text'>; revoked?: boolean;
  reactions?: Reaction[]; systemCode?: string; systemParams?: import('@kimposoft/plugin-sdk/nahida-im').NahidaJsonObject; card?: BusinessCard;
  imagePreviewUrl?: string;
  mentions?: import('@kimposoft/plugin-sdk/nahida-im').NahidaMentions;
  receipt?: { status: 'loading' | 'ready' | 'error'; mode?: 'roster' | 'count' | 'disabled'; readCount?: number; readUserIds?: string[]; error?: string };
  notification?: { id: string; title: string; content: string; readAt: string | null; link?: string };
  cardAction?: { source: 'nahida-message'; state: 'pending' | 'ignored' | 'agreed' | 'expired'; busy?: boolean };
}
export interface OrgUnit {
  id: string; name: string; members: User[]; childCount: number; children: OrgUnit[];
  membersLoaded: boolean; childrenLoaded: boolean; loading?: boolean;
}
export interface ImViewState { conversations: Conversation[]; messages: Message[]; directory: OrgUnit[]; self?: User; }
export interface UnifiedSearchState {
  query: string; status: 'idle' | 'loading' | 'ready' | 'empty' | 'error'; error?: string;
  users: User[]; groups: Conversation[]; conversations: Conversation[]; messages: Message[];
}
export interface GroupCandidateSearchState {
  query: string; status: 'idle' | 'loading' | 'ready' | 'empty' | 'error'; error?: string; users: User[];
}
export interface ForwardTargetResult { conversationId: string; status: 'pending' | 'success' | 'failed'; error?: string; }
export interface GroupOperationState {
  status: 'idle' | 'pending' | 'success' | 'partial' | 'error';
  action?: 'create' | 'invite' | 'kick' | 'update';
  error?: string;
  succeededIds?: string[];
  failedIds?: string[];
}
export interface GroupRoleOperationState {
  status: 'idle' | 'pending' | 'success' | 'error';
  action?: 'grant-admin' | 'revoke-admin' | 'transfer-owner';
  userId?: string;
  error?: string;
}
export interface UploadState { uploadId: string; fileName: string; progress: number | null; cancel: () => void; }
export type PreviewState =
  | { status: 'closed' }
  | { status: 'loading'; asset: Attachment }
  | { status: 'ready'; asset: Attachment; descriptor: import('@kimposoft/plugin-sdk/nahida-im').AssetOpenDescriptor }
  | { status: 'error'; asset: Attachment; message: string };

export interface VirtualWindow { start: number; end: number; paddingTop: number; paddingBottom: number; }
export interface ListAnchor { id: string; offset: number; }

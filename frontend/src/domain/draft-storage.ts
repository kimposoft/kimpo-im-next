export interface ImDraftStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

interface StoredDraft { readonly version: 1; readonly text: string }
const MAX_DRAFT_LENGTH = 100_000;

export function draftStorageKey(userId: string, conversationId: string): string {
  return `kimpo_im_next_draft:${encodeURIComponent(userId)}:${encodeURIComponent(conversationId)}`;
}

/** legacy 插件使用未经 encodeURIComponent 的纯文本 key；只用于受控迁移和回退双写。 */
export function legacyDraftStorageKey(userId: string, conversationId: string): string {
  return `nahida_draft_${userId || 'anon'}_${conversationId}`;
}

function legacyDraftOwnerKey(userId: string, conversationId: string): string {
  return `kimpo_im_next_legacy_draft_owner:${encodeURIComponent(legacyDraftStorageKey(userId, conversationId))}`;
}

function legacyDraftOwner(userId: string, conversationId: string): string {
  return JSON.stringify([userId, conversationId]);
}

function validDraft(text: string): boolean {
  return Boolean(text.trim()) && text.length <= MAX_DRAFT_LENGTH;
}

function parseNextDraft(raw: string): string | undefined {
  try {
    const parsed = JSON.parse(raw) as Partial<StoredDraft>;
    return parsed.version === 1 && typeof parsed.text === 'string' && validDraft(parsed.text) ? parsed.text : undefined;
  } catch {
    return undefined;
  }
}

export function readStoredDraft(storage: ImDraftStorage | undefined, userId: string, conversationId: string): string | undefined {
  if (!storage || !userId || !conversationId) return undefined;
  try {
    const nextKey = draftStorageKey(userId, conversationId);
    const nextRaw = storage.getItem(nextKey);
    // next key 一旦存在就是唯一权威；坏 JSON 也不能回退到可能过期的 legacy 值。
    if (nextRaw !== null) return parseNextDraft(nextRaw);
    const legacyKey = legacyDraftStorageKey(userId, conversationId);
    const ownerKey = legacyDraftOwnerKey(userId, conversationId);
    const owner = storage.getItem(ownerKey);
    // 新版双写会留下可验证归属；不匹配时拒绝读取天然碰撞的 legacy raw key。
    if (owner !== null && owner !== legacyDraftOwner(userId, conversationId)) return undefined;
    const legacy = storage.getItem(legacyKey);
    if (legacy === null || !validDraft(legacy)) return undefined;
    try {
      // 旧 raw key 可能存在下划线碰撞，迁移只能复制到当前已知 next key，不能反推并登记 legacy 归属。
      storage.setItem(nextKey, JSON.stringify({ version: 1, text: legacy } satisfies StoredDraft));
    } catch {
      // 配额/隐私模式不能阻断本次从 legacy 恢复输入，后续读取仍可再次尝试迁移。
    }
    return legacy;
  } catch {
    return undefined;
  }
}

export function writeStoredDraft(storage: ImDraftStorage | undefined, userId: string, conversationId: string, text: string): void {
  if (!storage || !userId || !conversationId) return;
  const nextKey = draftStorageKey(userId, conversationId);
  const legacyKey = legacyDraftStorageKey(userId, conversationId);
  const ownerKey = legacyDraftOwnerKey(userId, conversationId);
  const owner = legacyDraftOwner(userId, conversationId);
  if (!text.trim()) {
    try { storage.removeItem(nextKey); } catch { /* Storage denial must not break input. */ }
    try {
      const currentOwner = storage.getItem(ownerKey);
      // 无元数据表示旧客户端遗留值；有元数据时只允许原所有者删除碰撞 key。
      if (currentOwner === null || currentOwner === owner) {
        storage.removeItem(legacyKey);
        storage.removeItem(ownerKey);
      }
    } catch { /* 回退键删除同样 best effort。 */ }
    return;
  }
  const normalized = text.slice(0, MAX_DRAFT_LENGTH);
  let nextWritten = false;
  let legacyWritten = false;
  try {
    storage.setItem(nextKey, JSON.stringify({ version: 1, text: normalized } satisfies StoredDraft));
    nextWritten = true;
  } catch { /* 继续尝试 legacy，使回退插件仍有机会恢复最新草稿。 */ }
  let legacyOwnerMatches = true;
  try {
    const currentOwner = storage.getItem(ownerKey);
    legacyOwnerMatches = currentOwner === null || currentOwner === owner;
  } catch { /* 无法核验元数据时仍保持 legacy best effort 行为。 */ }
  if (legacyOwnerMatches) {
    try {
      storage.setItem(legacyKey, normalized);
      legacyWritten = true;
      try { storage.setItem(ownerKey, owner); } catch { /* legacy 纯文本仍保持老客户端可读。 */ }
    } catch { /* next 已成功时，legacy 配额错误不能影响当前插件。 */ }
  }
  if (!nextWritten && legacyWritten) {
    // 避免旧 next 值继续遮住刚成功写入的 legacy 最新值。
    try { storage.removeItem(nextKey); } catch { /* best effort */ }
  }
}

export function hydrateStoredDrafts(
  storage: ImDraftStorage | undefined,
  userId: string,
  conversationIds: readonly string[]
): Map<string, string> {
  const drafts = new Map<string, string>();
  for (const conversationId of new Set(conversationIds)) {
    const draft = readStoredDraft(storage, userId, conversationId);
    if (draft !== undefined) drafts.set(conversationId, draft);
  }
  return drafts;
}

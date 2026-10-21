import { describe, expect, it } from 'vitest';
import { draftStorageKey, hydrateStoredDrafts, legacyDraftStorageKey, readStoredDraft, writeStoredDraft, type ImDraftStorage } from './draft-storage';

function memoryStorage(seed: Record<string, string> = {}): ImDraftStorage & { values: Map<string, string> } {
  const values = new Map(Object.entries(seed));
  return {
    values,
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value); },
    removeItem: key => { values.delete(key); }
  };
}

describe('per-user conversation draft storage', () => {
  it('isolates both user and conversation ids in the key', () => {
    expect(draftStorageKey('user/1', 'conv:2')).toBe('kimpo_im_next_draft:user%2F1:conv%3A2');
    expect(legacyDraftStorageKey('user/1', 'conv:2')).toBe('nahida_draft_user/1_conv:2');
    expect(draftStorageKey('user/2', 'conv:2')).not.toBe(draftStorageKey('user/1', 'conv:2'));
  });

  it('round-trips exact nonblank text and removes whitespace-only drafts', () => {
    const storage = memoryStorage();
    writeStoredDraft(storage, 'u1', 'c1', ' hello\n');
    expect(readStoredDraft(storage, 'u1', 'c1')).toBe(' hello\n');
    expect(storage.values.get(legacyDraftStorageKey('u1', 'c1'))).toBe(' hello\n');
    writeStoredDraft(storage, 'u1', 'c1', '   ');
    expect(storage.values.has(draftStorageKey('u1', 'c1'))).toBe(false);
    expect(storage.values.has(legacyDraftStorageKey('u1', 'c1'))).toBe(false);
  });

  it('migrates a legacy plain-text draft once and keeps next authoritative afterwards', () => {
    const nextKey = draftStorageKey('u/特殊', 'c:?/空 格');
    const legacyKey = legacyDraftStorageKey('u/特殊', 'c:?/空 格');
    const storage = memoryStorage({ [legacyKey]: 'legacy draft' });
    expect(readStoredDraft(storage, 'u/特殊', 'c:?/空 格')).toBe('legacy draft');
    expect(storage.values.get(nextKey)).toBe(JSON.stringify({ version: 1, text: 'legacy draft' }));

    storage.values.set(legacyKey, 'stale legacy');
    expect(readStoredDraft(storage, 'u/特殊', 'c:?/空 格')).toBe('legacy draft');
  });

  it('writes next JSON and legacy plain text together for rollback continuity', () => {
    const storage = memoryStorage();
    writeStoredDraft(storage, 'u%2F1', '会话/1', 'next latest');
    expect(storage.values.get(draftStorageKey('u%2F1', '会话/1'))).toBe(JSON.stringify({ version: 1, text: 'next latest' }));
    expect(storage.values.get(legacyDraftStorageKey('u%2F1', '会话/1'))).toBe('next latest');
  });

  it('uses verifiable owner metadata to reject new dual-write collisions without changing the legacy value format', () => {
    const storage = memoryStorage();
    expect(legacyDraftStorageKey('a_b', 'c')).toBe(legacyDraftStorageKey('a', 'b_c'));
    writeStoredDraft(storage, 'a_b', 'c', 'owner A');
    expect(readStoredDraft(storage, 'a', 'b_c')).toBeUndefined();

    writeStoredDraft(storage, 'a', 'b_c', 'owner B');
    expect(storage.values.get(legacyDraftStorageKey('a_b', 'c'))).toBe('owner A');
    expect(readStoredDraft(storage, 'a', 'b_c')).toBe('owner B');
    writeStoredDraft(storage, 'a_b', 'c', '');
    expect(storage.values.has(legacyDraftStorageKey('a', 'b_c'))).toBe(false);
    expect(readStoredDraft(storage, 'a_b', 'c')).toBeUndefined();
    expect(readStoredDraft(storage, 'a', 'b_c')).toBe('owner B');
  });

  it('never lets a legacy value override an existing next key, even when next is invalid', () => {
    const storage = memoryStorage({
      [draftStorageKey('u1', 'c1')]: '{broken',
      [legacyDraftStorageKey('u1', 'c1')]: 'must not leak through'
    });
    expect(readStoredDraft(storage, 'u1', 'c1')).toBeUndefined();
  });

  it('fails safely on corrupt JSON, wrong versions, quota failures and denied reads', () => {
    const key = draftStorageKey('u1', 'c1');
    expect(readStoredDraft(memoryStorage({ [key]: '{broken' }), 'u1', 'c1')).toBeUndefined();
    expect(readStoredDraft(memoryStorage({ [key]: JSON.stringify({ version: 2, text: 'leak' }) }), 'u1', 'c1')).toBeUndefined();
    const denied: ImDraftStorage = {
      getItem() { throw new Error('denied'); },
      setItem() { throw new Error('quota'); },
      removeItem() { throw new Error('denied'); }
    };
    expect(readStoredDraft(denied, 'u1', 'c1')).toBeUndefined();
    expect(() => writeStoredDraft(denied, 'u1', 'c1', 'safe')).not.toThrow();
  });

  it('enforces the same length limit for migration and both write formats', () => {
    const storage = memoryStorage({ [legacyDraftStorageKey('u1', 'too-long')]: 'x'.repeat(100_001) });
    expect(readStoredDraft(storage, 'u1', 'too-long')).toBeUndefined();
    writeStoredDraft(storage, 'u1', 'c1', 'y'.repeat(100_001));
    expect(JSON.parse(storage.values.get(draftStorageKey('u1', 'c1'))!).text).toHaveLength(100_000);
    expect(storage.values.get(legacyDraftStorageKey('u1', 'c1'))).toHaveLength(100_000);
  });

  it('falls back to the latest legacy value when only next writes hit quota', () => {
    const base = memoryStorage({ [draftStorageKey('u1', 'c1')]: JSON.stringify({ version: 1, text: 'stale' }) });
    const storage: ImDraftStorage = {
      getItem: base.getItem,
      setItem(key, value) {
        if (key === draftStorageKey('u1', 'c1')) throw new Error('next quota');
        base.setItem(key, value);
      },
      removeItem: base.removeItem
    };
    writeStoredDraft(storage, 'u1', 'c1', 'latest');
    expect(base.values.has(draftStorageKey('u1', 'c1'))).toBe(false);
    expect(readStoredDraft(storage, 'u1', 'c1')).toBe('latest');
  });

  it('hydrates only the current user and known conversations', () => {
    const storage = memoryStorage();
    writeStoredDraft(storage, 'u1', 'c1', 'mine');
    writeStoredDraft(storage, 'u2', 'c1', 'other account');
    writeStoredDraft(storage, 'u1', 'unknown', 'unknown conversation');
    expect([...hydrateStoredDrafts(storage, 'u1', ['c1', 'c2'])]).toEqual([['c1', 'mine']]);
  });
});

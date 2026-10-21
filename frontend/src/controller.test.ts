import { describe, expect, it, vi } from 'vitest';
import { isFreshAssetDescriptor, isSafePreviewURL, shouldSendFromKeydown, useImController } from './controller';
import { createDemoHarness, demoConversations } from './fixtures/demo';
import { draftStorageKey, legacyDraftStorageKey, writeStoredDraft, type ImDraftStorage } from './domain/draft-storage';

const flush = () => new Promise(resolve => setTimeout(resolve, 0));
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => { resolve = resolvePromise; reject = rejectPromise; });
  return { promise, resolve, reject };
}
function draftMemoryStorage(): ImDraftStorage & { values: Map<string, string>; writes: string[] } {
  const values = new Map<string, string>();
  const writes: string[] = [];
  return {
    values,
    writes,
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => { writes.push(key); values.set(key, value); },
    removeItem: key => { values.delete(key); }
  };
}

describe('message input IME guard', () => {
  it('does not send while an IME composition commits Enter', () => expect(shouldSendFromKeydown({ key: 'Enter', shiftKey: false, isComposing: true })).toBe(false));
  it('keeps Shift+Enter as a line break and sends a plain Enter', () => {
    expect(shouldSendFromKeydown({ key: 'Enter', shiftKey: true, isComposing: false })).toBe(false);
    expect(shouldSendFromKeydown({ key: 'Enter', shiftKey: false, isComposing: false })).toBe(true);
  });
});

describe('preview URL policy', () => {
  it('accepts explicit HTTP(S), blob and same-origin relative URLs but rejects scheme-relative and active schemes', () => {
    const origin = 'https://kimpo.example';
    expect(isSafePreviewURL('/assets/1', origin)).toBe(true);
    expect(isSafePreviewURL('../assets/1', origin)).toBe(true);
    expect(isSafePreviewURL('https://cdn.example/asset', origin)).toBe(true);
    expect(isSafePreviewURL('blob:https://kimpo.example/id', origin)).toBe(true);
    expect(isSafePreviewURL('//evil.example/asset', origin)).toBe(false);
    expect(isSafePreviewURL('javascript:alert(1)', origin)).toBe(false);
    expect(isSafePreviewURL('data:text/html,bad', origin)).toBe(false);
    expect(isSafePreviewURL('file:///tmp/bad', origin)).toBe(false);
  });

  it('rejects expired descriptors deterministically', () => {
    expect(isFreshAssetDescriptor('2026-07-22T00:00:01Z', Date.parse('2026-07-22T00:00:00Z'))).toBe(true);
    expect(isFreshAssetDescriptor('2026-07-21T23:59:59Z', Date.parse('2026-07-22T00:00:00Z'))).toBe(false);
    expect(isFreshAssetDescriptor('invalid', Date.parse('2026-07-22T00:00:00Z'))).toBe(false);
  });
});

describe('formal SDK controller orchestration', () => {
  it('fails closed when a capability proxy rejects access', async () => {
    const proxy = new Proxy({}, { get() { throw new Error('capability denied'); } });
    const controller = useImController(proxy);
    await controller.refresh();
    expect(controller.screen.value).toBe('error');
    expect(controller.loadError.value).toContain('im');
  });

  it('loads org.me and direct department members, preserving multi-department identity', async () => {
    const harness = createDemoHarness();
    const controller = useImController(harness.host);
    await controller.refresh();
    expect(controller.snapshot.value.self).toMatchObject({ id: 'u-me', name: 'Current User', email: 'current.user@example.test', mobile: '13800000000' });
    expect(controller.contacts.value.find(item => item.id === 'u-chen')).toMatchObject({
      email: 'chen@example.test', departments: ['R&D', 'Product'], memberships: [
        { orgUnitId: 'd-rd', orgUnitName: 'R&D', primary: true },
        { orgUnitId: 'd-product', orgUnitName: 'Product', primary: false }
      ]
    });
    expect(harness.orgCalls.filter(call => call.method === 'members').every(call => call.includeChildren === false)).toBe(true);
  });

  it('lazy-loads child departments and their direct members one level at a time', async () => {
    const harness = createDemoHarness();
    const controller = useImController(harness.host);
    await controller.refresh();
    const root = controller.snapshot.value.directory.find(unit => unit.id === 'd-rd')!;
    expect(root.children).toEqual([]);
    await controller.expandDepartment(root);
    expect(root.children.map(unit => unit.id)).toEqual(['d-platform']);
    await controller.expandDepartment(root.children[0]);
    expect(root.children[0].members.map(member => member.id)).toEqual(['u-lin']);
    expect(harness.orgCalls).toContainEqual({ method: 'departments', id: 'd-rd' });
    expect(harness.orgCalls).toContainEqual({ method: 'members', id: 'd-platform', includeChildren: false });
  });

  it('projects directory member presence from presenceById on refresh and after expanding a department, defaulting absent ids to offline', async () => {
    const harness = createDemoHarness();
    harness.host.im!.presence.queryUsers = async ids => Object.fromEntries(ids.filter(id => id === 'u-lin').map(id => [id, 'online' as const]));
    const controller = useImController(harness.host);
    await controller.refresh();
    // updateDirectoryPresence 是 fire-and-forget（refresh 不 await 它），resolve 时不保证已回写；flush 让其挂起的微任务落地。
    await flush();
    // presence 存储收敛后不再写在 snapshot.value.directory 的实体上；expandDepartment 仍然按
    // 结构（真实、可变）对象操作，presence 断言则改走投影版 controller.directory。
    const structuralRoot = controller.snapshot.value.directory.find(unit => unit.id === 'd-rd')!;
    let projectedRoot = controller.directory.value.find(unit => unit.id === 'd-rd')!;
    expect(projectedRoot.members.find(member => member.id === 'u-lin')?.presence).toBe('online');
    expect(projectedRoot.members.find(member => member.id === 'u-chen')?.presence).toBe('offline');
    await controller.expandDepartment(structuralRoot);
    await controller.expandDepartment(structuralRoot.children[0]);
    await flush();
    projectedRoot = controller.directory.value.find(unit => unit.id === 'd-rd')!;
    expect(projectedRoot.children[0].members.find(member => member.id === 'u-lin')?.presence).toBe('online');
  });

  // 反验目标（presence 存储收敛任务）：presence 此前直接写在 conversation.connection 实体字段上，
  // 而 mapConversation 从不映射该字段；syncConversation 等"整体替换实体"的路径（这里用一次
  // im.message WS 帧模拟）会用 mapConversation 的产物整体替换旧会话对象，把写在旧对象上的在线态
  // 一起冲掉。这条用例在修复前必须是红的：旧 conversations 计算属性直接暴露实体的 connection
  // 字段，WS 帧一到就被抹成 undefined；修复后 connection 改为从 presenceById 查表投影，
  // 不再受实体整体替换影响。
  it('keeps single-chat peer presence visible after an im.message frame replaces the conversation entity', async () => {
    const harness = createDemoHarness();
    harness.host.im!.presence.queryUsers = async ids => Object.fromEntries(ids.filter(id => id === 'u-lin').map(id => [id, 'online' as const]));
    const controller = useImController(harness.host);
    await controller.refresh();
    expect(controller.conversations.value.find(item => item.id === 'c-lin')?.connection).toBe('online');

    controller.startRealtime();
    harness.pushIncoming({
      id: 'presence-regression-1', conversationId: 'c-lin', seq: 1, senderId: 'u-lin', senderDisplayName: 'Lin',
      clientMsgId: 'presence-regression-1', kind: 'text', content: { text: 'hi again' }, createdAt: '2026-07-22T10:00:00.000Z'
    });
    harness.emitMessage({ convId: 'c-lin' });
    await flush();
    await flush();

    expect(controller.conversations.value.find(item => item.id === 'c-lin')?.connection).toBe('online');
    controller.dispose();
  });

  // 反验目标（presence 存储收敛任务，症状 1 的直接复现）：u-external 刻意不出现在任何部门/组织树
  // 里，只能通过通讯录搜索找到——这样它绝不会被 refresh()/updateDirectoryPresence 的"通讯录批量
  // 查询"顺带覆盖到（若用一个真实部门成员当靶子，即便不修 openUser，目录侧 fire-and-forget 查询
  // 也可能凑巧把它的在线态带出来，测试会因为错误的原因通过）。只有"把新会话带进视野"的路径
  // （openUser → selectConversation）主动补查才会给它带来在线态。这条用例在修复前必须是红的：
  // 旧 openUser 不触发任何 presence 查询，新单聊的 activeConversation.connection 恒为 undefined。
  it('resolves peer presence for a brand-new single conversation opened via openUser', async () => {
    const harness = createDemoHarness();
    const queriedIds: string[] = [];
    harness.host.im!.presence.queryUsers = async ids => {
      queriedIds.push(...ids);
      return Object.fromEntries(ids.filter(id => id === 'u-external').map(id => [id, 'online' as const]));
    };
    harness.host.org!.searchUsers = async () => [{ userId: 'u-external', displayName: 'External', memberships: [] }];
    harness.host.im!.conversations.createSingle = async () => ({
      id: 'c-external', kind: 'single', displayName: 'External', peerUserId: 'u-external', memberCount: 2,
      lastSeq: 0, readSeq: 0, deliveredSeq: 0, mentionSeq: 0, unreadCount: 0, hasMention: false,
      muted: false, pinned: false, hidden: false, readonly: false, currentMemberRole: null, currentMemberSource: null,
      updatedAt: '2026-07-22T08:40:00.000Z'
    });
    const controller = useImController(harness.host);
    await controller.refresh();
    await controller.searchContacts('External');
    expect(queriedIds).not.toContain('u-external');

    await controller.openUser(controller.contactSearchResults.value.find(user => user.id === 'u-external')!);

    expect(controller.activeConversation.value?.id).toBe('c-external');
    expect(controller.activeConversation.value?.connection).toBe('online');
    controller.dispose();
  });

  it('keeps a failed department expansion collapsed and retryable', async () => {
    const harness = createDemoHarness();
    const controller = useImController(harness.host);
    await controller.refresh();
    const original = harness.host.org!.listDepartments.bind(harness.host.org);
    let fail = true;
    harness.host.org!.listDepartments = async parentId => {
      if (parentId === 'd-rd' && fail) { fail = false; throw new Error('temporary_directory_failure'); }
      return original(parentId);
    };
    const root = controller.snapshot.value.directory.find(unit => unit.id === 'd-rd')!;
    await expect(controller.expandDepartment(root)).resolves.toBe(false);
    expect(root).toMatchObject({ loading: false, childrenLoaded: false, children: [] });
    await expect(controller.expandDepartment(root)).resolves.toBe(true);
    expect(root.children.map(unit => unit.id)).toEqual(['d-platform']);
  });

  it('opens stable single and department conversations from directory entries', async () => {
    const harness = createDemoHarness();
    const controller = useImController(harness.host);
    await controller.refresh();
    await controller.openUser(controller.contacts.value.find(user => user.id === 'u-lin')!);
    expect(controller.activeConversation.value?.id).toBe('c-lin');
    await controller.openDepartment(controller.snapshot.value.directory[0]);
    expect(controller.activeConversation.value).toMatchObject({ id: 'c-team', kind: 'department', departmentId: 'd-rd' });
  });

  it('debounces unified search for 300ms and sends only the latest keyword', async () => {
    vi.useFakeTimers();
    try {
      const harness = createDemoHarness();
      const keywords: string[] = [];
      harness.host.im!.search.searchUsers = async keyword => { keywords.push(keyword); return { items: [], nextCursor: null }; };
      const controller = useImController(harness.host);
      await controller.refresh();
      controller.scheduleUnifiedSearch('first');
      controller.scheduleUnifiedSearch('second');
      await vi.advanceTimersByTimeAsync(299);
      expect(keywords).toEqual([]);
      await vi.advanceTimersByTimeAsync(1);
      expect(keywords).toEqual(['second']);
    } finally { vi.useRealTimers(); }
  });

  it('ignores a stale unified-search response that resolves after the latest query', async () => {
    const harness = createDemoHarness();
    const pending = new Map<string, (value: { items: never[]; nextCursor: null }) => void>();
    harness.host.im!.search.searchUsers = keyword => new Promise(resolve => pending.set(keyword, resolve));
    const controller = useImController(harness.host);
    await controller.refresh();
    const oldSearch = controller.runUnifiedSearch('old');
    const newSearch = controller.runUnifiedSearch('new');
    pending.get('new')!({ items: [], nextCursor: null });
    await newSearch;
    pending.get('old')!({ items: [], nextCursor: null });
    await oldSearch;
    expect(controller.unifiedSearch.value.query).toBe('new');
    expect(controller.unifiedSearch.value.status).toBe('empty');
  });

  it('finds an unexpanded grandchild-only user, preserves memberships, and submits the selected user', async () => {
    const harness = createDemoHarness();
    harness.host.org!.searchUsers = async () => [
      { userId: 'u-deep', displayName: 'Deep User', memberships: [{ orgUnitId: 'd-grandchild', orgUnitName: 'Grandchild', primary: true }] },
      { userId: 'u-deep', displayName: 'Deep User', memberships: [{ orgUnitId: 'd-secondary', orgUnitName: 'Secondary', primary: false }] }
    ];
    const controller = useImController(harness.host);
    await controller.refresh();
    expect(controller.contacts.value.some(user => user.id === 'u-deep')).toBe(false);
    await controller.runGroupCandidateSearch('Deep');
    expect(controller.groupCandidateSearch.value).toMatchObject({ status: 'ready' });
    expect(controller.groupCandidateSearch.value.users).toEqual([{
      id: 'u-deep', name: 'Deep User', departments: ['Grandchild', 'Secondary'], memberships: [
        { orgUnitId: 'd-grandchild', orgUnitName: 'Grandchild', primary: true },
        { orgUnitId: 'd-secondary', orgUnitName: 'Secondary', primary: false }
      ]
    }]);
    controller.toggleGroupCandidate(controller.groupCandidateSearch.value.users[0]);
    let createInput: unknown;
    harness.host.im!.conversations.createGroup = async input => {
      createInput = input;
      return { ...demoConversations[0], id: 'deep-group', kind: 'group', displayName: input.name, currentMemberRole: 'owner', currentMemberSource: 'manual' };
    };
    await controller.createGroup('Deep group', [...controller.groupCandidateSelectedIds.value]);
    expect(createInput).toEqual({ name: 'Deep group', memberUserIds: ['u-deep'] });
  });

  it('never asks the service to create a conversation with self', async () => {
    const harness = createDemoHarness();
    const createSingle = vi.fn(harness.host.im!.conversations.createSingle.bind(harness.host.im!.conversations));
    harness.host.im!.conversations.createSingle = createSingle;
    const controller = useImController(harness.host);
    await controller.refresh();
    await controller.openUser(controller.snapshot.value.self!);
    expect(createSingle).not.toHaveBeenCalled();
  });

  it('debounces group candidate search, ignores late results, clears independently, and preserves selection', async () => {
    vi.useFakeTimers();
    try {
      const harness = createDemoHarness();
      type OrgSearchResult = Awaited<ReturnType<NonNullable<typeof harness.host.org>['searchUsers']>>;
      const pending = new Map<string, ReturnType<typeof deferred<OrgSearchResult>>>();
      harness.host.org!.searchUsers = keyword => {
        const request = deferred<OrgSearchResult>();
        pending.set(keyword, request);
        return request.promise;
      };
      const controller = useImController(harness.host);
      await controller.refresh();
      controller.scheduleGroupCandidateSearch('old');
      await vi.advanceTimersByTimeAsync(300);
      controller.scheduleGroupCandidateSearch('new');
      pending.get('old')!.resolve([{ userId: 'u-old', displayName: 'Old', memberships: [] }]);
      await Promise.resolve();
      await Promise.resolve();
      expect(controller.groupCandidateSearch.value).toEqual({ query: 'new', status: 'loading', users: [] });
      await vi.advanceTimersByTimeAsync(300);
      pending.get('new')!.resolve([{ userId: 'u-new', displayName: 'New', memberships: [{ orgUnitId: 'd-new', orgUnitName: 'New Dept', primary: true }] }]);
      await Promise.resolve();
      await Promise.resolve();
      expect(controller.groupCandidateSearch.value.users.map(user => user.id)).toEqual(['u-new']);
      controller.toggleGroupCandidate(controller.groupCandidateSearch.value.users[0]);
      controller.scheduleGroupCandidateSearch('');
      expect(controller.groupCandidateSearch.value).toEqual({ query: '', status: 'idle', users: [] });
      expect(controller.groupCandidateSelectedIds.value).toEqual(new Set(['u-new']));
      expect(controller.groupCandidateSelectedUsers.value.get('u-new')?.departments).toEqual(['New Dept']);
      controller.resetGroupCandidateSelection();
      expect(controller.groupCandidateSelectedIds.value).toEqual(new Set());
      expect(controller.groupCandidateSelectedUsers.value).toEqual(new Map());
    } finally { vi.useRealTimers(); }
  });

  it('cancels a pending group-candidate debounce on dispose', async () => {
    vi.useFakeTimers();
    try {
      const harness = createDemoHarness();
      const search = vi.fn(harness.host.org!.searchUsers.bind(harness.host.org));
      harness.host.org!.searchUsers = search;
      const controller = useImController(harness.host);
      await controller.refresh();
      controller.scheduleGroupCandidateSearch('never');
      controller.dispose();
      await vi.advanceTimersByTimeAsync(300);
      expect(search).not.toHaveBeenCalled();
    } finally { vi.useRealTimers(); }
  });

  it('reports empty and error group-candidate searches without coupling loaded contacts to the global query', async () => {
    const harness = createDemoHarness();
    const controller = useImController(harness.host);
    await controller.refresh();
    const loadedIds = controller.loadedContacts.value.map(user => user.id);
    controller.query.value = 'unrelated global query';
    expect(controller.loadedContacts.value.map(user => user.id)).toEqual(loadedIds);
    harness.host.org!.searchUsers = async () => [];
    await controller.runGroupCandidateSearch('missing');
    expect(controller.groupCandidateSearch.value).toEqual({ query: 'missing', status: 'empty', users: [] });
    harness.host.org!.searchUsers = async () => { throw new Error('directory_unavailable'); };
    await controller.runGroupCandidateSearch('error');
    expect(controller.groupCandidateSearch.value).toEqual({ query: 'error', status: 'error', error: 'directory_unavailable', users: [] });
  });

  it('uses listAround to replace the message window and leaves the viewport non-bottom', async () => {
    const harness = createDemoHarness();
    harness.host.im!.messages.listAround = async (conversationId, seq) => ({
      items: [{ id: 'located', conversationId, seq, senderId: 'u-lin', senderDisplayName: 'Lin', clientMsgId: 'located', kind: 'text', content: { text: 'needle' }, createdAt: '2026-07-22T11:00:00Z' }],
      nextCursor: null, latestSeq: seq
    });
    const controller = useImController(harness.host);
    await controller.refresh();
    const found = await controller.openSearchMessage({ id: 'search-hit', conversationId: 'c-lin', seq: 42, clientMsgId: 'hit', sender: { id: 'u-lin', name: 'Lin', departments: [] }, kind: 'text', text: 'needle', createdAt: '2026-07-22T11:00:00Z' });
    expect(found?.id).toBe('located');
    expect(controller.activeConversation.value?.id).toBe('c-lin');
    expect(controller.messages.value.map(item => item.id)).toEqual(['located']);
    expect(controller.highlightedSeq.value).toBe(42);
    expect(controller.isAtBottom.value).toBe(false);
    expect(harness.ackReads).toEqual([]);
  });

  it('reuses clientMsgId for retry and does not acknowledge before the rendered view is at bottom', async () => {
    const harness = createDemoHarness();
    const controller = useImController(harness.host, { clientMsgId: () => 'stable-client-id' });
    await controller.refresh();
    harness.failNextSend();
    controller.draft.value = 'retry me';
    await controller.send();
    const failed = controller.messages.value.find(item => item.clientMsgId === 'stable-client-id')!;
    expect(failed.sendState).toBe('failed');
    await controller.retry(failed);
    expect(harness.sent.map(item => item.clientMsgId)).toEqual(['stable-client-id', 'stable-client-id']);
    expect(controller.draft.value).toBe('');
    expect(harness.ackReads).toEqual([]);
    controller.setAtBottom(true);
    expect(harness.ackReads).toEqual([]);
    controller.markMessageViewReady();
    controller.setAtBottom(true);
    await flush();
    expect(harness.ackReads.at(-1)).toEqual({ conversationId: 'c-team', seq: 3 });
  });

  it('keeps a saved reply visible through WS reconciliation and preserves ordinary sends', async () => {
    const harness = createDemoHarness();
    let clientId = 0;
    const controller = useImController(harness.host, { clientMsgId: () => `reply-lifecycle-${++clientId}` });
    await controller.refresh();
    const source = controller.messages.value.find(item => item.id === 'm1')!;
    controller.setReply(source);
    controller.draft.value = 'saved reply';
    await controller.send();

    expect(harness.sent.at(-1)).toMatchObject({ clientMsgId: 'reply-lifecycle-1', replyToSeq: source.seq });
    expect(controller.messages.value.find(item => item.clientMsgId === 'reply-lifecycle-1')).toMatchObject({
      id: 'saved-reply-lifecycle-1', text: 'saved reply', sendState: 'sent', replyTo: { id: 'm1', seq: source.seq, text: source.text }
    });

    const savedReply = structuredClone(harness.sent.at(-1));
    harness.host.im!.messages.listSince = async () => ({
      items: [{
        id: 'saved-reply-lifecycle-1', conversationId: 'c-team', seq: 3, senderId: 'u-me', senderDisplayName: 'Current User',
        clientMsgId: 'reply-lifecycle-1', kind: 'text', content: savedReply!.content, replyToSeq: source.seq,
        createdAt: '2026-07-22T10:00:00.000Z'
      }],
      nextCursor: null,
      latestSeq: 3
    });
    await controller.handleWsMessage({ conversationId: 'c-team', seq: 3 });
    expect(controller.messages.value.find(item => item.clientMsgId === 'reply-lifecycle-1')).toMatchObject({
      text: 'saved reply', sendState: 'sent', replyTo: { id: 'm1', seq: source.seq, text: source.text }
    });

    controller.draft.value = 'ordinary send';
    await controller.send();
    expect(harness.sent.at(-1)).toMatchObject({ clientMsgId: 'reply-lifecycle-2', content: { text: 'ordinary send' }, replyToSeq: undefined });
    expect(controller.messages.value.find(item => item.clientMsgId === 'reply-lifecycle-2')).toMatchObject({ text: 'ordinary send', sendState: 'sent' });
  });

  it('loads the latest window from the conversation high-water mark instead of listSince zero', async () => {
    const harness = createDemoHarness();
    for (let seq = 3; seq <= 122; seq += 1) {
      harness.pushIncoming({
        id: `bulk-${seq}`, conversationId: 'c-team', seq, senderId: 'u-lin', senderDisplayName: 'Lin', clientMsgId: `bulk-${seq}`,
        kind: 'text', content: { text: `message ${seq}` }, createdAt: `2026-07-22T10:${String(seq % 60).padStart(2, '0')}:00.000Z`
      });
    }
    const controller = useImController(harness.host);
    await controller.refresh();
    expect(harness.beforeSeqs[0]).toBe(123);
    expect(harness.sinceCalls).toEqual([]);
    expect(controller.messages.value).toHaveLength(100);
    expect(controller.messages.value[0].seq).toBe(23);
    expect(controller.messages.value.at(-1)?.seq).toBe(122);
    expect(harness.ackReads).toEqual([]);
  });

  it('paginates history with beforeSeq', async () => {
    const harness = createDemoHarness();
    const controller = useImController(harness.host);
    await controller.refresh();
    controller.snapshot.value.messages = controller.snapshot.value.messages.filter(item => item.seq === 2);
    await controller.loadHistory();
    expect(harness.beforeSeqs.at(-1)).toBe(2);
  });

  it('uploads then sends a file asset without opening preview automatically', async () => {
    const harness = createDemoHarness();
    const controller = useImController(harness.host, { clientMsgId: () => 'file-client-id' });
    await controller.refresh();
    const file = new File(['video'], 'walkthrough.mp4', { type: 'video/mp4' });
    await controller.sendFile(file);
    expect(harness.uploads).toHaveLength(1);
    expect(harness.sent.at(-1)).toMatchObject({ clientMsgId: 'file-client-id', kind: 'file', content: { asset: { fileName: 'walkthrough.mp4', mimeType: 'video/mp4' } } });
    expect(harness.previews).toHaveLength(0);
    await controller.openAttachment(controller.messages.value.find(item => item.clientMsgId === 'file-client-id')!.attachment!);
    expect(harness.previews).toHaveLength(1);
    expect(controller.preview.value).toMatchObject({ status: 'ready', descriptor: { kind: 'video' } });
  });

  it('sends image MIME as an image message and prepares an authenticated thumbnail', async () => {
    const harness = createDemoHarness();
    const controller = useImController(harness.host, { clientMsgId: () => 'image-client-id' });
    await controller.refresh();
    await controller.sendFile(new File(['image'], 'diagram.png', { type: 'image/png' }));
    expect(harness.sent.at(-1)).toMatchObject({ clientMsgId: 'image-client-id', kind: 'image' });
    expect(controller.messages.value.find(item => item.clientMsgId === 'image-client-id')).toMatchObject({
      kind: 'image', imagePreviewUrl: '/secure-preview/asset-1'
    });
  });

  it('rejects unsafe preview URL schemes without navigating', async () => {
    const harness = createDemoHarness();
    harness.host.im!.assets.openPreview = async asset => ({ asset, kind: 'image', url: 'javascript:alert(1)' });
    const controller = useImController(harness.host);
    await controller.refresh();
    await controller.openAttachment({ assetId: 'unsafe', fileName: 'unsafe.png', byteSize: 1, mimeType: 'image/png' });
    expect(controller.preview.value).toMatchObject({ status: 'error', message: 'unsafe_preview_url' });
  });

  it('uses host text payloads and obtains a distinct signed descriptor for download fallback', async () => {
    const harness = createDemoHarness();
    const controller = useImController(harness.host);
    await controller.refresh();
    harness.host.im!.assets.openPreview = async asset => ({ asset, kind: 'text', text: 'safe UTF-8', truncated: true, originalByteSize: 300_000 });
    await controller.openAttachment({ assetId: 'text', fileName: 'readme.txt', byteSize: 300_000, mimeType: 'text/plain' });
    expect(controller.preview.value).toMatchObject({ status: 'ready', descriptor: { kind: 'text', text: 'safe UTF-8', truncated: true } });

    const getDownloadURL = vi.fn(async asset => ({ url: '/secure-download/archive.bin', expiresAt: '2099-01-01T00:00:00Z', fileName: asset.fileName, mimeType: asset.mimeType }));
    harness.host.im!.assets.openPreview = async asset => ({ asset, kind: 'download' });
    harness.host.im!.assets.getDownloadURL = getDownloadURL;
    await controller.openAttachment({ assetId: 'bin', fileName: 'archive.bin', byteSize: 1, mimeType: 'application/octet-stream' });
    expect(getDownloadURL).toHaveBeenCalledOnce();
    expect(controller.preview.value).toMatchObject({ status: 'ready', descriptor: { kind: 'download', url: '/secure-download/archive.bin' } });
  });

  it('fails closed for text descriptors with URLs and expired or dangerous download descriptors', async () => {
    const harness = createDemoHarness();
    const controller = useImController(harness.host);
    await controller.refresh();
    const asset = { assetId: 'text', fileName: 'readme.txt', byteSize: 1, mimeType: 'text/plain' };
    harness.host.im!.assets.openPreview = async () => ({ asset, kind: 'text', text: 'x', url: '/must-not-leak' });
    await controller.openAttachment(asset);
    expect(controller.preview.value).toMatchObject({ status: 'error', message: 'invalid_text_preview_descriptor' });

    harness.host.im!.assets.openPreview = async () => ({ asset, kind: 'download' });
    harness.host.im!.assets.getDownloadURL = async () => ({ url: 'javascript:alert(1)', expiresAt: '2000-01-01T00:00:00Z', fileName: asset.fileName, mimeType: asset.mimeType });
    await controller.openAttachment(asset);
    expect(controller.preview.value).toMatchObject({ status: 'error', message: 'expired_asset_descriptor' });
  });

  it('uses a WS message only as an incremental-pull trigger and refreshes unread/activity', async () => {
    const harness = createDemoHarness();
    const controller = useImController(harness.host);
    await controller.refresh();
    const stop = controller.startRealtime();
    harness.pushIncoming({ id: 'm3', conversationId: 'c-lin', seq: 1, senderId: 'u-lin', senderDisplayName: 'Lin', clientMsgId: 'incoming-1', kind: 'text', content: { text: 'incremental' }, createdAt: '2026-07-22T10:00:00.000Z' });
    harness.emitMessage({ conversationId: 'c-lin', seq: 1 });
    await flush();
    expect(harness.sinceCalls.at(-1)).toEqual({ conversationId: 'c-lin', afterSeq: 0 });
    expect(controller.snapshot.value.messages.some(item => item.clientMsgId === 'incoming-1')).toBe(true);
    expect(controller.snapshot.value.conversations.find(item => item.id === 'c-lin')).toMatchObject({ lastSeq: 1, unread: 1 });
    expect(controller.newMessageCount.value).toBe(0);
    stop();
  });

  it('counts only active-conversation WS messages while the user is away from the bottom', async () => {
    const harness = createDemoHarness();
    const controller = useImController(harness.host);
    await controller.refresh();
    controller.setAtBottom(false);
    harness.pushIncoming({ id: 'm3', conversationId: 'c-team', seq: 3, senderId: 'u-lin', senderDisplayName: 'Lin', clientMsgId: 'active-incoming', kind: 'text', content: { text: 'new' }, createdAt: '2026-07-22T10:00:00.000Z' });
    await controller.handleWsMessage({ conversationId: 'c-team', seq: 3 });
    expect(controller.newMessageCount.value).toBe(1);
    controller.setAtBottom(true);
    expect(controller.newMessageCount.value).toBe(0);
  });

  it('does not ack a newly pulled message until the rendered viewport reports bottom again', async () => {
    const harness = createDemoHarness();
    const controller = useImController(harness.host);
    await controller.refresh();
    controller.markMessageViewReady();
    controller.setAtBottom(true);
    await flush();
    expect(harness.ackReads.at(-1)?.seq).toBe(2);
    harness.pushIncoming({ id: 'm3', conversationId: 'c-team', seq: 3, senderId: 'u-lin', senderDisplayName: 'Lin', clientMsgId: 'post-render', kind: 'text', content: { text: 'new' }, createdAt: '2026-07-22T10:00:00.000Z' });
    await controller.handleWsMessage({ conversationId: 'c-team', seq: 3 });
    expect(harness.ackReads.at(-1)?.seq).toBe(2);
    controller.setAtBottom(true);
    await flush();
    expect(harness.ackReads.at(-1)?.seq).toBe(3);
  });

  it('optimistically toggles reactions and rolls back on failure', async () => {
    const harness = createDemoHarness();
    const controller = useImController(harness.host);
    await controller.refresh();
    const message = controller.messages.value.find(item => item.id === 'm1')!;
    const reaction = message.reactions![0];
    await controller.toggleReaction(message, reaction);
    expect(reaction).toMatchObject({ mine: true, count: 2 });
    harness.failNextReaction();
    await expect(controller.toggleReaction(message, reaction)).rejects.toThrow('reaction_failed');
    expect(reaction).toMatchObject({ mine: true, count: 2 });
  });

  it('adds and removes a reaction through the formal reaction SDK', async () => {
    const harness = createDemoHarness();
    const controller = useImController(harness.host);
    await controller.refresh();
    const message = controller.messages.value.find(item => item.id === 'm1')!;
    await controller.setReactionEmoji(message, '🎉');
    expect(message.reactions).toContainEqual({ emoji: '🎉', count: 2, mine: true });
    await controller.setReactionEmoji(message, '🎉');
    expect(message.reactions?.find(item => item.emoji === '🎉')).toMatchObject({ count: 0, mine: false });
    expect(harness.reactionCalls.slice(-2)).toEqual([
      { messageId: 'm1', emoji: '🎉', active: true },
      { messageId: 'm1', emoji: '🎉', active: false }
    ]);
  });

  it('keeps per-message forward client IDs stable across retries and reports partial target failures', async () => {
    const harness = createDemoHarness();
    const calls: Array<{ target: string; clientMsgId: string; seq: number }> = [];
    harness.host.im!.messages.forward = async input => {
      calls.push({ target: input.conversationId, clientMsgId: input.clientMsgId, seq: input.source.seq });
      if (input.conversationId === 'c-lin') throw new Error('backend_forward_denied');
      return { message: { id: 'forwarded', conversationId: input.conversationId, seq: 9, senderId: 'u-me', clientMsgId: input.clientMsgId, kind: 'text', content: { text: 'forwarded' }, createdAt: '2026-07-22T12:00:00Z' }, isNew: true };
    };
    let id = 0;
    const controller = useImController(harness.host, { clientMsgId: () => `forward-id-${++id}` });
    await controller.refresh();
    controller.openForward([controller.messages.value.find(item => item.id === 'm1')!]);
    controller.toggleForwardTarget('c-team');
    controller.toggleForwardTarget('c-lin');
    await controller.executeForward('individual');
    const firstIds = calls.map(call => call.clientMsgId);
    expect(controller.forwardResults.value).toEqual([
      { conversationId: 'c-team', status: 'success', error: undefined },
      { conversationId: 'c-lin', status: 'failed', error: 'backend_forward_denied' }
    ]);
    await controller.executeForward('individual');
    expect(calls.slice(2).map(call => call.clientMsgId)).toEqual(firstIds);
  });

  it('maintains multi-select state in seq order and sends the fixed merged-message card', async () => {
    const harness = createDemoHarness();
    const controller = useImController(harness.host, { clientMsgId: (() => { let id = 0; return () => `merge-${++id}`; })() });
    await controller.refresh();
    const first = controller.messages.value.find(item => item.id === 'm1')!;
    const second = controller.messages.value.find(item => item.id === 'm2')!;
    controller.setSelectionMode(true);
    controller.toggleMessageSelection(second);
    controller.toggleMessageSelection(first);
    expect(controller.selectedMessages.value.map(item => item.seq)).toEqual([1, 2]);
    controller.openForward(controller.selectedMessages.value);
    controller.toggleForwardTarget('c-lin');
    await controller.executeForward('merged');
    expect(harness.sent.at(-1)).toMatchObject({
      conversationId: 'c-lin', kind: 'card',
      content: { card: { rendererKey: 'im.merged_messages', data: { items: [{ seq: 1, msgType: 0 }, { seq: 2, msgType: 2 }] } } }
    });
    controller.setSelectionMode(false);
    expect(controller.selectedMessageIds.value.size).toBe(0);
  });

  it('patches conversation preferences optimistically, rolls back failures, and blocks system mute/hide', async () => {
    const harness = createDemoHarness();
    const controller = useImController(harness.host);
    await controller.refresh();
    let conversation = controller.snapshot.value.conversations.find(item => item.id === 'c-team')!;
    await controller.togglePinned(conversation);
    conversation = controller.snapshot.value.conversations.find(item => item.id === 'c-team')!;
    expect(conversation.pinned).toBe(false);
    expect(harness.conversationActions.at(-1)).toMatchObject({ action: 'patch', conversationId: 'c-team', patch: { pinned: false } });

    harness.host.im!.conversations.patch = async () => { throw new Error('patch_failed'); };
    await expect(controller.toggleMuted(conversation)).rejects.toThrow('patch_failed');
    expect(conversation.muted).toBe(false);

    const other = controller.snapshot.value.conversations.find(item => item.id === 'c-lin')!;
    await controller.hideConversation(other);
    expect(controller.snapshot.value.conversations.some(item => item.id === 'c-lin')).toBe(false);
    expect(harness.conversationActions).toContainEqual({ action: 'hide', conversationId: 'c-lin' });

    conversation.kind = 'system';
    const before = harness.conversationActions.length;
    await controller.toggleMuted(conversation);
    await controller.hideConversation(conversation);
    expect(harness.conversationActions).toHaveLength(before);
  });

  it('keeps drafts isolated by conversation and restores them on switch', async () => {
    const harness = createDemoHarness();
    const controller = useImController(harness.host);
    await controller.refresh();
    controller.draft.value = 'team draft';
    await controller.selectConversation('c-lin');
    expect(controller.draft.value).toBe('');
    controller.draft.value = 'lin draft';
    await controller.selectConversation('c-team');
    expect(controller.draft.value).toBe('team draft');
    await controller.selectConversation('c-lin');
    expect(controller.draft.value).toBe('lin draft');
  });

  it('hydrates persisted drafts only after self and conversations identify the owner', async () => {
    const storage = draftMemoryStorage();
    writeStoredDraft(storage, 'u-me', 'c-team', 'persisted team draft');
    writeStoredDraft(storage, 'other-user', 'c-team', 'must not leak');
    const controller = useImController(createDemoHarness().host, { draftStorage: storage });
    expect(controller.conversationDrafts.value.size).toBe(0);
    await controller.refresh();
    expect(controller.draft.value).toBe('persisted team draft');
    expect(controller.conversationDrafts.value.get('c-team')).toBe('persisted team draft');
    expect([...controller.conversationDrafts.value.values()]).not.toContain('must not leak');
  });

  it('persists input immediately, keeps failed sends, and deletes only an unchanged successful draft', async () => {
    const storage = draftMemoryStorage();
    const harness = createDemoHarness();
    const controller = useImController(harness.host, { draftStorage: storage, clientMsgId: () => `draft-${harness.sent.length}` });
    await controller.refresh();
    const key = draftStorageKey('u-me', 'c-team');
    const authoritativeSummary = controller.activeConversation.value?.summary;
    controller.draft.value = 'send me';
    expect(storage.values.has(key)).toBe(true);
    expect(controller.activeConversation.value?.summary).toBe(authoritativeSummary);

    harness.failNextSend();
    await controller.send();
    expect(controller.draft.value).toBe('send me');
    expect(storage.values.has(key)).toBe(true);

    await controller.send();
    expect(controller.draft.value).toBe('');
    expect(storage.values.has(key)).toBe(false);
    expect(controller.conversationDrafts.value.has('c-team')).toBe(false);
  });

  it('does not save whitespace and synchronizes the last active draft again during dispose', async () => {
    const storage = draftMemoryStorage();
    const controller = useImController(createDemoHarness().host, { draftStorage: storage });
    await controller.refresh();
    controller.draft.value = '   ';
    expect(storage.values.has(draftStorageKey('u-me', 'c-team'))).toBe(false);
    controller.draft.value = 'last synchronous draft';
    const nextKey = draftStorageKey('u-me', 'c-team');
    const legacyKey = legacyDraftStorageKey('u-me', 'c-team');
    const nextWritesBeforeDispose = storage.writes.filter(key => key === nextKey).length;
    const legacyWritesBeforeDispose = storage.writes.filter(key => key === legacyKey).length;
    controller.dispose();
    expect(storage.writes.filter(key => key === nextKey)).toHaveLength(nextWritesBeforeDispose + 1);
    expect(storage.writes.filter(key => key === legacyKey)).toHaveLength(legacyWritesBeforeDispose + 1);
    expect(storage.values.has(nextKey)).toBe(true);
    expect(storage.values.get(legacyKey)).toBe('last synchronous draft');
  });

  it('restores a hidden conversation when the hide SDK call fails', async () => {
    const harness = createDemoHarness();
    harness.host.im!.conversations.hide = async () => { throw new Error('hide_failed'); };
    const controller = useImController(harness.host);
    await controller.refresh();
    const conversation = controller.snapshot.value.conversations.find(item => item.id === 'c-lin')!;
    await expect(controller.hideConversation(conversation)).rejects.toThrow('hide_failed');
    expect(controller.snapshot.value.conversations.some(item => item.id === 'c-lin')).toBe(true);
    expect(controller.activeConversation.value?.id).toBe('c-team');
  });

  it('filters host-returned hidden conversations without treating them as archived', async () => {
    const harness = createDemoHarness();
    const originalList = harness.host.im!.conversations.list.bind(harness.host.im!.conversations);
    harness.host.im!.conversations.list = async request => {
      const page = await originalList(request);
      return { ...page, items: page.items.map(item => item.id === 'c-lin' ? { ...item, hidden: true } : item) };
    };
    const controller = useImController(harness.host);
    await controller.refresh();
    expect(controller.snapshot.value.conversations.some(item => item.id === 'c-lin')).toBe(false);
    expect(controller.activeConversation.value).toMatchObject({ id: 'c-team', archived: false, hidden: false });
  });

  it('separates reply composition from quote location and uses listAround only for cache misses', async () => {
    const harness = createDemoHarness();
    harness.pushIncoming({
      id: 'm3', conversationId: 'c-team', seq: 3, senderId: 'u-chen', senderDisplayName: 'Chen', clientMsgId: 'reply-1',
      kind: 'text', content: { text: 'reply' }, replyToSeq: 1, createdAt: '2026-07-22T10:00:00.000Z'
    });
    const controller = useImController(harness.host);
    await controller.refresh();
    const reply = controller.messages.value.find(item => item.id === 'm3')!;
    expect(reply.replyTo).toMatchObject({ id: 'm1', sender: { name: 'Lin' }, text: 'Release checklist updated.' });
    expect((await controller.locateReply(reply))?.id).toBe('m1');
    expect(controller.highlightedSeq.value).toBe(1);
    expect(controller.replyTo.value).toBeUndefined();
    controller.setReply(reply);
    expect(controller.replyTo.value?.id).toBe('m3');
    reply.replyTo = { ...reply.replyTo!, seq: 999 };
    expect(await controller.locateReply(reply)).toBeUndefined();
    expect(harness.aroundSeqs).toEqual([999]);
  });

  it('copies text with an injected clipboard writer and revokes own messages to a tombstone', async () => {
    const harness = createDemoHarness();
    const controller = useImController(harness.host, { clientMsgId: () => 'mine-1' });
    await controller.refresh();
    controller.draft.value = 'owned text';
    await controller.send();
    const message = controller.messages.value.find(item => item.clientMsgId === 'mine-1')!;
    let copied = '';
    await controller.copyMessageText(message, async text => { copied = text; });
    expect(copied).toBe('owned text');
    expect(controller.canRevoke(message)).toBe(true);
    await controller.revokeMessage(message);
    expect(harness.revokedMessageIds).toEqual([message.id]);
    expect(message).toMatchObject({ kind: 'recall', revoked: true });
    expect(message.text).toBeUndefined();
  });

  it('refuses to revoke a message older than the two-minute window', async () => {
    const harness = createDemoHarness();
    const controller = useImController(harness.host, { clientMsgId: () => 'mine-old' });
    await controller.refresh();
    controller.draft.value = 'aged text';
    await controller.send();
    const message = controller.messages.value.find(item => item.clientMsgId === 'mine-old')!;
    // 刚发出：窗口内可撤回；把 createdAt 拨回 2 分钟零 1 秒前：过窗不可撤回
    expect(controller.canRevoke(message)).toBe(true);
    message.createdAt = new Date(Date.now() - (2 * 60_000 + 1_000)).toISOString();
    expect(controller.canRevoke(message)).toBe(false);
    await controller.revokeMessage(message);
    expect(harness.revokedMessageIds).toEqual([]);
  });

  it('loads actual group members from groups.listMembers for ordinary and department groups', async () => {
    const harness = createDemoHarness();
    const controller = useImController(harness.host);
    await controller.refresh();
    expect(harness.groupMemberCalls).toEqual(['c-team']);
    expect(controller.groupMembers.value).toEqual(expect.arrayContaining([
      expect.objectContaining({ userId: 'u-me', role: 'owner', source: 'organization' }),
      expect.objectContaining({ userId: 'u-lin', role: 'member', source: 'organization' })
    ]));
    controller.activeConversation.value!.kind = 'group';
    await controller.loadGroupMembers();
    expect(harness.groupMemberCalls).toEqual(['c-team', 'c-team']);
  });

  it('orchestrates mute-all, owner-only member mute, and authoritative announcements through the SDK', async () => {
    const harness = createDemoHarness();
    let mutation = 0;
    const setMuteAll = vi.fn(harness.host.im!.groups.setMuteAll.bind(harness.host.im!.groups));
    const setMemberSendMuted = vi.fn(harness.host.im!.groups.setMemberSendMuted.bind(harness.host.im!.groups));
    harness.host.im!.groups.setMuteAll = setMuteAll;
    harness.host.im!.groups.setMemberSendMuted = setMemberSendMuted;
    const controller = useImController(harness.host, { clientMsgId: () => `governance-${++mutation}` });
    await controller.refresh();

    expect(controller.canGovernGroup.value).toBe(true);
    expect(controller.canMuteMember.value).toBe(true);
    await controller.setGroupMuteAll(true);
    expect(setMuteAll).toHaveBeenCalledWith('c-team', true);
    expect(controller.activeConversation.value?.allMuted).toBe(true);

    const member = controller.groupMembers.value.find(item => item.userId === 'u-lin')!;
    await controller.setGroupMemberSendMuted(member, true);
    expect(setMemberSendMuted).toHaveBeenCalledWith('c-team', 'u-lin', true);
    // groupMembers 现在是"读时按 presenceById 投影"的 computed，返回的是克隆对象；乐观更新落在
    // groupMembersState 的真实对象上，断言需要重新从 groupMembers 里取最新值，不能再假设拿到手的
    // member 引用会被原地改写。
    expect(controller.groupMembers.value.find(item => item.userId === 'u-lin')?.sendMuted).toBe(true);

    controller.announcementDraft.value = 'Ship at 17:00';
    await controller.saveAnnouncement();
    expect(controller.announcementText.value).toBe('Ship at 17:00');
    expect((await harness.host.im!.groups.getAnnouncement('c-team'))?.content.systemParams?.text).toBe('Ship at 17:00');
    await controller.clearAnnouncement();
    expect(controller.announcementText.value).toBe('');
    expect(await harness.host.im!.groups.getAnnouncement('c-team')).toBeNull();
  });

  it('does not let a fail-closed disconnected ack collapse REST refresh', async () => {
    const harness = createDemoHarness();
    harness.host.im!.messages.ackRead = async () => {
      throw Object.assign(new Error('disconnected'), { code: 'NAHIDA_CAPABILITY_UNAVAILABLE', retryable: false });
    };
    const controller = useImController(harness.host);
    await controller.refresh();
    controller.markMessageViewReady();
    controller.setAtBottom(true);
    await flush();
    expect(controller.screen.value).toBe('ready');
  });

  it('advances delivered from the initial authoritative snapshot without changing read state', async () => {
    const harness = createDemoHarness();
    const originalList = harness.host.im!.conversations.list.bind(harness.host.im!.conversations);
    harness.host.im!.conversations.list = async request => {
      const page = await originalList(request);
      return {
        ...page,
        items: page.items.map(item => item.id === 'c-team' ? { ...item, deliveredSeq: 0 } : item)
      };
    };
    const controller = useImController(harness.host);

    await controller.refresh();
    await flush();

    expect(harness.ackDeliveries).toEqual([{ conversationId: 'c-team', seq: 2 }]);
    expect(harness.ackReads).toEqual([]);
    expect(controller.snapshot.value.messages.map(item => item.seq)).toEqual([1, 2]);
    controller.dispose();
  });

  it('acks an invisible conversation monotonically across WS duplicates and out-of-order messages', async () => {
    const harness = createDemoHarness();
    const controller = useImController(harness.host);
    await controller.refresh();
    controller.startRealtime();
    harness.pushIncoming({
      id: 'hidden-new', conversationId: 'c-lin', seq: 5, senderId: 'u-lin', senderDisplayName: 'Lin',
      clientMsgId: 'hidden-new', kind: 'text', content: { text: 'new' }, createdAt: '2026-07-22T10:05:00.000Z'
    });

    await controller.handleWsMessage({ convId: 'c-lin' });
    await flush();
    harness.pushIncoming({
      id: 'hidden-old', conversationId: 'c-lin', seq: 3, senderId: 'u-lin', senderDisplayName: 'Lin',
      clientMsgId: 'hidden-old', kind: 'text', content: { text: 'old' }, createdAt: '2026-07-22T10:03:00.000Z'
    });
    await controller.handleWsMessage({ convId: 'c-lin' });
    await controller.handleWsMessage({ convId: 'c-lin' });
    await flush();

    expect(controller.activeConversation.value?.id).toBe('c-team');
    expect(harness.ackDeliveries).toEqual([{ conversationId: 'c-lin', seq: 5 }]);
    expect(harness.ackReads).toEqual([]);
    controller.dispose();
  });

  it('retains the highest delivered seq while disconnected and flushes it after reconnect', async () => {
    const harness = createDemoHarness();
    const controller = useImController(harness.host);
    await controller.refresh();
    controller.startRealtime();
    harness.emitState('disconnected');
    harness.pushIncoming({
      id: 'offline-4', conversationId: 'c-lin', seq: 4, senderId: 'u-lin', senderDisplayName: 'Lin',
      clientMsgId: 'offline-4', kind: 'text', content: { text: 'offline' }, createdAt: '2026-07-22T10:04:00.000Z'
    });

    await controller.handleWsMessage({ convId: 'c-lin' });
    await flush();
    expect(harness.ackDeliveries).toEqual([]);

    harness.emitState('open');
    await flush();
    await flush();
    expect(harness.ackDeliveries).toEqual([{ conversationId: 'c-lin', seq: 4 }]);
    expect(harness.ackReads).toEqual([]);
    controller.dispose();
  });

  it('retries a failed delivered ack without blocking the authoritative message projection', async () => {
    const harness = createDemoHarness();
    let attempts = 0;
    harness.host.im!.messages.ackDelivered = async (conversationId, seq) => {
      attempts += 1;
      if (attempts === 1) throw new Error('temporary_ack_failure');
      harness.ackDeliveries.push({ conversationId, seq });
    };
    const controller = useImController(harness.host);
    await controller.refresh();
    controller.startRealtime();
    harness.pushIncoming({
      id: 'retry-6', conversationId: 'c-lin', seq: 6, senderId: 'u-lin', senderDisplayName: 'Lin',
      clientMsgId: 'retry-6', kind: 'text', content: { text: 'retry' }, createdAt: '2026-07-22T10:06:00.000Z'
    });

    await controller.handleWsMessage({ convId: 'c-lin' });
    await flush();
    expect(controller.snapshot.value.messages.some(item => item.id === 'retry-6')).toBe(true);
    expect(harness.ackDeliveries).toEqual([]);

    await new Promise(resolve => setTimeout(resolve, 300));
    expect(attempts).toBe(2);
    expect(harness.ackDeliveries).toEqual([{ conversationId: 'c-lin', seq: 6 }]);
    controller.dispose();
  });

  it('projects the pinned system conversation from notifications without calling message history', async () => {
    const harness = createDemoHarness();
    const notifyUnreadMaybeChanged = vi.fn();
    harness.host.notifyUnreadMaybeChanged = notifyUnreadMaybeChanged;
    const originalList = harness.host.im!.conversations.list.bind(harness.host.im!.conversations);
    harness.host.im!.conversations.list = async request => {
      const page = await originalList(request);
      return { ...page, items: [{
        id: '__system__', kind: 'system-notification' as const, displayName: 'Notifications', memberCount: 1,
        lastSeq: 0, readSeq: 0, deliveredSeq: 0, mentionSeq: 0, unreadCount: 1, hasMention: false,
        muted: false, pinned: true, hidden: false, readonly: true, currentMemberRole: null, currentMemberSource: null, updatedAt: '2027-01-01T00:00:00Z'
      }, ...page.items] };
    };
    const notificationCalls: string[] = [];
    harness.host.im!.notifications.list = async request => {
      const offset = request?.offset ?? 0;
      notificationCalls.push(`list:${offset}`);
      if (offset === 0) {
        return { items: [{ id: 'n1', type: 'todo', title: 'Approval', content: 'Please review', readAt: null, createdAt: '2027-01-01T00:00:00Z' }], total: 2, offset, limit: 50 };
      }
      return { items: [{ id: 'n2', type: 'announcement', title: 'Policy update', content: 'Please read', readAt: '2027-01-01T00:00:00Z', createdAt: '2026-12-31T00:00:00Z' }], total: 2, offset, limit: 50 };
    };
    harness.host.im!.notifications.unreadCount = async () => { notificationCalls.push('unread'); return 1; };
    harness.host.im!.notifications.markRead = async input => { notificationCalls.push(`read:${input?.ids?.join(',')}`); return 1; };
    harness.host.im!.notifications.cardAction = async id => { notificationCalls.push(`action:${id}`); return { forwarded: true }; };

    const controller = useImController(harness.host);
    await controller.refresh();
    expect(controller.activeConversation.value?.kind).toBe('system');
    expect(harness.sinceCalls).toEqual([]);
    expect(notificationCalls).toEqual(['list:0', 'unread']);
    expect(controller.messages.value.find(item => item.notification?.id === 'n1')?.notification?.readAt).toBeNull();
    expect(controller.activeConversation.value?.unread).toBe(1);
    await controller.markVisibleNotificationsRead();
    expect(notificationCalls).toContain('read:n1');
    expect(notifyUnreadMaybeChanged).toHaveBeenCalledOnce();
    expect(controller.messages.value.find(item => item.notification?.id === 'n1')?.notification?.readAt).not.toBeNull();
    await controller.loadHistory();
    expect(notificationCalls).toContain('list:1');
    expect(controller.messages.value.filter(item => item.notification).map(item => item.notification!.id)).toEqual(['n2', 'n1']);
    expect(harness.sinceCalls).toEqual([]);
    await controller.handleWsMessage({ conversationId: '__system__' });
    expect(harness.sinceCalls).toEqual([]);
    const notification = controller.messages.value.find(item => item.notification?.id === 'n1')!;
    await controller.runNotificationCardAction(notification, 'approve');
    expect(notificationCalls).toContain('action:n1');
    const stop = controller.startRealtime();
    const beforeNotificationEvents = notificationCalls.length;
    harness.emit('notify.push', { id: 'n3', unreadTotal: 2 });
    harness.emit('notify.revoke', { sourceRef: 'todo-1', unreadTotal: 1 });
    await flush();
    expect(notificationCalls.length).toBeGreaterThan(beforeNotificationEvents);
    expect(harness.sinceCalls).toEqual([]);
    stop();
  });

  it('converges real WS read/revoke/card/member events and unregisters every subscription', async () => {
    const harness = createDemoHarness();
    const controller = useImController(harness.host);
    await controller.refresh();
    controller.snapshot.value.messages.push({
      id: 'card-1', conversationId: 'c-team', seq: 5, clientMsgId: 'card-1', sender: { id: 'u-lin', name: 'Lin', departments: [] },
      kind: 'card', card: { rendererKey: 'todo', data: {}, actions: [], state: 'pending' }, createdAt: '2026-07-22T12:00:00Z', sendState: 'sent'
    });
    const memberCalls = harness.groupMemberCalls.length;
    const stop = controller.startRealtime();
    for (const kind of ['im.message', 'im.read', 'im.read.peer', 'im.revoke', 'card.update', 'im.member_change', 'notify.push', 'notify.revoke', 'resync']) expect(harness.listenerCount(kind)).toBe(1);
    harness.emit('im.read', { convId: 'c-team', readSeq: 5 });
    harness.emit('im.revoke', { convId: 'c-team', seq: 1, revokedBy: 'u-lin' });
    harness.emit('card.update', { convId: 'c-team', seq: 5, state: 'done' });
    harness.emit('im.member_change', { convId: 'c-team', kind: 'role_changed', targets: ['u-lin'], operator: 'u-me' });
    await flush();
    expect(controller.activeConversation.value).toMatchObject({ readSeq: 5, unread: 0 });
    expect(controller.snapshot.value.messages.find(item => item.seq === 1)?.kind).toBe('recall');
    expect(controller.snapshot.value.messages.find(item => item.seq === 5)?.card?.state).toBe('done');
    expect(harness.groupMemberCalls.length).toBeGreaterThan(memberCalls);
    stop();
    for (const kind of ['im.message', 'im.read', 'im.read.peer', 'im.revoke', 'card.update', 'im.member_change', 'notify.push', 'notify.revoke', 'resync']) expect(harness.listenerCount(kind)).toBe(0);
  });

  it('flips the sticky read/unread receipt to read when an im.read.peer frame reports the single-chat peer caught up', async () => {
    const harness = createDemoHarness();
    const controller = useImController(harness.host);
    await controller.refresh();
    controller.snapshot.value.messages.push({
      id: 'peer-read-1', conversationId: 'c-lin', seq: 1, clientMsgId: 'peer-read-1',
      sender: { id: 'u-me', name: 'Current User', departments: [] }, kind: 'text', text: 'hi',
      createdAt: '2026-07-22T12:00:00Z', sendState: 'sent'
    });
    const stop = controller.startRealtime();
    harness.emit('im.read.peer', { convId: 'c-lin', readerId: 'u-lin', readSeq: 1 });
    await flush();
    expect(controller.snapshot.value.messages.find(item => item.id === 'peer-read-1')?.receipt).toEqual({ status: 'ready', mode: 'count', readCount: 1 });
    stop();
  });

  it('does not flip receipts for messages sent by someone other than self on an im.read.peer frame', async () => {
    const harness = createDemoHarness();
    const controller = useImController(harness.host);
    await controller.refresh();
    controller.snapshot.value.messages.push({
      id: 'peer-read-2', conversationId: 'c-lin', seq: 1, clientMsgId: 'peer-read-2',
      sender: { id: 'u-lin', name: 'Lin', departments: [] }, kind: 'text', text: 'from peer',
      createdAt: '2026-07-22T12:00:00Z', sendState: 'sent'
    });
    const stop = controller.startRealtime();
    harness.emit('im.read.peer', { convId: 'c-lin', readerId: 'u-lin', readSeq: 1 });
    await flush();
    expect(controller.snapshot.value.messages.find(item => item.id === 'peer-read-2')?.receipt).toBeUndefined();
    stop();
  });

  it('does not flip receipts when the message seq is beyond the reported readSeq', async () => {
    const harness = createDemoHarness();
    const controller = useImController(harness.host);
    await controller.refresh();
    controller.snapshot.value.messages.push({
      id: 'peer-read-3', conversationId: 'c-lin', seq: 5, clientMsgId: 'peer-read-3',
      sender: { id: 'u-me', name: 'Current User', departments: [] }, kind: 'text', text: 'not yet read',
      createdAt: '2026-07-22T12:00:00Z', sendState: 'sent'
    });
    const stop = controller.startRealtime();
    harness.emit('im.read.peer', { convId: 'c-lin', readerId: 'u-lin', readSeq: 3 });
    await flush();
    expect(controller.snapshot.value.messages.find(item => item.id === 'peer-read-3')?.receipt).toBeUndefined();
    stop();
  });

  it('does not flip receipts belonging to a different conversation than the im.read.peer frame', async () => {
    const harness = createDemoHarness();
    const controller = useImController(harness.host);
    await controller.refresh();
    controller.snapshot.value.messages.push({
      id: 'peer-read-4', conversationId: 'c-team', seq: 1, clientMsgId: 'peer-read-4',
      sender: { id: 'u-me', name: 'Current User', departments: [] }, kind: 'text', text: 'other conversation',
      createdAt: '2026-07-22T12:00:00Z', sendState: 'sent'
    });
    const stop = controller.startRealtime();
    harness.emit('im.read.peer', { convId: 'c-lin', readerId: 'u-lin', readSeq: 99 });
    await flush();
    expect(controller.snapshot.value.messages.find(item => item.id === 'peer-read-4')?.receipt).toBeUndefined();
    stop();
  });

  it('is idempotent when an im.read.peer frame arrives after the receipt is already read', async () => {
    const harness = createDemoHarness();
    const controller = useImController(harness.host);
    await controller.refresh();
    controller.snapshot.value.messages.push({
      id: 'peer-read-5', conversationId: 'c-lin', seq: 1, clientMsgId: 'peer-read-5',
      sender: { id: 'u-me', name: 'Current User', departments: [] }, kind: 'text', text: 'already acked',
      createdAt: '2026-07-22T12:00:00Z', sendState: 'sent',
      receipt: { status: 'ready', mode: 'roster', readUserIds: ['u-lin'] }
    });
    const stop = controller.startRealtime();
    harness.emit('im.read.peer', { convId: 'c-lin', readerId: 'u-lin', readSeq: 1 });
    await flush();
    // 已是已读态时不覆盖既有回执形状（此处仍是 roster 模式），验证 handler 的幂等跳过分支。
    expect(controller.snapshot.value.messages.find(item => item.id === 'peer-read-5')?.receipt).toEqual({ status: 'ready', mode: 'roster', readUserIds: ['u-lin'] });
    stop();
  });

  it('removes the current conversation when a member-change frame removes self', async () => {
    const harness = createDemoHarness();
    const controller = useImController(harness.host);
    await controller.refresh();
    await controller.handleWsMemberChange({ convId: 'c-team', kind: 'kicked', targets: ['u-me'], operator: 'u-lin' });
    expect(controller.snapshot.value.conversations.some(item => item.id === 'c-team')).toBe(false);
    expect(controller.activeConversation.value?.id).toBe('c-lin');
  });

  it('deduplicates concurrent resyncs and caps conversation pull concurrency at four', async () => {
    const harness = createDemoHarness();
    const extras = Array.from({ length: 8 }, (_, index) => ({ ...demoConversations[1], id: `extra-${index}`, displayName: `Extra ${index}`, peerUserId: `peer-${index}` }));
    const all = [...demoConversations, ...extras];
    harness.host.im!.conversations.list = async () => ({ items: structuredClone(all), nextCursor: null });
    harness.host.im!.conversations.get = async id => structuredClone(all.find(item => item.id === id)!);
    let active = 0;
    let maxActive = 0;
    let pulls = 0;
    harness.host.im!.messages.listSince = async (conversationId, afterSeq) => {
      pulls += 1; active += 1; maxActive = Math.max(maxActive, active);
      await new Promise(resolve => setTimeout(resolve, 5));
      active -= 1;
      return { items: [], nextCursor: null, latestSeq: afterSeq };
    };
    const controller = useImController(harness.host);
    await controller.refresh();
    const stop = controller.startRealtime();
    harness.emitState('open');
    harness.emit('resync', { reason: 'backpressure' });
    await Promise.all([controller.resyncAll(), controller.resyncAll()]);
    expect(pulls).toBe(all.length);
    expect(maxActive).toBeLessThanOrEqual(4);
    stop();
  });

  it('maps group mentions and privileged mention-all to the formal send DTO', async () => {
    const harness = createDemoHarness();
    let nextId = 0;
    const controller = useImController(harness.host, { clientMsgId: () => `mention-${++nextId}` });
    await controller.refresh();
    expect(controller.mentionCandidates.value.map(item => item.userId)).toContain('u-lin');
    expect(controller.canMentionAll.value).toBe(true);
    controller.addMention('u-lin', '@Lin');
    controller.draft.value = 'hello @Lin';
    await controller.send();
    expect(harness.sent.at(-1)?.mentions).toEqual([{ userId: 'u-lin' }]);
    controller.addMentionAll('@all');
    controller.draft.value = 'notice @all';
    await controller.send();
    expect(harness.sent.at(-1)?.mentions).toEqual({ all: true });
    controller.activeConversation.value!.currentMemberRole = 'member';
    expect(controller.canMentionAll.value).toBe(false);
    controller.activeConversation.value!.kind = 'group';
    expect(controller.canManageGroup.value).toBe(false);
    controller.activeConversation.value!.currentMemberRole = 'admin';
    expect(controller.canManageGroup.value).toBe(true);
    controller.activeConversation.value!.currentMemberRole = 'member';
    controller.addMentionAll('@all');
    expect(controller.mentionAll.value).toBe(false);
    controller.addMention('u-lin', '@Lin');
    controller.pruneMentions('mention removed');
    expect(controller.mentionUserIds.value.size).toBe(0);
    await controller.selectConversation('c-lin');
    expect(controller.mentionCandidates.value).toEqual([]);
  });

  it('preserves roster/count/disabled read-receipt modes and shares presence across surfaces via the unified store', async () => {
    const harness = createDemoHarness();
    const presenceCalls: string[][] = [];
    harness.host.im!.presence.queryUsers = async ids => { presenceCalls.push([...ids]); return Object.fromEntries(ids.filter(id => id === 'u-lin').map(id => [id, 'online' as const])); };
    const controller = useImController(harness.host, { clientMsgId: () => 'receipt-self' });
    await controller.refresh();
    // presence 存储收敛后不再写在 snapshot.value.conversations 的实体上，读取要走投影版 controller.conversations。
    expect(controller.conversations.value.find(item => item.id === 'c-lin')?.connection).toBe('online');
    // presenceById 是唯一权威存储，u-me（当前登录者）同时是通讯录成员和群成员——通讯录侧的
    // updateDirectoryPresence 对缺席 id 有 'offline' 兜底（refresh() 的 fire-and-forget 通讯录
    // 查询在这里已经落地），这个事实现在会经由共享的同一张表自然反映到群成员视图，而不再像
    // 旧实现那样因为"存在三份互相独立的副本"而在群成员视图上保持 undefined。
    expect(controller.groupMembers.value.find(item => item.userId === 'u-me')?.presence).toBe('offline');
    expect(presenceCalls.every(ids => ids.length <= 100)).toBe(true);
    controller.draft.value = 'receipt';
    await controller.send();
    const message = controller.messages.value.find(item => item.clientMsgId === 'receipt-self')!;
    harness.host.im!.messages.getReadReceipt = async () => ({ mode: 'roster', readUserIds: ['u-lin'] });
    await controller.loadReadReceipt(message);
    expect(message.receipt).toMatchObject({ status: 'ready', mode: 'roster', readUserIds: ['u-lin'] });
    harness.host.im!.messages.getReadReceipt = async () => ({ mode: 'count', readCount: 42 });
    await controller.loadReadReceipt(message);
    expect(message.receipt).toMatchObject({ mode: 'count', readCount: 42, readUserIds: undefined });
    harness.host.im!.messages.getReadReceipt = async () => ({ mode: 'disabled' });
    await controller.loadReadReceipt(message);
    expect(message.receipt).toMatchObject({ mode: 'disabled' });
  });

  it('routes the ordinary-group leave/dissolve matrix and blocks department actions', async () => {
    const harness = createDemoHarness();
    const controller = useImController(harness.host);
    await controller.refresh();
    await controller.leaveGroup();
    expect(harness.groupActions).toEqual([]);
    controller.activeConversation.value!.kind = 'group';
    controller.activeConversation.value!.currentMemberRole = 'owner';
    await controller.leaveGroup();
    expect(harness.groupActions).toEqual([]);
    await controller.dissolveGroup();
    expect(harness.groupActions).toEqual([{ action: 'dissolve', conversationId: 'c-team' }]);
  });

  it('lets only an ordinary-group owner grant and revoke admin without using member source as authority', async () => {
    const harness = createDemoHarness();
    const roles = new Map<string, 'member' | 'admin' | 'owner'>([['u-me', 'owner'], ['u-lin', 'member']]);
    const calls: Array<{ userId: string; role: 'member' | 'admin' | 'owner' }> = [];
    harness.host.im!.conversations.get = async () => ({ ...demoConversations[0], kind: 'group', currentMemberRole: 'owner', currentMemberSource: 'manual' });
    harness.host.im!.groups.listMembers = async () => ({ items: [
      { userId: 'u-me', displayName: 'Current User', role: roles.get('u-me')!, source: 'manual', joinedAt: '' },
      { userId: 'u-lin', displayName: 'Lin', role: roles.get('u-lin')!, source: 'organization', joinedAt: '' }
    ], nextCursor: null });
    harness.host.im!.groups.setRole = async (_conversationId, userId, role) => { calls.push({ userId, role }); roles.set(userId, role); };
    const controller = useImController(harness.host);
    await controller.refresh();
    controller.activeConversation.value!.kind = 'group';
    controller.activeConversation.value!.currentMemberRole = 'owner';
    const member = controller.groupMembers.value.find(item => item.userId === 'u-lin')!;
    expect(controller.canSetMemberAdmin(member)).toBe(true);
    await controller.setGroupMemberAdmin(member, true);
    expect(calls).toEqual([{ userId: 'u-lin', role: 'admin' }]);
    expect(controller.groupMembers.value.find(item => item.userId === 'u-lin')?.role).toBe('admin');
    await controller.setGroupMemberAdmin(controller.groupMembers.value.find(item => item.userId === 'u-lin')!, false);
    expect(calls.at(-1)).toEqual({ userId: 'u-lin', role: 'member' });
    controller.activeConversation.value!.currentMemberRole = 'admin';
    expect(controller.canSetMemberAdmin(controller.groupMembers.value[1])).toBe(false);
  });

  it('requires transfer confirmation, refreshes the new owner and former owner role, and enables leave', async () => {
    const harness = createDemoHarness();
    let transferred = false;
    const calls: string[] = [];
    harness.host.im!.conversations.get = async () => ({ ...demoConversations[0], kind: 'group', currentMemberRole: transferred ? 'admin' : 'owner', currentMemberSource: 'manual' });
    harness.host.im!.groups.listMembers = async () => ({ items: [
      { userId: 'u-me', displayName: 'Current User', role: transferred ? 'admin' : 'owner', source: 'manual', joinedAt: '' },
      { userId: 'u-lin', displayName: 'Lin', role: transferred ? 'owner' : 'member', source: 'business', joinedAt: '' }
    ], nextCursor: null });
    harness.host.im!.groups.setRole = async (_conversationId, userId, role) => { calls.push(`${userId}:${role}`); transferred = true; };
    const controller = useImController(harness.host);
    await controller.refresh();
    controller.activeConversation.value!.kind = 'group';
    controller.activeConversation.value!.currentMemberRole = 'owner';
    const target = controller.groupMembers.value.find(item => item.userId === 'u-lin')!;
    await controller.transferGroupOwnership(target, async () => false);
    expect(calls).toEqual([]);
    expect(controller.groupRoleOperation.value.status).toBe('idle');
    await controller.transferGroupOwnership(target, async () => true);
    expect(calls).toEqual(['u-lin:owner']);
    expect(controller.activeConversation.value?.currentMemberRole).toBe('admin');
    expect(controller.groupMembers.value.map(item => [item.userId, item.role])).toEqual([['u-me', 'admin'], ['u-lin', 'owner']]);
    expect(controller.canLeaveGroup.value).toBe(true);
    expect(controller.groupRoleOperation.value).toMatchObject({ status: 'success', action: 'transfer-owner', userId: 'u-lin' });
  });

  it('keeps role data unchanged on a confirmed transfer failure and blocks duplicate requests while pending', async () => {
    const harness = createDemoHarness();
    const request = deferred<void>();
    let calls = 0;
    harness.host.im!.conversations.get = async () => ({ ...demoConversations[0], kind: 'group', currentMemberRole: 'owner', currentMemberSource: 'manual' });
    harness.host.im!.groups.setRole = async () => { calls += 1; return request.promise; };
    const controller = useImController(harness.host);
    await controller.refresh();
    controller.activeConversation.value!.kind = 'group';
    controller.activeConversation.value!.currentMemberRole = 'owner';
    const member = controller.groupMembers.value.find(item => item.userId === 'u-lin')!;
    const first = controller.transferGroupOwnership(member, async () => true);
    const duplicate = controller.transferGroupOwnership(member, async () => true);
    await new Promise(resolve => setTimeout(resolve, 0)); // 异步确认框 resolve 后才进入 pending
    expect(calls).toBe(1);
    expect(controller.groupRoleOperation.value).toMatchObject({ status: 'pending', userId: 'u-lin' });
    await duplicate;
    request.reject(new Error('transfer_denied'));
    await expect(first).rejects.toThrow('transfer_denied');
    expect(controller.groupMembers.value.find(item => item.userId === 'u-lin')?.role).toBe('member');
    expect(controller.activeConversation.value?.currentMemberRole).toBe('owner');
    expect(controller.groupRoleOperation.value).toMatchObject({ status: 'error', action: 'transfer-owner', userId: 'u-lin', error: 'transfer_denied' });
  });

  it('loads every group-member cursor page without a 100-member cutoff', async () => {
    const harness = createDemoHarness();
    const cursors: Array<string | undefined> = [];
    harness.host.im!.groups.listMembers = async (_conversationId, request) => {
      const cursor = request?.cursor;
      cursors.push(cursor);
      const start = cursor === 'page-2' ? 100 : cursor === 'page-3' ? 200 : 0;
      const count = start === 200 ? 5 : 100;
      return {
        items: Array.from({ length: count }, (_, index) => ({ userId: `member-${start + index}`, displayName: `Member ${start + index}`, role: 'member' as const, source: 'manual' as const, joinedAt: '2026-07-22T00:00:00Z' })),
        nextCursor: start === 0 ? 'page-2' : start === 100 ? 'page-3' : null
      };
    };
    const controller = useImController(harness.host);
    await controller.refresh();
    expect(cursors).toEqual([undefined, 'page-2', 'page-3']);
    expect(controller.groupMembers.value).toHaveLength(205);
  });

  it('settles every presence batch independently and keeps failed users unknown', async () => {
    const harness = createDemoHarness();
    harness.host.im!.presence.queryUsers = async ids => {
      const first = ids[0];
      if (first === 'presence-100') throw new Error('presence_batch_failed');
      await new Promise(resolve => setTimeout(resolve, first === 'presence-0' ? 15 : 5));
      return Object.fromEntries(ids.map(id => [id, 'online' as const]));
    };
    const controller = useImController(harness.host);
    await controller.refresh();
    const ids = Array.from({ length: 205 }, (_, index) => `presence-${index}`);
    const presence = await controller.queryPresence(ids);
    expect(presence['presence-0']).toBe('online');
    expect(presence['presence-100']).toBeUndefined();
    expect(presence['presence-200']).toBe('online');
    const snapshot = JSON.stringify(presence);
    await new Promise(resolve => setTimeout(resolve, 25));
    expect(JSON.stringify(presence)).toBe(snapshot);
  });

  it('reports partial invite and kick results and enforces role/source kicks', async () => {
    const harness = createDemoHarness();
    const controller = useImController(harness.host);
    await controller.refresh();
    controller.activeConversation.value!.kind = 'group';
    controller.activeConversation.value!.currentMemberRole = 'admin';
    const originalGet = harness.host.im!.conversations.get.bind(harness.host.im!.conversations);
    harness.host.im!.conversations.get = async id => ({ ...(await originalGet(id)), kind: 'group', currentMemberRole: 'admin', currentMemberSource: 'manual' });
    harness.host.im!.groups.addMembers = async () => ['u-lin'];
    await controller.inviteGroupMembers(['u-lin', 'u-chen']);
    expect(controller.groupOperation.value).toMatchObject({ status: 'partial', action: 'invite', succeededIds: ['u-lin'], failedIds: ['u-chen'] });
    const kicked: string[] = [];
    harness.host.im!.groups.kick = async (_conversationId, userId) => { kicked.push(userId); };
    const manualMember = { userId: 'manual-member', displayName: 'Manual', role: 'member' as const, source: 'manual' as const, joinedAt: '' };
    const manualAdmin = { userId: 'manual-admin', displayName: 'Admin', role: 'admin' as const, source: 'manual' as const, joinedAt: '' };
    const orgMember = { ...manualMember, userId: 'org-member', source: 'organization' as const };
    await controller.kickGroupMembers([manualMember, manualAdmin, orgMember]);
    expect(kicked).toEqual(['manual-member']);
    expect(controller.groupOperation.value).toMatchObject({ status: 'success', action: 'kick', succeededIds: ['manual-member'] });
  });

  it('creates an ordinary group without readonly input and uploads an avatar before updating info', async () => {
    const harness = createDemoHarness();
    const controller = useImController(harness.host);
    await controller.refresh();
    let createInput: unknown;
    harness.host.im!.conversations.createGroup = async input => {
      createInput = input;
      return { ...demoConversations[0], id: 'created-group', kind: 'group', displayName: input.name, currentMemberRole: 'owner', currentMemberSource: 'manual' };
    };
    await controller.createGroup('  Project  ', ['u-lin']);
    expect(createInput).toEqual({ name: 'Project', memberUserIds: ['u-lin'] });
    expect(createInput).not.toHaveProperty('readonly');
    let updateInput: unknown;
    harness.host.im!.groups.updateInfo = async (_conversationId, input) => { updateInput = input; return { ...demoConversations[0], id: 'created-group', kind: 'group', displayName: input.name ?? 'Project', currentMemberRole: 'owner', currentMemberSource: 'manual' }; };
    await controller.updateGroupInfo('Renamed', new File(['avatar'], 'avatar.png', { type: 'image/png' }));
    expect(updateInput).toEqual({ name: 'Renamed', avatarAssetId: 'asset-1' });
    expect(controller.groupOperation.value.status).toBe('success');
  });

  it('loads every conversation cursor page at limit 100 and deduplicates IDs', async () => {
    const harness = createDemoHarness();
    const cursors: Array<string | undefined> = [];
    harness.host.im!.conversations.list = async request => {
      cursors.push(request?.cursor);
      if (!request?.cursor) return { items: [demoConversations[0], demoConversations[1]], nextCursor: 'page-2' };
      return { items: [{ ...demoConversations[1], displayName: 'Lin latest' }], nextCursor: null };
    };
    const controller = useImController(harness.host);
    await controller.refresh();
    expect(cursors).toEqual([undefined, 'page-2']);
    expect(controller.snapshot.value.conversations).toHaveLength(2);
    expect(controller.snapshot.value.conversations.find(item => item.id === 'c-lin')?.title).toBe('Lin latest');
  });

  it('fails an entire conversation refresh on a later-page error or cursor cycle without committing partial pages', async () => {
    const harness = createDemoHarness();
    const controller = useImController(harness.host);
    await controller.refresh();
    const before = JSON.stringify(controller.snapshot.value);
    harness.host.im!.conversations.list = async request => {
      if (!request?.cursor) return { items: [{ ...demoConversations[0], id: 'partial' }], nextCursor: 'broken-page' };
      throw new Error('backend_page_failed');
    };
    await controller.refresh();
    expect(JSON.stringify(controller.snapshot.value)).toBe(before);
    expect(controller.loadError.value).toContain('conversation_list_page_failed:2:broken-page:backend_page_failed');

    harness.host.im!.conversations.list = async request => ({ items: [], nextCursor: request?.cursor ? 'cycle' : 'cycle' });
    await controller.refresh();
    expect(JSON.stringify(controller.snapshot.value)).toBe(before);
    expect(controller.loadError.value).toBe('conversation_cursor_cycle:cycle');
  });

  it('does not commit refresh results or start realtime after disposal', async () => {
    const harness = createDemoHarness();
    const page = deferred<{ items: typeof demoConversations; nextCursor: null }>();
    harness.host.im!.conversations.list = () => page.promise;
    const controller = useImController(harness.host);
    const refresh = controller.refresh();
    controller.dispose();
    const atDispose = JSON.stringify(controller.snapshot.value);
    page.resolve({ items: demoConversations, nextCursor: null });
    await refresh;
    const stop = controller.startRealtime();
    expect(JSON.stringify(controller.snapshot.value)).toBe(atDispose);
    expect(harness.listenerCount('im.message')).toBe(0);
    stop();
  });

  it('releases every realtime and state listener across repeated start-stop cycles', async () => {
    const harness = createDemoHarness();
    const controller = useImController(harness.host);
    await controller.refresh();
    const kinds = ['im.message', 'im.read', 'im.read.peer', 'im.revoke', 'card.update', 'im.member_change', 'notify.push', 'notify.revoke', 'resync'];
    for (let cycle = 0; cycle < 50; cycle += 1) {
      const stop = controller.startRealtime();
      expect(kinds.every(kind => harness.listenerCount(kind) === 1)).toBe(true);
      expect(harness.stateListenerCount()).toBe(1);
      stop();
      expect(kinds.every(kind => harness.listenerCount(kind) === 0)).toBe(true);
      expect(harness.stateListenerCount()).toBe(0);
    }
    controller.dispose();
  });

  it('deduplicates reconnect pulls and preserves the active draft across disconnect recovery', async () => {
    const harness = createDemoHarness();
    const controller = useImController(harness.host);
    await controller.refresh();
    controller.draft.value = 'weak-network draft';
    const stop = controller.startRealtime();
    harness.pushIncoming({
      id: 'm-reconnect', conversationId: 'c-team', seq: 3, senderId: 'u-lin', senderDisplayName: 'Lin',
      clientMsgId: 'reconnect-3', kind: 'text', content: { text: 'arrived while offline' }, createdAt: '2026-07-22T12:30:00Z'
    });
    harness.emitState('disconnected');
    harness.emitState('open');
    harness.emitState('open');
    await controller.resyncAll();
    await controller.resyncAll();

    expect(controller.snapshot.value.messages.filter(message => message.id === 'm-reconnect')).toHaveLength(1);
    expect(controller.draft.value).toBe('weak-network draft');
    stop();
  });

  it('cancels an active upload on disposal and ignores its eventual completion', async () => {
    const harness = createDemoHarness();
    const controller = useImController(harness.host);
    await controller.refresh();
    const result = deferred<{ assetId: string; fileName: string; byteSize: number; mimeType: string }>();
    const cancel = vi.fn();
    harness.host.im!.assets.upload = () => ({ uploadId: 'slow-upload', result: result.promise, cancel });
    const sending = controller.sendFile(new File(['data'], 'slow.txt', { type: 'text/plain' }));
    expect(controller.upload.value?.uploadId).toBe('slow-upload');
    const messageCount = controller.snapshot.value.messages.length;
    controller.dispose();
    expect(cancel).toHaveBeenCalledWith('controller_disposed');
    result.resolve({ assetId: 'late-asset', fileName: 'slow.txt', byteSize: 4, mimeType: 'text/plain' });
    await sending;
    expect(controller.snapshot.value.messages).toHaveLength(messageCount);
    expect(controller.upload.value).toBeUndefined();
  });

  it('drops a stale conversation load when a newer selection wins', async () => {
    const harness = createDemoHarness();
    const controller = useImController(harness.host);
    await controller.refresh();
    controller.snapshot.value.messages = [];
    controller.snapshot.value.conversations.find(item => item.id === 'c-lin')!.lastSeq = 1;
    const teamPage = deferred<Awaited<ReturnType<NonNullable<typeof harness.host.im>['messages']['listBefore']>>>();
    const linPage = deferred<Awaited<ReturnType<NonNullable<typeof harness.host.im>['messages']['listBefore']>>>();
    harness.host.im!.messages.listBefore = conversationId => conversationId === 'c-team' ? teamPage.promise : linPage.promise;
    const first = controller.selectConversation('c-team');
    const second = controller.selectConversation('c-lin');
    linPage.resolve({ items: [{ id: 'current', conversationId: 'c-lin', seq: 1, senderId: 'u-lin', clientMsgId: 'current', kind: 'text', content: { text: 'current' }, createdAt: '2026-07-22T00:00:00Z' }], nextCursor: null, latestSeq: 1 });
    await second;
    teamPage.resolve({ items: [{ id: 'stale', conversationId: 'c-team', seq: 1, senderId: 'u-lin', clientMsgId: 'stale', kind: 'text', content: { text: 'stale' }, createdAt: '2026-07-22T00:00:00Z' }], nextCursor: null, latestSeq: 1 });
    await first;
    expect(controller.activeConversation.value?.id).toBe('c-lin');
    expect(controller.snapshot.value.messages.map(item => item.id)).toEqual(['current']);
  });

  it('ignores a search response that resolves after disposal', async () => {
    const harness = createDemoHarness();
    const users = deferred<{ items: never[]; nextCursor: null }>();
    harness.host.im!.search.searchUsers = () => users.promise;
    const controller = useImController(harness.host);
    await controller.refresh();
    const search = controller.runUnifiedSearch('late');
    controller.dispose();
    const atDispose = JSON.stringify(controller.unifiedSearch.value);
    users.resolve({ items: [], nextCursor: null });
    await search;
    expect(JSON.stringify(controller.unifiedSearch.value)).toBe(atDispose);
  });

  it('stops an in-flight resync from committing or continuing after disposal', async () => {
    const harness = createDemoHarness();
    const controller = useImController(harness.host);
    await controller.refresh();
    const page = deferred<{ items: never[]; nextCursor: null; latestSeq: number }>();
    const gets = vi.fn(harness.host.im!.conversations.get.bind(harness.host.im!.conversations));
    const sinceCalls = vi.fn(() => page.promise);
    harness.host.im!.messages.listSince = sinceCalls;
    harness.host.im!.conversations.get = gets;
    const resync = controller.resyncAll();
    const atDispose = JSON.stringify(controller.snapshot.value);
    controller.dispose();
    page.resolve({ items: [], nextCursor: null, latestSeq: 0 });
    await resync;
    expect(JSON.stringify(controller.snapshot.value)).toBe(atDispose);
    // syncConversation 现在先拉会话本体（conversations.get，会话可见性修复：保证会话可见性
    // 不受消息增量拉取拖累）再拉消息增量（listSince）；resyncAll 启动时两个会话的
    // conversations.get 会同步发出并很快 resolve，但 dispose() 之后 guard() 让其结果被
    // 丢弃、不提交任何 snapshot 变化（上面已验证）。真正验证"disposal 后不再继续"的落点
    // 变成了第二步——loadSince 顶部的 disposed 短路会在到达 listSince 之前就直接返回，
    // listSince 因此从未被真正调用。
    expect(sinceCalls).not.toHaveBeenCalled();
  });

  // 面板常开 + 会话被隐藏 + 新消息到达：宿主约定后端在消息落库同一事务内把 hidden
  // 复位为 false（resetHiddenMembersTx），前端这里补上对应的实时侧收口——WS 帧到达时必须
  // 让该会话重新出现在 conversations.value（最近会话列表投影），不必等下一次整页刷新。
  it('reappears a hidden conversation in the realtime list projection once its WS message frame arrives', async () => {
    const harness = createDemoHarness();
    const controller = useImController(harness.host);
    await controller.refresh();
    controller.startRealtime();
    const conversation = controller.snapshot.value.conversations.find(item => item.id === 'c-lin')!;
    await controller.hideConversation(conversation);
    expect(controller.conversations.value.some(item => item.id === 'c-lin')).toBe(false);

    // conversations.get 模拟后端 resetHiddenMembersTx 已经生效：hidden 已回读为 false。
    harness.host.im!.conversations.get = async id => {
      const found = demoConversations.find(item => item.id === id);
      if (!found) throw new Error('conversation_not_found');
      return { ...structuredClone(found), hidden: false };
    };
    harness.pushIncoming({
      id: 'reappear-1', conversationId: 'c-lin', seq: 1, senderId: 'u-lin', senderDisplayName: 'Lin',
      clientMsgId: 'reappear-1', kind: 'text', content: { text: 'hi again' }, createdAt: '2026-07-22T10:00:00.000Z'
    });
    harness.emitMessage({ convId: 'c-lin' });
    await flush();
    await flush();

    expect(controller.conversations.value.some(item => item.id === 'c-lin')).toBe(true);
    controller.dispose();
  });

  // 反验目标：旧实现是 loadSince→conversations.get 严格串行，一旦 loadSince（消息增量拉取，
  // 尽力而为）失败，conversations.get（会话本体，决定列表可见性）根本不会被执行到，于是
  // 出现"消息侧可能已经有动静、但会话始终没回到最近会话列表"的半更新态——这正是本任务要
  // 修的"面板常开+隐藏+新消息不实时回列表"缺口的一种真实触发方式（网络抖动/瞬时后端故障
  // 都可能让 messages/since 这一步失败）。本用例把 listSince 固定改为失败，用来断言"会话
  // 可见性"这个结果不再依赖"消息增量拉取"是否成功——这条不变量是本次改动新增的，用于在
  // 修复前后分别验证。
  it('still reappears the hidden conversation in the list even when the incremental message fetch fails', async () => {
    const harness = createDemoHarness();
    const controller = useImController(harness.host);
    await controller.refresh();
    controller.startRealtime();
    const conversation = controller.snapshot.value.conversations.find(item => item.id === 'c-lin')!;
    await controller.hideConversation(conversation);
    expect(controller.conversations.value.some(item => item.id === 'c-lin')).toBe(false);

    harness.host.im!.conversations.get = async id => {
      const found = demoConversations.find(item => item.id === id);
      if (!found) throw new Error('conversation_not_found');
      return { ...structuredClone(found), hidden: false };
    };
    harness.host.im!.messages.listSince = async () => { throw new Error('transient_network_hiccup'); };
    harness.emitMessage({ convId: 'c-lin' });
    await flush();
    await flush();

    expect(controller.conversations.value.some(item => item.id === 'c-lin')).toBe(true);
    controller.dispose();
  });

  // presence.update 帧（A 半：单聊对端实时推送）。反验：改动前该 kind 从未被订阅（startRealtime
  // 里没有对应的 caps.ws.subscribe 调用），harness.emit('presence.update', ...) 是无人监听的
  // 空投，下面三次状态断言必然全部拿到 refresh() 期间通讯录 fire-and-forget 查询留下的旧值，
  // 与预期的 online/busy/offline 三态都对不上——这条用例在修复前是红的。
  it('applies a presence.update frame directly to presenceById without issuing any HTTP presence query', async () => {
    const harness = createDemoHarness();
    const controller = useImController(harness.host);
    await controller.refresh();
    // u-lin 同时是 c-lin 的单聊对端和通讯录成员：refresh() 内 updateDirectoryPresence 是
    // fire-and-forget（不 await），显式 flush 让它先落地，避免其"缺席回落 offline"的写入
    // 在后面的断言过程中才不确定地插入进来，污染基线。
    await flush();
    const queryUsers = vi.fn(harness.host.im!.presence.queryUsers.bind(harness.host.im!.presence));
    harness.host.im!.presence.queryUsers = queryUsers;
    const stop = controller.startRealtime();
    queryUsers.mockClear(); // 排除 refresh()/startRealtime() 期间已经发生的查询，只看帧到达之后

    harness.emit('presence.update', { userId: 'u-lin', status: 1 });
    await flush();
    expect(controller.conversations.value.find(item => item.id === 'c-lin')?.connection).toBe('online');

    harness.emit('presence.update', { userId: 'u-lin', status: 2 });
    await flush();
    expect(controller.conversations.value.find(item => item.id === 'c-lin')?.connection).toBe('busy');

    harness.emit('presence.update', { userId: 'u-lin', status: 0 });
    await flush();
    expect(controller.conversations.value.find(item => item.id === 'c-lin')?.connection).toBe('offline');

    // 推送值本身就是权威合成态：全程不应该为此发起任何 im.presence.queryUsers 调用。
    expect(queryUsers).not.toHaveBeenCalled();
    stop();
    controller.dispose();
  });

  // 反验：改动前 presence.update 完全没有订阅，这条用例无从触发；改动后故意构造缺字段/错类型的
  // 帧，验证 handleWsPresenceUpdate 的容错分支——不抛错、不写坏 presenceById、且不影响后续合法帧。
  it('silently ignores a malformed presence.update frame, reports a warn, and keeps the realtime channel working', async () => {
    const harness = createDemoHarness();
    const controller = useImController(harness.host);
    await controller.refresh();
    const warn = vi.fn();
    harness.host.im!.logger!.warn = warn; // logger 本身是 readonly 属性，只能改写其方法而非整体替换
    const stop = controller.startRealtime();
    const before = controller.conversations.value.find(item => item.id === 'c-lin')?.connection;

    expect(() => harness.emit('presence.update', { userId: 'u-lin' })).not.toThrow(); // 缺 status
    expect(() => harness.emit('presence.update', { status: 1 })).not.toThrow(); // 缺 userId
    expect(() => harness.emit('presence.update', { userId: 'u-lin', status: 'online' })).not.toThrow(); // status 类型不对（宿主透传的是原始数值，不是已解码枚举）
    expect(() => harness.emit('presence.update', null)).not.toThrow();
    await flush();

    expect(controller.conversations.value.find(item => item.id === 'c-lin')?.connection).toBe(before);
    expect(warn).toHaveBeenCalled();
    expect(warn.mock.calls.every(call => call[0] === 'im_next.ws_presence_frame_invalid')).toBe(true);

    // 非法帧不得打断实时链路：紧接着一条合法帧仍然正常生效。
    harness.emit('presence.update', { userId: 'u-lin', status: 1 });
    await flush();
    expect(controller.conversations.value.find(item => item.id === 'c-lin')?.connection).toBe('online');
    stop();
    controller.dispose();
  });

  // presence 定时轮询兜底（B 半：通讯录/群成员没有实时推送）。反验：改动前 startRealtime 里
  // 没有任何 setInterval，vi.getTimerCount() 在 startRealtime() 之后仍等于 baseline，30 秒推进
  // 也不会触发任何 im.presence.queryUsers 调用——这几条断言在修复前必然是红的。
  it('polls presence for the visible scope every 30s while the tab is visible, skips while hidden, dedupes a just-completed sync, and leaks no timer or listener after dispose', async () => {
    vi.useFakeTimers();
    const originalDocument = (globalThis as { document?: unknown }).document;
    try {
      const harness = createDemoHarness();
      const queryUsers = vi.fn(async () => ({}));
      harness.host.im!.presence.queryUsers = queryUsers;
      const controller = useImController(harness.host);
      await controller.refresh(); // refresh() 内部已做过一轮 presence 同步并 markPresenceSynced()
      queryUsers.mockClear();

      // 伪造最小 document：只实现轮询逻辑用到的三个成员，可见性通过外层变量手动翻转。
      let visibilityState: 'visible' | 'hidden' = 'visible';
      const listeners = new Set<() => void>();
      const fakeDocument = {
        get visibilityState() { return visibilityState; },
        addEventListener: (type: string, handler: () => void) => { if (type === 'visibilitychange') listeners.add(handler); },
        removeEventListener: (type: string, handler: () => void) => { if (type === 'visibilitychange') listeners.delete(handler); }
      };
      (globalThis as unknown as { document: unknown }).document = fakeDocument;
      const setVisibility = (next: 'visible' | 'hidden') => { visibilityState = next; listeners.forEach(handler => handler()); };
      // vitest 的 advanceTimersByTimeAsync 只保证"由它触发的定时器回调"之后的 promise 链被 await；
      // 这里手动模拟 visibilitychange，不经过 vitest 的定时器调度器，因此改用普通微任务队列排空，
      // 不依赖 fake timer 的内部实现细节。
      const flushMicrotasks = async () => { for (let i = 0; i < 10; i += 1) await Promise.resolve(); };

      const baselineTimers = vi.getTimerCount();
      const stop = controller.startRealtime();
      expect(vi.getTimerCount()).toBe(baselineTimers + 1); // 新增了一个常驻的轮询 setInterval
      expect(listeners.size).toBe(1); // 订阅了 visibilitychange

      // 去重反验：refresh() 刚做过一轮同步，此刻立即触发可见性事件应被去重窗口吸收，不发起新查询。
      setVisibility('hidden');
      setVisibility('visible');
      await flushMicrotasks();
      expect(queryUsers).not.toHaveBeenCalled();

      // 到点轮询：可见状态下 30 秒后应发起查询（三个投影面各自一批，具体调用次数不做强绑定）。
      await vi.advanceTimersByTimeAsync(30_000);
      expect(queryUsers).toHaveBeenCalled();

      // 隐藏状态下，到点也不应该发起任何查询。
      setVisibility('hidden');
      queryUsers.mockClear();
      await vi.advanceTimersByTimeAsync(30_000);
      expect(queryUsers).not.toHaveBeenCalled();

      // 恢复可见立即补一次，不必等下一个 30 秒整点。
      setVisibility('visible');
      await flushMicrotasks();
      expect(queryUsers).toHaveBeenCalled();

      // dispose 后：定时器与 visibilitychange 监听器都必须清理干净，不再触发任何查询。
      queryUsers.mockClear();
      stop();
      controller.dispose();
      expect(vi.getTimerCount()).toBe(baselineTimers);
      expect(listeners.size).toBe(0);
      setVisibility('visible'); // 若监听器未被移除，这里会误触发一次补拉
      await vi.advanceTimersByTimeAsync(60_000);
      expect(queryUsers).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
      (globalThis as { document?: unknown }).document = originalDocument;
    }
  });
});

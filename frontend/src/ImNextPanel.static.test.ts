import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('./ImNextPanel.vue', import.meta.url), 'utf8');
const controllerSource = readFileSync(new URL('./controller.ts', import.meta.url), 'utf8');
const conversationModelSource = readFileSync(new URL('./components/conversations/conversation-list-model.ts', import.meta.url), 'utf8');
const messageItemSource = readFileSync(new URL('./components/messages/ImMessageItem.vue', import.meta.url), 'utf8');
const composerSource = readFileSync(new URL('./components/composer/ImMessageComposer.vue', import.meta.url), 'utf8');
const style = source.match(/<style scoped>([\s\S]*?)<\/style>/)?.[1] ?? '';

describe('ImNextPanel static host-safety checks', () => {
  it('delegates the conversation DOM to exactly one visual list component', () => {
    expect(source.match(/<ImConversationList/g)).toHaveLength(1);
    expect(source).not.toContain('<details class="conversation-actions"');
  });

  it('keeps UMD-injected CSS scoped and forbids global reset selectors', () => {
    expect(source).toContain('<style scoped>');
    expect(style).not.toContain(':root');
    expect(style).not.toMatch(/(^|})\s*\*\s*{/);
    expect(style).not.toMatch(/(^|})\s*(button|input|textarea)(?=\s*[,{:])/);
    expect(style).toContain('.im-next *');
  });

  it('has explicit image and notification renderer branches without v-html', () => {
    expect(source).toContain("message.kind === 'image'");
    expect(source).toContain('class="image-bubble"');
    expect(source).toContain('message.notification');
    // 卡片类通知的 content 即卡片 JSON 载体：有卡片时不得渲染原文（2026-08-10 JSON 外露修复）
    expect(source).toContain('<template v-if="!message.card"><b>{{ message.notification.title }}</b><p>{{ message.notification.content }}</p></template>');
    expect(source).not.toContain('v-html');
  });

  it('routes all cards through the safe registry and keeps IM card actions single-flight', () => {
    expect(source.match(/<ImBusinessCard/g)).toHaveLength(2);
    expect(source).toContain('buildCardDisplayModel(message.card');
    expect(source).not.toContain('function isKnownCardRenderer');
    expect(source).not.toContain("['approval', 'workflow.approval', 'todo'");
    expect(source).not.toContain('class="business-card"');
    expect(source).toContain("actionSource: message.notification ? 'nahida-notification' : message.cardAction ? 'nahida-message' : 'none'");
    expect(source).toContain('const cardActionBusy = ref(new Set<string>());');
    expect(source).toContain("if ((!message.notification && !message.cardAction) || action.disabled || action.blockReason !== 'allowed') return;");
    expect(source).toContain('await c.runNotificationCardAction(message, action.key, comment);');
    expect(source).toContain('await c.runMessageCardAction(message, action.key);');
    expect(source).toContain('finally {');
    expect(source).toContain('setCardActionBusy(key, false);');
  });

  it('delegates safe internal card routes to the declared host navigation capability', () => {
    expect(source).toContain("readHostCapability(props.hostBridge, 'navigate')");
    expect(source).toContain('navigate(safeInternalLink);');
    expect(source).not.toContain('window.location');
    expect(source).not.toContain('window.open');
    expect(source).toContain("cardDisplayModel(message).localView === 'merged'");
  });

  it('consumes the host pending conversation and synchronizes the active conversation id', () => {
    expect(source).toContain("readHostCapability(props.hostBridge, 'imWindowState')?.pendingConvId");
    expect(source).toContain('await initialRefreshPromise;');
    expect(source).toContain('await selectChat(conversationId);');
    expect(source).toContain("readHostCapability(props.hostBridge, 'clearPendingConvId')");
    expect(source).toContain('state.activeConversationId = conversationId ?? null;');
    expect(source).toContain('if (state) state.activeConversationId = null;');
  });

  it('keeps quote location separate from reply composition and omits unsupported message actions', () => {
    expect(source).toContain('@click="locateQuotedMessage(message)"');
    expect(source).toContain('class="message-text"');
    expect(source).toContain("if (action === 'reply') c.setReply(message)");
    expect(source).not.toContain('@click="c.replyTo.value = message"');
    expect(source).not.toContain("key: 'edit'");
    expect(source).not.toContain("action === 'edit'");
    expect(source).toContain("message.editedAt ? t('message.edited')");
    expect(source).not.toContain('message.translate');
    expect(source).not.toContain('message.call');
  });

  it('supports development emoji, paste/drop uploads, scoped drafts, and real group-member projection', () => {
    expect(source).toContain('<ImMessageComposer');
    expect(composerSource).toContain('@paste="onPaste"');
    expect(composerSource).toContain('@drop.prevent="onDrop"');
    expect(composerSource).toContain('emojiChoices');
    expect(source).toContain('c.groupMembers.value');
    expect(conversationModelSource).toContain("conversation.kind !== 'system'");
  });

  it('pins a multi-file upload batch to its starting conversation and retains unsent files for retry', () => {
    expect(source).toContain('const conversationId = c.activeConversation.value?.id;');
    expect(source).toContain('if (c.activeConversation.value?.id !== conversationId)');
    expect(source).toContain("error: t('upload.conversationChanged')");
    expect(source).toContain('failure.conversationId !== c.activeConversation.value?.id');
  });

  it('renders own messages on the opposite side and uses only formal around/forward capabilities', () => {
    expect(source).toContain(':own="message.sender.id === c.snapshot.value.self?.id"');
    expect(messageItemSource).toContain('.message-layout--own { flex-direction:row-reverse; }');
    expect(controllerSource).toContain('.messages.listAround(');
    expect(controllerSource).toContain('.messages.forward(');
    expect(controllerSource).not.toContain('/api/');
    expect(controllerSource).not.toContain('new WebSocket');
  });

  it('subscribes only to implemented realtime consistency events and keeps mention/receipt UI explicit', () => {
    for (const kind of ['im.message', 'im.read', 'im.read.peer', 'im.revoke', 'card.update', 'im.member_change', 'notify.push', 'notify.revoke', 'resync']) {
      expect(controllerSource).toContain(`subscribe('${kind}'`);
    }
    expect(controllerSource).not.toContain("subscribe('im.edit'");
    expect(composerSource).toContain(':open="mentionOpen"');
    expect(source).toContain('class="receipt-state"');
  });

  it('locates a conversation mention without routing through normal latest-message selection', () => {
    expect(source).toContain("mentioned: t('conversation.mentioned')");
    expect(source).toContain('@locate-mention="locateConversationMention"');
    expect(source).toContain('await c.focusAround(conversationId, seq)');
    expect(source).toContain("messageList.value?.scrollToMessage(target.id, 'center')");
    expect(source).toContain('c.markMessageViewReady();');
    expect(source).toContain('c.setAtBottom(false);');
  });

  it('keeps group candidate search independent with explicit states and persistent selection', () => {
    expect(source).toContain('c.loadedContacts.value');
    expect(source).toContain('c.scheduleGroupCandidateSearch');
    expect(source).toContain("groupCandidateSearch.value.status === 'loading'");
    expect(source).toContain("groupCandidateSearch.value.status === 'empty'");
    expect(source).toContain("groupCandidateSearch.value.status === 'error'");
    expect(source).toContain('c.groupCandidateSelectedUsers.value.values()');
    expect(source).toContain(':checked="c.groupCandidateSelectedIds.value.has(user.id)"');
    expect(source.match(/c\.resetGroupCandidateSelection\(\)/g)).toHaveLength(2);
  });

  it('opens every contact source through one detail flow before creating a single conversation', () => {
    expect(source).toContain("import ImContactDetailDialog from './components/contacts/ImContactDetailDialog.vue'");
    expect(source.match(/@click="openContactDetail\(/g)).toHaveLength(2);
    expect(source).toContain('@activate-member="openContactDetail"');
    expect(source).not.toContain('@click="enterUser(');
    expect(source).toContain('@send-message="messageSelectedContact"');
    expect(source).toContain('await c.openUser(user);');
    expect(source).toContain("c.activeTab.value = 'chats';");
    expect(source).toContain(':return-focus="contactReturnFocus"');
    expect(source).toContain(':can-send-message="canMessageSelectedContact"');
    expect(controllerSource).toContain("if (user.id === snapshot.value.self?.id) return;");
  });

  // 产品定版（2026-08-11）：通讯录点部门只展开/收起下级，不再打开部门群聊（群聊分段页签已有
  // 部门群入口，两处重复容易点错）；activate-unit 与展开箭头共用 toggleUnit，且死代码 enterDepartment
  // 必须已被删除（其唯一调用点就是这里被替换掉的那个）。
  it('routes directory department clicks to expand/collapse instead of opening the department conversation', () => {
    expect(source).toContain('@activate-unit="toggleUnit"');
    expect(source).not.toContain('@activate-unit="enterDepartment"');
    expect(source).not.toContain('function enterDepartment(');
    expect(source).not.toContain('async function enterDepartment(');
  });

  it('opens global notification preferences only through the injected SDK contract', () => {
    expect(source).toContain("import ImNotificationPreferences from './components/preferences/ImNotificationPreferences.vue'");
    // 2026-08-10 Figma 改版：入口挂在 rail 汉堡按钮上（类名保留作为唯一入口标记）
    expect(source).toContain('global-settings-button');
    expect(source).toContain("readHostCapability(props.hostBridge, 'im')?.preferences");
    expect(source).toContain(':client="notificationPreferenceClient"');
    expect(source).toContain(':return-focus="notificationSettingsTrigger"');
    expect(source).not.toMatch(/fetch\(|axios|\/api\/v1\/im\/preferences/);
  });

  it('keeps ordinary-group role controls owner-only, confirmed, and single-flight', () => {
    expect(source).toContain('c.canSetMemberAdmin(member)');
    expect(source).toContain('c.canTransferOwnership(member)');
    expect(source).toContain("confirmAction({ content: `${t('group.transferOwnerConfirm')}");
    expect(source).not.toMatch(/window\.(confirm|prompt|alert)\(/);
    expect(source).toContain(":disabled=\"c.groupRoleOperation.value.status === 'pending'\"");
    expect(source).toContain("c.groupRoleOperation.value.userId === member.userId");
    expect(source).toContain("c.activeConversation.value.kind === 'group'");
  });

  it('exposes group governance without conflating personal DND or bypassing SDK authority', () => {
    expect(source).toContain('c.announcementText.value');
    expect(source).toContain('v-model="c.announcementDraft.value"');
    expect(source).toContain('maxlength="4000"');
    expect(source).toContain('@click="toggleMemberSendMuted(member)"');
    expect(source).toContain(':model-value="Boolean(c.activeConversation.value.allMuted)"');
    expect(source).toContain(':disabled="!c.canGovernGroup.value || c.groupGovernancePending.value"');
    expect(controllerSource).toContain('caps.im.groups.setMuteAll(');
    expect(controllerSource).toContain('caps.im.groups.setMemberSendMuted(');
    expect(controllerSource).toContain('caps.im.groups.setAnnouncement(');
    expect(controllerSource).toContain('caps.im.groups.clearAnnouncement(');
  });

  it('marks the whole rail plus search row and chat header as window drag handles', () => {
    // 2026-08-11：rail 整区可拖（button 交互控件由外壳排除清单兜底），与搜索行/聊天顶栏同一 data-im-drag-handle 契约
    expect(source).toContain('<nav class="im-rail" data-im-drag-handle');
    expect(source).toContain('<div class="sidebar-search-row" data-im-drag-handle>');
  });

  // 需求6（2026-08-11）：事件通知(system/recall)必须与日期时间分隔线视觉对齐，.system-message 不能再是零样式的裸 <p>
  it('gives the system/recall event notice its own CSS instead of relying on bare <p> margins', () => {
    expect(style).toMatch(/\.system-message\s*{[^}]*text-align:center/);
    expect(style).toMatch(/\.system-message\s*{[^}]*margin:0/);
    expect(style).toMatch(/\.system-message\s*{[^}]*overflow-wrap:anywhere/);
    // 不动 .notification-message（系统通知会话里的白底卡片，另一套东西）
    expect(style).toContain('.notification-message {');
  });

  // 需求7（2026-08-11）：当天分隔线短时间+可展开，非当天分隔线是不可交互的纯文本（不是点了没反应的按钮）
  it('collapses today\'s time divider to a clock and keeps it expandable via a real button', () => {
    expect(source).toContain('isTodayDivider(message)');
    expect(source).toContain('class="message-time-divider__toggle"');
    expect(source).toContain(':aria-expanded="expandedDividers.has(message.id)"');
    expect(source).toContain('@click="toggleDivider(message)"');
    // 非当天分支必须是 <span>，不能也做成按钮
    expect(source).toMatch(/<span v-else>{{ dividerText\(message\) }}<\/span>/);
    expect(controllerSource).not.toContain('isImSameCalendarDay'); // 时区判定是纯函数，不应该漏到 controller 层
  });

  // 需求A（2026-08-11）：通讯录侧栏部门树折叠/展开时不应因滚动条有无而让内容区宽度突变，
  // scrollbar-gutter:stable 恒定预留滚动条槽宽消除这个跳动。
  // 需求B（2026-08-11）：滚动条只作用于页签下方的内容区（.contacts__scroll），不再挂在
  // .contacts 整体上——.contacts 本身必须是不滚动的容器，预留槽与 margin 配平都在滚动容器上。
  it('reserves a stable scrollbar gutter on the contacts scroll region, not the whole panel', () => {
    expect(style).toMatch(/\.contacts__scroll\s*{[^}]*scrollbar-gutter:stable/);
    // .contacts 自身不再滚动（页签固定在其中，见下一条守卫），滚动相关声明不应挂在它身上
    expect(style).toMatch(/\.contacts\s*{[^}]*overflow:hidden/);
    expect(style).not.toMatch(/\.contacts\s*{[^}]*scrollbar-gutter:stable/);
    // 预留槽宽后右侧视觉留白改由槽宽承担，树/联系人行的 margin-right 收到 0 避免左右不对称
    expect(style).toContain('.contacts__scroll > .im-org-tree,.contacts__scroll > .contact,.contacts__scroll > .empty-contacts { margin:0 0 0 16px; }');
  });

  // 尺寸基准：按参考应用（微信 Mac）实测比例，为 Figma 定稿的 0.75 倍——
  // rail 宽 60（12+36+12）、按钮盒 36、字形 20、按钮间距 12（行中心距 36+12=48）。
  // 🔴 字形尺寸必须与按钮外框一起锁：此前只锁外框，导致导航字形长期停在 29/24 而无人察觉。
  it('sizes the rail column and its glyphs to the reference-app scale', () => {
    // 2026-10-17 标题栏改版：窗控与自己头像移到顶部标题栏，rail 顶部不再给三灯留 40 的位，收到 8（与内容卡片上边距一致）
    expect(style).toContain('.im-rail { display:flex;width:60px;flex:0 0 60px;flex-direction:column;align-items:center;padding:8px 12px 16px;background:transparent; }');
    expect(style).toContain('.im-rail__nav { display:flex;flex-direction:column;gap:12px;margin-top:0; }');
    expect(style).toMatch(/\.im-rail__nav-btn \{ display:flex;width:36px;height:36px;/);
    expect(style).toMatch(/\.im-rail__logo \{ display:grid;width:36px;height:36px;/);
    // 自己头像已移出 rail（在标题栏，28），rail 不得再出现头像按钮
    expect(style).not.toContain('.im-rail__self');
    expect(source).not.toContain('class="im-rail__self"');
    expect(source).toContain('<ImBrandLogo :width="25" :height="17" />');
    // 三个导航按钮的字形都必须是 20；禁止再出现历史上的 29/24
    expect(source).not.toContain(':size="29"');
    expect(source).not.toContain(':size="24"');
    expect(source.match(/class="im-rail__nav-btn[^"]*"[\s\S]{0,600}?:size="20"/g)).toHaveLength(3);
    // 聊天顶部「更多」字形 24（该处仍按 Figma 定稿，不随 rail 缩放）
    expect(style).toContain('[data-kimpo-extension="chat-settings"] { padding:2px; }');
  });

  // 2026-08-11 回归守卫：「顶级分类收起后再也展不开」。默认展开第一级的 watch 数据源必须是
  // 结构真身数组 c.snapshot.value.directory，不能是叠加在线态的投影 computed c.directory.value——
  // 投影每次重算都产出新数组，而 expandDepartment 一进门就同步置 target.loading=true 会让投影失效、
  // 触发本 watch 把根部门 id 加回 expandedUnits；此时 toggleUnit 正停在 await 上，恢复后看到 id
  // 已存在便走 delete 分支，一次点击被反转两次。曾因一次"全局把 snapshot.value.directory 换成
  // directory.value"的替换而引入，故在此锁死数据源。
  it('drives the default first-level expansion from the structural directory, not the presence projection', () => {
    const watchBlock = source.slice(source.indexOf('// 通讯录默认展开第一级'), source.indexOf('onMounted('));
    expect(watchBlock).toContain('() => c.snapshot.value.directory');
    expect(watchBlock).not.toContain('() => c.directory.value');
    // 树渲染那两处仍必须用投影版，否则成员在线态不显示
    expect(source).toContain(':units="c.directory.value"');
  });

  // 需求B（2026-08-11）追加守卫：分段页签结构上必须在滚动容器之外，防止回归成"整块滚动"
  // ——用户反馈滚动条贯穿到页签会把页签一起滚出可视区，页签要恒定可见。
  it('keeps the contacts segmented tabs outside the scroll container in the DOM order', () => {
    const tabsIndex = source.indexOf('class="contacts-tabs"');
    const scrollIndex = source.indexOf('class="contacts__scroll"');
    expect(tabsIndex).toBeGreaterThan(-1);
    expect(scrollIndex).toBeGreaterThan(-1);
    // 页签的开标签必须出现在滚动容器开标签之前，说明页签是滚动容器的前一个兄弟节点而非其内部子节点
    expect(tabsIndex).toBeLessThan(scrollIndex);
  });

  // 需求8（2026-08-11）：引用信息挪到气泡下方(#after 插槽最前)，不再塞在 #bubble 内部；去掉"引用 · "前缀
  it('renders the reply quote below the bubble via the #after slot, not inside #bubble', () => {
    const bubbleBlock = source.slice(source.indexOf('<template #bubble>'), source.indexOf('<template #status>'));
    const afterBlock = source.slice(source.indexOf('<template #after>'), source.indexOf('</ImMessageItem>'));
    expect(bubbleBlock).not.toContain('message.replyTo');
    expect(bubbleBlock).not.toContain('class="reply"');
    expect(afterBlock).toContain('message-quote');
    expect(afterBlock.indexOf('message-quote')).toBeLessThan(afterBlock.indexOf('receipt-state'));
    expect(source).not.toContain("t('quote') }} · {{");
    expect(source).toContain('quoteLineText(message)');
    expect(source).toContain('isOwnMessage(message)');
  });
});

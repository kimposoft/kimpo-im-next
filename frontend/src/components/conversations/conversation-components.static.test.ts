import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const preview = readFileSync(new URL('./ImConversationPreview.vue', import.meta.url), 'utf8');
const list = readFileSync(new URL('./ImConversationList.vue', import.meta.url), 'utf8');
const model = readFileSync(new URL('./conversation-list-model.ts', import.meta.url), 'utf8');
const search = readFileSync(new URL('./ImSearchBar.vue', import.meta.url), 'utf8');
const floating = readFileSync(new URL('../primitives/ImFloatingMenu.vue', import.meta.url), 'utf8');
const panel = readFileSync(new URL('../../ImNextPanel.vue', import.meta.url), 'utf8');

describe('conversation visual DOM contract', () => {
  it('keeps the frozen row hierarchy and dimensions explicit', () => {
    for (const name of ['avatar', 'content', 'header', 'title', 'time', 'footer', 'summary']) {
      expect(preview).toContain(`im-conversation-preview__${name}`);
    }
    expect(preview).toContain('role="option"');
    expect(preview).toContain(':aria-selected="selected"');
    // 2026-08-10 Figma 改版：行高 72（4px 内衬 + 圆角内卡），选中态=品牌描边内卡
    expect(preview).toContain('height: var(--im-uikit-conversation-row-height, 72px)');
    expect(preview).toContain('im-conversation-preview__card');
    expect(preview).toContain('size="md"');
  });

  it('supports pointer, keyboard, and context menu entry without details', () => {
    expect(preview).toContain('@contextmenu="openFromContext"');
    expect(preview).toContain("event.key === 'ContextMenu'");
    expect(list).toContain('variant="conversation"');
    expect(list).toContain('v-model:open="menuOpen"');
    expect(list).toContain('v-bind="$attrs"');
    expect(list).toContain("event.key === 'ArrowDown'");
    expect(list).toContain("event.key === 'ArrowUp'");
    expect(list).toContain("event.key === 'Home'");
    expect(list).toContain("event.key === 'End'");
    expect(list).toContain(':tab-index="focusedConversationId === conversation.id ? 0 : -1"');
    expect(preview).not.toMatch(/role="option"[\s\S]*?<button/);
    expect(list).not.toContain('<details');
  });

  it('drops the hover more-button and keeps single-chat presence always-on', () => {
    // 悬停「更多」按钮已移除：不再有 actions-wrapper/more 容器与触发函数
    expect(preview).not.toContain('im-conversation-preview__actions-wrapper');
    expect(preview).not.toContain('im-conversation-preview__more');
    expect(preview).not.toContain('openFromButton');
    // 单聊判据 = peerUserId；群聊/部门群/系统通知无该字段故恒不出状态点/后缀（判据落在纯函数里，preview 恒传）
    expect(model).toContain('conversation.peerUserId');
    expect(preview).toContain(':presence="presence"');
    expect(preview).toContain('{{ conversation.title }}{{ titleSuffix }}');
  });

  it('renders an accessible UIKit mention hint and forwards a dedicated locate event', () => {
    expect(preview).toContain('im-conversation-preview__mention');
    expect(preview).toContain("'locate-mention': [conversation: Conversation, seq: number]");
    expect(preview).toContain('@click.stop="locateMention"');
    expect(preview).toContain('aria-hidden="true"');
    expect(list).toContain("data-menu-key=\"mention\"");
    expect(list).toContain("'locate-mention': [conversationId: string, seq: number]");
    expect(list).toContain("emit('locate-mention', conversation.id, seq)");
  });

  it('renders a red draft projection ahead of the server summary', () => {
    expect(preview).toContain('im-conversation-preview__draft-prefix');
    expect(preview).toContain('[{{ draftLabel }}]');
    expect(preview).toContain('getConversationPreviewSummary(conversation, draft).text');
    expect(preview).toContain('color:var(--im-uikit-text-error,#e84f4f)');
    expect(list).toContain(':draft="drafts?.get(conversation.id)"');
    expect(panel).toContain(':drafts="c.conversationDrafts.value"');
  });

  it('keeps the search wrapper and accessible input separate', () => {
    expect(search).toContain('class="im-search-bar__input-wrapper"');
    expect(search).toContain(':aria-label="label"');
    // 2026-08-10 Figma 改版：36 高、圆角8、#ebebeb 底
    // 2026-08-11 尺寸基准改按参考应用实测：搜索输入 36→26 高（外层搜索行仍 61，输入在其中居中）
    expect(search).toContain('height: 26px');
    expect(search).toContain('border-radius: var(--im-uikit-radius-md, 8px)');
  });

  it('cleans teleported menu listeners and restores focus on controlled close', () => {
    expect(floating).toContain('<Teleport :to="teleportTo">');
    expect(floating).toContain("'im-uikit-theme'");
    expect(floating).toContain('onBeforeUnmount(() =>');
    expect(floating).toContain('removeListeners();');
    expect(floating).toContain('if (target?.isConnected && focusStillBelongsToClosingMenu) target.focus();');
    expect(floating).toContain("anchor.setAttribute('aria-controls', menuId)");
    expect(floating).toContain("anchor.setAttribute('aria-expanded', String(open))");
  });

  it('marks Kimpo-only tabs and the unified conversation creation entry outside the UIKit baseline', () => {
    expect(panel).toContain('data-kimpo-extension="conversation-contact-tabs"');
    expect(panel).toContain('data-kimpo-extension="conversation-create"');
  });
});

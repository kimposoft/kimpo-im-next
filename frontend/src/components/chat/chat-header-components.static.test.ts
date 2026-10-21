import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const component = readFileSync(new URL('./ImChatHeader.vue', import.meta.url), 'utf8');
const panel = readFileSync(new URL('../../ImNextPanel.vue', import.meta.url), 'utf8');

describe('ImChatHeader visual contract', () => {
  // 2026-08-10 Figma 改版：61 高、左右 20 内距、名字 16/Medium + 在线状态点（无头像）
  it('matches the Figma ChatHeader geometry and typography', () => {
    expect(component).toContain('var(--im-uikit-chat-header-height, 61px)');
    expect(component).toContain('padding: 0 20px');
    expect(component).toContain('im-chat-header__presence');
    // 2026-08-11 尺寸基准改按参考应用（微信 Mac）实测：标题字号 16→14（Figma 稿不同步，
    // 见 floating-shell.static.test.ts 里的两套权威分工说明）。容器高 61 两边本就一致，未动。
    expect(component).toContain('font-size: 14px');
    expect(component).toContain('font-weight: 500');
    expect(component).toContain('border-bottom: 1px solid var(--im-uikit-border-lighter');
    expect(component).toContain('im-chat-header__left');
    expect(component).toContain('im-chat-header__actions');
  });

  it('keeps product actions outside the visual primitive and marks them as extensions', () => {
    expect(component).toContain('<slot name="actions" />');
    expect(component).not.toContain('selectionMode');
    expect(component).not.toContain('markVisibleNotificationsRead');
    expect(component).not.toContain('drawerOpen');
    expect(panel).toContain('<ImChatHeader');
    expect(panel).toContain('<template #actions>');
    expect(panel).toContain('data-kimpo-extension="system-mark-read"');
    expect(panel).toContain('data-kimpo-extension="message-selection"');
    expect(panel).toContain('data-kimpo-extension="chat-settings"');
  });
});

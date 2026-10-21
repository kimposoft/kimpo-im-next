import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const panel = readFileSync(new URL('../../ImNextPanel.vue', import.meta.url), 'utf8');
const item = readFileSync(new URL('./ImMessageItem.vue', import.meta.url), 'utf8');

describe('virtual UIKit message integration', () => {
  it('routes the real message collection through one bounded virtual list', () => {
    expect(panel.match(/<ImVirtualMessageList/g)).toHaveLength(1);
    expect(panel).toContain(':messages="c.messages.value"');
    expect(panel).not.toContain('v-for="(message, index) in c.messages.value"');
    expect(panel).toContain('@top-reached="onVirtualTopReached"');
    expect(panel).toContain('historyRequestPending');
    expect(panel).toContain("messageList.value?.scrollToMessage(target.id, 'center')");
    expect(panel).toContain('for (let pass = 0; pass < 3; pass += 1)');
    expect(panel).toContain('viewport?.atBottom');
  });

  // 2026-08-10 Figma 改版：白底气泡圆角4、内边距 4/8、token 上色（暗色自动跟随）
  it('matches the Figma message layout geometry without grouped negative margins', () => {
    for (const part of ['avatar', 'content', 'header', 'body', 'bubble', 'operate']) {
      expect(item).toContain(`message-layout__${part}`);
    }
    expect(item).toContain('size="md"');
    expect(item).toContain('padding:4px 8px');
    expect(item).toContain('border-radius:var(--im-uikit-radius-xs,4px)');
    expect(item).toContain('background:var(--im-uikit-bg-bubble-peer,#fff)');
    expect(item).toContain('background:var(--im-uikit-bg-bubble-own,#fff)');
    expect(item).toContain('box-shadow:none');
    expect(item).not.toMatch(/margin-(top|bottom):\s*-/);
  });

  it('moves message actions to the shared teleported menu and keeps every permission gate', () => {
    expect(item).toContain('variant="message"');
    expect(item).toContain('class="message-layout__menu-trigger"');
    expect(item).toContain('position:absolute');
    for (const action of ['reply', 'copy', 'forward', 'receipt', 'reaction', 'revoke']) {
      expect(panel).toContain(`action === '${action}'`);
    }
    expect(panel).toContain('canForwardMessage(message)');
    expect(panel).toContain('c.canLoadReceipt(message)');
    expect(panel).toContain('c.canRevoke(message)');
  });

  it('retains special renderers, selection, receipts, reactions and safe text links', () => {
    for (const token of ['message.notification', "message.kind === 'system'", "message.kind === 'recall'", "message.kind === 'image'", "message.kind === 'card'", 'message.attachment', '<ImBusinessCard', 'buildCardDisplayModel', 'message.receipt', 'message.reactions', 'c.selectionMode.value']) {
      expect(panel).toContain(token);
    }
    expect(panel).toContain('linkifyMessageText');
    expect(panel).toContain('rel="noopener noreferrer"');
    expect(panel).not.toContain('v-html');
    expect(panel).toContain('message-time-divider');
    expect(panel).toContain('message-unread-divider');
    expect(panel).toContain(":edited-label=\"message.editedAt ? t('message.edited') : undefined\"");
    expect(item).toContain('class="message-layout__edited"');
    expect(item).not.toContain('edit-message');
  });
});

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const setting = readFileSync(new URL('./ImChatSetting.vue', import.meta.url), 'utf8');
const section = readFileSync(new URL('./ImSettingSection.vue', import.meta.url), 'utf8');
const switchRow = readFileSync(new URL('./ImSettingSwitchRow.vue', import.meta.url), 'utf8');
const sharedSwitch = readFileSync(new URL('../primitives/ImSwitch.vue', import.meta.url), 'utf8');
const panel = readFileSync(new URL('../../ImNextPanel.vue', import.meta.url), 'utf8');

describe('chat setting visual primitives', () => {
  // 2026-08-10 Figma 改版：353 宽浮层卡（#f5f5f5 底 + 描边 + 圆角8 + 投影）
  it('locks the Figma overlay width, header, inset and scrolling region', () => {
    expect(setting).toContain('width: 353px');
    expect(setting).toContain('min-width: 353px');
    expect(setting).toContain('max-width: 353px');
    expect(setting).toContain('border-radius: var(--im-uikit-radius-md, 8px)');
    expect(setting).toContain('box-shadow: var(--im-uikit-shadow-popup');
    expect(setting).toContain('overflow-y: auto');
    expect(setting).toContain('flex: 0 0 47px');
  });

  // 需求A（2026-08-11）：浮层内容长短会变（不同会话类型可见的分组/成员数不同），内容不足一屏
  // 与超出一屏之间切换时不应因滚动条有无导致内容区宽度突变。
  it('reserves a stable scrollbar gutter on the scroll region so it never jumps width', () => {
    expect(setting).toContain('scrollbar-gutter: stable;');
  });

  // 2026-08-11 底部被裁切修复：宿主把 .chat-setting-overlay 的
  // position:absolute + top/bottom 叠在本组件根元素上，若根元素再显式给
  // height:100%，三者（top/height/bottom）同时非 auto 即过约束，浏览器会
  // 丢弃 bottom 只按 height 计算，面板底边超出 .im-body 可视区被裁掉且
  // 内部滚动区滚到底也补不回来。锁定改为 height:auto 交给 top+bottom 反解，
  // 并用 max-height:100% 兜底防止未来挪作 flex 子项时意外溢出；同时守住
  // 不再出现裸的 height:100%（区别于 max-height:100% / min-height:100%）。
  it('keeps the overlay height unconstrained so top+bottom drive it instead of an explicit 100%', () => {
    expect(setting).toContain('height: auto;');
    expect(setting).toContain('max-height: 100%;');
    // 反向锁：只检查 .im-chat-setting 根规则块本身（而非 __close svg 等
    // 图标 100% 宽高这类无关声明），不允许再出现独立的 height: 100%
    // （前面不带 max-/min- 前缀），那正是曾经引发 top+height+bottom
    // 过约束、裁掉面板底部内容的写法。
    const rootRuleMatch = setting.match(/\.im-chat-setting\s*\{[^}]*\}/);
    expect(rootRuleMatch).not.toBeNull();
    // 先剥掉块内注释再匹配，避免解释过约束原理的中文注释里出现的
    // "height:100%" 字样把这条反向锁自己断言失败。
    const rootRuleWithoutComments = rootRuleMatch![0].replace(/\/\*[\s\S]*?\*\//g, '');
    expect(rootRuleWithoutComments).not.toMatch(/(?<!-)height:\s*100%/);
  });

  it('provides native close, Escape and focus semantics without external assets', () => {
    expect(setting).toContain(':aria-label="closeLabel"');
    expect(setting).toContain('@keydown.esc.stop.prevent="requestClose"');
    expect(setting).toContain("closeButton.value?.focus()");
    expect(setting).toContain('tabindex="0"');
    expect(setting).toContain('role="region"');
    expect(setting).not.toContain('tencent');
    expect(setting).not.toMatch(/https?:\/\//);
  });

  // 2026-08-10 Figma 改版：分组内容坐白色圆角卡，不再画分隔线
  it('keeps sections, white cards and action slots free of business permissions', () => {
    expect(section).toContain('im-setting-section--divided');
    expect(section).toContain('background: var(--im-uikit-bg-bubble, #fff)');
    expect(section).toContain('<slot name="actions" />');
    expect(section).not.toMatch(/permission|owner|admin|department/i);
    expect(setting).toContain('<slot name="header-actions" />');
    expect(setting).toContain('<slot />');
  });

  // 2026-08-10 Figma 改版：开关 38×20（token 定值），行高 44
  it('uses the shared token-sized switch inside an exact 44px row', () => {
    expect(switchRow).toContain("import ImSwitch from '../primitives/ImSwitch.vue'");
    expect(switchRow).toContain('height: 44px');
    expect(switchRow).toContain(':model-value="modelValue"');
    expect(switchRow).toContain('@update:model-value');
    expect(sharedSwitch).toContain('var(--im-uikit-switch-width, 40px)');
    expect(sharedSwitch).toContain('var(--im-uikit-switch-height, 24px)');
  });

  it('integrates the setting primitives and routes preference failures through the host', () => {
    expect(panel).toContain("import ImChatSetting from './components/settings/ImChatSetting.vue'");
    expect(panel).toContain('<ImChatSetting');
    expect(panel).toContain('<ImSettingSection');
    expect(panel).toContain('<ImSettingSwitchRow');
    expect(panel).toContain("await c.togglePinned(conversation)");
    expect(panel).toContain("await c.toggleMuted(conversation)");
    expect(panel).toContain("readHostCapability(props.hostBridge, 'message')?.error(t('error.conversationAction'))");
    expect(panel).not.toContain('<aside v-if="c.drawerOpen.value" class="setting"');
    expect(panel).toContain(':disabled="isGroupCandidateDisabled(user)"');
  });

  it('keeps department membership read-only while preserving ordinary group controls', () => {
    expect(panel).toContain("v-if=\"c.activeConversation.value.kind === 'department'\"");
    expect(panel).toContain("v-if=\"c.activeConversation.value.kind === 'group'\"");
    expect(panel).toContain('c.canSetMemberAdmin(member)');
    expect(panel).toContain('c.canTransferOwnership(member)');
    expect(panel).toContain('c.canKickMember(member)');
    expect(panel).toContain('c.canInvite.value');
    expect(panel).toContain('c.canEditGroup.value');
    expect(panel).toContain('c.canLeaveGroup.value');
    expect(panel).toContain('c.canDissolveGroup.value');
  });

  it('makes profile, hide action, group identity and type discoverable inside settings', () => {
    expect(panel).toContain("c.activeConversation.value.kind === 'single' && singleSettingUser");
    expect(panel).toContain('@click="openSingleSettingContact"');
    expect(panel).toContain('@click="hideActiveFromSettings"');
    expect(panel).toContain("t('setting.groupId')");
    expect(panel).toContain("t('setting.groupType')");
    expect(panel).toContain('c.activeConversation.value.id');
  });
});

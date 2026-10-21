import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const composer = readFileSync(new URL('./ImMessageComposer.vue', import.meta.url), 'utf8');
const floatingMenu = readFileSync(new URL('../primitives/ImFloatingMenu.vue', import.meta.url), 'utf8');

describe('UIKit message composer integration', () => {
  // 2026-08-10 Figma 改版：输入区 180 高（工具行 44 + 无边框输入 + 引用条 25）
  it('keeps the Figma composer geometry and quote chip', () => {
    expect(composer).toContain('height:180px');
    expect(composer).toContain('flex:0 0 44px');
    expect(composer).toContain('min-height:25px');
    expect(composer).toContain('im-composer__quote');
  });

  // 2026-08-10 Figma 改版：文件/图片拆为独立按钮直连选择器，附件菜单移除（视频经文件按钮任选）
  it('uses portal menus for emoji and mentions with direct file/image pickers', () => {
    expect(composer.match(/<ImFloatingMenu/g)).toHaveLength(2);
    expect(composer).not.toContain('variant="attachment"');
    expect(composer).toContain("openFilePicker('image/*')");
    expect(composer).toContain("openFilePicker('')");
    expect(composer).toContain('role="menuitem"');
    expect(composer).toContain('System Unicode characters only');
    expect(composer).toContain('no Tencent emoji asset-fidelity claim');
  });

  it('settles teleported slot content before focusing while retaining delegated mouse selection', () => {
    const focusRoutine = floatingMenu.match(/async function focusFirstItemAfterRender[\s\S]*?\n}/)?.[0] ?? '';
    expect(focusRoutine.match(/await nextTick\(\)/g)).toHaveLength(2);
    expect(focusRoutine).toContain('updatePosition()');
    expect(focusRoutine).toContain("menuItems()[0]?.focus({ preventScroll: true })");
    expect(floatingMenu).toContain('@click="onMenuClick"');
    expect(floatingMenu).toContain("emit('select', { key: target.dataset.menuKey, element: target })");
    expect(floatingMenu).toContain('focusStillBelongsToClosingMenu');
    expect(floatingMenu).toContain('target?.isConnected && focusStillBelongsToClosingMenu');
  });

  it('provides at least 50 genuinely unique Unicode emoji keys', () => {
    const source = composer.match(/const emojiChoices = \[([\s\S]*?)\n\];/)?.[1] ?? '';
    const choices = [...source.matchAll(/'([^']+)'/g)].map(match => match[1]!);
    expect(choices.length).toBeGreaterThanOrEqual(50);
    expect(new Set(choices).size).toBe(choices.length);
  });

  it('preserves IME-aware send, paste/drop upload, and one-way mention registration', () => {
    expect(composer).toContain('shouldSendFromKeydown(event)');
    expect(composer).toContain('@paste="onPaste"');
    expect(composer).toContain('@drop.prevent="onDrop"');
    expect(composer).toContain("emit('mention', member, token)");
    expect(composer).toContain("emit('mentionAll', props.labels.mentionAll)");
    expect(composer).toContain(':auto-focus="false"');
    expect(composer).toContain("event.key === 'ArrowDown'");
  });

  it('retains the original File after upload failure and exposes distinct retry/cancel actions', () => {
    expect(composer).toContain('failure.file.name');
    expect(composer).toContain("emit('retryUpload', failure)");
    expect(composer).toContain("emit('dismissUploadFailure', failure.id)");
    expect(composer).toContain('failure.conversationId === props.activeConversationId');
    expect(composer).toContain('v-for="failure in visibleUploadFailures"');
    expect(composer).not.toContain('send.retry');
  });

  it('exposes a narrow imperative focus boundary without watching conversation state', () => {
    expect(composer).toContain('function focusInput()');
    expect(composer).toContain("input.value?.focus({ preventScroll: true })");
    expect(composer).toContain('defineExpose({ focusInput })');
  });

  it('receives a reason-specific disabled placeholder from the panel', () => {
    const panel = readFileSync(new URL('../../ImNextPanel.vue', import.meta.url), 'utf8');
    expect(panel).toContain("t('placeholder.readonly')");
    expect(panel).toContain("t('placeholder.muted')");
    expect(composer).toContain(':placeholder="labels.placeholder"');
  });

  // 2026-08-11 只读会话去重复提醒：占位符已写明「当前会话只读」，红字提醒与之重复，只读分支不再渲染；
  // 禁言分支（!canWrite 的另一个成因）产品未要求去掉，须保留。
  it('suppresses the red notice for read-only conversations while keeping it for muted ones', () => {
    // 条件收窄为「不可写 且 非只读」，渲染内容固定为禁言文案，不再按 readonly 三元切换
    expect(composer).toContain('<p v-if="!canWrite && !readonly" class="im-composer__notice">{{ labels.muted }}</p>');
    expect(composer).not.toContain('readonly ? labels.readonly : labels.muted');
    // labels.readonly 这个 prop 字段本任务不删（即便模板内暂无引用）：宿主 ImNextPanel 仍在传值，
    // placeholder 的只读文案计算依赖同名 i18n 键，类型契约需要保留。
    expect(composer).toContain('readonly: string;');
  });
});

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const header = read('./ImDialogHeader.vue');

// 2026-10-17 标题栏改版配套：插件内弹窗统一弹窗头，与窗口标题栏同一条规则（macOS 关闭在左，其他平台在右）
describe('ImDialogHeader', () => {
  it('places the close button by platform and uses the Figma close glyph', () => {
    expect(header).toContain('inject(IM_WINDOW_PLATFORM, computed(() => \'other\' as const))');
    expect(header).toContain(':class="`im-dialog-header--${platform}`"');
    expect(header).toContain('.im-dialog-header--other .im-dialog-header__close { order:2;margin-left:auto; }');
    expect(header).toContain('<ImIcon name="windowClose" :size="20" />');
    expect(header).toContain('min-height:48px');
  });

  it('is used by every plugin dialog instead of ad-hoc "×" close buttons', () => {
    const consumers = [
      '../contacts/ImContactDetailDialog.vue',
      '../contacts/ImGroupDetailDialog.vue',
      '../history/ImChatHistoryDialog.vue',
      '../preferences/ImNotificationPreferences.vue'
    ];
    for (const path of consumers) expect(read(path)).toContain('<ImDialogHeader');
    const panel = read('../../ImNextPanel.vue');
    // 转发 / 建群邀请 / 合并转发查看 / 文件预览
    expect(panel.match(/<ImDialogHeader /g)).toHaveLength(4);
    expect(panel).not.toMatch(/<button[^>]*>×<\/button>/);
  });
});

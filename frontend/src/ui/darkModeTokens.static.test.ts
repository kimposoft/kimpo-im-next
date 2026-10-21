/*
 * 暗色适配静态守卫（2026-08-12 暗色改造批）。
 * 锁三件事：①新增语义 token 存在且字面值 token 有暗色推导；
 * ②业务卡片容器 .notification-message 的底色/描边走 token（不得回退成写死 #fff/#e5e8ef）；
 * ③状态点 .presence 的描边跟随容器底 token（写死 #fff 会在暗色下变白环）。
 * 反向断言（not.toContain）是为了让"改回硬编码"这一动作精确变红。
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const tokens = readFileSync(new URL('./im-uikit-tokens.css', import.meta.url), 'utf8');
const panel = readFileSync(new URL('../ImNextPanel.vue', import.meta.url), 'utf8');

/** 取出 html.dark .im-uikit-theme { ... } 块正文，用来核对暗色推导 */
function darkBlock(css: string): string {
  const start = css.indexOf('html.dark .im-uikit-theme {');
  expect(start).toBeGreaterThan(-1);
  const end = css.indexOf('}', start);
  expect(end).toBeGreaterThan(start);
  return css.slice(start, end);
}

describe('dark-mode token contract', () => {
  it('declares every new semantic token in the light block', () => {
    const expected = [
      '--im-uikit-success: rgb(var(--success-color, 103 194 58))',
      '--im-uikit-warning: rgb(var(--warning-color, 250 173 20))',
      '--im-uikit-bg-brand-soft: rgb(var(--primary-color, 8 119 244) / 0.08)',
      '--im-uikit-bg-warning-soft: rgb(var(--warning-color, 250 173 20) / 0.18)',
      '--im-uikit-bg-card: #fff',
      '--im-uikit-bg-muted: #f7f8fa',
      '--im-uikit-bg-image-placeholder: #eef1f5',
    ];
    for (const decl of expected) expect(tokens).toContain(decl);
  });

  it('gives the three literal-valued tokens a dark derivation', () => {
    const dark = darkBlock(tokens);
    expect(dark).toContain('--im-uikit-bg-card: #2f2f2f');
    expect(dark).toContain('--im-uikit-bg-muted: #1f1f1f');
    expect(dark).toContain('--im-uikit-bg-image-placeholder: #333');
    // 三元组 token 由宿主在 html.dark 下自动翻转，不得在暗色块里重复声明
    // （匹配带冒号的声明形式，避免误伤注释里对该 token 的提及）
    expect(dark).not.toContain('--im-uikit-text-on-primary:');
    // 输入框比气泡亮一档，暗色下保持层级差
    expect(dark).toContain('--im-uikit-bg-field: #3a3a3a');
    expect(dark).toContain('--im-uikit-bg-bubble: #2f2f2f');
  });

  it('routes the business-card container through tokens instead of hardcoded light values', () => {
    expect(panel).toContain(
      '.notification-message { display:grid;gap:8px;margin:14px auto;padding:12px 14px;width:min(90%,460px);background:var(--im-uikit-bg-card,#fff);border:1px solid var(--im-uikit-border-lighter,#e5e8ef);',
    );
    // 反向锁：卡片底/描边一旦改回裸硬编码即变红
    expect(panel).not.toContain('.notification-message { display:grid;gap:8px;margin:14px auto;padding:12px 14px;width:min(90%,460px);background:#fff;');
    expect(panel).not.toContain('border:1px solid #e5e8ef;border-radius:9px');
  });

  it('anchors the presence dot ring to the container background token', () => {
    expect(panel).toContain('border:2px solid var(--im-uikit-bg-surface,#fff);border-radius:50%;background:var(--im-uikit-presence-online,#25b36b)');
    // 反向锁：描边写死白色即变红
    expect(panel).not.toContain('.presence { position:absolute;right:-1px;bottom:-1px;width:9px;height:9px;border:2px solid #fff;');
  });
});

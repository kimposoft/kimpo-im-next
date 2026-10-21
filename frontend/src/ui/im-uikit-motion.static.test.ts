import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const floatingMenu = readFileSync(new URL('../components/primitives/ImFloatingMenu.vue', import.meta.url), 'utf8');
const composer = readFileSync(new URL('../components/composer/ImMessageComposer.vue', import.meta.url), 'utf8');
const panel = readFileSync(new URL('../ImNextPanel.vue', import.meta.url), 'utf8');

describe('frozen UIKit motion contract', () => {
  it('keeps every floating popup on the official Dropdown trajectory', () => {
    expect(floatingMenu).toContain('<Transition name="im-floating-menu"');
    expect(floatingMenu).toContain('transition: opacity 0.2s ease, transform 0.2s ease');
    expect(floatingMenu).toContain('transform: scale(0.95)');
    expect(floatingMenu).toContain('@after-leave="afterLeave"');
  });

  // 2026-08-10 Figma 改版：设置浮层改为右缘滑入淡入（translateX 24 + opacity）
  it('uses the frozen Drawer and quote-preview timing', () => {
    expect(panel).toContain('transition:transform .3s ease-in-out,opacity .3s ease-in-out');
    expect(panel).toContain('transform:translateX(24px)');
    expect(composer).toContain('<Transition name="im-composer-quote">');
    expect(composer).toContain('transition:opacity .2s ease-out,transform .2s ease-out');
    expect(composer).toContain('transform:translateY(10px)');
  });

  it('keeps hover, loading and tab/list-switch feedback explicit', () => {
    expect(panel).toContain('transition:color var(--im-uikit-transition-interaction),background-color var(--im-uikit-transition-interaction)');
    expect(panel).toContain('animation:im-next-spinner .8s linear infinite');
    expect(panel).toContain('animation:im-next-fade-in .3s ease-out forwards');
  });

  it('provides a reduced-motion branch for every continuous or positional effect', () => {
    for (const source of [floatingMenu, composer, panel]) {
      expect(source).toContain('@media (prefers-reduced-motion: reduce)');
    }
  });
});

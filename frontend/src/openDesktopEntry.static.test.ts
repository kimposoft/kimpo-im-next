import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const panel = readFileSync(resolve(process.cwd(), 'src/ImNextPanel.vue'), 'utf8');
const bridge = readFileSync(resolve(process.cwd(), 'src/host-bridge.ts'), 'utf8');
const zh = JSON.parse(readFileSync(resolve(process.cwd(), 'locales/zh-CN.json'), 'utf8'));
const en = JSON.parse(readFileSync(resolve(process.cwd(), 'locales/en-US.json'), 'utf8'));

describe('rail 菜单的「打开桌面端」入口', () => {
  // 🔴 存在理由（2026-08-22 用户反馈）：侧栏底部那条推荐横幅点过 × 之后会被
  // localStorage 永久记住，用户从此再也找不到唤起桌面端的入口。这个菜单项是常驻兜底，
  // 不可被关闭；删掉它等于把"误关横幅的用户"永久锁在网页端。
  it('菜单项存在，且点击后关闭菜单再转交宿主', () => {
    expect(panel).toContain('data-menu-key="open-desktop-app"');
    expect(panel).toContain("t('rail.openDesktop')");
    // 点击必须先收起菜单：浮层菜单是 fixed 定位，唤起后若不收，
    // 系统弹出的"是否打开 KimpoChat"确认框背后会一直悬着一个菜单。
    expect(panel).toMatch(/function handleOpenDesktopApp\(\): void \{\s*moreMenuOpen\.value = false;/);
  });

  // 🔴 角色分离：唤起逻辑（配对码、deep link、下载弹窗降级）属于宿主的客户端分发业务。
  // 插件一旦自己实现，就会与宿主横幅那条流程各写一份、必然漂移。
  it('插件不得自行实现唤起逻辑，只能调用宿主能力', () => {
    expect(bridge).toContain('openDesktopApp?: () => void;');
    expect(panel).toContain("readHostCapability(props.hostBridge, 'openDesktopApp')?.()");
    // 反向断言：插件里不得出现唤起实现的**代码**。
    // 注意要剥掉注释再断言——本文件的说明性注释里就提到了 kimpo-chat:// 与 pairing，
    // 直接对全文断言会误伤自己写的解释（同类坑：windowTheme 那条 themeSource 断言）。
    const code = panel.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/<!--[\s\S]*?-->/g, '');
    expect(code).not.toContain('kimpo-chat://');
    expect(code).not.toMatch(/pairing/i);
    expect(code).not.toContain('window.location.href =');
  });

  // 宿主没注入能力时不渲染——否则桌面壳内会出现一个点了没反应的死入口。
  it('能力缺失时不渲染该菜单项', () => {
    expect(panel).toContain('v-if="canOpenDesktopApp"');
    expect(panel).toMatch(
      /const canOpenDesktopApp = computed\(\(\) => typeof readHostCapability\(props\.hostBridge, 'openDesktopApp'\) === 'function'\)/
    );
  });

  it('两种内置语言都有文案', () => {
    expect(zh['rail.openDesktop']).toBeTruthy();
    expect(en['rail.openDesktop']).toBeTruthy();
    expect(zh['rail.openDesktop']).not.toBe(en['rail.openDesktop']);
  });
});

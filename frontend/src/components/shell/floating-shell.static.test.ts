import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('./ImFloatingShell.vue', import.meta.url), 'utf8');
const index = readFileSync(new URL('../../index.ts', import.meta.url), 'utf8');
const panel = readFileSync(new URL('../../ImNextPanel.vue', import.meta.url), 'utf8');

describe('ImFloatingShell structure', () => {
  it('wraps the business panel without copying any business component', () => {
    // 2026-10-17：窗口按钮经 window-controls 插槽交给面板顶部标题栏摆放
    expect(source).toContain('<ImNextPanel :host-bridge="hostBridge">');
    expect(source).toContain('<template #window-controls>');
    expect(panel).toContain('<slot name="window-controls" />');
    expect(source).not.toContain('ImConversationList');
    expect(source).not.toContain('ImMessageComposer');
    expect(source).not.toContain('useImController');
    expect(index).toContain('component: ImFloatingShell');
    expect(index).toContain("userId: typeof props.userId === 'string' ? props.userId : ''");
  });

  it('provides two collapse controls, maximize/restore and all eight resize directions', () => {
    expect(source.match(/emit\('collapse'\)/g)).toHaveLength(2);
    // 双击标题栏切最大化：桌面形态下必须与绿灯走同一条 dispatcher（onGreenLightClick），
    // 否则 os 模式双击只改插件内部 CSS 几何、被宿主 !important 撑满后毫无效果。
    // 原先锁的是 @dblclick="toggleMaximize"，那是 panel 形态下的实现细节，已随 dispatcher 收编。
    // 2026-10-17：标题栏移入面板，双击按 data-im-titlebar 识别，落在按钮上不触发。
    expect(source).toContain('@dblclick="onTitlebarDblClick"');
    expect(source).toContain("if (!target?.closest('[data-im-titlebar]') || target.closest('button')) return;\n  onGreenLightClick();");
    expect(panel).toContain('data-im-drag-handle data-im-titlebar');
    expect(source).toContain("if (props.windowControlMode === 'os') { emit('window-toggle-maximize'); return; }");
    expect(source).toContain("['n','s','e','w','ne','nw','se','sw']");
    expect(source).toContain('data-resize');
  });

  it('is a fixed theme-following shell with a full-size panel body', () => {
    expect(source).toContain('position:fixed');
    expect(source).toContain('min-width:800px');
    expect(source).toContain('min-height:520px');
    // 2026-08-10 Figma 改版：外壳消费 token 壳（.im-uikit-theme），暗色随宿主 html.dark 翻转，
    // 不再锁死 color-scheme:light；暗色下以描边表达窗口边界（阴影不可见）。
    expect(source).toContain('im-uikit-theme');
    expect(source).not.toContain('color-scheme:light');
    expect(source).toContain('html.dark .im-floating-shell');
    expect(source).toContain(':deep(.im-next) { width:100%;height:100%; }');
    expect(panel).toContain('.im-next { width:100%;min-width:0;height:100%;border:0;border-radius:0;box-shadow:none; }');
  });

  it('delegates geometry migration and rollback dual-write to the domain storage boundary', () => {
    expect(source).toContain('readStoredWindowRect(localStorage, props.userId, viewport())');
    expect(source).toContain('writeStoredWindowRect(localStorage, props.userId');
    expect(source).not.toContain('localStorage.setItem(');
  });

  // 2026-10-17：外壳自带的 startDrag（隐形拖拽块专用）随标题栏移入面板删除，拖窗口统一走把手拖拽
  it('closes any open floating menu at the start of handle-drag/resize, since fixed-position menus cannot follow the window', () => {
    expect(source).toContain("import { closeActiveImFloatingMenu } from '../primitives/ImFloatingMenu.vue';");
    expect(source.match(/closeActiveImFloatingMenu\(\);/g)).toHaveLength(2);
    expect(source).not.toContain('function startDrag(');
  });

  // 2026-08-11 对齐 macOS 交通灯：字形默认透明，悬停整组/单灯聚焦才淡入；圆底（rect）始终常显不受影响
  it('hides traffic-light glyphs by default and fades them in only on group hover or single-light focus', () => {
    // 三个字形（叉/横杠/双三角）都单独打了 __glyph 类，圆底 rect 不受此类影响，始终常显
    expect(source.match(/<path class="im-floating-shell__glyph"/g)).toHaveLength(3);
    // 默认透明 + 走既有 transition token（带 fallback）
    expect(source).toContain('.im-floating-shell__glyph { opacity:0;transition:opacity var(--im-uikit-transition-interaction,.2s ease); }');
    // 悬停整组（.im-floating-shell__traffic）三个字形一起淡入，而不是各自 hover 各自的灯
    expect(source).toContain('.im-floating-shell__traffic:hover .im-floating-shell__glyph');
    // 键盘 focus-visible 落在单灯上时该灯字形也要显示，无障碍不退化
    expect(source).toContain('.im-floating-shell__light:focus-visible .im-floating-shell__glyph { opacity:1; }');
    // prefers-reduced-motion 下过渡缩短到 0.001ms（项目既有惯例）
    expect(source).toMatch(/@media \(prefers-reduced-motion: reduce\) \{\s*\.im-floating-shell__glyph \{ transition-duration:\.001ms!important; \}/);
  });

  // 2026-10-17 标题栏改版（替代 2026-08-12 的「60×76 隐形拖拽块必须跟 rail 走」守卫）：
  // 拖拽区改为面板顶部整条标题栏，外壳不再有任何绝对定位的拖拽块，也就不存在压住搜索行/导航按钮的风险。
  it('puts window controls in the panel title bar: mac traffic lights on the left, other platforms on the right', () => {
    expect(source).not.toContain('im-floating-shell__titlebar');
    expect(source).not.toContain('width:60px;height:76px');
    // 平台判定集中在外壳并 provide 给整棵插件树（标题栏、弹窗头共用）
    expect(source).toContain('resolveImWindowPlatform(props.platform, currentNavigator())');
    expect(source).toContain('provide(IM_WINDOW_PLATFORM, windowPlatform);');
    expect(source).toContain(`v-if="windowPlatform === 'mac'" class="im-floating-shell__winctl im-floating-shell__traffic"`);
    expect(source).toContain('class="im-floating-shell__winctl im-floating-shell__winbtns"');
    // Windows 系统标题按钮样式（2026-10-17 用户要求）：10×10 1px 字形，最大化后切还原双框；
    // 最小化 / 最大化 / 关闭共用同一套 dispatcher（不另写窗口语义）
    expect(source).toContain('<svg viewBox="0 0 10 10" aria-hidden="true"><path d="M0 5.5H10" /></svg>');
    expect(source).toContain('<svg v-else viewBox="0 0 10 10" aria-hidden="true"><rect x="0.5" y="0.5" width="9" height="9" /></svg>');
    expect(source).toContain('<svg v-if="showRestore" viewBox="0 0 10 10" aria-hidden="true">');
    expect(source).toContain("const showRestore = computed(() => props.windowControlMode === 'os' ? Boolean(props.windowMaximized) : maximized.value);");
    // 46 宽贴顶贴右无圆角；关闭悬停系统红 #C42B1C + 白字形
    expect(source).toContain('.im-floating-shell__winbtn { display:flex;width:46px;height:100%;');
    expect(source).toContain('border-radius:0;');
    expect(source).toContain('.im-floating-shell__winbtn--close:hover { color:#fff;background:#c42b1c; }');
    // 窗口圆角按平台：mac 系统窗口圆角 10，Windows 视觉规范「圆角/小」4；写在近全屏规则之后，两态通用
    expect(source).toContain('.im-floating-shell--mac { border-radius:10px; }');
    expect(source).toContain('.im-floating-shell--other { border-radius:var(--im-uikit-radius-xs,4px); }');
    expect(source.indexOf('.im-floating-shell--other {')).toBeGreaterThan(source.indexOf('.im-floating-shell--maximized {'));
    expect(source.match(/@click\.stop="onRedLightClick"/g)).toHaveLength(2);
    expect(source.match(/@click\.stop="onYellowLightClick"/g)).toHaveLength(2);
    expect(source.match(/@click\.stop="onGreenLightClick"/g)).toHaveLength(2);
    // 面板标题栏：44 高；mac 左 16，其他平台头像组对齐内容区（56 = rail 60 − 头像组内边距 4）且按钮贴右
    expect(panel).toContain('.im-titlebar { display:flex;height:44px;flex:0 0 44px;align-items:center;gap:16px;padding:0 0 0 56px;');
    expect(panel).toContain('.im-titlebar--mac { padding:0 16px; }');
    expect(panel).toContain('.im-titlebar--other :deep(.im-floating-shell__winctl) { order:2;margin-left:auto; }');
  });

  it('shows the signed-in user as one line: 28 avatar, name 14, lighter and smaller department', () => {
    expect(panel).toContain('class="im-titlebar__self"');
    expect(panel).toContain('.im-titlebar__self :deep(.im-avatar) { --im-avatar-size:28px; }');
    expect(panel).toMatch(/\.im-titlebar__name \{ [^}]*font-size:14px;font-weight:500;/);
    expect(panel).toMatch(/\.im-titlebar__dept \{ [^}]*color:var\(--im-uikit-text-tertiary\);font-size:12px;/);
    // 头像在顶部，在线状态菜单向下弹
    expect(panel).toContain(':anchor="selfAvatarButton" placement="bottom-start"');
  });

  // 2026-08-11 两套权威分工（定版，别再混为一谈）：
  //   · **字形本身**（path/描边/配色）以 Figma 导出 SVG 为准——本仓两次凭手感
  //     改这三个图标都改错了（先是折角方块混搭的绿灯，后是把红叉黄杠描边"收细"到 1.1），故逐字锁死。
  //   · **尺寸基准**（直径/间距/位置）以用户实测的参考应用为准，**Figma 稿不同步、也不必回改**。
  //     定稿是 16/4/56，实测参考应用是 12/6/48，采用后者。
  it('draws the three traffic-light glyphs exactly as exported from the Figma spec', () => {
    // 红叉与黄杠：定稿坐标 + 1.5 描边（不是任何"收细"后的近似值）
    expect(source).toContain('d="M11 5L5 11M5 5L11 11" stroke="#802E30" stroke-width="1.5"');
    expect(source).toContain('d="M4 8H12" stroke="#7E6400" stroke-width="1.5"');
    expect(source).not.toContain('stroke-width="1.1"');
    // 绿灯：定稿是带圆角的双三角 Union 路径，不是手写的直角三角，也不是更早的折角方块混搭
    expect(source).toContain('d="M11.1602 5.83789C11.2861 5.712');
    expect(source).not.toContain('d="M4 8v4h4ZM12 8V4H8Z"');
    expect(source).not.toContain('M5 9.6V11h1.4L5 9.6Z');
    // 尺寸基准改按参考应用实测（2026-08-11 定稿，Figma 稿不同步）：灯直径 12、间距 6。
    // 2026-10-17 起灯组不再绝对定位，位置由面板标题栏排布。
    expect(source).toContain('.im-floating-shell__traffic { gap:6px; }');
    expect(source).toMatch(/\.im-floating-shell__light \{ display:flex;width:12px;height:12px;/);
    expect(source).not.toContain('gap:4px;align-items:center');
  });
});

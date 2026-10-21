<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, provide, ref } from 'vue';
import ImNextPanel from '../../ImNextPanel.vue';
import { closeActiveImFloatingMenu } from '../primitives/ImFloatingMenu.vue';
import type { ImNextHostBridge } from '../../host-bridge';
import {
  clampWindowRect,
  defaultWindowRect,
  dragWindowRect,
  readStoredWindowRect,
  maximizedWindowRect,
  resizeWindowRect,
  writeStoredWindowRect,
  type ResizeDirection,
  type ViewportSize,
  type WindowRect
} from '../../domain/window-rect';
import { IM_WINDOW_PLATFORM, currentNavigator, resolveImWindowPlatform } from '../../domain/window-platform';

// windowControlMode（2026-08-12 新增）：三色灯默认仍是"面板内浮窗"语义（'panel'，零行为变化）；
// 宿主在桌面壳（Electron）承载时传入 'os'，届时三色灯点击只对外 emit 语义事件、不再执行内部
// 几何/收起逻辑——真正的最小化/关闭/最大化交给宿主去调用 Electron API。插件本身绝不引用
// window.kimpoDesktop 或任何 Electron API，只负责"用户点了哪个灯"这一意图的上报。
// platform（2026-10-17 标题栏改版）：宿主给的平台提示（桌面壳传 Electron process.platform），
// 缺省时插件按浏览器 navigator 自行判定。决定窗口按钮放左上（macOS 三灯）还是右上（Windows 三件套）。
// windowMaximized：os 模式下真实 OS 窗口是否最大化（宿主订阅桌面壳 onMaximizeChange 后传入），
// 只用于 Windows 形态「最大化 / 还原」图标与文案切换；panel 模式用本组件内部的 maximized。
const props = defineProps<{ userId?: string; hostBridge?: ImNextHostBridge; windowControlMode?: 'panel' | 'os'; platform?: string; windowMaximized?: boolean }>();
const emit = defineEmits<{
  collapse: [];
  'window-close': [];
  'window-minimize': [];
  'window-toggle-maximize': [];
}>();

type Interaction = {
  readonly kind: 'drag' | 'resize';
  readonly direction?: ResizeDirection;
  readonly pointerX: number;
  readonly pointerY: number;
  readonly rect: WindowRect;
};

function viewport(): ViewportSize {
  return typeof window === 'undefined' ? { width: 1440, height: 900 } : { width: window.innerWidth, height: window.innerHeight };
}

function loadRect(): WindowRect {
  const fallback = defaultWindowRect(viewport());
  if (typeof localStorage === 'undefined') return fallback;
  try { return readStoredWindowRect(localStorage, props.userId, viewport()); }
  catch { return fallback; }
}

const rect = ref<WindowRect>(loadRect());
const maximized = ref(false);
const interaction = ref<Interaction>();
let restoreRect: WindowRect | undefined;
// 当前是否处于「已最大化」：桌面壳看真实 OS 窗口状态，网页浮窗看内部近全屏态
const showRestore = computed(() => props.windowControlMode === 'os' ? Boolean(props.windowMaximized) : maximized.value);

const shellStyle = computed(() => ({
  left: `${rect.value.x}px`,
  top: `${rect.value.y}px`,
  width: `${rect.value.width}px`,
  height: `${rect.value.height}px`
}));
// 整棵插件树共用一份平台判定：标题栏按钮位置、各弹窗头关闭按钮位置都从这里 inject。
const windowPlatform = computed(() => resolveImWindowPlatform(props.platform, currentNavigator()));
provide(IM_WINDOW_PLATFORM, windowPlatform);

// 窗口按钮文案：桌面壳（os）下是真实的最小化 / 关闭；网页面板内浮窗（panel）两者都是「收起」。
const labels = computed(() => {
  const en = props.hostBridge?.locale === 'en-US';
  const os = props.windowControlMode === 'os';
  const base = en
    ? { title: 'Kimpo IM', collapse: 'Collapse', maximize: 'Maximize', restore: 'Restore', minimize: 'Minimize', close: 'Close' }
    : { title: 'Kimpo 即时通讯', collapse: '收起', maximize: '近全屏', restore: '还原', minimize: '最小化', close: '关闭' };
  return { ...base, closeAction: os ? base.close : base.collapse, minimizeAction: os ? base.minimize : base.collapse };
});

function persistRect(): void {
  if (typeof localStorage === 'undefined') return;
  try { writeStoredWindowRect(localStorage, props.userId, maximized.value && restoreRect ? restoreRect : rect.value, viewport()); }
  catch { /* Geometry persistence is best effort only. */ }
}

/**
 * 面板内拖拽把手（2026-08-11）：标了 data-im-drag-handle 的区域（顶部标题栏、搜索行空白、聊天顶栏）
 * 可拖动窗口；命中把手内的交互控件（按钮/输入框/链接/菜单项等）时不拦截点击。
 * 2026-10-17 起标题栏移入面板顶部（整条 44 高），原外壳左上角 60×76 的隐形拖拽块随之删除，
 * 拖窗口统一走本函数。
 */
function startHandleDrag(event: PointerEvent): void {
  if (event.button !== 0 || maximized.value) return;
  const target = event.target as HTMLElement | null;
  if (!target?.closest('[data-im-drag-handle]')) return;
  if (target.closest('button, input, textarea, a, [role="menuitem"], [role="option"], [contenteditable="true"]')) return;
  event.preventDefault();
  // 拖拽窗口起手先关闭浮动菜单：fixed 定位的 ImFloatingMenu 无法跟随窗口移动重算位置。
  // 命中把手且未被交互控件排除，拖拽确立后再关闭，避免误关点在菜单项上的操作。
  closeActiveImFloatingMenu();
  interaction.value = { kind: 'drag', pointerX: event.clientX, pointerY: event.clientY, rect: rect.value };
}

function startResize(direction: ResizeDirection, event: PointerEvent): void {
  if (event.button !== 0 || maximized.value) return;
  event.preventDefault();
  event.stopPropagation();
  // 缩放窗口起手同样关闭浮动菜单，理由同 startHandleDrag。
  closeActiveImFloatingMenu();
  interaction.value = { kind: 'resize', direction, pointerX: event.clientX, pointerY: event.clientY, rect: rect.value };
}

function moveInteraction(event: PointerEvent): void {
  const current = interaction.value;
  if (!current) return;
  const deltaX = event.clientX - current.pointerX;
  const deltaY = event.clientY - current.pointerY;
  rect.value = current.kind === 'drag'
    ? dragWindowRect(current.rect, deltaX, deltaY, viewport())
    : resizeWindowRect(current.rect, current.direction!, deltaX, deltaY, viewport());
}

function finishInteraction(): void {
  if (!interaction.value) return;
  interaction.value = undefined;
  persistRect();
}

/**
 * 三色灯点击分发（2026-08-12）：'os' 模式下只上报语义事件，不执行本组件内部的收起/几何逻辑
 * （那套逻辑是"面板内浮窗"专属，桌面壳里窗口是原生 OS 窗口，几何由宿主/Electron 负责）。
 * 'panel' 模式（默认）分支与此前完全一致：红黄两灯发 collapse 事件、绿灯走内部 toggleMaximize()。
 */
function onRedLightClick(): void {
  if (props.windowControlMode === 'os') { emit('window-close'); return; }
  emit('collapse');
}
function onYellowLightClick(): void {
  if (props.windowControlMode === 'os') { emit('window-minimize'); return; }
  emit('collapse');
}
function onGreenLightClick(): void {
  if (props.windowControlMode === 'os') { emit('window-toggle-maximize'); return; }
  toggleMaximize();
}

/**
 * 双击标题栏切换最大化（macOS 标准行为，Windows 同理）：与绿灯/最大化按钮走同一条 dispatcher，
 * 否则 os 模式下双击只会改插件内部 CSS 几何（被宿主 !important 撑满后完全无效果）。
 * 双击落在标题栏里的按钮（窗口按钮、自己头像）上时不触发。
 */
function onTitlebarDblClick(event: MouseEvent): void {
  const target = event.target as HTMLElement | null;
  if (!target?.closest('[data-im-titlebar]') || target.closest('button')) return;
  onGreenLightClick();
}

function toggleMaximize(): void {
  if (maximized.value) {
    rect.value = clampWindowRect(restoreRect ?? defaultWindowRect(viewport()), viewport());
    restoreRect = undefined;
    maximized.value = false;
  } else {
    restoreRect = rect.value;
    rect.value = maximizedWindowRect(viewport());
    maximized.value = true;
  }
  persistRect();
}

function handleViewportResize(): void {
  rect.value = maximized.value ? maximizedWindowRect(viewport()) : clampWindowRect(rect.value, viewport());
  persistRect();
}

onMounted(() => {
  window.addEventListener('pointermove', moveInteraction);
  window.addEventListener('pointerup', finishInteraction);
  window.addEventListener('pointercancel', finishInteraction);
  window.addEventListener('resize', handleViewportResize);
});
onBeforeUnmount(() => {
  window.removeEventListener('pointermove', moveInteraction);
  window.removeEventListener('pointerup', finishInteraction);
  window.removeEventListener('pointercancel', finishInteraction);
  window.removeEventListener('resize', handleViewportResize);
});
</script>

<template>
  <section class="im-floating-shell im-uikit-theme" :class="[{ 'im-floating-shell--maximized': maximized }, `im-floating-shell--${windowPlatform}`]" :style="shellStyle" role="dialog" :aria-label="labels.title">
    <div class="im-floating-shell__body" @pointerdown="startHandleDrag" @dblclick="onTitlebarDblClick">
      <!-- 窗口按钮经插槽交给面板顶部标题栏摆放（macOS 在左、其他平台在右，见 ImNextPanel 的 .im-titlebar）；
           按钮本身与点击分发仍归外壳所有，面板不感知窗口语义。 -->
      <ImNextPanel :host-bridge="hostBridge">
        <template #window-controls>
          <div v-if="windowPlatform === 'mac'" class="im-floating-shell__winctl im-floating-shell__traffic">
            <!-- 字形默认透明（悬停整组/聚焦单灯才淡入），圆底始终常显：字形与圆底拆两层，字形单独打 __glyph 类 -->
            <button type="button" class="im-floating-shell__light im-floating-shell__light--red" :aria-label="labels.closeAction" @click.stop="onRedLightClick">
              <svg viewBox="0 0 16 16" aria-hidden="true"><rect x="0.25" y="0.25" width="15.5" height="15.5" rx="7.75" fill="#FF5C5F" stroke="#FF2C30" stroke-width="0.5" /><path class="im-floating-shell__glyph" d="M11 5L5 11M5 5L11 11" stroke="#802E30" stroke-width="1.5" stroke-linecap="round" /></svg>
            </button>
            <button type="button" class="im-floating-shell__light im-floating-shell__light--yellow" :aria-label="labels.minimizeAction" @click.stop="onYellowLightClick">
              <svg viewBox="0 0 16 16" aria-hidden="true"><rect x="0.25" y="0.25" width="15.5" height="15.5" rx="7.75" fill="#FAC800" stroke="#F9B800" stroke-width="0.5" /><path class="im-floating-shell__glyph" d="M4 8H12" stroke="#7E6400" stroke-width="1.5" stroke-linecap="round" /></svg>
            </button>
            <!-- 三个字形的 path/描边/配色逐字取自 Figma 导出 SVG，
                 不手写近似值——上一轮凭手感把红叉黄杠描边"收细"到 1.1 就偏离了定稿的 1.5。 -->
            <button type="button" class="im-floating-shell__light im-floating-shell__light--green" :aria-label="showRestore ? labels.restore : labels.maximize" @click.stop="onGreenLightClick">
              <svg viewBox="0 0 16 16" aria-hidden="true"><rect x="0.25" y="0.25" width="15.5" height="15.5" rx="7.75" fill="#34C759" stroke="#00B729" stroke-width="0.5" /><path class="im-floating-shell__glyph" d="M11.1602 5.83789C11.2861 5.712 11.5016 5.80061 11.502 5.97852V10.4961C11.502 11.0482 11.054 11.4958 10.502 11.4961H5.98438C5.80619 11.4961 5.71678 11.2803 5.84277 11.1543L11.1602 5.83789ZM10.0166 4.5C10.1945 4.50034 10.2831 4.7159 10.1572 4.8418L4.84082 10.1582C4.71493 10.2841 4.49936 10.1955 4.49902 10.0176V5.5C4.49902 4.94772 4.94674 4.5 5.49902 4.5H10.0166Z" fill="#1A642D" /></svg>
            </button>
          </div>
          <!-- Windows / Linux：右上角系统标题按钮（2026-10-17 用户要求改为 Windows 默认样式）——
               46 宽、贴顶贴右、无圆角；字形按 Windows 11 标题按钮：10×10、1px 线条，最大化后切「还原」双框。 -->
          <div v-else class="im-floating-shell__winctl im-floating-shell__winbtns">
            <button type="button" class="im-floating-shell__winbtn" :aria-label="labels.minimizeAction" :title="labels.minimizeAction" @click.stop="onYellowLightClick">
              <svg viewBox="0 0 10 10" aria-hidden="true"><path d="M0 5.5H10" /></svg>
            </button>
            <button type="button" class="im-floating-shell__winbtn" :aria-label="showRestore ? labels.restore : labels.maximize" :title="showRestore ? labels.restore : labels.maximize" @click.stop="onGreenLightClick">
              <svg v-if="showRestore" viewBox="0 0 10 10" aria-hidden="true"><rect x="0.5" y="2.5" width="7" height="7" /><path d="M2.5 2.5V0.5H9.5V7.5H7.5" /></svg>
              <svg v-else viewBox="0 0 10 10" aria-hidden="true"><rect x="0.5" y="0.5" width="9" height="9" /></svg>
            </button>
            <button type="button" class="im-floating-shell__winbtn im-floating-shell__winbtn--close" :aria-label="labels.closeAction" :title="labels.closeAction" @click.stop="onRedLightClick">
              <svg viewBox="0 0 10 10" aria-hidden="true"><path d="M0.5 0.5L9.5 9.5M9.5 0.5L0.5 9.5" /></svg>
            </button>
          </div>
        </template>
      </ImNextPanel>
    </div>
    <i v-for="direction in (['n','s','e','w','ne','nw','se','sw'] as const)" :key="direction" :class="['im-floating-shell__resize', `im-floating-shell__resize--${direction}`]" :data-resize="direction" @pointerdown="startResize(direction, $event)" />
  </section>
</template>

<style scoped>
.im-floating-shell { position:fixed;z-index:2200;display:flex;min-width:800px;min-height:520px;flex-direction:column;overflow:hidden;color:var(--im-uikit-text-primary,#1f1f1f);background:var(--im-uikit-bg-shell,#fff);border:0;border-radius:var(--im-uikit-radius-window,24px);box-shadow:var(--im-uikit-shadow-window,0 0 24px rgba(0,0,0,.2)); }
.im-floating-shell--maximized { border-radius:var(--im-uikit-radius-md,8px); }
/* 窗口圆角按平台（2026-10-17 用户要求，放在近全屏规则之后、两态通用）：
   macOS 取普通桌面应用窗口的系统圆角 10；Windows / Linux 取视觉规范「圆角/小」4。 */
.im-floating-shell--mac { border-radius:10px; }
.im-floating-shell--other { border-radius:var(--im-uikit-radius-xs,4px); }
/* 暗色下阴影不可见，按规范第八节以 1px 描边表达窗口边界 */
html.dark .im-floating-shell { border:1px solid var(--im-uikit-border-lighter,rgba(255,255,255,.12)); }
/* 2026-08-11 定版：可拖动区域 hover 一律保持普通指针（不显示 move 光标），拖拽是隐性交互 */
/* 2026-10-17 标题栏改版：窗口按钮不再绝对定位在 rail 顶部，而是作为面板顶部标题栏（.im-titlebar，
   整条 44 高、整条可拖动）里的一个 flex 子项，左右位置由面板按平台排布。
   尺寸基准沿用 2026-08-11 定稿（参考应用微信 Mac 实测）：灯直径 12、间距 6；
   三个 svg 用 viewBox+width:100%，改外框即整体等比缩，字形 path 与描边不必单独调。 */
.im-floating-shell__winctl { display:flex;flex:0 0 auto;align-items:center; }
.im-floating-shell__traffic { gap:6px; }
.im-floating-shell__light { display:flex;width:12px;height:12px;border:0;border-radius:50%;padding:0;background:transparent;cursor:pointer; }
.im-floating-shell__light svg { width:100%;height:100%; }
.im-floating-shell__light:focus-visible { outline:2px solid rgb(var(--primary-color,8 119 244) / .5);outline-offset:2px; }
/* 对齐 macOS 交通灯：圆底常显，字形默认隐藏，悬停整组三灯一起淡入；键盘聚焦单灯时该灯字形也需可见（无障碍不退化） */
.im-floating-shell__glyph { opacity:0;transition:opacity var(--im-uikit-transition-interaction,.2s ease); }
.im-floating-shell__traffic:hover .im-floating-shell__glyph,
.im-floating-shell__light:focus-visible .im-floating-shell__glyph { opacity:1; }
/* Windows / Linux 窗口按钮：按 Windows 11 系统标题按钮——46 宽、占满标题栏高、无圆角、按钮间无间距；
   字形 10×10、1px 线条（crispEdges 保证 1px 不发虚），颜色跟正文色；
   悬停/按下为浅灰半透明底，关闭悬停系统红 #C42B1C + 白色字形，按下再淡一档。 */
.im-floating-shell__winbtns { align-self:stretch; }
.im-floating-shell__winbtn { display:flex;width:46px;height:100%;align-items:center;justify-content:center;border:0;border-radius:0;padding:0;color:var(--im-uikit-text-primary,#1f1f1f);background:transparent;cursor:default;transition:background-color .1s linear,color .1s linear; }
.im-floating-shell__winbtn svg { width:10px;height:10px;overflow:visible;fill:none;stroke:currentColor;stroke-width:1;shape-rendering:crispEdges; }
.im-floating-shell__winbtn--close svg { shape-rendering:geometricPrecision; }
.im-floating-shell__winbtn:hover { background:var(--im-uikit-bg-caption-hover,rgba(0,0,0,.06)); }
.im-floating-shell__winbtn:active { background:var(--im-uikit-bg-caption-pressed,rgba(0,0,0,.04)); }
.im-floating-shell__winbtn--close:hover { color:#fff;background:#c42b1c; }
.im-floating-shell__winbtn--close:active { color:rgba(255,255,255,.7);background:rgba(196,43,28,.9); }
.im-floating-shell__winbtn:focus-visible { outline:2px solid rgb(var(--primary-color,8 119 244) / .5);outline-offset:-2px; }
.im-floating-shell__body { flex:1;min-width:0;min-height:0;overflow:hidden; }
.im-floating-shell__body :deep(.im-next) { width:100%;height:100%; }
.im-floating-shell__body :deep([data-im-drag-handle]) { cursor:default;user-select:none;touch-action:none; } /* 拖拽区保持普通指针（定版），内部交互控件在下面按类型还原 */
.im-floating-shell__body :deep([data-im-drag-handle] button),
.im-floating-shell__body :deep([data-im-drag-handle] input) { cursor:pointer;user-select:auto; }
.im-floating-shell__body :deep([data-im-drag-handle] input) { cursor:text; }
.im-floating-shell__resize { position:absolute;z-index:2;display:block;touch-action:none; }
.im-floating-shell__resize--n,.im-floating-shell__resize--s { right:8px;left:8px;height:8px;cursor:ns-resize; }
.im-floating-shell__resize--n { top:-4px; }.im-floating-shell__resize--s { bottom:-4px; }
.im-floating-shell__resize--e,.im-floating-shell__resize--w { top:8px;bottom:8px;width:8px;cursor:ew-resize; }
.im-floating-shell__resize--e { right:-4px; }.im-floating-shell__resize--w { left:-4px; }
.im-floating-shell__resize--ne,.im-floating-shell__resize--nw,.im-floating-shell__resize--se,.im-floating-shell__resize--sw { width:14px;height:14px; }
.im-floating-shell__resize--ne { top:-5px;right:-5px;cursor:nesw-resize; }.im-floating-shell__resize--nw { top:-5px;left:-5px;cursor:nwse-resize; }
.im-floating-shell__resize--se { right:-5px;bottom:-5px;cursor:nwse-resize; }.im-floating-shell__resize--sw { bottom:-5px;left:-5px;cursor:nesw-resize; }
.im-floating-shell--maximized .im-floating-shell__resize { display:none; }
@media (prefers-reduced-motion: reduce) {
  .im-floating-shell__glyph { transition-duration:.001ms!important; }
}
</style>

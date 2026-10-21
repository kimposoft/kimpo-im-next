<script lang="ts">
let activeMenuClose: ((restoreFocus?: boolean) => void) | undefined;
let floatingMenuId = 0;

/** 关闭当前打开的浮动菜单（拖窗/缩放时由外壳调用；fixed 定位无法跟随窗口移动） */
export function closeActiveImFloatingMenu(): void { activeMenuClose?.(false); }
</script>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch, type CSSProperties } from 'vue';
import { computeFloatingMenuPosition, type ImFloatingMenuPlacement } from './floating-menu-position';

export type ImFloatingMenuVariant = 'conversation' | 'message' | 'emoji' | 'attachment';
export interface ImFloatingMenuSelection { key?: string; element: HTMLElement; }

const props = withDefaults(defineProps<{
  open: boolean;
  anchor?: HTMLElement | null;
  anchorPoint?: { x: number; y: number } | null;
  placement?: ImFloatingMenuPlacement;
  variant?: ImFloatingMenuVariant;
  label: string;
  offset?: number;
  closeOnSelect?: boolean;
  restoreFocusOnSelect?: boolean;
  autoFocus?: boolean;
  teleportTo?: string | HTMLElement;
}>(), {
  anchor: null,
  anchorPoint: null,
  placement: 'bottom-end',
  variant: 'conversation',
  offset: 4,
  closeOnSelect: true,
  restoreFocusOnSelect: true,
  autoFocus: true,
  teleportTo: 'body'
});

const emit = defineEmits<{
  'update:open': [value: boolean];
  close: [];
  select: [selection: ImFloatingMenuSelection];
}>();

const menu = ref<HTMLElement>();
const menuId = `im-floating-menu-${++floatingMenuId}`;
const position = ref({ left: 0, top: 0 });
const positioned = ref(false);
let returnFocus: HTMLElement | null = null;
let leavingMenu: HTMLElement | null = null;
let restoreFocusOnClose = true;
let semanticAnchor: HTMLElement | null = null;

function syncAnchorSemantics(anchor: HTMLElement | null, open: boolean): void {
  if (semanticAnchor && semanticAnchor !== anchor) {
    semanticAnchor.removeAttribute('aria-controls');
    semanticAnchor.setAttribute('aria-expanded', 'false');
  }
  semanticAnchor = anchor;
  if (!anchor) return;
  anchor.setAttribute('aria-haspopup', 'menu');
  anchor.setAttribute('aria-expanded', String(open));
  if (open) anchor.setAttribute('aria-controls', menuId);
  else anchor.removeAttribute('aria-controls');
}

const transformOrigin = computed(() => {
  const vertical = props.placement.startsWith('top') ? 'bottom' : 'top';
  const horizontal = props.placement.endsWith('start') ? 'left' : 'right';
  return `${horizontal} ${vertical}`;
});
const menuStyle = computed<CSSProperties>(() => ({
  left: `${position.value.left}px`,
  top: `${position.value.top}px`,
  visibility: positioned.value ? 'visible' : 'hidden',
  transformOrigin: transformOrigin.value
}));

function requestClose(restoreFocus = true): void {
  if (!props.open) return;
  restoreFocusOnClose = restoreFocus;
  emit('update:open', false);
  emit('close');
}

function afterLeave(): void {
  positioned.value = false;
  const target = restoreFocusOnClose ? returnFocus : null;
  const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const focusStillBelongsToClosingMenu = !active || active === document.body || active === target || Boolean(leavingMenu?.contains(active));
  leavingMenu = null;
  returnFocus = null;
  restoreFocusOnClose = true;
  // A delayed leave must not steal focus after the user has moved to another control.
  if (target?.isConnected && focusStillBelongsToClosingMenu) target.focus();
}

function anchorRect(): DOMRect | undefined {
  if (props.anchorPoint) return new DOMRect(props.anchorPoint.x, props.anchorPoint.y, 0, 0);
  return props.anchor?.getBoundingClientRect();
}

function menuItems(): HTMLElement[] {
  if (!menu.value) return [];
  const items = [...menu.value.querySelectorAll<HTMLElement>('[role="menuitem"], button:not([disabled]), [data-im-menu-item]')];
  for (const item of items) {
    item.setAttribute('role', 'menuitem');
    item.tabIndex = -1;
  }
  return items.filter(item => item.getAttribute('aria-disabled') !== 'true' && !('disabled' in item && Boolean((item as HTMLButtonElement).disabled)));
}

function updatePosition(): void {
  if (!props.open || !menu.value || typeof window === 'undefined') return;
  const anchor = anchorRect();
  if (!anchor) return;
  const rect = menu.value.getBoundingClientRect();
  const next = computeFloatingMenuPosition(anchor, rect, { width: window.innerWidth, height: window.innerHeight }, props.placement, props.offset);
  position.value = { left: next.left, top: next.top };
  positioned.value = true;
}

function onDocumentPointerDown(event: PointerEvent): void {
  const target = event.target as Node | null;
  if (!target || menu.value?.contains(target) || props.anchor?.contains(target)) return;
  // Preserve the pointer target's natural focus instead of stealing it back.
  requestClose(false);
}

function onDocumentKeydown(event: KeyboardEvent): void {
  if (activeMenuClose !== requestClose || !props.open || (event.key !== 'Escape' && event.key !== 'Tab')) return;
  // Capture at document level because focus can still be on the trigger while a teleported menu settles.
  event.stopPropagation();
  if (event.key === 'Escape') {
    event.preventDefault();
    requestClose(true);
  } else {
    requestClose(false);
  }
}

function onMenuClick(event: MouseEvent): void {
  const target = (event.target as Element | null)?.closest<HTMLElement>('[role="menuitem"], button, [data-im-menu-item]');
  if (!target || target.getAttribute('aria-disabled') === 'true' || ('disabled' in target && Boolean((target as HTMLButtonElement).disabled))) return;
  emit('select', { key: target.dataset.menuKey, element: target });
  if (props.closeOnSelect) requestClose(props.restoreFocusOnSelect);
}

function onMenuKeydown(event: KeyboardEvent): void {
  const items = menuItems();
  if (!items.length) return;
  const current = Math.max(0, items.indexOf(document.activeElement as HTMLElement));
  let next: number | undefined;
  if (event.key === 'ArrowDown') next = (current + 1) % items.length;
  else if (event.key === 'ArrowUp') next = (current - 1 + items.length) % items.length;
  else if (event.key === 'Home') next = 0;
  else if (event.key === 'End') next = items.length - 1;
  else if (event.key === 'Escape') { event.preventDefault(); requestClose(); return; }
  else if (event.key === 'Tab') { requestClose(false); return; }
  else if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); items[current]?.click(); return; }
  if (next !== undefined) { event.preventDefault(); items[next]?.focus(); }
}

function addListeners(): void {
  document.addEventListener('pointerdown', onDocumentPointerDown, true);
  document.addEventListener('keydown', onDocumentKeydown, true);
  window.addEventListener('resize', updatePosition);
  window.addEventListener('scroll', updatePosition, true);
}
function removeListeners(): void {
  if (typeof document === 'undefined') return;
  document.removeEventListener('pointerdown', onDocumentPointerDown, true);
  document.removeEventListener('keydown', onDocumentKeydown, true);
  window.removeEventListener('resize', updatePosition);
  window.removeEventListener('scroll', updatePosition, true);
}

async function focusFirstItemAfterRender(): Promise<void> {
  await nextTick();
  updatePosition();
  // Teleport and slot children may settle on separate flushes.
  await nextTick();
  if (props.open && activeMenuClose === requestClose && props.autoFocus) menuItems()[0]?.focus({ preventScroll: true });
}

watch(() => props.open, async open => {
  if (!open) {
    syncAnchorSemantics(props.anchor ?? semanticAnchor, false);
    leavingMenu = menu.value ?? null;
    removeListeners();
    if (activeMenuClose === requestClose) activeMenuClose = undefined;
    return;
  }
  positioned.value = false;
  leavingMenu = null;
  activeMenuClose?.(false);
  activeMenuClose = requestClose;
  const activeElement = document.activeElement instanceof HTMLElement && document.activeElement !== document.body
    ? document.activeElement
    : null;
  returnFocus = props.anchor ?? activeElement ?? null;
  syncAnchorSemantics(returnFocus, true);
  addListeners();
  await focusFirstItemAfterRender();
}, { immediate: true });

watch([() => props.anchor, () => props.anchorPoint, () => props.placement], () => { void nextTick(updatePosition); }, { deep: true });

onBeforeUnmount(() => {
  removeListeners();
  syncAnchorSemantics(semanticAnchor, false);
  if (activeMenuClose === requestClose) activeMenuClose = undefined;
});
</script>

<template>
  <Teleport :to="teleportTo">
    <Transition name="im-floating-menu" @after-leave="afterLeave">
      <div
        v-if="open"
        :id="menuId"
        ref="menu"
        :class="['im-floating-menu', 'im-uikit-theme', `im-floating-menu--${variant}`]"
        :style="menuStyle"
        role="menu"
        :aria-label="label"
        tabindex="-1"
        @click="onMenuClick"
        @keydown="onMenuKeydown"
      >
        <slot :close="requestClose" />
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.im-floating-menu {
  position: fixed;
  /* Menus teleport to body, so they must sit above the Kimpo floating shell (2200). */
  z-index: 2400;
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
  overflow: hidden;
  /* Figma 弹层定版：白底 + #ebeef5 描边 + 圆角8 + 统一投影 */
  border: 1px solid var(--im-uikit-border-lighter, #ebeef5);
  border-radius: var(--im-uikit-radius-md, 8px);
  color: var(--im-uikit-text-primary, #1f1f1f);
  background: var(--im-uikit-bg-dropdown, #fff);
  font-family: var(--im-uikit-font-family, Roboto, 'Source Han Sans SC', sans-serif);
  font-size: var(--im-uikit-font-size-md, 14px);
}
.im-floating-menu-enter-active,
.im-floating-menu-leave-active {
  transition: opacity 0.2s ease, transform 0.2s ease;
}
.im-floating-menu-enter-from,
.im-floating-menu-leave-to {
  opacity: 0;
  transform: scale(0.95);
}
.im-floating-menu--conversation {
  width: var(--im-uikit-menu-conversation-width, 160px);
  padding: 8px 0;
  box-shadow: var(--im-uikit-shadow-menu, -1px 2px 13px rgba(0, 0, 0, 0.1));
}
.im-floating-menu--message {
  min-width: var(--im-uikit-menu-message-width, 120px);
  width: auto;
  padding: 8px 0;
  box-shadow: var(--im-uikit-shadow-message-menu, -1px 2px 13px rgba(0, 0, 0, 0.1));
}
.im-floating-menu--emoji {
  width: 320px;
  padding: 12px;
  border-radius: var(--im-uikit-radius-md, 8px);
  box-shadow: var(--im-uikit-shadow-message-menu, -1px 2px 13px rgba(0, 0, 0, 0.1));
}
.im-floating-menu--attachment {
  width: var(--im-uikit-menu-attachment-width, 160px);
  padding: 8px 0;
  border-radius: var(--im-uikit-radius-md, 8px);
  box-shadow: var(--im-uikit-shadow-menu, -1px 2px 13px rgba(0, 0, 0, 0.1));
}
.im-floating-menu:focus { outline: none; }
.im-floating-menu :deep([role="menuitem"]) {
  display: flex;
  flex: 0 0 var(--im-uikit-menu-item-height, 36px);
  width: 100%;
  height: var(--im-uikit-menu-item-height, 36px);
  box-sizing: border-box;
  align-items: center;
  justify-content: flex-start;
  gap: 8px;
  border: 0;
  padding: 4px 16px;
  color: inherit;
  background: var(--im-uikit-bg-dropdown, #fff);
  font: inherit;
  text-align: left;
  cursor: pointer;
  transition: background-color var(--im-uikit-transition-interaction, 0.2s ease);
}
.im-floating-menu :deep([role="menuitem"]:hover),
.im-floating-menu :deep([role="menuitem"]:focus-visible) { outline: none; background: var(--im-uikit-bg-dropdown-hover, #f0f7ff); }
.im-floating-menu :deep([role="menuitem"]:active) { background: var(--im-uikit-bg-dropdown-active, #e6f2ff); }
.im-floating-menu :deep([role="menuitem"][aria-disabled="true"]),
.im-floating-menu :deep([role="menuitem"]:disabled) { color: var(--im-uikit-text-disabled, rgba(0, 0, 0, 0.25)); cursor: not-allowed; }
.im-floating-menu :deep([role="menuitem"][data-tone="danger"]) { color: var(--im-uikit-text-error, #ff584c); }
@media (prefers-reduced-motion: reduce) {
  .im-floating-menu-enter-active,
  .im-floating-menu-leave-active,
  .im-floating-menu :deep([role="menuitem"]) { transition-duration: 0.001ms !important; }
}
</style>

export const DEFAULT_WINDOW_WIDTH = 1120;
export const DEFAULT_WINDOW_HEIGHT = 700;
export const MIN_WINDOW_WIDTH = 800;
export const MIN_WINDOW_HEIGHT = 520;
export const MIN_WINDOW_VISIBLE = 100;
export const MAXIMIZED_INSET = 12;

export type ResizeDirection = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';
export interface ViewportSize { readonly width: number; readonly height: number }
export interface WindowRect { readonly x: number; readonly y: number; readonly width: number; readonly height: number }
export interface WindowRectStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const LEGACY_DEFAULT_LEFT_WIDTH = 288;
const LEGACY_MIN_LEFT_WIDTH = 240;

function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}

export function windowRectStorageKey(userId?: string): string {
  return `kimpo_im_next_window_${encodeURIComponent(userId?.trim() || 'anon')}`;
}

/** legacy 窗口 key 不编码用户 ID；只用于受控迁移和回退双写。 */
export function legacyWindowRectStorageKey(userId?: string): string {
  return `nahida_im_window_${userId?.trim() || 'anon'}`;
}

export function defaultWindowRect(viewport: ViewportSize): WindowRect {
  return {
    x: Math.round((viewport.width - DEFAULT_WINDOW_WIDTH) / 2),
    y: Math.round((viewport.height - DEFAULT_WINDOW_HEIGHT) / 2),
    width: DEFAULT_WINDOW_WIDTH,
    height: DEFAULT_WINDOW_HEIGHT
  };
}

/** At least 100px stays reachable on every axis, even when the viewport is smaller than the minimum window. */
export function clampWindowRect(rect: WindowRect, viewport: ViewportSize): WindowRect {
  const width = Math.max(MIN_WINDOW_WIDTH, finite(rect.width, DEFAULT_WINDOW_WIDTH));
  const height = Math.max(MIN_WINDOW_HEIGHT, finite(rect.height, DEFAULT_WINDOW_HEIGHT));
  return {
    x: clamp(finite(rect.x, 0), MIN_WINDOW_VISIBLE - width, Math.max(MIN_WINDOW_VISIBLE - width, viewport.width - MIN_WINDOW_VISIBLE)),
    y: clamp(finite(rect.y, 0), MIN_WINDOW_VISIBLE - height, Math.max(MIN_WINDOW_VISIBLE - height, viewport.height - MIN_WINDOW_VISIBLE)),
    width,
    height
  };
}

export function dragWindowRect(rect: WindowRect, deltaX: number, deltaY: number, viewport: ViewportSize): WindowRect {
  return clampWindowRect({ ...rect, x: rect.x + deltaX, y: rect.y + deltaY }, viewport);
}

export function resizeWindowRect(rect: WindowRect, direction: ResizeDirection, deltaX: number, deltaY: number, viewport: ViewportSize): WindowRect {
  let left = rect.x;
  let top = rect.y;
  let right = rect.x + rect.width;
  let bottom = rect.y + rect.height;
  if (direction.includes('w')) left += deltaX;
  if (direction.includes('e')) right += deltaX;
  if (direction.includes('n')) top += deltaY;
  if (direction.includes('s')) bottom += deltaY;
  if (right - left < MIN_WINDOW_WIDTH) {
    if (direction.includes('w')) left = right - MIN_WINDOW_WIDTH;
    else right = left + MIN_WINDOW_WIDTH;
  }
  if (bottom - top < MIN_WINDOW_HEIGHT) {
    if (direction.includes('n')) top = bottom - MIN_WINDOW_HEIGHT;
    else bottom = top + MIN_WINDOW_HEIGHT;
  }
  return clampWindowRect({ x: left, y: top, width: right - left, height: bottom - top }, viewport);
}

export function maximizedWindowRect(viewport: ViewportSize): WindowRect {
  return clampWindowRect({
    x: MAXIMIZED_INSET,
    y: MAXIMIZED_INSET,
    width: Math.max(MIN_WINDOW_WIDTH, viewport.width - MAXIMIZED_INSET * 2),
    height: Math.max(MIN_WINDOW_HEIGHT, viewport.height - MAXIMIZED_INSET * 2)
  }, viewport);
}

export function parseStoredWindowRect(raw: string | null, viewport: ViewportSize): WindowRect {
  const fallback = defaultWindowRect(viewport);
  if (!raw) return clampWindowRect(fallback, viewport);
  try {
    const parsed = JSON.parse(raw) as Partial<WindowRect>;
    return clampWindowRect({
      x: finite(parsed.x, fallback.x),
      y: finite(parsed.y, fallback.y),
      width: finite(parsed.width, fallback.width),
      height: finite(parsed.height, fallback.height)
    }, viewport);
  } catch {
    return clampWindowRect(fallback, viewport);
  }
}

export function serializeWindowRect(rect: WindowRect): string {
  return JSON.stringify({ x: rect.x, y: rect.y, width: rect.width, height: rect.height });
}

function parseLegacyRect(raw: string, viewport: ViewportSize): WindowRect | undefined {
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined;
    return parseStoredWindowRect(raw, viewport);
  } catch {
    return undefined;
  }
}

/** next key 优先；仅当它完全不存在时才读取 legacy，并把按 next 规则 clamp 后的结果迁移一次。 */
export function readStoredWindowRect(
  storage: WindowRectStorage | undefined,
  userId: string | undefined,
  viewport: ViewportSize
): WindowRect {
  const fallback = clampWindowRect(defaultWindowRect(viewport), viewport);
  if (!storage) return fallback;
  try {
    const nextKey = windowRectStorageKey(userId);
    const nextRaw = storage.getItem(nextKey);
    if (nextRaw !== null) return parseStoredWindowRect(nextRaw, viewport);
    const legacyRaw = storage.getItem(legacyWindowRectStorageKey(userId));
    if (legacyRaw === null) return fallback;
    const migrated = parseLegacyRect(legacyRaw, viewport);
    if (!migrated) return fallback;
    try { storage.setItem(nextKey, serializeWindowRect(migrated)); }
    catch { /* 当前窗口仍使用迁移结果，后续加载可再次尝试落 next key。 */ }
    return migrated;
  } catch {
    return fallback;
  }
}

function legacyWindowJSON(rect: WindowRect, previousRaw: string | null): string {
  let preferredLeftWidth = LEGACY_DEFAULT_LEFT_WIDTH;
  if (previousRaw) {
    try {
      const previous = JSON.parse(previousRaw) as { leftWidth?: unknown };
      if (typeof previous.leftWidth === 'number' && Number.isFinite(previous.leftWidth)) preferredLeftWidth = previous.leftWidth;
    } catch { /* 坏 legacy JSON 使用稳定默认栏宽。 */ }
  }
  const maximumLeftWidth = Math.max(LEGACY_MIN_LEFT_WIDTH, rect.width * 0.4);
  const leftWidth = clamp(preferredLeftWidth, LEGACY_MIN_LEFT_WIDTH, maximumLeftWidth);
  return JSON.stringify({ ...rect, leftWidth, maximized: false });
}

/** 持久化 next 几何时同步产出 legacy 可解析 JSON，使回退后保留位置和尺寸。 */
export function writeStoredWindowRect(
  storage: WindowRectStorage | undefined,
  userId: string | undefined,
  rect: WindowRect,
  viewport: ViewportSize
): void {
  if (!storage) return;
  const normalized = clampWindowRect(rect, viewport);
  const nextKey = windowRectStorageKey(userId);
  const legacyKey = legacyWindowRectStorageKey(userId);
  let previousLegacy: string | null = null;
  try { previousLegacy = storage.getItem(legacyKey); } catch { /* 读取失败时使用默认 leftWidth。 */ }
  let nextWritten = false;
  let legacyWritten = false;
  try { storage.setItem(nextKey, serializeWindowRect(normalized)); nextWritten = true; }
  catch { /* 继续尝试 legacy 回退键。 */ }
  try { storage.setItem(legacyKey, legacyWindowJSON(normalized, previousLegacy)); legacyWritten = true; }
  catch { /* next 成功时 legacy 配额错误不影响当前插件。 */ }
  if (!nextWritten && legacyWritten) {
    try { storage.removeItem(nextKey); } catch { /* best effort */ }
  }
}

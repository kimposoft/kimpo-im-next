import { describe, expect, it } from 'vitest';
import {
  DEFAULT_WINDOW_HEIGHT,
  DEFAULT_WINDOW_WIDTH,
  MAXIMIZED_INSET,
  MIN_WINDOW_HEIGHT,
  MIN_WINDOW_VISIBLE,
  MIN_WINDOW_WIDTH,
  clampWindowRect,
  defaultWindowRect,
  dragWindowRect,
  legacyWindowRectStorageKey,
  maximizedWindowRect,
  parseStoredWindowRect,
  readStoredWindowRect,
  resizeWindowRect,
  serializeWindowRect,
  windowRectStorageKey,
  writeStoredWindowRect,
  type WindowRectStorage
} from './window-rect';

const viewport = { width: 1440, height: 900 };

function memoryStorage(seed: Record<string, string> = {}): WindowRectStorage & { values: Map<string, string> } {
  const values = new Map(Object.entries(seed));
  return {
    values,
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value); },
    removeItem: key => { values.delete(key); }
  };
}

describe('floating IM window rectangle model', () => {
  it('centers the 1120x700 default and isolates storage by user', () => {
    expect(defaultWindowRect(viewport)).toEqual({ x: 160, y: 100, width: DEFAULT_WINDOW_WIDTH, height: DEFAULT_WINDOW_HEIGHT });
    expect(windowRectStorageKey('u/1')).toBe('kimpo_im_next_window_u%2F1');
    expect(legacyWindowRectStorageKey('u/1')).toBe('nahida_im_window_u/1');
    expect(windowRectStorageKey(' ')).toBe('kimpo_im_next_window_anon');
  });

  it('clamps dragging so at least 100 pixels remain visible', () => {
    const rect = defaultWindowRect(viewport);
    expect(dragWindowRect(rect, -10_000, -10_000, viewport)).toMatchObject({ x: MIN_WINDOW_VISIBLE - rect.width, y: MIN_WINDOW_VISIBLE - rect.height });
    expect(dragWindowRect(rect, 10_000, 10_000, viewport)).toMatchObject({ x: viewport.width - MIN_WINDOW_VISIBLE, y: viewport.height - MIN_WINDOW_VISIBLE });
  });

  it('resizes all edges while enforcing minimum dimensions', () => {
    const rect = { x: 200, y: 100, width: 900, height: 600 };
    expect(resizeWindowRect(rect, 'nw', 400, 300, viewport)).toEqual({ x: 300, y: 180, width: MIN_WINDOW_WIDTH, height: MIN_WINDOW_HEIGHT });
    expect(resizeWindowRect(rect, 'se', 50, 25, viewport)).toEqual({ x: 200, y: 100, width: 950, height: 625 });
    for (const direction of ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'] as const) {
      const resized = resizeWindowRect(rect, direction, 20, 20, viewport);
      expect(resized.width).toBeGreaterThanOrEqual(MIN_WINDOW_WIDTH);
      expect(resized.height).toBeGreaterThanOrEqual(MIN_WINDOW_HEIGHT);
    }
  });

  it('produces a near-fullscreen rectangle and preserves a restorable source rectangle', () => {
    const before = defaultWindowRect(viewport);
    const maximized = maximizedWindowRect(viewport);
    expect(maximized).toEqual({ x: MAXIMIZED_INSET, y: MAXIMIZED_INSET, width: 1416, height: 876 });
    expect(before).toEqual(defaultWindowRect(viewport));
  });

  it('round-trips valid persisted geometry and repairs corrupt or undersized values', () => {
    const rect = { x: 20, y: 30, width: 900, height: 600 };
    expect(parseStoredWindowRect(serializeWindowRect(rect), viewport)).toEqual(rect);
    expect(parseStoredWindowRect('{bad', viewport)).toEqual(defaultWindowRect(viewport));
    expect(parseStoredWindowRect(JSON.stringify({ x: 0, y: 0, width: 10, height: 20 }), viewport))
      .toMatchObject({ width: MIN_WINDOW_WIDTH, height: MIN_WINDOW_HEIGHT });
    expect(clampWindowRect({ x: Infinity, y: NaN, width: NaN, height: Infinity }, viewport))
      .toEqual({ x: 0, y: 0, width: DEFAULT_WINDOW_WIDTH, height: DEFAULT_WINDOW_HEIGHT });
  });

  it('migrates legacy geometry to the encoded next key and clamps it for the current viewport', () => {
    const legacyKey = legacyWindowRectStorageKey('用户/1');
    const nextKey = windowRectStorageKey('用户/1');
    const storage = memoryStorage({
      [legacyKey]: JSON.stringify({ x: 5000, y: -5000, width: 900, height: 600, leftWidth: 300, maximized: true })
    });
    const migrated = readStoredWindowRect(storage, '用户/1', viewport);
    expect(migrated).toEqual({ x: 1340, y: -500, width: 900, height: 600 });
    expect(storage.values.get(nextKey)).toBe(serializeWindowRect(migrated));

    storage.values.set(legacyKey, JSON.stringify({ x: 1, y: 2, width: 800, height: 520 }));
    expect(readStoredWindowRect(storage, '用户/1', viewport)).toEqual(migrated);
  });

  it('dual-writes rollback-compatible legacy JSON while preserving a valid legacy left width', () => {
    const storage = memoryStorage({
      [legacyWindowRectStorageKey('u1')]: JSON.stringify({ x: 0, y: 0, width: 900, height: 600, leftWidth: 310, maximized: true })
    });
    const rect = { x: 20, y: 30, width: 1000, height: 650 };
    writeStoredWindowRect(storage, 'u1', rect, viewport);
    expect(storage.values.get(windowRectStorageKey('u1'))).toBe(serializeWindowRect(rect));
    expect(JSON.parse(storage.values.get(legacyWindowRectStorageKey('u1'))!)).toEqual({
      ...rect,
      leftWidth: 310,
      maximized: false
    });
  });

  it('isolates users, gives an existing next key priority and does not fall through bad next JSON', () => {
    const storage = memoryStorage({
      [windowRectStorageKey('u1')]: serializeWindowRect({ x: 10, y: 20, width: 900, height: 600 }),
      [legacyWindowRectStorageKey('u1')]: JSON.stringify({ x: 200, y: 200, width: 1000, height: 700 }),
      [legacyWindowRectStorageKey('u2')]: JSON.stringify({ x: 300, y: 300, width: 1000, height: 700 })
    });
    expect(readStoredWindowRect(storage, 'u1', viewport)).toEqual({ x: 10, y: 20, width: 900, height: 600 });
    expect(readStoredWindowRect(storage, 'u2', viewport)).toEqual({ x: 300, y: 300, width: 1000, height: 700 });

    storage.values.set(windowRectStorageKey('u1'), '{bad');
    expect(readStoredWindowRect(storage, 'u1', viewport)).toEqual(defaultWindowRect(viewport));
  });

  it('fails safely for bad legacy JSON, denied reads and quota errors', () => {
    const bad = memoryStorage({ [legacyWindowRectStorageKey('u1')]: '{bad' });
    expect(readStoredWindowRect(bad, 'u1', viewport)).toEqual(defaultWindowRect(viewport));
    expect(bad.values.has(windowRectStorageKey('u1'))).toBe(false);
    const denied: WindowRectStorage = {
      getItem() { throw new Error('denied'); },
      setItem() { throw new Error('quota'); },
      removeItem() { throw new Error('denied'); }
    };
    expect(readStoredWindowRect(denied, 'u1', viewport)).toEqual(defaultWindowRect(viewport));
    expect(() => writeStoredWindowRect(denied, 'u1', { x: 1, y: 2, width: 900, height: 600 }, viewport)).not.toThrow();
  });

  it('removes a stale next value when only the legacy compatibility write succeeds', () => {
    const nextKey = windowRectStorageKey('u1');
    const base = memoryStorage({ [nextKey]: serializeWindowRect({ x: 1, y: 2, width: 900, height: 600 }) });
    const storage: WindowRectStorage = {
      getItem: base.getItem,
      setItem(key, value) {
        if (key === nextKey) throw new Error('next quota');
        base.setItem(key, value);
      },
      removeItem: base.removeItem
    };
    const latest = { x: 40, y: 50, width: 1000, height: 650 };
    writeStoredWindowRect(storage, 'u1', latest, viewport);
    expect(base.values.has(nextKey)).toBe(false);
    expect(readStoredWindowRect(storage, 'u1', viewport)).toEqual(latest);
  });

  it('re-clamps next geometry when the viewport becomes smaller', () => {
    const storage = memoryStorage({
      [windowRectStorageKey('u1')]: serializeWindowRect({ x: 1200, y: 700, width: 1000, height: 650 })
    });
    expect(readStoredWindowRect(storage, 'u1', { width: 800, height: 600 }))
      .toEqual({ x: 700, y: 500, width: 1000, height: 650 });
  });
});

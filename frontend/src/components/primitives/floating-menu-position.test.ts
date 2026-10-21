import { describe, expect, it } from 'vitest';
import { computeFloatingMenuPosition } from './floating-menu-position';

describe('computeFloatingMenuPosition', () => {
  const viewport = { width: 1440, height: 900 };
  const menu = { width: 140, height: 144 };

  it('aligns a bottom-end menu to its anchor', () => {
    expect(computeFloatingMenuPosition({ left: 160, top: 100, right: 300, bottom: 164, width: 140, height: 64 }, menu, viewport, 'bottom-end'))
      .toEqual({ left: 160, top: 168, placement: 'bottom-end' });
  });

  it('flips above when there is no room below', () => {
    expect(computeFloatingMenuPosition({ left: 900, top: 780, right: 1040, bottom: 844, width: 140, height: 64 }, menu, viewport, 'bottom-start'))
      .toEqual({ left: 900, top: 632, placement: 'top-start' });
  });

  it('clamps pointer-anchored menus inside the viewport margin', () => {
    const position = computeFloatingMenuPosition(
      { left: 1438, top: 898, right: 1438, bottom: 898, width: 0, height: 0 },
      menu,
      viewport,
      'bottom-start'
    );
    expect(position).toEqual({ left: 1292, top: 748, placement: 'top-start' });
    expect(position.left + menu.width).toBe(viewport.width - 8);
    expect(position.top + menu.height).toBe(viewport.height - 8);
  });
});

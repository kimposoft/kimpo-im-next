export type ImFloatingMenuPlacement = 'bottom-start' | 'bottom-end' | 'top-start' | 'top-end' | 'right-start' | 'left-start';

export interface FloatingRect { left: number; top: number; right: number; bottom: number; width: number; height: number; }
export interface FloatingSize { width: number; height: number; }
export interface FloatingViewport { width: number; height: number; }
export interface FloatingPosition { left: number; top: number; placement: ImFloatingMenuPlacement; }

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), Math.max(minimum, maximum));
}

/** Positions a fixed menu, flips on its main axis, then clamps it to the viewport. */
export function computeFloatingMenuPosition(
  anchor: FloatingRect,
  menu: FloatingSize,
  viewport: FloatingViewport,
  preferred: ImFloatingMenuPlacement,
  offset = 4,
  margin = 8
): FloatingPosition {
  let placement = preferred;
  if (preferred.startsWith('bottom') && anchor.bottom + offset + menu.height > viewport.height - margin && anchor.top - offset - menu.height >= margin) {
    placement = preferred === 'bottom-start' ? 'top-start' : 'top-end';
  } else if (preferred.startsWith('top') && anchor.top - offset - menu.height < margin && anchor.bottom + offset + menu.height <= viewport.height - margin) {
    placement = preferred === 'top-start' ? 'bottom-start' : 'bottom-end';
  } else if (preferred === 'right-start' && anchor.right + offset + menu.width > viewport.width - margin && anchor.left - offset - menu.width >= margin) {
    placement = 'left-start';
  } else if (preferred === 'left-start' && anchor.left - offset - menu.width < margin && anchor.right + offset + menu.width <= viewport.width - margin) {
    placement = 'right-start';
  }

  let left: number;
  let top: number;
  if (placement === 'bottom-start') { left = anchor.left; top = anchor.bottom + offset; }
  else if (placement === 'bottom-end') { left = anchor.right - menu.width; top = anchor.bottom + offset; }
  else if (placement === 'top-start') { left = anchor.left; top = anchor.top - menu.height - offset; }
  else if (placement === 'top-end') { left = anchor.right - menu.width; top = anchor.top - menu.height - offset; }
  else if (placement === 'right-start') { left = anchor.right + offset; top = anchor.top; }
  else { left = anchor.left - menu.width - offset; top = anchor.top; }

  return {
    left: Math.round(clamp(left, margin, viewport.width - menu.width - margin)),
    top: Math.round(clamp(top, margin, viewport.height - menu.height - margin)),
    placement
  };
}

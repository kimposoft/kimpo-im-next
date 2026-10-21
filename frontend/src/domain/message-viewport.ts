export interface MessageViewport {
  scrollTop: number;
  readonly scrollHeight: number;
  readonly clientHeight: number;
}

export interface ViewportAnchor { scrollTop: number; scrollHeight: number; }

export function isViewportAtBottom(viewport: MessageViewport, threshold = 24): boolean {
  return viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight <= threshold;
}

/** Scroll once before layout settles and once after it, then trust only the measured result. */
export async function scrollViewportToLatest(viewport: MessageViewport, settle: () => Promise<void>): Promise<boolean> {
  viewport.scrollTop = viewport.scrollHeight;
  await settle();
  viewport.scrollTop = viewport.scrollHeight;
  return isViewportAtBottom(viewport);
}

export function captureViewportAnchor(viewport: MessageViewport): ViewportAnchor {
  return { scrollTop: viewport.scrollTop, scrollHeight: viewport.scrollHeight };
}

export function restoreViewportAfterPrepend(viewport: MessageViewport, anchor: ViewportAnchor): void {
  viewport.scrollTop = anchor.scrollTop + Math.max(0, viewport.scrollHeight - anchor.scrollHeight);
}

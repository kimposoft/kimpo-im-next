import { describe, expect, it } from 'vitest';
import { captureViewportAnchor, restoreViewportAfterPrepend, scrollViewportToLatest } from './message-viewport';

describe('message viewport orchestration', () => {
  it('settles a long latest window at the real bottom before reporting readiness', async () => {
    const viewport = { scrollTop: 0, scrollHeight: 4000, clientHeight: 600 };
    const atBottom = await scrollViewportToLatest(viewport, async () => {
      expect(viewport.scrollTop).toBe(4000);
      viewport.scrollHeight = 4300;
    });
    expect(viewport.scrollTop).toBe(4300);
    expect(atBottom).toBe(true);
  });

  it('preserves the visible anchor when older messages are prepended', () => {
    const viewport = { scrollTop: 180, scrollHeight: 1200, clientHeight: 600 };
    const anchor = captureViewportAnchor(viewport);
    viewport.scrollHeight = 1900;
    restoreViewportAfterPrepend(viewport, anchor);
    expect(viewport.scrollTop).toBe(880);
  });
});

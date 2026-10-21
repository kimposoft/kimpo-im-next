import { describe, expect, it } from 'vitest';
import { shouldAutoFocusComposer } from './composer-focus';

describe('composer focus policy', () => {
  it('focuses only a writable desktop conversation without an open modal', () => {
    expect(shouldAutoFocusComposer({ canWrite: true, modalOpen: false, viewportWidth: 1280, coarsePointer: false })).toBe(true);
    expect(shouldAutoFocusComposer({ canWrite: false, modalOpen: false, viewportWidth: 1280, coarsePointer: false })).toBe(false);
    expect(shouldAutoFocusComposer({ canWrite: true, modalOpen: true, viewportWidth: 1280, coarsePointer: false })).toBe(false);
  });

  it('does not summon the keyboard on a narrow coarse-pointer surface', () => {
    expect(shouldAutoFocusComposer({ canWrite: true, modalOpen: false, viewportWidth: 390, coarsePointer: true })).toBe(false);
    expect(shouldAutoFocusComposer({ canWrite: true, modalOpen: false, viewportWidth: 1024, coarsePointer: true })).toBe(true);
  });
});

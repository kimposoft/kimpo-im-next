export interface ComposerFocusContext {
  canWrite: boolean;
  modalOpen: boolean;
  viewportWidth: number;
  coarsePointer: boolean;
}

/** Avoids opening the on-screen keyboard or stealing focus from an active modal. */
export function shouldAutoFocusComposer(context: ComposerFocusContext): boolean {
  return context.canWrite && !context.modalOpen && !(context.coarsePointer && context.viewportWidth <= 768);
}

import { definePluginSurface, type SurfaceCreateInput } from '@kimposoft/plugin-sdk/surface';
import ImFloatingShell from './components/shell/ImFloatingShell.vue';
import type { ImNextHostBridge } from './host-bridge';

export type { ImNextHostBridge } from './host-bridge';
export type { NahidaImClient } from '@kimposoft/plugin-sdk/nahida-im';
export { buildCardDisplayModel, isKnownCardRenderer, normalizeSafeCardLink, registerBusinessCardRenderer } from './domain/card-renderer-registry';
export type { CardDisplayAction, CardDisplayModel, CardRendererContext, CardRendererDisplay, CardRendererInput, CardRendererRegistration } from './domain/card-renderer-registry';
export { default as ImBusinessCard } from './components/cards/ImBusinessCard.vue';
export { getVirtualWindow, restoreHistoryAnchor, mediaHeightScrollDelta } from './domain/virtual-window';

export const createSurface = definePluginSurface((input: SurfaceCreateInput) => {
  if ((input.surfaceType as string) !== 'im-panel') throw new Error(`[kimpo-im-next] unsupported surface: ${input.surfaceType}`);
  const props = input.props ?? {};
  return {
    component: ImFloatingShell,
    props: {
      hostBridge: props.hostBridge as ImNextHostBridge | undefined,
      userId: typeof props.userId === 'string' ? props.userId : ''
    }
  };
});

import type { BusinessCard } from './types';
import { MERGED_MESSAGES_RENDERER } from './forward';

export type CardRendererVariant = 'approval' | 'todo' | 'merged' | 'extension' | 'fallback';
/**
 * 卡片色调（卡片样式规范第三节）：决定类别图标块与待处理状态胶囊取哪个宿主语义色三元组。
 * brand=流程审批/编辑申请等待办型；warning=待办提醒；success=已释放/已完成型告知；neutral=合并转发与未知回退。
 */
export type CardTone = 'brand' | 'warning' | 'success' | 'neutral';
export type CardActionBlockReason =
  | 'allowed'
  | 'unsupported-renderer'
  | 'renderer-readonly'
  | 'not-notification'
  | 'not-pending'
  | 'busy'
  | 'declared-disabled'
  | 'invalid-action';

export interface CardRendererContext {
  /** Only notification cards have the authenticated IM cardAction route. */
  readonly actionSource: 'nahida-notification' | 'nahida-message' | 'none';
  readonly busy?: boolean;
}

export interface CardDisplayAction {
  readonly key: string;
  readonly label: string;
  readonly style: 'default' | 'primary' | 'danger';
  readonly requiresComment: boolean;
  readonly disabled: boolean;
  readonly blockReason: CardActionBlockReason;
}

export interface CardDetailRow {
  readonly label: string;
  readonly value: string;
}

/**
 * Safe, renderer-independent output consumed by the Vue component. It deliberately contains no
 * HTML, component, callback or action payload. Business actions always originate from the IM
 * card contract and are executed by the panel's notification cardAction path.
 */
export interface CardDisplayModel {
  readonly rendererKey: string;
  readonly variant: CardRendererVariant;
  readonly tone: CardTone;
  readonly supported: boolean;
  readonly title: string;
  readonly summary: string;
  readonly state?: 'pending' | 'done' | 'ignored' | 'agreed' | 'expired';
  readonly safeLink?: string;
  readonly detailRows: readonly CardDetailRow[];
  readonly actions: readonly CardDisplayAction[];
  readonly localView: 'none' | 'link' | 'merged';
}

export interface CardRendererDisplay {
  readonly title?: string;
  readonly summary?: string;
  readonly detailRows?: readonly CardDetailRow[];
  readonly link?: string;
}

export interface CardRendererInput {
  readonly rendererKey: string;
  readonly title?: string;
  readonly summary?: string;
  readonly state?: 'pending' | 'done' | 'ignored' | 'agreed' | 'expired';
  readonly link?: string;
  readonly data: Readonly<BusinessCard['data']>;
}

export interface CardRendererRegistration {
  readonly rendererKey: string;
  /** Opt-in only; actions are still sourced exclusively from the IM card and use cardAction. */
  readonly allowNahidaActions?: boolean;
  /** Pure presentation only. Returned data is sanitized before it reaches the component. */
  readonly buildDisplay: (card: CardRendererInput) => CardRendererDisplay;
}

interface RegisteredRenderer {
  readonly variant: Exclude<CardRendererVariant, 'fallback'>;
  readonly tone: CardTone;
  readonly buildDisplay: CardRendererRegistration['buildDisplay'];
  readonly localView?: CardDisplayModel['localView'];
  readonly allowNahidaActions: boolean;
  readonly builtin: boolean;
}

const MAX_KEY_LENGTH = 160;
const MAX_TEXT_LENGTH = 2_000;
const MAX_DETAIL_ROWS = 12;
const KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;
const registry = new Map<string, RegisteredRenderer>();

function canonicalKey(value: string): string {
  const key = value.trim();
  if (!key || key.length > MAX_KEY_LENGTH || !KEY_PATTERN.test(key)) throw new Error('invalid_card_renderer_key');
  return key;
}

function safeText(value: unknown, maxLength = MAX_TEXT_LENGTH): string {
  return typeof value === 'string' ? value.slice(0, maxLength) : '';
}

/** Allows app-relative routes and http(s), and rejects protocol-relative and active-content URLs. */
export function normalizeSafeCardLink(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const link = value.trim();
  if (!link || link.length > MAX_TEXT_LENGTH || /[\u0000-\u001f\u007f]/.test(link)) return undefined;
  if (link.startsWith('/') && !link.startsWith('//') && !link.startsWith('/\\')) return link;
  try {
    const parsed = new URL(link);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.href : undefined;
  } catch {
    return undefined;
  }
}

function sanitizeDetails(rows: readonly CardDetailRow[] | undefined): readonly CardDetailRow[] {
  if (!Array.isArray(rows)) return [];
  return rows.slice(0, MAX_DETAIL_ROWS).flatMap(row => {
    const label = safeText(row?.label, 120).trim();
    const value = safeText(row?.value, 500).trim();
    return label && value ? [{ label, value }] : [];
  });
}

function actionBlockReason(
  action: BusinessCard['actions'][number],
  card: Readonly<BusinessCard>,
  context: CardRendererContext,
  supported: boolean,
  allowNahidaActions: boolean
): CardActionBlockReason {
  if (!action.key.trim() || !action.label.trim() || action.key.length > MAX_KEY_LENGTH || !KEY_PATTERN.test(action.key)) return 'invalid-action';
  if (!supported) return 'unsupported-renderer';
  if (!allowNahidaActions) return 'renderer-readonly';
  if (context.actionSource === 'none') return 'not-notification';
  if (card.state !== 'pending') return 'not-pending';
  if (context.busy) return 'busy';
  if (action.disabled) return 'declared-disabled';
  return 'allowed';
}

function normalizeActions(card: Readonly<BusinessCard>, context: CardRendererContext, supported: boolean, allowNahidaActions: boolean): readonly CardDisplayAction[] {
  const seen = new Set<string>();
  return card.actions.slice(0, 20).flatMap(action => {
    const key = safeText(action.key, MAX_KEY_LENGTH).trim();
    if (seen.has(key)) return [];
    seen.add(key);
    const reason = actionBlockReason(action, card, context, supported, allowNahidaActions);
    return [{
      key,
      label: safeText(action.label, 240).trim() || key,
      style: action.style === 'primary' || action.style === 'danger' ? action.style : 'default',
      requiresComment: Boolean(action.requiresComment),
      disabled: reason !== 'allowed',
      blockReason: reason
    }];
  });
}

function baseDisplay(card: CardRendererInput): CardRendererDisplay {
  return { title: card.title, summary: card.summary, link: card.link };
}

function installBuiltin(
  rendererKey: string,
  variant: RegisteredRenderer['variant'],
  localView: CardDisplayModel['localView'] = 'link',
  allowNahidaActions = true,
  tone: CardTone = 'brand'
): void {
  registry.set(rendererKey, { variant, tone, localView, allowNahidaActions, builtin: true, buildDisplay: baseDisplay });
}

installBuiltin('approval', 'approval');
installBuiltin('workflow.approval', 'approval');
installBuiltin('workflow.approval_card', 'approval');
installBuiltin('todo', 'todo', 'link', true, 'warning');
installBuiltin(MERGED_MESSAGES_RENDERER, 'merged', 'merged', false, 'neutral');
installBuiltin('edit_request.workflow', 'extension', 'link');
installBuiltin('edit_request.template', 'extension', 'link');
installBuiltin('edit_request.business_record', 'extension', 'link');
// 已释放告知卡：只读、success 色调（对方已同意，属正向结果通知）
installBuiltin('edit_request.released.workflow', 'extension', 'link', false, 'success');
installBuiltin('edit_request.released.template', 'extension', 'link', false, 'success');
installBuiltin('edit_request.released.business_record', 'extension', 'link', false, 'success');

/**
 * Registers a safe presentation adapter. Built-ins and existing keys cannot be overwritten; this
 * prevents a late-loaded plugin from changing another plugin's renderer or action affordances.
 */
export function registerBusinessCardRenderer(registration: CardRendererRegistration): () => void {
  const key = canonicalKey(registration.rendererKey);
  if (typeof registration.buildDisplay !== 'function') throw new Error('invalid_card_renderer');
  if (registry.has(key)) throw new Error('card_renderer_already_registered');
  const entry: RegisteredRenderer = {
    variant: 'extension',
    tone: 'brand',
    builtin: false,
    buildDisplay: registration.buildDisplay,
    localView: 'link',
    allowNahidaActions: registration.allowNahidaActions === true
  };
  registry.set(key, entry);
  return () => {
    if (registry.get(key) === entry) registry.delete(key);
  };
}

export function isKnownCardRenderer(rendererKey: string): boolean {
  try { return registry.has(canonicalKey(rendererKey)); }
  catch { return false; }
}

export function buildCardDisplayModel(card: Readonly<BusinessCard>, context: CardRendererContext): CardDisplayModel {
  let key: string;
  try { key = canonicalKey(card.rendererKey); }
  catch { key = safeText(card.rendererKey, MAX_KEY_LENGTH); }
  const renderer = registry.get(key);
  let rawDisplay: CardRendererDisplay = baseDisplay(card);
  let supported = Boolean(renderer);
  if (renderer) {
    const rendererInput: CardRendererInput = Object.freeze({
      rendererKey: card.rendererKey,
      title: card.title,
      summary: card.summary,
      state: card.state,
      link: card.link,
      data: Object.freeze({ ...card.data })
    });
    try { rawDisplay = renderer.buildDisplay(rendererInput) ?? {}; }
    catch { supported = false; }
  }
  const safeLink = normalizeSafeCardLink(rawDisplay.link ?? card.link);
  const variant = supported && renderer ? renderer.variant : 'fallback';
  const localView = supported && renderer?.localView === 'merged'
    ? 'merged'
    : safeLink && supported
      ? 'link'
      : 'none';
  return {
    rendererKey: key,
    variant,
    tone: supported && renderer ? renderer.tone : 'neutral',
    supported,
    title: safeText(rawDisplay.title ?? card.title).trim(),
    summary: safeText(rawDisplay.summary ?? card.summary).trim(),
    state: card.state,
    safeLink,
    detailRows: sanitizeDetails(rawDisplay.detailRows),
    actions: normalizeActions(card, context, supported, Boolean(renderer?.allowNahidaActions)),
    localView
  };
}

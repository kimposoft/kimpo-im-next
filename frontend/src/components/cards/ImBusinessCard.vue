<script setup lang="ts">
/**
 * 业务卡片统一渲染组件（KimpoChat 卡片样式规范 2026-08-23）。
 * 解剖：类别行（色调图标块 + 类别文字 + 状态胶囊）→ 标题 → 摘要 → 明细井 → 底行（查看文字链靠左 / 动作按钮靠右）。
 * 卡片自带外框（bg-card 实底 + border-lighter 描边 + 8px 圆角），两个宿主容器（系统通知会话 / 聊天气泡）
 * 在放入卡片时自身退为透明无框，外框只画一次。
 * 安全边界不变：只插值 model 字段，图标按 variant 走静态 v-if 内联 SVG，不做原始 HTML 注入、不用动态组件。
 */
import { computed } from 'vue';
import type { CardDisplayAction, CardDisplayModel } from '../../domain/card-renderer-registry';

const props = defineProps<{
  model: CardDisplayModel;
  fallbackLabel: string;
  /** 类别行文字：由宿主面板按 variant/cardType 本地化后传入（如「流程审批」「编辑申请」「聊天记录」） */
  businessLabel: string;
  untitledLabel: string;
  noSummaryLabel: string;
  viewLabel: string;
  mergedViewLabel: string;
}>();

const emit = defineEmits<{
  action: [action: CardDisplayAction];
  view: [safeInternalLink?: string];
}>();

const externalLink = computed(() => Boolean(props.model.safeLink && /^https?:\/\//i.test(props.model.safeLink)));
const internalLink = computed(() => props.model.localView === 'link' && props.model.safeLink?.startsWith('/') ? props.model.safeLink : undefined);
/** 已进入终态（done/agreed/ignored/expired）的卡片：图标块退灰，按钮由 model 侧禁用 */
const settled = computed(() => Boolean(props.model.state && props.model.state !== 'pending'));
/** 已释放告知卡：success 色调 + 锁图标 */
const released = computed(() => props.model.rendererKey.startsWith('edit_request.released.'));
const editRequest = computed(() => !released.value && props.model.rendererKey.startsWith('edit_request.'));

function requestAction(action: CardDisplayAction): void {
  if (!action.disabled && action.blockReason === 'allowed') emit('action', action);
}
</script>

<template>
  <section
    :class="[
      'im-business-card',
      `im-business-card--${model.variant}`,
      `im-business-card--tone-${model.tone}`,
      { 'im-business-card--fallback': !model.supported, 'im-business-card--settled': settled }
    ]"
    :data-renderer-key="model.rendererKey"
  >
    <div class="im-business-card__head">
      <span class="im-business-card__icon" aria-hidden="true">
        <!-- 图标按 variant 静态分支：审批=勾 / 待办=清单 / 合并转发=行 / 编辑申请=笔 / 已释放=锁 / 回退=感叹 -->
        <svg v-if="!model.supported" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><circle cx="8" cy="8" r="5.5" /><path d="M8 5.5v3M8 11h.01" /></svg>
        <svg v-else-if="model.variant === 'approval'" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8.5l3 3 7-7" /></svg>
        <svg v-else-if="model.variant === 'todo'" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><rect x="3" y="3" width="10" height="10" rx="2" /><path d="M6 8h4M6 10.5h2.5" /></svg>
        <svg v-else-if="model.variant === 'merged'" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M3 4h10M3 8h10M3 12h6" /></svg>
        <svg v-else-if="released" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M5 8V5.5a3 3 0 016 0" /><rect x="3" y="8" width="10" height="6" rx="1.5" /></svg>
        <svg v-else-if="editRequest" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M11 2.5l2.5 2.5L6 12.5H3.5V10L11 2.5z" /></svg>
        <svg v-else viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><rect x="2.5" y="3.5" width="11" height="9" rx="2" /><path d="M2.5 6.5h11" /></svg>
      </span>
      <small class="im-business-card__kind">{{ model.supported ? businessLabel : fallbackLabel }}</small>
      <span v-if="model.state" class="im-business-card__state" :data-state="model.state"><slot name="state" :state="model.state">{{ model.state }}</slot></span>
    </div>
    <b class="im-business-card__title">{{ model.title || untitledLabel }}</b>
    <p class="im-business-card__summary">{{ model.summary || noSummaryLabel }}</p>
    <dl v-if="model.detailRows.length" class="im-business-card__details">
      <template v-for="row in model.detailRows" :key="`${row.label}:${row.value}`">
        <dt>{{ row.label }}</dt><dd>{{ row.value }}</dd>
      </template>
    </dl>
    <div v-if="model.actions.length || (model.localView === 'link' && model.safeLink) || model.localView === 'merged'" class="im-business-card__foot">
      <a
        v-if="model.localView === 'link' && model.safeLink && externalLink"
        class="im-business-card__view"
        :href="model.safeLink"
        :target="externalLink ? '_blank' : undefined"
        :rel="externalLink ? 'noopener noreferrer' : undefined"
      >{{ viewLabel }}<svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M4.5 2.5L8 6l-3.5 3.5" /></svg></a>
      <button v-else-if="internalLink" type="button" class="im-business-card__view" @click="emit('view', internalLink)">{{ viewLabel }}<svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M4.5 2.5L8 6l-3.5 3.5" /></svg></button>
      <button v-else-if="model.localView === 'merged'" type="button" class="im-business-card__view" @click="emit('view')">{{ mergedViewLabel }}<svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M4.5 2.5L8 6l-3.5 3.5" /></svg></button>
      <div v-if="model.actions.length" class="im-business-card__actions">
        <button
          v-for="action in model.actions"
          :key="action.key"
          type="button"
          :class="`im-business-card__action--${action.style}`"
          :disabled="action.disabled"
          :data-block-reason="action.blockReason"
          @click="requestAction(action)"
        >{{ action.label }}</button>
      </div>
    </div>
  </section>
</template>

<style scoped>
/* —— 外框与色调（规范第二/三节）。--im-card-tone 为 RGB 三元组，取自宿主语义色 —— */
.im-business-card { --im-card-tone:var(--primary-color,8 119 244);display:grid;gap:8px;min-width:260px;max-width:360px;width:100%;box-sizing:border-box;padding:12px 14px;background:var(--im-uikit-bg-card,#fff);border:1px solid var(--im-uikit-border-lighter,#ebeef5);border-radius:var(--im-uikit-radius-md,8px);box-shadow:0 1px 3px rgba(31,35,41,.05);color:var(--im-uikit-text-primary,#1f1f1f);font-size:var(--im-uikit-font-size-md,14px);line-height:var(--im-uikit-line-height-md,20px);text-align:left; }
.im-business-card--tone-warning { --im-card-tone:var(--warning-color,250 173 20); }
.im-business-card--tone-success { --im-card-tone:var(--success-color,103 194 58); }
.im-business-card--tone-neutral { --im-card-tone:var(--text-hint-color,153 153 153); }
.im-business-card--fallback { border-style:dashed;color:var(--im-uikit-text-secondary,#666); }

/* —— 类别行 —— */
.im-business-card__head { display:flex;align-items:center;gap:8px;min-height:20px; }
.im-business-card__icon { flex:none;display:grid;place-items:center;width:20px;height:20px;border-radius:var(--im-uikit-radius-sm,6px);background:rgb(var(--im-card-tone) / .12);color:rgb(var(--im-card-tone)); }
.im-business-card__icon svg { display:block;width:13px;height:13px; }
.im-business-card--settled .im-business-card__icon { background:var(--im-uikit-bg-muted,#f7f8fa);color:var(--im-uikit-text-tertiary,#999); }
.im-business-card__kind { flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--im-uikit-text-tertiary,#999);font-size:var(--im-uikit-font-size-sm,12px);line-height:var(--im-uikit-line-height-sm,18px); }
.im-business-card__state { flex:none;padding:0 8px;border-radius:var(--im-uikit-radius-pill,999px);font-size:11px;line-height:18px;font-weight:500;background:rgb(var(--im-card-tone) / .12);color:rgb(var(--im-card-tone)); }
.im-business-card__state[data-state="done"],.im-business-card__state[data-state="agreed"] { background:rgb(var(--success-color,103 194 58) / .14);color:rgb(var(--success-color,103 194 58)); }
.im-business-card__state[data-state="ignored"],.im-business-card__state[data-state="expired"] { line-height:16px;border:1px solid var(--im-uikit-border-lighter,#ebeef5);background:var(--im-uikit-bg-muted,#f7f8fa);color:var(--im-uikit-text-secondary,#666); }
.im-business-card__state[data-state="expired"] { color:var(--im-uikit-text-tertiary,#999);text-decoration:line-through; }

/* —— 标题 / 摘要 / 明细井 —— */
.im-business-card__title { display:block;font-size:var(--im-uikit-font-size-md,14px);line-height:var(--im-uikit-line-height-md,20px);font-weight:600;overflow-wrap:anywhere; }
.im-business-card__summary { margin:0;color:var(--im-uikit-text-secondary,#666);font-size:13px;line-height:20px;white-space:pre-wrap;overflow-wrap:anywhere; }
.im-business-card__details { display:grid;grid-template-columns:auto minmax(0,1fr);gap:4px 12px;margin:0;padding:8px 10px;border-radius:var(--im-uikit-radius-sm,6px);background:var(--im-uikit-bg-muted,#f7f8fa);font-size:var(--im-uikit-font-size-sm,12px);line-height:var(--im-uikit-line-height-sm,18px); }
.im-business-card__details dt { color:var(--im-uikit-text-tertiary,#999);white-space:nowrap; }
.im-business-card__details dd { margin:0;overflow-wrap:anywhere;font-variant-numeric:tabular-nums; }
/* 合并转发：明细井作为消息预览列表，值列单行省略 */
.im-business-card--merged .im-business-card__details dd { overflow:hidden;text-overflow:ellipsis;white-space:nowrap; }

/* —— 底行：查看文字链靠左，动作按钮靠右 —— */
.im-business-card__foot { display:flex;align-items:center;flex-wrap:wrap;gap:8px;margin-top:2px; }
.im-business-card__view { display:inline-flex;align-items:center;gap:4px;margin-right:auto;border:0;padding:0;background:none;color:var(--im-uikit-text-link,#0877f4);font:inherit;font-size:var(--im-uikit-font-size-sm,12px);line-height:28px;text-decoration:none;cursor:pointer; }
.im-business-card__view:hover { text-decoration:underline; }
.im-business-card__view:focus-visible { outline:none;border-radius:4px;box-shadow:var(--im-uikit-focus-ring,0 0 0 2px rgba(8,119,244,.28)); }
.im-business-card__view svg { width:12px;height:12px; }
.im-business-card__actions { display:flex;flex-wrap:wrap;gap:8px;margin-left:auto; }
.im-business-card__actions button { height:28px;padding:0 12px;border:1px solid var(--im-uikit-border-default,#dcdfe6);border-radius:var(--im-uikit-radius-sm,6px);background:var(--im-uikit-bg-card,#fff);color:var(--im-uikit-text-primary,#1f1f1f);font:inherit;font-size:var(--im-uikit-font-size-sm,12px);font-weight:500;line-height:26px;cursor:pointer;transition:background var(--im-uikit-transition-interaction,.2s ease),border-color var(--im-uikit-transition-interaction,.2s ease); }
.im-business-card__actions button:hover { background:var(--im-uikit-bg-muted,#f7f8fa); }
.im-business-card__actions button:focus-visible { outline:none;box-shadow:var(--im-uikit-focus-ring,0 0 0 2px rgba(8,119,244,.28)); }
.im-business-card__actions .im-business-card__action--primary { background:var(--im-uikit-brand,#0877f4);border-color:var(--im-uikit-brand,#0877f4);color:var(--im-uikit-text-on-primary,#fff); }
.im-business-card__actions .im-business-card__action--primary:hover { background:rgb(var(--primary-color,8 119 244) / .88); }
.im-business-card__actions .im-business-card__action--danger { background:rgb(var(--error-color,232 79 79) / .08);border-color:rgb(var(--error-color,232 79 79) / .25);color:var(--im-uikit-error,#e84f4f); }
.im-business-card__actions .im-business-card__action--danger:hover { background:rgb(var(--error-color,232 79 79) / .14); }
.im-business-card__actions button:disabled { opacity:.45;cursor:not-allowed; }
.im-business-card__actions button:disabled:hover { background:var(--im-uikit-bg-card,#fff); }
.im-business-card__actions .im-business-card__action--primary:disabled:hover { background:var(--im-uikit-brand,#0877f4); }
.im-business-card__actions .im-business-card__action--danger:disabled:hover { background:rgb(var(--error-color,232 79 79) / .08); }
@media (prefers-reduced-motion:reduce) { .im-business-card__actions button { transition:none; } }
</style>

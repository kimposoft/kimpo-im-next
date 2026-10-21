<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import type { Attachment, Message } from '../../domain/types';
import { filterHistory, type HistorySource, type HistoryTab } from '../../domain/history-filter';
import { linkifyMessageText } from '../../domain/message-presentation';
import { imCalendarDay } from '../../domain/time-format';
import ImSearchBar from '../conversations/ImSearchBar.vue';
import ImAvatar from '../primitives/ImAvatar.vue';
import ImIcon from '../../components/primitives/ImIcon.vue';
import ImDialogHeader from '../primitives/ImDialogHeader.vue';
import ImHistoryCalendar from './ImHistoryCalendar.vue';

/**
 * 聊天记录浮层（2026-08-11，交互参照微信聊天记录页）：
 * 全部/图片与视频/文件/链接 分类页签 + 关键字搜索 + 日期分组 + 日期筛选，最新在上，触底按需翻页。
 * 翻页抽象为「无参闭包」——游标（消息 seq / 通知 offset）由面板闭包持有，浮层只
 * 负责调用、按 message.id 去重拼接（顺带兜底通知 offset 深分页同秒重复）、判定 done。
 * 2026-08-11：日期筛选——选中某天后仅展示该日消息；若已加载区间未覆盖所选日，
 * 自动向更早翻页补载，单次筛选最多再补 10 页，避免无限拉取。
 */
export interface ImChatHistoryLabels {
  title: string;
  close: string;
  search: string;
  tabAll: string;
  tabMedia: string;
  tabFile: string;
  tabLink: string;
  empty: string;
  loading: string;
  loadMore: string;
  end: string;
  image: string;
  video: string;
  card: string;
  system: string;
  /** 日期筛选按钮 aria/tooltip，选中/未选中共用 */
  dateFilter: string;
  /** 清除已选日期的小叉按钮 aria/tooltip */
  dateClear: string;
  datePrevMonth: string;
  dateNextMonth: string;
  /** 日期筛选自动补载达单次 10 页上限后，手动继续加载的按钮文案 */
  dateContinue: string;
}

const props = withDefaults(defineProps<{
  title: string;
  labels: ImChatHistoryLabels;
  fetchPage: () => Promise<{ items: Message[]; done: boolean }>;
  formatDate: (message: Message) => string;
  formatTime: (message: Message) => string;
  source?: HistorySource;
  /** 宿主 IANA 时区；日期筛选/自动补载的"哪一天"判定全部走它，不用浏览器本地时区 */
  timezone: string;
  locale: string;
}>(), { source: 'messages' });

const emit = defineEmits<{ close: []; preview: [attachment: Attachment] }>();

const items = ref<Message[]>([]);
const seenIds = new Set<string>();
const keyword = ref('');
const tab = ref<HistoryTab>('all');
const loading = ref(false);
const exhausted = ref(false);
const loadError = ref(false);
const surface = ref<HTMLElement>();

// —— 日期筛选——
const selectedDay = ref<string | null>(null); // 'YYYY-MM-DD'，null=不筛选
const calendarOpen = ref(false);
const dateBudgetExhausted = ref(false); // 单次筛选已连续补载满上限仍未覆盖所选日
const dateButton = ref<HTMLElement>();
const calendarPanel = ref<HTMLElement>();
/** 单次日期筛选最多自动/手动补载的页数上限，防止一次筛选无限翻页 */
const DATE_AUTO_LOAD_PAGE_CAP = 10;

const tabs: ReadonlyArray<{ key: HistoryTab; label: keyof ImChatHistoryLabels }> = [
  { key: 'all', label: 'tabAll' },
  { key: 'media', label: 'tabMedia' },
  { key: 'file', label: 'tabFile' },
  { key: 'link', label: 'tabLink' }
];

// 最新在上（微信同款倒序），filterHistory 升序结果反转展示
const visible = computed(() =>
  filterHistory(items.value, tab.value, keyword.value, props.source, selectedDay.value ?? undefined, props.timezone).reverse()
);
const grouped = computed(() => {
  const groups: Array<{ date: string; rows: Message[] }> = [];
  for (const message of visible.value) {
    const date = props.formatDate(message);
    const last = groups.at(-1);
    if (last && last.date === date) last.rows.push(message);
    else groups.push({ date, rows: [message] });
  }
  return groups;
});
/** 选中日期按钮上的短文案："MM月DD日"（zh-CN）/ "Aug 11"（其余语言，取 Intl 短月+日） */
const selectedDayLabel = computed(() => {
  if (!selectedDay.value) return '';
  const [year, month, date] = selectedDay.value.split('-').map(Number);
  if (props.locale === 'zh-CN') return `${String(month).padStart(2, '0')}月${String(date).padStart(2, '0')}日`;
  return new Intl.DateTimeFormat(props.locale, { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(
    new Date(Date.UTC(year, month - 1, date))
  );
});

async function loadMore(): Promise<void> {
  if (loading.value || exhausted.value) return;
  loading.value = true;
  loadError.value = false;
  try {
    const page = await props.fetchPage();
    const fresh = page.items.filter(item => !seenIds.has(item.id));
    fresh.forEach(item => seenIds.add(item.id));
    if (fresh.length) items.value = items.value.concat(fresh);
    if (page.done) exhausted.value = true;
  } catch {
    loadError.value = true;
  } finally {
    loading.value = false;
  }
}

/** 已加载消息中最旧一条的日历日；尚未加载任何消息时返回 undefined */
function oldestLoadedDay(): string | undefined {
  if (!items.value.length) return undefined;
  const oldest = items.value.reduce((min, item) => (item.seq < min.seq ? item : min));
  return imCalendarDay(oldest.createdAt, props.timezone);
}

/** 已加载区间是否已覆盖所选日（done 时视为覆盖——那天确实没有更早消息可补） */
function coversDay(day: string): boolean {
  if (exhausted.value) return true;
  const oldestDay = oldestLoadedDay();
  return oldestDay !== undefined && oldestDay <= day;
}

/**
 * 为所选日期自动补载：只要"已加载最旧一条消息的日历日仍晚于所选日期"且未到底，
 * 就持续翻页；单次筛选最多补 DATE_AUTO_LOAD_PAGE_CAP 页，超限交给"继续加载"按钮手动接力。
 */
async function loadForSelectedDay(day: string): Promise<void> {
  dateBudgetExhausted.value = false;
  let budget = DATE_AUTO_LOAD_PAGE_CAP;
  while (!coversDay(day) && !exhausted.value && budget > 0) {
    await loadMore();
    budget -= 1;
  }
  if (!coversDay(day) && !exhausted.value) dateBudgetExhausted.value = true;
}

function selectDay(day: string): void {
  selectedDay.value = day;
  calendarOpen.value = false;
  void loadForSelectedDay(day);
}
function clearDay(): void {
  selectedDay.value = null;
  dateBudgetExhausted.value = false;
}
/** "继续加载"按钮：补载额度用尽后由用户手动接力，再给一轮 10 页额度 */
function continueLoadingDay(): void {
  if (selectedDay.value) void loadForSelectedDay(selectedDay.value);
}

function toggleCalendar(): void {
  calendarOpen.value = !calendarOpen.value;
}
/** 点击面板外部关闭日历（不用 ImFloatingMenu——该组件由其他改动并行维护） */
function closeCalendarIfOutside(event: MouseEvent): void {
  const target = event.target as Node;
  if (dateButton.value?.contains(target) || calendarPanel.value?.contains(target)) return;
  calendarOpen.value = false;
}
watch(calendarOpen, open => {
  if (open) document.addEventListener('mousedown', closeCalendarIfOutside);
  else document.removeEventListener('mousedown', closeCalendarIfOutside);
});
onUnmounted(() => document.removeEventListener('mousedown', closeCalendarIfOutside));

function onScroll(event: Event): void {
  const el = event.target as HTMLElement;
  if (el.scrollHeight - el.scrollTop - el.clientHeight < 80) void loadMore();
}

function attachmentSize(attachment: Attachment): string {
  const kb = attachment.byteSize / 1024;
  if (kb < 1024) return `${Math.max(1, Math.round(kb))} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
}

function attachmentBadge(message: Message): string {
  if (message.kind === 'image') return props.labels.image;
  if (message.attachment?.mimeType.startsWith('video/')) return props.labels.video;
  return '';
}

function senderName(message: Message): string {
  return message.sender.id === 'system' ? props.labels.system : message.sender.name;
}

/** 通知行摘要：卡片类用卡片摘要（content 是卡片 JSON 载体，不外露），纯文本用 content */
function notificationSummary(message: Message): string {
  if (message.card) return `${props.labels.card} ${message.card.summary ?? message.card.title ?? ''}`.trim();
  return message.notification?.content ?? '';
}

onMounted(() => {
  void loadMore();
  surface.value?.focus();
});
</script>

<template>
  <div class="im-history-overlay" role="presentation" @click.self="emit('close')">
    <section
      ref="surface"
      class="im-history"
      role="dialog"
      aria-modal="true"
      :aria-label="labels.title"
      tabindex="-1"
      @keydown.esc.stop.prevent="emit('close')"
    >
      <!-- 统一弹窗头：macOS 关闭在左、其他平台在右 -->
      <ImDialogHeader :title="title || labels.title" :close-label="labels.close" @close="emit('close')" />
      <div class="im-history__search">
        <ImSearchBar v-model="keyword" :label="labels.search" :placeholder="labels.search" />
      </div>
      <nav class="im-history__tabs" role="tablist" :aria-label="labels.title">
        <button
          v-for="entry in tabs"
          :key="entry.key"
          type="button"
          role="tab"
          :aria-selected="tab === entry.key"
          :class="{ active: tab === entry.key }"
          @click="tab = entry.key"
        >{{ labels[entry.label] }}</button>
        <!-- 日期筛选：页签行右端，点开在按钮下方弹自绘月历 -->
        <div class="im-history__date-filter">
          <button
            ref="dateButton"
            type="button"
            class="im-history__date-btn"
            :class="{ 'im-history__date-btn--active': !!selectedDay }"
            :aria-label="labels.dateFilter"
            :aria-pressed="calendarOpen"
            :title="labels.dateFilter"
            @click="toggleCalendar"
          >
            <ImIcon name="calendar" :size="13" />
            <span v-if="selectedDayLabel">{{ selectedDayLabel }}</span>
          </button>
          <button
            v-if="selectedDay"
            type="button"
            class="im-history__date-clear"
            :aria-label="labels.dateClear"
            :title="labels.dateClear"
            @click="clearDay"
          ><ImIcon name="quoteClose" :size="7" /></button>
          <div v-if="calendarOpen" ref="calendarPanel" class="im-history__date-panel">
            <ImHistoryCalendar
              :selected="selectedDay"
              :timezone="timezone"
              :locale="locale"
              :prev-label="labels.datePrevMonth"
              :next-label="labels.dateNextMonth"
              @select="selectDay"
            />
          </div>
        </div>
      </nav>
      <div class="im-history__list" @scroll="onScroll">
        <template v-for="group in grouped" :key="group.date">
          <p class="im-history__date">{{ group.date }}</p>
          <article v-for="message in group.rows" :key="message.id" class="im-history__row">
            <ImAvatar :src="message.sender.avatar" :name="message.sender.name" size="sm" />
            <div class="im-history__body">
              <header><b>{{ senderName(message) }}</b><time>{{ formatTime(message) }}</time></header>
              <p v-if="message.notification" class="im-history__text">
                <b>{{ message.notification.title }}</b><template v-if="notificationSummary(message)"> · {{ notificationSummary(message) }}</template>
              </p>
              <p v-else-if="message.kind === 'text'" class="im-history__text">
                <template v-for="(part, index) in linkifyMessageText(message.text || '')" :key="index">
                  <a v-if="part.kind === 'link'" :href="part.href" target="_blank" rel="noopener noreferrer">{{ part.text }}</a>
                  <template v-else>{{ part.text }}</template>
                </template>
              </p>
              <button v-else-if="message.attachment" type="button" class="im-history__asset" @click="emit('preview', message.attachment)">
                <span class="im-history__asset-badge">{{ attachmentBadge(message) || labels.tabFile }}</span>
                <span class="im-history__asset-name">{{ message.attachment.fileName }}</span>
                <small>{{ attachmentSize(message.attachment) }}</small>
              </button>
              <p v-else-if="message.card" class="im-history__text">{{ labels.card }} {{ message.card.title || message.card.summary }}</p>
            </div>
          </article>
        </template>
        <p v-if="!visible.length && !loading" class="im-history__state">{{ labels.empty }}</p>
        <p v-if="loading" class="im-history__state" aria-live="polite">{{ labels.loading }}</p>
        <!-- 日期筛选中（selectedDay）：不复用触底 loadMore——筛选后的短列表往往撑不满容器，
             滚动触底不会触发，须由"继续加载"按钮接力自动补载用剩的额度 -->
        <template v-else-if="selectedDay">
          <button v-if="dateBudgetExhausted" type="button" class="im-history__more" @click="continueLoadingDay">{{ labels.dateContinue }}</button>
          <p v-else-if="visible.length" class="im-history__state">{{ labels.end }}</p>
        </template>
        <button v-else-if="loadError || !exhausted" type="button" class="im-history__more" @click="loadMore">{{ labels.loadMore }}</button>
        <p v-else-if="visible.length" class="im-history__state">{{ labels.end }}</p>
      </div>
    </section>
  </div>
</template>

<style scoped>
.im-history-overlay { position:absolute;inset:0;z-index:15;display:grid;place-items:center;padding:24px;background:rgb(var(--base-text-color,31 31 31) / 0.35); }
.im-history { display:flex;width:min(720px,94%);height:min(640px,92%);flex-direction:column;overflow:hidden;border:1px solid var(--im-uikit-border-lighter,#ebeef5);border-radius:var(--im-uikit-radius-md,8px);background:var(--im-uikit-bg-dropdown,#fff);box-shadow:var(--im-uikit-shadow-popup,-1px 2px 13px rgba(0,0,0,.1));outline:none; }
.im-history__search { flex:0 0 auto;padding:12px 16px 0; }
/* 微信同款下划线分类页签 */
.im-history__tabs { display:flex;flex:0 0 auto;gap:24px;border-bottom:1px solid var(--im-uikit-border-lighter,#ebeef5);padding:6px 16px 0; }
.im-history__tabs button { position:relative;border:0;padding:8px 2px;color:var(--im-uikit-text-secondary,#666);background:transparent;font-size:var(--im-uikit-font-size-sm,12px);line-height:20px;cursor:pointer; }
.im-history__tabs button.active { color:var(--im-uikit-text-link,#0877f4);font-weight:500; }
.im-history__tabs button.active::after { position:absolute;right:0;bottom:-1px;left:0;height:2px;border-radius:1px;background:var(--im-uikit-text-link,#0877f4);content:''; }
.im-history__tabs button:focus-visible { outline:none;box-shadow:var(--im-uikit-focus-ring); }
/* 日期筛选：页签行右端，margin-left:auto 顶到底 */
.im-history__date-filter { position:relative;display:flex;flex:0 0 auto;align-items:center;gap:4px;margin-left:auto;padding-bottom:6px; }
.im-history__date-btn { display:flex;align-items:center;gap:4px;border:0;border-radius:var(--im-uikit-radius-xs,4px);padding:4px 6px;color:var(--im-uikit-text-secondary,#666);background:transparent;font-size:var(--im-uikit-font-size-sm,12px);line-height:16px;cursor:pointer; }
.im-history__date-btn:hover { background:var(--im-uikit-bg-dropdown-hover,rgba(8,119,244,.08)); }
.im-history__date-btn--active { color:var(--im-uikit-text-link,#0877f4);background:var(--im-uikit-bg-list-focused,rgba(8,119,244,.05));font-weight:500; }
.im-history__date-btn:focus-visible { outline:none;box-shadow:var(--im-uikit-focus-ring); }
.im-history__date-clear { display:flex;width:16px;height:16px;flex:0 0 auto;align-items:center;justify-content:center;border:0;border-radius:50%;padding:0;color:var(--im-uikit-text-tertiary,#999);background:transparent;cursor:pointer; }
.im-history__date-clear:hover { background:var(--im-uikit-bg-dropdown-hover,rgba(8,119,244,.08)); }
.im-history__date-clear:focus-visible { outline:none;box-shadow:var(--im-uikit-focus-ring); }
.im-history__date-panel { position:absolute;top:100%;right:0;z-index:5;margin-top:4px; }
.im-history__list { flex:1;min-height:0;overflow:auto;padding:4px 16px 16px; }
.im-history__date { margin:10px 0 2px;border-bottom:1px solid var(--im-uikit-border-lighter,#ebeef5);padding-bottom:6px;color:var(--im-uikit-text-tertiary,#999);font-size:var(--im-uikit-font-size-sm,12px); }
.im-history__row { display:flex;gap:10px;border-bottom:1px solid var(--im-uikit-border-lighter,#ebeef5);padding:10px 0; }
.im-history__body { display:grid;min-width:0;flex:1;gap:2px; }
.im-history__body header { display:flex;align-items:center;justify-content:space-between;gap:8px;color:var(--im-uikit-text-tertiary,#999);font-size:var(--im-uikit-font-size-sm,12px);line-height:17px; }
.im-history__body header b { overflow:hidden;font-weight:400;text-overflow:ellipsis;white-space:nowrap; }
.im-history__text { margin:0;overflow-wrap:anywhere;color:var(--im-uikit-text-primary,#1f1f1f);font-size:var(--im-uikit-font-size-sm,12px);line-height:20px;white-space:pre-wrap; }
.im-history__text a { color:var(--im-uikit-text-link,#0877f4);text-decoration:none; }
.im-history__text a:hover { text-decoration:underline; }
.im-history__asset { display:flex;max-width:100%;align-items:center;gap:8px;border:0;border-radius:var(--im-uikit-radius-xs,4px);padding:4px 6px;background:var(--im-uikit-bg-list-hover,rgba(31,31,31,.05));color:var(--im-uikit-text-primary,#1f1f1f);font-size:var(--im-uikit-font-size-sm,12px);cursor:pointer;text-align:left; }
.im-history__asset:hover { background:var(--im-uikit-bg-dropdown-hover,rgba(8,119,244,.08)); }
.im-history__asset-badge { flex:0 0 auto;color:var(--im-uikit-text-link,#0877f4); }
.im-history__asset-name { min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap; }
.im-history__asset small { flex:0 0 auto;color:var(--im-uikit-text-tertiary,#999); }
.im-history__state { margin:12px 0;color:var(--im-uikit-text-tertiary,#999);font-size:var(--im-uikit-font-size-sm,12px);text-align:center; }
.im-history__more { display:block;margin:10px auto;border:0;border-radius:var(--im-uikit-radius-xs,4px);padding:5px 14px;color:var(--im-uikit-text-link,#0877f4);background:var(--im-uikit-bg-list-focused,rgba(8,119,244,.05));font-size:var(--im-uikit-font-size-sm,12px);cursor:pointer; }
</style>

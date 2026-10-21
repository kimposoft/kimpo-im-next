<script setup lang="ts">
import { computed, ref } from 'vue';
import { imCalendarDay } from '../../domain/time-format';
import ImIcon from '../primitives/ImIcon.vue';

/**
 * 聊天记录浮层日期筛选用轻量月历（2026-08-11，交互参照微信聊天记录页）。
 * 插件禁用 NaiveUI 与一切第三方组件库，纯自绘：周起始固定周日，6 行×7 列含首尾月补白日，
 * 网格本身只对整数年/月/日做算术（借道 Date.UTC 避免浏览器本地时区干扰对齐），
 * 唯一需要真正折算时区的地方是"今天"——必须走 imCalendarDay(宿主时区)，
 * 不能用浏览器本地 new Date() 直取年月日（否则跨天/DST 边界会把"今天"标错）。
 */
const props = defineProps<{
  /** 当前选中日（'YYYY-MM-DD'），未选中传 null */
  selected: string | null;
  timezone: string;
  locale: string;
  prevLabel: string;
  nextLabel: string;
}>();

const emit = defineEmits<{ select: [day: string] }>();

/** "今天"的日历日，按宿主时区折算一次；面板是每次打开都重新挂载的临时浮层，无需响应式刷新 */
const todayKey = imCalendarDay(new Date().toISOString(), props.timezone);

const [initYear, initMonth] = (props.selected ?? todayKey).split('-').map(Number);
const viewYear = ref(initYear);
const viewMonth = ref(initMonth); // 1-12

const weekdayLabels = computed(() =>
  props.locale === 'zh-CN' ? ['日', '一', '二', '三', '四', '五', '六'] : ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']
);

const monthLabel = computed(() => {
  if (props.locale === 'zh-CN') return `${viewYear.value}年${String(viewMonth.value).padStart(2, '0')}月`;
  return new Intl.DateTimeFormat(props.locale, { year: 'numeric', month: 'long', timeZone: 'UTC' }).format(
    new Date(Date.UTC(viewYear.value, viewMonth.value - 1, 1))
  );
});

interface DayCell { key: string; day: number; inMonth: boolean }

function dayKey(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}
/** 月份加/减，跨年安全；返回位移后的 [year, month]（month 恒为 1-12） */
function shiftMonth(year: number, month: number, delta: number): [number, number] {
  const total = year * 12 + (month - 1) + delta;
  return [Math.floor(total / 12), (((total % 12) + 12) % 12) + 1];
}

// 纯日历网格：只对整数年月日做算术，用 Date.UTC 求"某月天数/月初星期几"，不经过本地时区
const cells = computed<DayCell[]>(() => {
  const year = viewYear.value;
  const month = viewMonth.value;
  const startWeekday = new Date(Date.UTC(year, month - 1, 1)).getUTCDay(); // 0=周日
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const daysInPrevMonth = new Date(Date.UTC(year, month - 1, 0)).getUTCDate();
  const [prevYear, prevMonthNo] = shiftMonth(year, month, -1);
  const [nextYear, nextMonthNo] = shiftMonth(year, month, 1);
  const list: DayCell[] = [];
  for (let i = 0; i < startWeekday; i += 1) {
    const day = daysInPrevMonth - startWeekday + 1 + i;
    list.push({ key: dayKey(prevYear, prevMonthNo, day), day, inMonth: false });
  }
  for (let day = 1; day <= daysInMonth; day += 1) {
    list.push({ key: dayKey(year, month, day), day, inMonth: true });
  }
  let trailing = 1;
  while (list.length < 42) {
    list.push({ key: dayKey(nextYear, nextMonthNo, trailing), day: trailing, inMonth: false });
    trailing += 1;
  }
  return list;
});

function prevMonth(): void {
  const [y, m] = shiftMonth(viewYear.value, viewMonth.value, -1);
  viewYear.value = y;
  viewMonth.value = m;
}
function nextMonth(): void {
  const [y, m] = shiftMonth(viewYear.value, viewMonth.value, 1);
  viewYear.value = y;
  viewMonth.value = m;
}
function pick(cell: DayCell): void {
  emit('select', cell.key);
}
</script>

<template>
  <div class="im-hcal">
    <header class="im-hcal__head">
      <button type="button" class="im-hcal__nav" :aria-label="prevLabel" :title="prevLabel" @click="prevMonth">
        <span class="im-hcal__chevron im-hcal__chevron--prev"><ImIcon name="chevron" :size="9" /></span>
      </button>
      <b>{{ monthLabel }}</b>
      <button type="button" class="im-hcal__nav" :aria-label="nextLabel" :title="nextLabel" @click="nextMonth">
        <span class="im-hcal__chevron im-hcal__chevron--next"><ImIcon name="chevron" :size="9" /></span>
      </button>
    </header>
    <div class="im-hcal__weekdays" aria-hidden="true">
      <span v-for="label in weekdayLabels" :key="label">{{ label }}</span>
    </div>
    <div class="im-hcal__grid">
      <button
        v-for="cell in cells"
        :key="cell.key"
        type="button"
        class="im-hcal__day"
        :class="{
          'im-hcal__day--out': !cell.inMonth,
          'im-hcal__day--today': cell.key === todayKey,
          'im-hcal__day--selected': cell.key === selected
        }"
        @click="pick(cell)"
      >{{ cell.day }}</button>
    </div>
  </div>
</template>

<style scoped>
.im-hcal { display:flex;width:236px;flex-direction:column;gap:6px;border:1px solid var(--im-uikit-border-lighter,#ebeef5);border-radius:var(--im-uikit-radius-md,8px);padding:10px;background:var(--im-uikit-bg-dropdown,#fff);box-shadow:var(--im-uikit-shadow-popup,-1px 2px 13px rgba(0,0,0,.1)); }
.im-hcal__head { display:flex;align-items:center;justify-content:space-between; }
.im-hcal__head b { color:var(--im-uikit-text-primary,#1f1f1f);font-size:var(--im-uikit-font-size-sm,12px);font-weight:500; }
.im-hcal__nav { display:flex;width:20px;height:20px;flex:0 0 auto;align-items:center;justify-content:center;border:0;border-radius:var(--im-uikit-radius-xs,4px);padding:0;color:var(--im-uikit-text-secondary,#666);background:transparent;cursor:pointer; }
.im-hcal__nav:hover { background:var(--im-uikit-bg-dropdown-hover,rgba(8,119,244,.08)); }
.im-hcal__nav:focus-visible { outline:none;box-shadow:var(--im-uikit-focus-ring); }
.im-hcal__chevron { display:grid;place-items:center; }
/* chevron 图标默认朝上（"^"），左/右靠旋转派生，与 ImContactGroupSections 的既有约定一致 */
.im-hcal__chevron--prev { transform:rotate(-90deg); }
.im-hcal__chevron--next { transform:rotate(90deg); }
.im-hcal__weekdays { display:grid;grid-template-columns:repeat(7,1fr);color:var(--im-uikit-text-tertiary,#999);font-size:var(--im-uikit-font-size-sm,12px);text-align:center; }
.im-hcal__grid { display:grid;grid-template-columns:repeat(7,1fr);gap:2px; }
.im-hcal__day { display:flex;height:26px;align-items:center;justify-content:center;border:1px solid transparent;border-radius:50%;padding:0;color:var(--im-uikit-text-primary,#1f1f1f);background:transparent;font-size:var(--im-uikit-font-size-sm,12px);cursor:pointer; }
.im-hcal__day:hover { background:var(--im-uikit-bg-dropdown-hover,rgba(8,119,244,.08)); }
.im-hcal__day--out { color:var(--im-uikit-text-tertiary,#999); }
.im-hcal__day--today { border-color:var(--im-uikit-text-link,#0877f4); }
.im-hcal__day--selected { border-color:transparent;color:#fff;background:var(--im-uikit-text-link,#0877f4); }
.im-hcal__day:focus-visible { outline:none;box-shadow:var(--im-uikit-focus-ring); }
</style>

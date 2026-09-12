<script setup lang="ts">
import { computed, ref } from 'vue';
import { toDateTimeInput } from '../date.ts';
import Icon from './Icon.vue';

/**
 * 日時の入力。値は `YYYY-MM-DDTHH:mm`（JST の裸の日時）で、空文字は「指定なし」。
 *
 * **ネイティブの `datetime-local` / `date` は使わない。** 日本語の Chrome では
 * 曜日の欄が付いた形 (`2026/08/28(金) 00:25`) で描かれ、そこが空のまま出る。
 * 環境によって出方が変わるものを画面の一部に置くと、崩れても手が出せない。
 */
const model = defineModel<string>({ required: true });

const open = ref(false);
/** 表示している月。値と切り離して持つので、空のままでも月を送れる。 */
const view = ref(monthOf(model.value));

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];

function monthOf(value: string): { year: number; month: number } {
  const parsed = /^(\d{4})-(\d{2})/.exec(value);
  const now = new Date();
  return parsed
    ? { year: Number(parsed[1]), month: Number(parsed[2]) - 1 }
    : { year: now.getFullYear(), month: now.getMonth() };
}

const datePart = computed(() => model.value.split('T')[0] ?? '');
const timePart = computed(() => model.value.split('T')[1] ?? '');

const label = computed(() =>
  model.value === '' ? '指定なし' : `${datePart.value.replaceAll('-', '/')} ${timePart.value}`,
);

/** 月のマス目。前後の月も薄く出して、週の形を崩さない。 */
const cells = computed(() => {
  const { year, month } = view.value;
  const first = new Date(year, month, 1);
  const start = new Date(year, month, 1 - first.getDay());

  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(start.getFullYear(), start.getMonth(), start.getDate() + index);
    return {
      key: ymd(date),
      day: date.getDate(),
      outside: date.getMonth() !== month,
      today: ymd(date) === ymd(new Date()),
    };
  });
});

function ymd(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${String(date.getDate()).padStart(2, '0')}`;
}

function shiftMonth(step: number): void {
  const moved = new Date(view.value.year, view.value.month + step, 1);
  view.value = { year: moved.getFullYear(), month: moved.getMonth() };
}

/** 日付を選ぶ。時刻がまだ無ければ 0 時にする。 */
function pick(date: string): void {
  model.value = `${date}T${timePart.value || '00:00'}`;
}

/**
 * `9:5` `930` `9` のような入力を `09:05` の形に均す。読めなければ元に戻す。
 *
 * 分から先に形を決める。時を貪欲に取ると `930` が「93 時 0 分」になり、
 * 時刻としてよくある打ち方が黙って捨てられる。
 */
function normalizeTime(event: Event): void {
  const input = event.target as HTMLInputElement;
  const value = input.value.trim();
  const matched =
    /^(\d{1,2})\D(\d{1,2})$/.exec(value) ??
    /^(\d{1,2})(\d{2})$/.exec(value) ??
    /^(\d{1,2})$/.exec(value);
  const hour = Number(matched?.[1] ?? NaN);
  const minute = Number(matched?.[2] ?? 0);

  if (!matched || hour > 23 || minute > 59) {
    input.value = timePart.value;
    return;
  }
  const time = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
  model.value = `${datePart.value || ymd(new Date())}T${time}`;
}

function setNow(): void {
  model.value = toDateTimeInput(new Date());
  view.value = monthOf(model.value);
}

function clear(): void {
  model.value = '';
}

function toggle(): void {
  open.value = !open.value;
  if (!open.value) return;
  view.value = monthOf(model.value);
  // 開くきっかけの pointerdown でそのまま閉じないよう、登録を 1 フレーム遅らせる。
  requestAnimationFrame(() => addEventListener('pointerdown', close, { once: true }));
}

function close(): void {
  open.value = false;
}
</script>

<template>
  <div class="datetime" @pointerdown.stop>
    <button type="button" class="value" :class="{ on: open }" @click="toggle" @keydown.escape="close">
      <span :class="{ muted: model === '' }">{{ label }}</span>
      <Icon name="more" />
    </button>

    <div v-if="open" class="picker">
      <div class="month">
        <button type="button" title="前の月" @click="shiftMonth(-1)">‹</button>
        <span>{{ view.year }} 年 {{ view.month + 1 }} 月</span>
        <button type="button" title="次の月" @click="shiftMonth(1)">›</button>
      </div>

      <div class="grid">
        <span v-for="name in WEEKDAYS" :key="name" class="weekday">{{ name }}</span>
        <button
          v-for="cell in cells"
          :key="cell.key"
          type="button"
          class="day"
          :class="{ outside: cell.outside, today: cell.today, on: cell.key === datePart }"
          @click="pick(cell.key)"
        >
          {{ cell.day }}
        </button>
      </div>

      <div class="foot">
        <input
          type="text"
          inputmode="numeric"
          placeholder="HH:mm"
          :value="timePart"
          @change="normalizeTime"
        />
        <button type="button" @click="setNow">今</button>
        <button type="button" @click="clear">消す</button>
      </div>
    </div>
  </div>
</template>

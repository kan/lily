<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { client } from '../api.ts';

/**
 * タグの入力。**既存のタグを補完する。**
 *
 * 手で打ち直すと `Dev` と `dev` のように slug がぶつかる名前を作りやすい
 * (API は 409 で弾くが、弾かれる前に選べる方がよい)。
 */
const model = defineModel<string[]>({ required: true });

const draft = ref('');
const known = ref<{ name: string; count: number }[]>([]);
const open = ref(false);
const input = ref<HTMLInputElement | null>(null);

onMounted(async () => {
  const res = await client.tags.$get();
  if (res.ok) known.value = (await res.json()).tags;
});

const suggestions = computed(() => {
  const typed = draft.value.trim().toLowerCase();
  return known.value
    .filter((tag) => !model.value.includes(tag.name))
    .filter((tag) => typed === '' || tag.name.toLowerCase().includes(typed))
    .slice(0, 8);
});

function add(name: string): void {
  const tag = name.trim();
  if (tag !== '' && !model.value.includes(tag)) model.value = [...model.value, tag];
  draft.value = '';
  // **閉じない。** 候補は `mousedown.prevent` で拾っていて blur が起きないので、
  // ここで閉じると 2 つ目以降を選ぶために一度どこかへ外して戻る必要が出る
  // (`focus()` は既に当たっている入力欄には focus イベントを出さない)。
  open.value = true;
  input.value?.focus();
}

/**
 * 打っている途中の見張り。**カンマは入力側で拾う。**
 *
 * キーの修飾子だと IME 経由やカンマ区切りの貼り付け (`a, b, c`) を取りこぼす。
 */
function onInput(): void {
  open.value = true;
  if (!draft.value.includes(',')) return;

  const parts = draft.value.split(',');
  // 最後の 1 つは打ちかけかもしれないので残す
  draft.value = parts.pop() ?? '';
  for (const part of parts) {
    const tag = part.trim();
    if (tag !== '' && !model.value.includes(tag)) model.value = [...model.value, tag];
  }
}

function remove(name: string): void {
  model.value = model.value.filter((tag) => tag !== name);
}

/**
 * 空欄で Backspace なら直前のタグを消す。打ち直しの手数を減らす。
 *
 * `@keydown.delete` は Backspace と Delete の**両方**に当たるので、ここで
 * 見分ける（前を消すつもりのキーだけを拾う）。
 */
function onBackspace(event: KeyboardEvent): void {
  if (event.key !== 'Backspace') return;
  if (draft.value === '' && model.value.length > 0) {
    model.value = model.value.slice(0, -1);
  }
}
</script>

<template>
  <div class="tag-input">
    <span v-for="tag in model" :key="tag" class="chip">
      {{ tag }}
      <button type="button" title="外す" @click="remove(tag)">×</button>
    </span>

    <input
      ref="input"
      v-model="draft"
      type="text"
      placeholder="タグを足す"
      @focus="open = true"
      @input="onInput"
      @blur="open = false"
      @keydown.enter.prevent="add(suggestions[0] && draft.trim() === '' ? suggestions[0].name : draft)"
      @keydown.delete="onBackspace"
      @keydown.escape="open = false"
    />

    <!-- blur より先に click を取るため mousedown で拾う -->
    <ul v-if="open && suggestions.length" class="suggest">
      <li v-for="tag in suggestions" :key="tag.name" @mousedown.prevent="add(tag.name)">
        <span>{{ tag.name }}</span>
        <span class="muted">{{ tag.count }}</span>
      </li>
    </ul>
  </div>
</template>

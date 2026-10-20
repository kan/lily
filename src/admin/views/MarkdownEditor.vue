<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import { client } from '../api.ts';
import { caretPoint } from '../caret.ts';
import { t } from '../i18n.ts';
import { listEnter, listIndent, replacement } from '../../core/render/list-edit.ts';
import type { Edited } from '../../core/render/list-edit.ts';
import {
  blockPadding,
  carriedPosition,
  imageMarkdown,
  inLinkUrl,
} from '../../core/render/markdown.ts';
import Icon from './Icon.vue';

const props = defineProps<{
  modelValue: string;
  /**
   * ファイルを預けるとファイル名を返す。失敗したら null。
   * **本文に入れるのは `./<filename>` の相対参照**で、配信 URL は描画時に解決する。
   */
  upload: (file: File) => Promise<string | null>;
  /**
   * URL を預けるとカードの HTML を返す。失敗したら null。
   *
   * 組み立てるのは Worker 側（`core/link-card.ts`）。相手のページを読むのも、
   * サムネを添付として取り込むのも向こうの仕事で、ここは差し込むだけ。
   */
  makeCard: (url: string) => Promise<string | null>;
}>();

const emit = defineEmits<{ 'update:modelValue': [string] }>();

const area = ref<HTMLTextAreaElement | null>(null);
const picker = ref<HTMLInputElement | null>(null);
const dragging = ref(0);

/**
 * 直前に貼った URL と、そのとき本文へ入れた文字列。**カードにできるのはこれだけ。**
 *
 * 位置だけでなく中身も覚えるのは、本文が動いたかを照合するため。
 */
const justPasted = ref<{ url: string; start: number; text: string } | null>(null);
const carding = ref(false);

/**
 * 「カードにする」を出してよいか。**入れた場所の中身が変わったら黙って消える。**
 * 打ち始めた人に、もう当たらない操作を見せ続けない。
 */
const cardTarget = computed(() => {
  const target = justPasted.value;
  if (target === null) return null;
  const end = target.start + target.text.length;
  return props.modelValue.slice(target.start, end) === target.text ? { ...target, end } : null;
});

/** 貼ったリンクの真下に出す位置。textarea の左上からの座標。 */
const popupAt = ref<{ top: number; left: number } | null>(null);
const popup = ref<HTMLElement | null>(null);

/**
 * 貼ったリンクの位置へ寄せる。**入力欄の外へはみ出させない。**
 *
 * 本文が変わると折り返しも変わるので、`modelValue` を見て置き直す。textarea を
 * スクロールしたときも同じ（`caretPoint` はスクロール量を引いた座標を返す）。
 */
function placePopup(): void {
  const area_ = area.value;
  const target = cardTarget.value;
  if (!area_ || target === null) {
    popupAt.value = null;
    return;
  }

  const point = caretPoint(area_, target.start);
  const width = popup.value?.offsetWidth ?? 0;
  popupAt.value = {
    top: point.top + point.lineHeight,
    left: Math.max(0, Math.min(point.left, area_.clientWidth - width)),
  };
}

// **描画のあとに測る。** 幅は出てみないと分からず、折り返しも本文が入ってから決まる。
watch([cardTarget, () => props.modelValue], () => void nextTick(placePopup), { flush: 'post' });

/** 差し込む表の雛形。**見出しも中身も置き字**なので、画面の言語で出す。 */
const table = computed(() => {
  const [heading, cell] = t.markdown.tableSample;
  return [`| ${heading} | ${heading} |`, '| --- | --- |', `| ${cell} | ${cell} |`].join('\n');
});

type Range = { start: number; end: number };

function selection(): Range {
  const el = area.value;
  return el ? { start: el.selectionStart, end: el.selectionEnd } : { start: 0, end: 0 };
}

/** 差し込んだあと、指定の範囲を選び直す。 */
function reselect(start: number, end: number): void {
  requestAnimationFrame(() => {
    const el = area.value;
    if (!el) return;
    el.focus();
    el.setSelectionRange(start, end);
  });
}

/**
 * 本文の `[start, end)` を差し替える。**待ったあと（題・カード・画像が届いたあと）は
 * これを使う。**
 *
 * **カーソルは利用者のもの。** 待っているあいだに別の場所を選び直していたら、その
 * 選択を残す（長さが変わったぶんだけずらす。決め方は `carriedPosition`）。
 * `reselect` と違って `focus()` も呼ばない —— 題の欄へ移った人を本文へ連れ戻さない。
 *
 * **その場で終える。** `reselect` は次のフレームでカーソルを置くので、予約が残って
 * いるあいだの操作（全選択して打ち直す）に割り込んで、置き換えを追記に変えてしまう。
 */
function replaceRange(start: number, end: number, text: string): void {
  const el = area.value;
  if (!el) return;

  const carry = (position: number): number => carriedPosition(position, start, end, text.length);
  const selected = [carry(el.selectionStart), carry(el.selectionEnd)] as const;
  const direction = el.selectionDirection;

  el.setRangeText(text, start, end);
  el.setSelectionRange(selected[0], selected[1], direction);
  follow(start, end, text.length);
  emit('update:modelValue', el.value);
}

/**
 * 待っているあいだ追いかけている位置。**アップロード中の画像を入れる場所。**
 *
 * 待つ前に捕まえた位置は、そのあいだに前の行を打たれるとずれる。ずれたまま入れると
 * 別の記法の途中に割り込む。だから本文が変わるたびに、カーソルと同じ決め方
 * （`carriedPosition`）で運ぶ。
 */
const following = new Set<Range>();

function follow(start: number, end: number, length: number): void {
  for (const range of following) {
    range.start = carriedPosition(range.start, start, end, length);
    range.end = carriedPosition(range.end, start, end, length);
  }
}

/**
 * 日本語の変換が終わるまで待つ。**変換中に本文を差し替えると、未確定の字が壊れる。**
 *
 * 題や画像を待つあいだに別の場所を打っている人は、日本語ならほぼ変換の途中にいる。
 * 待ったあとの差し替えは、どれもこれを通してから行う。
 *
 * **`compositionend` の次のタスクまで待つ。** 確定の `input` があとから届くので、
 * その場で進めると確定前の本文を見て位置を決めることになる。
 */
let composing = false;

function setComposing(now: boolean): void {
  composing = now;
}

function settled(): Promise<void> {
  const el = area.value;
  if (!composing || !el) return Promise.resolve();
  return new Promise((resolve) => {
    el.addEventListener('compositionend', () => setTimeout(resolve), { once: true });
  });
}

/**
 * フォーカスが宙に浮いていたら本文へ戻す。**誰かが持っているなら取らない**
 * （題の欄へ移った人を連れ戻さない）。
 *
 * 浮くのは、ファイルを落とした直後と、キーボードで「カードにする」を押したあと
 * （押したボタンごとポップアップが消える）。
 */
function refocusIfLost(): void {
  if (document.activeElement === document.body) area.value?.focus();
}

/**
 * 選択範囲を包む / カーソル位置に差し込む。
 *
 * `at` を渡すとその位置に入れる。**textarea の value を代入し直すとカーソルが
 * 末尾へ飛ぶ**ので、非同期の処理 (画像のアップロード) をまたぐときは、始める
 * 前に捕まえた位置を持ち回る必要がある。
 */
function surround(before: string, after = '', placeholder = '', at?: Range): void {
  const { start, end } = at ?? selection();
  const selected = props.modelValue.slice(start, end) || placeholder;
  const inserted = `${before}${selected}${after}`;
  emit('update:modelValue', props.modelValue.slice(0, start) + inserted + props.modelValue.slice(end));
  // 差し込んだ中身を選び直す。続けて打てば置き換わる。
  reselect(start + before.length, start + before.length + selected.length);
}

/** 行頭に印を足す (見出し・引用・リスト)。 */
function prefixLine(mark: string): void {
  const el = area.value;
  if (!el) return;

  const value = props.modelValue;
  const lineStart = value.lastIndexOf('\n', el.selectionStart - 1) + 1;
  const at = el.selectionStart + mark.length;
  emit('update:modelValue', value.slice(0, lineStart) + mark + value.slice(lineStart));
  reselect(at, at);
}

/**
 * リストの上での Enter / Tab / Shift+Tab。何をどう書き換えるかは
 * `core/render/list-edit.ts` が決め、ここはキーを渡して結果を入れるだけ。
 *
 * **変換中の Enter は確定であって改行ではない。** `isComposing` を見ないと、
 * 日本語を確定するたびに項目が増える。`keyCode === 229` は Safari 用
 * （確定の keydown が `isComposing: false` で届く）。
 *
 * **Tab を取るのはリストの行の上だけ。** それ以外では既定のフォーカス移動を残す
 * （キーボードだけで入力欄から出られなくなる）。
 */
function onKeydown(event: KeyboardEvent): void {
  if (event.isComposing || event.keyCode === 229) return;
  if (event.ctrlKey || event.metaKey || event.altKey) return;
  const el = area.value;
  if (!el) return;

  let edited: Edited | null;
  if (event.key === 'Enter' && !event.shiftKey) edited = listEnter(el.value, selection());
  else if (event.key === 'Tab') edited = listIndent(el.value, selection(), event.shiftKey ? -1 : 1);
  else return;

  if (edited === null) return;
  event.preventDefault();
  applyEdit(el, edited);
}

/**
 * 編集の結果を入力欄へ入れる。
 *
 * **`execCommand` で差分だけを入れる。** `value` を代入し直すとブラウザの取り消し
 * 履歴が消えるので、キー入力のたびに通るここでそれをやると Ctrl+Z が効かなくなる。
 * `execCommand` は `input` を発火するので、本文は textarea の `@input` から出ていく。
 * 使えない環境では代入に落とす（取り消しは効かないが、編集は通る）。
 */
function applyEdit(el: HTMLTextAreaElement, edited: Edited): void {
  if (edited.value !== el.value) {
    const { start, end, text } = replacement(el.value, edited.value);
    el.setSelectionRange(start, end);
    const done =
      text === '' ? document.execCommand('delete') : document.execCommand('insertText', false, text);
    if (!done || el.value !== edited.value) {
      emit('update:modelValue', edited.value);
      reselect(edited.start, edited.end);
      return;
    }
  }
  el.setSelectionRange(edited.start, edited.end);
}

/**
 * 入力欄の変更を本文へ出す。
 *
 * **取り消しのあとに残る選択は畳む。** `applyEdit` は置き換える範囲を選んでから
 * 入れるので、ブラウザはそれを取り消すと元の範囲（リストの印や字下げ）を選んだ
 * 状態に戻す。そのまま打つと印が上書きされる。
 */
function onInput(event: Event): void {
  const el = event.target as HTMLTextAreaElement;
  const { inputType } = event as InputEvent;
  if (inputType === 'historyUndo' || inputType === 'historyRedo') {
    el.setSelectionRange(el.selectionEnd, el.selectionEnd);
  }
  if (following.size > 0) {
    const edit = replacement(props.modelValue, el.value);
    follow(edit.start, edit.end, edit.text.length);
  }
  emit('update:modelValue', el.value);
}

/** 前後に空行を空けてブロックを差し込む (表・水平線)。 */
function insertBlock(text: string): void {
  const { start } = selection();
  const { before } = blockPadding(props.modelValue, start, start);
  surround(`${before}${text}\n`, '', '');
}

/**
 * 脚注。本文に参照を置き、**定義は末尾に足す**。
 *
 * 番号は本文にある `[^n]` の最大値の次。定義の位置は末尾で固定でよい
 * (Markdown では定義がどこにあっても、出力は末尾にまとまる)。
 */
function insertFootnote(): void {
  const value = props.modelValue;
  const used = [...value.matchAll(/\[\^(\d+)\]/g)].map((matched) => Number(matched[1]));
  const number = used.length === 0 ? 1 : Math.max(...used) + 1;

  const { start } = selection();
  const withRef = `${value.slice(0, start)}[^${number}]${value.slice(start)}`;
  const gap = withRef.endsWith('\n') ? '\n' : '\n\n';
  const full = `${withRef}${gap}[^${number}]: `;

  emit('update:modelValue', full);
  // 定義の行末に置いて、そのまま中身を書けるようにする
  reselect(full.length, full.length);
}

/**
 * 画像を差し込む。
 *
 * アップロードを待つあいだも本文は打てるので、入れるのは `replaceRange` で
 * （打っている人のカーソルを画像の後ろへ連れていかない）。
 */
async function insertFiles(files: readonly File[], at?: Range): Promise<void> {
  // 待つあいだに本文が動いても付いていくよう、入れる場所を追いかけさせる。
  const cursor = { ...(at ?? selection()) };
  following.add(cursor);

  try {
    for (const file of files) {
      const filename = await props.upload(file);
      if (filename === null) continue;
      await settled();

      // 記事と同じディレクトリのファイルとして参照する。mount 依存の URL は書かない。
      // 書き方 (空白を含むときの `<…>`) は renderer 側と対で core が持っている。
      const text = imageMarkdown(filename);
      replaceRange(cursor.start, cursor.end, text);
      // 末尾は `follow` が入れたものの後ろへ運んでいる。次の画像はそこから。
      cursor.start = cursor.end;
    }
  } finally {
    following.delete(cursor);
  }
  refocusIfLost();
}

function imagesOf(list: FileList | null | undefined): File[] {
  return [...(list ?? [])].filter((file) => file.type.startsWith('image/'));
}

/**
 * ファイルを運んでいるドラッグか。**それ以外には一切手を出さない。**
 *
 * 本文の中で選んだ文字列をドラッグで動かすのも同じ drag イベントで来る。
 * そこで `preventDefault` するとブラウザの移動が止まり、アップロードの表示まで出る。
 * `types` はドラッグの途中でも読める（`files` は drop まで空）。
 */
function carriesFiles(event: DragEvent): boolean {
  return event.dataTransfer?.types.includes('Files') ?? false;
}

function onDragEnter(event: DragEvent): void {
  if (!carriesFiles(event)) return;
  event.preventDefault();
  dragging.value++;
}

// dragleave は取り消せないので preventDefault は要らない。
function onDragLeave(event: DragEvent): void {
  if (carriesFiles(event)) dragging.value--;
}

function onDragOver(event: DragEvent): void {
  if (carriesFiles(event)) event.preventDefault();
}

async function onDrop(event: DragEvent): Promise<void> {
  // 数え違いがあっても、何かが落ちた時点で表示は必ず消す。
  dragging.value = 0;
  if (!carriesFiles(event)) return;
  event.preventDefault();
  await insertFiles(imagesOf(event.dataTransfer?.files));
}

/**
 * 「その他」のメニュー。たまにしか使わない記法をここに畳む。
 *
 * 開いたあとに document の pointerdown で閉じる。**登録を 1 フレーム遅らせる**の
 * は、開くきっかけになった pointerdown でそのまま閉じないため。メニューの中は
 * `@pointerdown.stop` で伝播を止めてあるので、項目を選んでも先に閉じない。
 */
const menuOpen = ref(false);

function toggleMenu(): void {
  menuOpen.value = !menuOpen.value;
  if (!menuOpen.value) return;
  requestAnimationFrame(() => {
    addEventListener('pointerdown', closeMenu, { once: true });
  });
}

function closeMenu(): void {
  menuOpen.value = false;
}

/** メニューから選んだら閉じてから入れる。 */
function fromMenu(run: () => void): void {
  closeMenu();
  run();
}

/** ボタンを押した時点のカーソル位置。ファイル選択のあいだ blur するので覚えておく。 */
let pickedAt: Range | undefined;

function openPicker(): void {
  pickedAt = selection();
  picker.value?.click();
}

async function onPick(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement;
  await insertFiles(imagesOf(input.files), pickedAt);
  // 同じファイルをもう一度選べるように空にしておく
  input.value = '';
}

/**
 * 貼り付け。
 *
 * - 画像 → アップロードして `![](./…)`
 * - URL  → タイトルを取ってきて `[タイトル](url)`。選択中ならその文字を題にする
 * - それ以外 → 既定の貼り付けに任せる
 */
async function onPaste(event: ClipboardEvent): Promise<void> {
  const images = imagesOf(event.clipboardData?.files);
  if (images.length > 0) {
    event.preventDefault();
    await insertFiles(images);
    return;
  }

  const text = event.clipboardData?.getData('text/plain')?.trim() ?? '';
  if (!isHttpUrl(text)) return;

  const { start, end } = selection();
  // リンクの URL 欄に貼っているなら、素の貼り付けに任せる。ここで `[…](…)` に
  // 包むと `[題]([url](url))` になる (ツールバーのリンクボタンで出る
  // `[リンク](https://)` の続きを埋める操作がまさにこれ)。
  if (inLinkUrl(props.modelValue, start)) return;

  event.preventDefault();
  const selected = props.modelValue.slice(start, end);

  // 取りに行くあいだも書き続けられるよう、まず URL のままの形で入れておく。
  // **surround には通さない。** あれは選択範囲を読み直して包むので、完成形を
  // 渡すと選んだ文字が後ろに二重で残る。
  const inserted = `[${selected || text}](${text})`;
  // 貼ったのは利用者なので、ここだけはカーソルを置く（入れたリンクの直後）。
  replaceRange(start, end, inserted);
  area.value?.setSelectionRange(start + inserted.length, start + inserted.length);
  justPasted.value = { url: text, start, text: inserted };

  // 選んだ文字が題なら、取りに行く必要がない。
  if (selected !== '') return;

  const res = await client['link-title'].$post({ json: { url: text } });
  if (!res.ok) return;
  const { title } = await res.json();
  if (title === null) return;
  await settled();

  // **入れた場所を覚えておいて、そこだけ差し替える。** 本文から探して置き換えると、
  // 同じ URL を前にも貼っていたときに古い方が書き変わる。
  const current = props.modelValue;
  if (current.slice(start, start + inserted.length) !== inserted) return;

  // **カーソルは置かない。** 取りに行くあいだに別の場所を打っていた人のものなので、
  // 長さが変わったぶんずらすだけにする（issue #12）。
  const replaced = `[${title}](${text})`;
  replaceRange(start, start + inserted.length, replaced);

  // 題が入って形が変わったので、カードの差し替え先も合わせる。**この貼り付けの
  // ものだけ**（待っているあいだに別の URL を貼られていたら触らない）。
  if (justPasted.value?.start === start && justPasted.value.text === inserted) {
    justPasted.value = { url: text, start, text: replaced };
  }
}

/**
 * 貼った URL をカードに替える。
 *
 * **差し替えるのは、入れた場所の中身が今も同じときだけ。** 本文から URL を探して
 * 置き換えると、同じ URL を前にも貼っていたときに古い方が変わる（題の差し替えと
 * 同じ理由）。取りに行くあいだにも本文は動くので、前後 2 回照合する。
 */
async function toCard(): Promise<void> {
  const target = cardTarget.value;
  if (target === null || carding.value) return;

  carding.value = true;
  let html: string | null;
  try {
    html = await props.makeCard(target.url);
  } finally {
    carding.value = false;
  }
  if (html === null) return;
  await settled();

  const current = props.modelValue;
  if (current.slice(target.start, target.end) !== target.text) return;

  // **生 HTML は空行で挟まないとブロックにならない。** 段落の途中に貼った
  // リンクをそのまま替えると、カードが段落の中のインライン要素になる。
  const { before, after } = blockPadding(current, target.start, target.end);
  const block = `${before}${html}${after}`;
  replaceRange(target.start, target.end, block);
  justPasted.value = null;
  await nextTick();
  refocusIfLost();
}

function isHttpUrl(text: string): boolean {
  if (/\s/.test(text)) return false;
  try {
    const { protocol } = new URL(text);
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}
</script>

<template>
  <!-- 似たものをまとめる。左から 見出し / インライン / ブロック / 箇条書き。 -->
  <div class="toolbar">
    <div class="group">
      <button type="button" @mousedown.prevent :title="t.markdown.heading" @click="prefixLine('## ')">H2</button>
      <button type="button" @mousedown.prevent :title="t.markdown.subheading" @click="prefixLine('### ')">H3</button>
    </div>

    <div class="group">
      <button
        type="button"
        @mousedown.prevent
        :title="t.markdown.bold"
        @click="surround('**', '**', t.markdown.boldSample)"
      >
        <Icon name="bold" />
      </button>
      <button
        type="button"
        @mousedown.prevent
        :title="t.markdown.italic"
        @click="surround('*', '*', t.markdown.italicSample)"
      >
        <Icon name="italic" />
      </button>
      <button type="button" @mousedown.prevent :title="t.markdown.inlineCode" @click="surround('`', '`', 'code')">
        <Icon name="code" />
      </button>
      <button
        type="button"
        @mousedown.prevent
        :title="t.markdown.link"
        @click="surround('[', '](https://)', t.markdown.linkSample)"
      >
        <Icon name="link" />
      </button>
    </div>

    <div class="group">
      <button type="button" @mousedown.prevent :title="t.markdown.image" @click="openPicker">
        <Icon name="image" />
      </button>
      <button type="button" @mousedown.prevent :title="t.markdown.codeBlock" @click="surround('```ts\n', '\n```', '')">
        <Icon name="block" />
      </button>
      <button type="button" @mousedown.prevent :title="t.markdown.quote" @click="prefixLine('> ')">
        <Icon name="quote" />
      </button>

      <div class="menu-wrap" @pointerdown.stop>
        <button
          type="button"
          @mousedown.prevent
          :title="t.markdown.more"
          :class="{ on: menuOpen }"
          @click="toggleMenu"
          @keydown.escape="closeMenu"
        >
          <Icon name="more" />
        </button>
        <!-- 項目は button。li に click だけ付けるとキーボードで押せない。 -->
        <ul v-if="menuOpen" class="menu">
          <li>
            <button type="button" @click="fromMenu(() => insertBlock(table))">
              <Icon name="table" /><span>{{ t.markdown.table }}</span>
            </button>
          </li>
          <li>
            <button type="button" @click="fromMenu(() => insertBlock('---'))">
              <Icon name="rule" /><span>{{ t.markdown.rule }}</span>
            </button>
          </li>
          <li>
            <button type="button" @click="fromMenu(insertFootnote)">
              <Icon name="footnote" /><span>{{ t.markdown.footnote }}</span>
            </button>
          </li>
        </ul>
      </div>
    </div>

    <div class="group">
      <button type="button" @mousedown.prevent :title="t.markdown.bullets" @click="prefixLine('- ')">
        <Icon name="list" />
      </button>
      <button type="button" @mousedown.prevent :title="t.markdown.numbers" @click="prefixLine('1. ')">
        <Icon name="ordered-list" />
      </button>
    </div>

    <input ref="picker" type="file" accept="image/*" multiple hidden @change="onPick" />
  </div>

  <div
    class="dropzone"
    :class="{ over: dragging > 0 }"
    @dragenter="onDragEnter"
    @dragleave="onDragLeave"
    @dragover="onDragOver"
    @drop="onDrop"
  >
    <textarea
      ref="area"
      :value="modelValue"
      @input="onInput"
      @compositionstart="setComposing(true)"
      @compositionend="setComposing(false)"
      @paste="onPaste"
      @scroll="placePopup"
      @keydown="onKeydown"
      @keydown.esc="justPasted = null"
    />
    <!-- 貼った直後だけ、貼ったリンクの真下に出す。既定はテキストリンクのまま。
         `mousedown.prevent` は textarea からフォーカスを外さないため。 -->
    <div
      v-if="cardTarget"
      ref="popup"
      class="card-popup"
      :style="popupAt ? { top: `${popupAt.top}px`, left: `${popupAt.left}px` } : { visibility: 'hidden' }"
      @mousedown.prevent
    >
      <button type="button" :disabled="carding" :title="t.markdown.makeCardTitle" @click="toCard">
        <Icon name="link" /><span>{{ carding ? t.markdown.carding : t.markdown.makeCard }}</span>
      </button>
      <button type="button" class="close" :title="t.markdown.closeEsc" @click="justPasted = null">
        ×
      </button>
    </div>
  </div>
  <p class="muted">{{ t.markdown.help }}</p>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import { client } from '../api.ts';
import { caretPoint } from '../caret.ts';
import { blockPadding, imageMarkdown, inLinkUrl } from '../../core/render/markdown.ts';
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

const TABLE = ['| 見出し | 見出し |', '| --- | --- |', '| 中身 | 中身 |'].join('\n');

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
 * **1 つ入れるごとに `nextTick` で props の更新を待つ。** 待たずに続けると
 * 古い本文を元に組み立てて、直前に入れたものを消してしまう。
 */
async function insertFiles(files: readonly File[], at?: Range): Promise<void> {
  let cursor = at ?? selection();

  for (const file of files) {
    const filename = await props.upload(file);
    if (filename === null) continue;

    // 記事と同じディレクトリのファイルとして参照する。mount 依存の URL は書かない。
    // 書き方 (空白を含むときの `<…>`) は renderer 側と対で core が持っている。
    const text = imageMarkdown(filename);
    const value = props.modelValue;
    emit('update:modelValue', value.slice(0, cursor.start) + text + value.slice(cursor.end));

    const next = cursor.start + text.length;
    cursor = { start: next, end: next };
    await nextTick();
  }
  reselect(cursor.start, cursor.end);
}

function imagesOf(list: FileList | null | undefined): File[] {
  return [...(list ?? [])].filter((file) => file.type.startsWith('image/'));
}

async function onDrop(event: DragEvent): Promise<void> {
  dragging.value = 0;
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
  const pasted = props.modelValue.slice(0, start) + inserted + props.modelValue.slice(end);
  emit('update:modelValue', pasted);
  reselect(start + inserted.length, start + inserted.length);
  justPasted.value = { url: text, start, text: inserted };

  // 選んだ文字が題なら、取りに行く必要がない。
  if (selected !== '') return;

  const res = await client['link-title'].$post({ json: { url: text } });
  if (!res.ok) return;
  const { title } = await res.json();
  if (title === null) return;

  // **入れた場所を覚えておいて、そこだけ差し替える。** 本文から探して置き換えると、
  // 同じ URL を前にも貼っていたときに古い方が書き変わる。
  const current = props.modelValue;
  if (current.slice(start, start + inserted.length) !== inserted) return;

  const replaced = `[${title}](${text})`;
  emit(
    'update:modelValue',
    current.slice(0, start) + replaced + current.slice(start + inserted.length),
  );
  reselect(start + replaced.length, start + replaced.length);

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
  let html: string | null = null;
  try {
    html = await props.makeCard(target.url);
  } finally {
    carding.value = false;
  }
  if (html === null) return;

  const current = props.modelValue;
  if (current.slice(target.start, target.end) !== target.text) return;

  // **生 HTML は空行で挟まないとブロックにならない。** 段落の途中に貼った
  // リンクをそのまま替えると、カードが段落の中のインライン要素になる。
  const { before, after } = blockPadding(current, target.start, target.end);
  const block = `${before}${html}${after}`;
  emit('update:modelValue', current.slice(0, target.start) + block + current.slice(target.end));

  justPasted.value = null;
  const at = target.start + block.length;
  reselect(at, at);
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
      <button type="button" @mousedown.prevent title="見出し" @click="prefixLine('## ')">H2</button>
      <button type="button" @mousedown.prevent title="小見出し" @click="prefixLine('### ')">H3</button>
    </div>

    <div class="group">
      <button type="button" @mousedown.prevent title="太字" @click="surround('**', '**', '太字')">
        <Icon name="bold" />
      </button>
      <button type="button" @mousedown.prevent title="斜体" @click="surround('*', '*', '斜体')">
        <Icon name="italic" />
      </button>
      <button type="button" @mousedown.prevent title="インラインコード" @click="surround('`', '`', 'code')">
        <Icon name="code" />
      </button>
      <button type="button" @mousedown.prevent title="リンク" @click="surround('[', '](https://)', 'リンク')">
        <Icon name="link" />
      </button>
    </div>

    <div class="group">
      <button type="button" @mousedown.prevent title="画像を入れる" @click="openPicker">
        <Icon name="image" />
      </button>
      <button type="button" @mousedown.prevent title="コードブロック" @click="surround('```ts\n', '\n```', '')">
        <Icon name="block" />
      </button>
      <button type="button" @mousedown.prevent title="引用" @click="prefixLine('> ')">
        <Icon name="quote" />
      </button>

      <div class="menu-wrap" @pointerdown.stop>
        <button
          type="button"
          @mousedown.prevent
          title="そのほかの記法"
          :class="{ on: menuOpen }"
          @click="toggleMenu"
          @keydown.escape="closeMenu"
        >
          <Icon name="more" />
        </button>
        <!-- 項目は button。li に click だけ付けるとキーボードで押せない。 -->
        <ul v-if="menuOpen" class="menu">
          <li>
            <button type="button" @click="fromMenu(() => insertBlock(TABLE))">
              <Icon name="table" /><span>表</span>
            </button>
          </li>
          <li>
            <button type="button" @click="fromMenu(() => insertBlock('---'))">
              <Icon name="rule" /><span>水平線</span>
            </button>
          </li>
          <li>
            <button type="button" @click="fromMenu(insertFootnote)">
              <Icon name="footnote" /><span>脚注</span>
            </button>
          </li>
        </ul>
      </div>
    </div>

    <div class="group">
      <button type="button" @mousedown.prevent title="箇条書き" @click="prefixLine('- ')">
        <Icon name="list" />
      </button>
      <button type="button" @mousedown.prevent title="番号付きリスト" @click="prefixLine('1. ')">
        <Icon name="ordered-list" />
      </button>
    </div>

    <input ref="picker" type="file" accept="image/*" multiple hidden @change="onPick" />
  </div>

  <div
    class="dropzone"
    :class="{ over: dragging > 0 }"
    @dragenter.prevent="dragging++"
    @dragleave.prevent="dragging--"
    @dragover.prevent
    @drop.prevent="onDrop"
  >
    <textarea
      ref="area"
      :value="modelValue"
      @input="emit('update:modelValue', ($event.target as HTMLTextAreaElement).value)"
      @paste="onPaste"
      @scroll="placePopup"
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
      <button type="button" :disabled="carding" title="題と説明とサムネのブロックにする" @click="toCard">
        <Icon name="link" /><span>{{ carding ? '取りに行っています…' : 'カードにする' }}</span>
      </button>
      <button type="button" class="close" title="閉じる (Esc)" @click="justPasted = null">×</button>
    </div>
  </div>
  <p class="muted">
    画像はドラッグ＆ドロップ・貼り付け・ボタンで入る。URL を貼るとタイトル付きのリンクになる。
  </p>
</template>

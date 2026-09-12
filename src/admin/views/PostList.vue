<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref, watch } from 'vue';
import { isoDate } from '../date.ts';
import { client, errorMessage, MOUNT } from '../api.ts';
import { go, NEW_POST_ROUTE, postRoute } from '../router.ts';
import { SITE } from '../site.ts';

type Post = {
  publicId: string;
  title: string;
  status: 'draft' | 'published';
  publishedAt: string | null;
  canonicalPath: string;
  url: string;
  tags: { name: string; slug: string }[];
};

/** 1 ページの件数。API 側の上限は 100。 */
const PER_PAGE = 30;

/**
 * 検索語を確定させるまでの待ち。1 文字ごとに投げると、日本語の変換中に
 * 中間の読み (`ke` `けん` …) で検索してしまう。
 */
const TYPING_PAUSE = 250;

/**
 * 絞り込み。**1 つのオブジェクトにまとめてある。**
 *
 * 別々の ref にすると、項目を 1 つ足すたびに「クエリの組み立て」「絞り込み中か」
 * 「解除」「ページを戻す watch」「読み直す watch」の 5 箇所へ同じ名前を書き足す
 * ことになる。どれか 1 つを落とすと、解除しても消えない項目や、絞ったのに
 * 3 ページ目のままになる項目ができる。
 */
const EMPTY = { status: '' as '' | 'draft' | 'published', tag: '', q: '' };
const filters = reactive({ ...EMPTY });

const posts = ref<Post[]>([]);
const total = ref(0);
const offset = ref(0);
/** 検索欄の値。これがそのまま飛ぶのではなく、少し置いてから `filters.q` に移る。 */
const typed = ref('');
const tagOptions = ref<{ name: string; slug: string; count: number }[]>([]);
const error = ref('');
const tagsError = ref('');
const loading = ref(true);

/**
 * 今の renderer で描かれていない記事の数。**`0` のあいだは画面に何も出さない。**
 *
 * 配信側は保存済みの `body_html` をそのまま返すので、lily を更新して出力が
 * 変わっても**古い HTML のままだと気付けない**。ここが唯一の知らせる場所。
 */
const stale = ref(0);
const rerendering = ref(false);
const rerenderError = ref('');
/** 解決できない画像参照を持っていた記事。再描画のあいだに溜める。 */
const rerenderWarnings = ref<string[]>([]);

/**
 * 選択欄に出すタグ。**いま絞り込んでいる slug が無ければ足す。**
 *
 * 行のタグを押した直後や `/tags` が読めなかったときに、一覧は絞られているのに
 * 選択欄が「すべてのタグ」を指したままになる (絞り込み条件が画面から読めない)。
 */
const tagChoices = computed(() => {
  const options = tagOptions.value;
  const slug = filters.tag;
  if (slug === '' || options.some((option) => option.slug === slug)) return options;
  return [{ name: slug, slug, count: 0 }, ...options];
});

const filtered = computed(() => Object.values(filters).some((value) => value !== ''));
const hasPrev = computed(() => offset.value > 0);
const hasNext = computed(() => offset.value + posts.value.length < total.value);
const range = computed(() =>
  total.value === 0 ? '0 件' : `${offset.value + 1}–${offset.value + posts.value.length} / ${total.value} 件`,
);

/**
 * 最後に投げた読み込みの番号。**追い越した古い結果を捨てるため。**
 *
 * 検索は本文への LIKE 全走査なので、短い語ほど遅くなる。「早」の結果が
 * 「早朝」の結果より後に返ると、入力欄と一覧が食い違ったまま固まる。
 */
let latest = 0;

async function load(): Promise<void> {
  const token = ++latest;
  loading.value = true;
  const res = await client.posts.$get({
    query: {
      limit: String(PER_PAGE),
      offset: String(offset.value),
      // 空文字を「絞り込み無し」と読むのは API 側 (`core/api/schema.ts` の
      // `filterWord`)。ここでも同じ判断をすると、規則が 2 箇所になる。
      tag: filters.tag,
      q: filters.q,
      // status だけは enum なので空文字を渡せない。
      ...(filters.status === '' ? {} : { status: filters.status }),
    },
  });
  const body = res.ok ? await res.json() : null;
  const message = body ? '' : await errorMessage(res);

  // 読み終わるまでの間に次の読み込みが始まっていたら、こちらは捨てる。
  if (token !== latest) return;

  if (body) {
    posts.value = body.posts;
    total.value = body.total;
  }
  error.value = message;
  loading.value = false;
}

/**
 * 絞り込みの選択肢。**下書きしか無いタグは 0 件と出る** (件数は公開記事の数)。
 *
 * 失敗を黙って捨てない。捨てると選択欄が「すべてのタグ」だけになり、なぜ選べない
 * のかが画面に出ない。
 */
async function loadTags(): Promise<void> {
  const res = await client.tags.$get();
  if (res.ok) {
    tagOptions.value = (await res.json()).tags;
    tagsError.value = '';
  } else {
    tagsError.value = await errorMessage(res);
  }
}

/**
 * 再描画の残り。**読めなかったら黙って 0 にする。**
 *
 * これは付随的な知らせで、記事を読み書きする邪魔をしてはいけない。出せないなら
 * 「知らせが出ない」だけで、一覧そのものは今までどおり使える。
 */
async function loadStale(): Promise<void> {
  try {
    const res = await client.rerender.$get();
    stale.value = res.ok ? (await res.json()).remaining : 0;
  } catch {
    // 回線が切れていても知らせが消えるだけ。**握り潰すのはここだけ**
    // （押した先の失敗は下の `rerenderAll` が画面に出す）。
    stale.value = 0;
  }
}

/** 画面を離れたら描き直しを止める合図。**`onUnmounted` で立てる。** */
let leaving = false;

/**
 * 残りが 0 になるまで描き直す。**1 回の `POST` は 50 件までしか進まない**
 * （Workers の subrequest の上限があるので、サーバー側が区切っている）。
 */
async function rerenderAll(): Promise<void> {
  rerendering.value = true;
  rerenderError.value = '';
  rerenderWarnings.value = [];

  let previous = Infinity;
  try {
    for (;;) {
      const res = await client.rerender.$post();
      // **画面を離れたら止める。** 続けると、消えたコンポーネントの ref に
      // 書き込みながら裏で回り続ける。一覧に戻ると減りかけの件数でボタンが
      // また出るので、押されると 2 本目の loop が同じ記事を重ねて描き直す。
      if (leaving) return;

      if (!res.ok) {
        rerenderError.value = await errorMessage(res);
        return;
      }
      const body = await res.json();
      stale.value = body.remaining;
      rerenderWarnings.value.push(...body.warnings.map((warning) => warning.publicId));

      if (body.remaining === 0) return;
      // **減らないなら止める。** 数百件あれば十数回投げるので、こちらが直せない
      // 何か（描画で毎回落ちる記事など）に当たると永久に API を叩き続ける。
      //
      // **`rendered` が 0 かでは見ない。** サーバーは残りを数えるのと同じ条件で
      // 対象を引くので、`rendered === 0` は `remaining === 0` と同じ意味にしか
      // ならず、1 行上で既に抜けている。「1 記事の失敗で全体を落とさない」形に
      // 変えた日に素通りする。
      if (body.remaining >= previous) {
        rerenderError.value = `${body.remaining} 件が残ったまま減らなくなった。Worker のログを見ること。`;
        return;
      }
      previous = body.remaining;
    }
  } catch (error) {
    // **投げた先が落ちたことも画面に出す。** 十数回の往復のどこかで回線が切れる
    // ことはあるので、黙って終わると「押したのに何も起きなかった」に見える。
    rerenderError.value = error instanceof Error ? error.message : String(error);
  } finally {
    rerendering.value = false;
  }
}

function move(step: number): void {
  offset.value = Math.max(0, offset.value + step * PER_PAGE);
}

function clearFilters(): void {
  Object.assign(filters, EMPTY);
  typed.value = '';
}

let typingTimer: ReturnType<typeof setTimeout> | undefined;

watch(typed, (value) => {
  clearTimeout(typingTimer);
  typingTimer = setTimeout(() => {
    filters.q = value.trim();
  }, TYPING_PAUSE);
});

// 打ち終える前／描き直しの途中で画面を離れたときに、消えたコンポーネントの
// ref を触らせない。
onUnmounted(() => {
  clearTimeout(typingTimer);
  leaving = true;
});

// 絞り込みを変えたら先頭のページに戻す。3 ページ目で絞ると空に見えるため。
watch(filters, () => {
  offset.value = 0;
});
watch([offset, filters], load);

onMounted(() => {
  void load();
  void loadTags();
  void loadStale();
});

/**
 * 表示は日付まで。時刻の細かさは一覧で要らない。
 *
 * **JST で切り出す。** `published_at` は UTC の ISO8601 なので、頭を 10 文字
 * 取ると 9 時間ぶんずれる（JST の 0:00〜8:59 に公開した記事が前日として並ぶ。
 * 公開ページと編集画面は JST なので、一覧だけ 1 日違うことになる。実際に踏んだ）。
 */
function day(value: string | null): string {
  return value ? isoDate(new Date(value)) : '—';
}
</script>

<template>
  <header class="bar">
    <h1>{{ SITE.name }}</h1>
    <span class="spacer" />
    <a href="#/settings">設定</a>
    <a :href="`${MOUNT}/`" target="_blank" rel="noreferrer">ブログを開く</a>
    <button class="primary" @click="go(NEW_POST_ROUTE)">新規</button>
  </header>

  <div class="filters">
    <input
      v-model="typed"
      type="search"
      class="search"
      placeholder="タイトル・説明・本文を検索"
      aria-label="記事を検索"
    />
    <select v-model="filters.status" class="filter" aria-label="状態で絞り込む">
      <option value="">すべての状態</option>
      <option value="published">公開</option>
      <option value="draft">下書き</option>
    </select>
    <select v-model="filters.tag" class="filter" aria-label="タグで絞り込む">
      <option value="">すべてのタグ</option>
      <option v-for="option in tagChoices" :key="option.slug" :value="option.slug">
        {{ option.name }}（{{ option.count }}）
      </option>
    </select>
    <button v-if="filtered" @click="clearFilters">絞り込みを解除</button>
  </div>

  <!-- lily を更新して出力が変わったときだけ出る。配信は保存済みの HTML を返すので、
       ここに出さないと古いまま気付けない。 -->
  <p v-if="stale > 0" class="notice">
    この renderer で描かれていない記事が {{ stale }} 件ある。
    <button :disabled="rerendering" @click="rerenderAll">
      {{ rerendering ? '描き直している…' : 'まとめて描き直す' }}
    </button>
  </p>
  <p v-if="rerenderError" class="notice error">{{ rerenderError }}</p>
  <p v-if="rerenderWarnings.length" class="notice">
    解決できない画像の参照を持つ記事: {{ rerenderWarnings.join(', ') }}
  </p>

  <p v-if="tagsError" class="notice error">タグの一覧を読めなかった: {{ tagsError }}</p>
  <p v-if="error" class="notice error">{{ error }}</p>
  <p v-else-if="loading" class="muted">読み込み中…</p>
  <p v-else-if="posts.length === 0" class="muted">
    {{ filtered ? 'この条件の記事はありません。' : 'まだ記事がありません。' }}
  </p>

  <div v-for="post in posts" :key="post.publicId" class="post-row">
    <span class="badge" :class="post.status">{{ post.status === 'published' ? '公開' : '下書き' }}</span>
    <a class="title" href="#" @click.prevent="go(postRoute(post.publicId))">{{ post.title }}</a>
    <!-- パスを決めていない記事は canonical が public_id そのもの。uuid を並べても
         読めないので出さない。 -->
    <span v-if="post.canonicalPath !== post.publicId" class="path">/{{ post.canonicalPath }}/</span>
    <span class="spacer" />
    <!-- 押すとそのタグで絞り込む。選択欄まで目を移さずに辿れる。 -->
    <button
      v-for="postTag in post.tags"
      :key="postTag.slug"
      class="chip"
      :aria-label="`${postTag.name} で絞り込む`"
      @click="filters.tag = postTag.slug"
    >
      {{ postTag.name }}
    </button>
    <span class="muted">{{ day(post.publishedAt) }}</span>
  </div>

  <div v-if="!loading && total > 0" class="pager">
    <button :disabled="!hasPrev" @click="move(-1)">← 前</button>
    <span class="muted">{{ range }}</span>
    <button :disabled="!hasNext" @click="move(1)">次 →</button>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { fromDateTimeInput, toDateTimeInput } from '../date.ts';
import { apiFetch, client, errorMessage, MOUNT } from '../api.ts';
import { go, postRoute, replaceRoute } from '../router.ts';
import { onSessionLost, stash, unstash } from '../session.ts';
import DateTimeInput from './DateTimeInput.vue';
import MarkdownEditor from './MarkdownEditor.vue';
import TagInput from './TagInput.vue';

const props = defineProps<{ publicId: string | null }>();

type Detail = {
  publicId: string;
  title: string;
  description: string | null;
  bodyMd: string;
  status: 'draft' | 'published';
  publishedAt: string | null;
  hasPreview: boolean;
  /** 告知済みかどうかはこちらで見る（**URL は組めないことがある**）。 */
  blueskyUri: string | null;
  /** bsky.app で開ける URL。**組むのはサーバー**（`core/bluesky.ts`）。 */
  blueskyUrl: string | null;
  canonicalPath: string;
  url: string;
  paths: { path: string; isCanonical: boolean }[];
  tags: { name: string; slug: string }[];
  media: {
    publicId: string;
    filename: string;
    url: string;
    /** この記事の OGP に選ばれている 1 枚か。 */
    isOgp: boolean;
    /** OGP に選べる形式か。**判断はサーバー**（`core/media/formats.ts`）。 */
    canBeOgp: boolean;
  }[];
};

/**
 * 画面の中で作った記事の id。**新規の画面のまま記事が生まれることがある**
 * （きっかけと理由は `ensureSaved`）。
 *
 * **route ではなくここに持つ。** route を動かすと `App.vue` の `key` が変わって
 * 編集画面が作り直され、**書きかけとカーソルが飛ぶ** —— それが起きるのは画像を
 * 差し込んでいる最中で、消えたことに気付きにくい。URL だけは `replaceRoute()` で
 * 追随させるので、再読み込みやセッション切れからの復帰では同じ記事が開く。
 */
const createdId = ref<string | null>(null);

/** 進行中の作成。**同時に 2 つ作らない**ための待ち合わせ場所（`create()`）。 */
let creating: Promise<string | null> | null = null;

/** いま編集しているのはどの記事か。**新規のうちは null。** */
const postId = computed(() => props.publicId ?? createdId.value);

const post = ref<Detail | null>(null);
const title = ref('');
const description = ref('');
const tags = ref<string[]>([]);
const bodyMd = ref('');
const newPath = ref('');
const previewUrl = ref('');
/** 公開日時。`YYYY-MM-DDTHH:mm`（JST の裸の日時）。空は「指定なし」。 */
const publishedAt = ref('');

/** 読み込んだときの値。触ったかどうかの判定に使う。 */
const loadedPublishedAt = ref('');

function publishedAtChanged(): boolean {
  return publishedAt.value !== loadedPublishedAt.value;
}

/**
 * 説明を空のままにしたときに出るもの。**組み立てるのはサーバー**（`POST /api/render`
 * が本文と一緒に返す）。ここで作ると、解析器を管理画面のバンドルへ運ぶことになり、
 * しかも打つたびに走る。
 */
const autoDescription = ref('');

const html = ref('');
const unresolved = ref<readonly string[]>([]);
const error = ref('');
const busy = ref(false);

const saved = computed(() => postId.value !== null);

/**
 * 記事を画面に反映する。**編集中の欄には触らない。**
 *
 * 作った直後（`create()`）はこちらだけを使う。作るきっかけは画像のドロップで、
 * その往復のあいだも人は打ち続けている ―― 送った時点の値で欄を埋め直すと、
 * **その間の打鍵が黙って消える**（差し込みは upload の前に捕まえた位置へ入るので、
 * 消えたことにも気付きにくい）。
 *
 * 公開日時は「読み込んだ値」として控えるだけ。次の保存で送り返さないためで、
 * 送り返すと欄が持たない秒が落ちて並びが変わる（`publishedAtChanged`）。
 */
function adopt(detail: Detail): void {
  post.value = detail;
  newPath.value = detail.canonicalPath;
  loadedPublishedAt.value =
    detail.publishedAt === null ? '' : toDateTimeInput(new Date(detail.publishedAt));
}

/** 記事を画面に反映して、**編集中の欄もサーバーの値に揃える**（読み込みと保存）。 */
function fill(detail: Detail): void {
  adopt(detail);
  title.value = detail.title;
  description.value = detail.description ?? '';
  tags.value = detail.tags.map((tag) => tag.name);
  bodyMd.value = detail.bodyMd;
  publishedAt.value = loadedPublishedAt.value;
}

/**
 * 失敗を画面に出して null を返す。
 *
 * **絞り込みをまたぐ汎用ヘルパーは作らない。** `hc` の戻り値は成功・API の
 * エラー・zod の検証失敗の union で、`if (!res.ok)` で絞ったところに型が付く。
 * ジェネリックな関数で包むとその情報が消える。
 */
async function fail(res: { status: number; json: () => Promise<unknown> }): Promise<void> {
  error.value = await errorMessage(res);
}

/** 通信中の印を立てる。 */
async function run(work: () => Promise<void>): Promise<void> {
  busy.value = true;
  error.value = '';
  try {
    await work();
  } finally {
    busy.value = false;
  }
}

/**
 * 開いたときに 1 度だけ読む。**ここだけは `props` を見る**（新規の画面で作った
 * 記事を読み直すことは無い。読むと、作った直後の値で書きかけを上書きする）。
 */
async function load(): Promise<void> {
  const id = props.publicId;
  if (id === null) return;
  await run(async () => {
    const res = await client.posts[':publicId'].$get({ param: { publicId: id } });
    if (!res.ok) return await fail(res);
    fill((await res.json()).post);
  });
}

/** 保存に送る中身。作るときも直すときも同じものを送る。 */
function payload() {
  return {
    title: title.value,
    description: description.value,
    bodyMd: bodyMd.value,
    tags: tags.value,
    // 下書きでも設定できる。公開のときに coalesce でこの日時が使われるので、
    // 「公開日を先に決めておく」「昔の記事を移す」がそのまま通る。
    //
    // **触っていなければ送らない。** 欄は分までしか持たないので、送り返すと
    // 秒が落ちる。並びは published_at 順なので、無関係な編集で同じ分に公開した
    // 記事の順序が入れ替わる。空のときも送らない (日付を消すのは「取り下げる」)。
    ...(publishedAt.value === '' || !publishedAtChanged()
      ? {}
      : { publishedAt: fromDateTimeInput(publishedAt.value) ?? undefined }),
  };
}

/**
 * 下書きとして作る。**同時に 2 つ作らない。**
 *
 * 作るきっかけは「保存」だけではなく、画像のドロップ・貼り付け・カードにする、と
 * 複数あり、それぞれ独立に走る。2 枚を続けて落とすと両方が「記事が無い」を見て、
 * 同じ題の下書きが 2 件でき、先に上げた画像は誰も開かない方に付く。**進行中の
 * 作成をここで覚える**ので、どの入口から来ても待ち合わせは 1 つ（画面ごとに
 * 編集している記事は 1 つなので、モジュールではなくここに持つ）。
 */
function create(): Promise<string | null> {
  creating ??= createOnce().finally(() => {
    creating = null;
  });
  return creating;
}

async function createOnce(): Promise<string | null> {
  await run(async () => {
    const res = await client.posts.$post({ json: payload() });
    if (!res.ok) return await fail(res);
    const created = await res.json();
    unresolved.value = created.unresolvedMedia;
    // **編集中の欄には触らない**（`adopt`）。URL だけ追随させる（`createdId`）。
    adopt(created.post);
    createdId.value = created.post.publicId;
    replaceRoute(postRoute(created.post.publicId));
  });
  return createdId.value;
}

async function save(): Promise<void> {
  const id = postId.value;
  if (id === null) {
    // **`create()` を直接呼ばない。** 題の検査と待ち合わせが付いてこない。
    await ensureSaved();
    return;
  }
  await run(async () => {
    const res = await client.posts[':publicId'].$patch({
      param: { publicId: id },
      json: payload(),
    });
    if (!res.ok) return await fail(res);
    const updated = await res.json();
    unresolved.value = updated.unresolvedMedia;
    fill(updated.post);
  });
}

/**
 * 添付できる状態にする。**記事が無ければ下書きとして保存してから返す。**
 *
 * 添付は記事に紐づく（R2 のキーが記事とファイル名から決まる）ので、記事が無い
 * あいだは受け取れない。「先に保存してください」と突き放すと、書き始めてすぐ
 * 画像を貼りたい場面で必ず引っかかる（issue #6）。
 *
 * **題だけは省略できない。** 記事のタイトルは空にできないので（`createPostSchema`
 * と DB の CHECK。空白だけの題も同じく弾かれる）、代わりに「無題」を作ると一覧に
 * 持ち主の分からない下書きが並ぶ。**ここで見るのはサーバーと同じ述語**で、
 * 往復を 1 つ省くためのもの（読める日本語を出せるのも今のところここだけ）。
 */
async function ensureSaved(): Promise<string | null> {
  const id = postId.value;
  if (id !== null) return id;
  // 作っている途中なら題は既に見てある（`create()` が待ち合わせる）。
  if (creating === null && title.value.trim() === '') {
    error.value = 'タイトルを入れてから画像やカードを入れる（下書きとして保存してから添付する）';
    return null;
  }
  return await create();
}

async function setStatus(action: 'publish' | 'unpublish'): Promise<void> {
  const id = postId.value;
  if (id === null) return;
  await run(async () => {
    const res =
      action === 'publish'
        ? await client.posts[':publicId'].publish.$post({ param: { publicId: id }, json: {} })
        : await client.posts[':publicId'].unpublish.$post({ param: { publicId: id } });
    if (!res.ok) return await fail(res);
    fill((await res.json()).post);
  });
}

async function changePath(): Promise<void> {
  const id = postId.value;
  if (id === null || post.value === null || newPath.value === post.value.canonicalPath) return;
  await run(async () => {
    const res = await client.posts[':publicId'].path.$put({
      param: { publicId: id },
      json: { path: newPath.value },
    });
    if (!res.ok) return await fail(res);
    fill((await res.json()).post);
  });
}

async function removeAlias(path: string): Promise<void> {
  const id = postId.value;
  if (id === null) return;
  await run(async () => {
    const res = await client.posts[':publicId'].paths.$delete({
      param: { publicId: id },
      json: { path },
    });
    if (!res.ok) return await fail(res);
    fill((await res.json()).post);
  });
}

async function issuePreview(): Promise<void> {
  const id = postId.value;
  if (id === null) return;
  await run(async () => {
    const res = await client.posts[':publicId'].preview.$post({ param: { publicId: id } });
    if (!res.ok) return await fail(res);
    // API が返すのは mount 相対のパス。共有できる URL は、管理画面が動いて
    // いるオリジンと繋いで作る (本番でも手元でも、そのまま開ける形になる)。
    previewUrl.value = `${location.origin}${(await res.json()).path}`;
    if (post.value) post.value = { ...post.value, hasPreview: true };
  });
}

async function revokePreview(): Promise<void> {
  const id = postId.value;
  if (id === null) return;
  await run(async () => {
    const res = await client.posts[':publicId'].preview.$delete({ param: { publicId: id } });
    if (!res.ok) return await fail(res);
    previewUrl.value = '';
    if (post.value) post.value = { ...post.value, hasPreview: false };
  });
}

/**
 * Bluesky へ告知する。**押したときだけ投げる。**
 *
 * 二重投稿の抑止はサーバー側（`bluesky_uri`）。押してから返るまで数秒かかるので、
 * `busy` で押しっぱなしを防ぐ。
 *
 * **`fill()` を呼ばない。** 告知で記事の中身は何も変わらないので、読み直すと
 * 保存前の書きかけを消すことになる（プレビューの発行と同じ扱い）。
 */
async function announce(): Promise<void> {
  const id = postId.value;
  if (id === null) return;
  if (!confirm('Bluesky に告知する。取り消せない。')) return;
  await run(async () => {
    const res = await client.posts[':publicId'].bluesky.$post({ param: { publicId: id } });
    if (!res.ok) return await fail(res);
    const announced = (await res.json()).post;
    if (post.value) {
      post.value = {
        ...post.value,
        blueskyUri: announced.blueskyUri,
        blueskyUrl: announced.blueskyUrl,
      };
    }
  });
}

async function remove(): Promise<void> {
  const id = postId.value;
  if (id === null) return;
  if (!confirm('この記事を消す。元に戻せない。')) return;
  await run(async () => {
    const res = await client.posts[':publicId'].$delete({ param: { publicId: id } });
    if (!res.ok) return await fail(res);
    go('/');
  });
}

/**
 * 画像を上げてファイル名を返す。本文に入るのは `./<filename>`。
 *
 * multipart なので `hc` の型付き呼び出しは使えない (検証を zod に通していない)。
 * URL の組み立てだけ `$url()` に任せて、パスを 2 箇所に書かないようにする。
 */
async function upload(file: File): Promise<string | null> {
  const id = await ensureSaved();
  if (id === null) return null;

  const form = new FormData();
  form.append('file', file);

  let filename: string | null = null;
  await run(async () => {
    const url = client.posts[':publicId'].media.$url({ param: { publicId: id } });
    const res = await apiFetch(url, { method: 'POST', body: form });
    if (!res.ok) return await fail(res);

    const uploaded = (await res.json()) as { media: Detail['media'][number] };
    filename = uploaded.media.filename;

    // **ここで load() を呼ばない。** 本文まで読み直すと textarea の value が
    // 代入し直され、カーソルが末尾へ飛ぶ (画像がそこに入ってしまう)。
    // 増えたのは添付だけなので、その 1 件だけを足す。
    if (post.value) post.value = { ...post.value, media: [...post.value.media, uploaded.media] };
  });
  return filename;
}

/**
 * 貼った URL をカードの HTML にする。**サムネを添付として取り込む**ので記事が要る。
 *
 * 取り込んだ添付をここで `media` に足すのは `upload()` と同じ理由。足さないと、
 * プレビューが本文の `./card-….png` を解決できず、警告だけが出る。
 */
async function makeCard(url: string): Promise<string | null> {
  const id = await ensureSaved();
  if (id === null) return null;

  let html: string | null = null;
  await run(async () => {
    const res = await client.posts[':publicId']['link-card'].$post({
      param: { publicId: id },
      json: { url },
    });
    if (!res.ok) return await fail(res);

    const card = await res.json();
    html = card.html;

    // **既にあるものが返ることがある。** サムネのファイル名はページの URL から
    // 決まるので、同じリンクを 2 回カードにすると同じ添付が返る。素直に足すと
    // 一覧に同じ行が並び、`:key` が重複する。
    const added = card.media;
    if (added !== null && post.value && !post.value.media.some((m) => m.publicId === added.publicId)) {
      post.value = { ...post.value, media: [...post.value.media, added] };
    }
  });
  return html;
}

/**
 * OGP に使う添付を選ぶ / やめる（`null` で解除）。
 *
 * **`fill()` を呼ばない。** 記事の中身は変わらないので、書きかけを消さないよう
 * 添付の一覧だけ差し替える（告知と同じ扱い）。
 */
async function setOgp(mediaPublicId: string | null): Promise<void> {
  const id = postId.value;
  if (id === null) return;
  await run(async () => {
    const res = await client.posts[':publicId'].ogp.$put({
      param: { publicId: id },
      json: { mediaPublicId },
    });
    if (!res.ok) return await fail(res);
    const updated = (await res.json()).post;
    if (post.value) post.value = { ...post.value, media: updated.media };
  });
}

async function removeMedia(mediaId: string): Promise<void> {
  await run(async () => {
    const res = await client.media[':publicId'].$delete({ param: { publicId: mediaId } });
    if (!res.ok) return await fail(res);

    // 消したときも本文は読み直さない (書きかけを捨てないため)。
    if (post.value) {
      post.value = {
        ...post.value,
        media: post.value.media.filter((item) => item.publicId !== mediaId),
      };
    }
  });
}

/**
 * セッションが切れて読み込み直すときの控え。**保存前の編集内容はここにしかない。**
 *
 * 記事ごとに分けるのは、読み込み直したあとに別の記事を開いても混ざらないため。
 * mount を混ぜるのは `/blog` と `/blog-next` を同じブラウザで開くから。
 */
type StashedDraft = {
  title: string;
  description: string;
  tags: string[];
  bodyMd: string;
  publishedAt: string;
};

/**
 * 退避先のキー。**書くときの値で決まる。**
 *
 * 定数にできない ―― 新規の画面で画像を入れると下書きが生まれ、URL も
 * `#/posts/<id>` に変わる。`new` のまま書くと、読み込み直した先（その記事の画面）
 * が自分の控えを見つけられない。
 */
function stashKey(): string {
  return `lily:draft:${MOUNT}:${postId.value ?? 'new'}`;
}

/**
 * 記事を読み込めたか。**読めていない画面の空欄を退避しない**ため。
 *
 * 読み込み直した直後にもう一度切れると、まだ `load()` が終わっていない空の
 * 状態を控えとして書くことになる（新規は読むものが無いので最初から真）。
 */
const loaded = computed(() => props.publicId === null || post.value !== null);

onUnmounted(
  onSessionLost(() => {
    if (!loaded.value) return;
    stash(stashKey(), {
      title: title.value,
      description: description.value,
      tags: tags.value,
      bodyMd: bodyMd.value,
      publishedAt: publishedAt.value,
    } satisfies StashedDraft);
  }),
);

const restored = ref(false);

/** 読み込み直す前の編集内容を戻す。**読み込みが終わってから上書きする。** */
function restore(): void {
  const draft = unstash<StashedDraft>(stashKey());
  if (draft === null) return;
  title.value = draft.title;
  description.value = draft.description;
  tags.value = draft.tags;
  bodyMd.value = draft.bodyMd;
  publishedAt.value = draft.publishedAt;
  restored.value = true;
}

/**
 * プレビュー。**公開ページと同じ renderer を通す**ので、書きながら見ているものと
 * 出るものが食い違わない。打つたびに投げないよう少し待つ。
 */
let timer: ReturnType<typeof setTimeout> | undefined;

watch(
  bodyMd,
  (value) => {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      const res = await client.render.$post({
        // **記事が決まっていれば渡す。** 添付（`./sample.png`）を解決するのに要る
        // ので、新規の画面で画像を入れて下書きが生まれた直後もそこから効く。
        json: { bodyMd: value, ...(postId.value === null ? {} : { publicId: postId.value }) },
      });
      if (!res.ok) return;
      const rendered = await res.json();
      html.value = rendered.html;
      unresolved.value = rendered.unresolvedMedia;
      autoDescription.value = rendered.autoDescription ?? '';
    }, 300);
  },
  { immediate: true },
);

onMounted(async () => {
  await load();
  restore();
});
</script>

<template>
  <header class="bar">
    <button @click="go('/')">← 一覧</button>
    <h1>{{ saved ? '編集' : '新規' }}</h1>
    <span v-if="post" class="badge" :class="post.status">
      {{ post.status === 'published' ? '公開' : '下書き' }}
    </span>
    <span class="spacer" />
    <a v-if="post && post.status === 'published'" :href="post.url" target="_blank" rel="noreferrer">
      公開ページ
    </a>
    <button class="primary" :disabled="busy" @click="save">保存</button>
  </header>

  <p v-if="error" class="notice error">{{ error }}</p>
  <p v-if="restored" class="notice">
    セッションが切れる前の編集内容を復元した。保存するまで記事には入っていない。
  </p>
  <p v-if="unresolved.length" class="notice">
    解決できない画像の参照: {{ unresolved.join(', ') }}
  </p>

  <!-- 上段: 記事そのものではなく「記事についての情報」。ここが動くと本文の
       縦位置がずれるので、本文とプレビューより上にまとめて置く。 -->
  <div class="meta">
    <label class="wide">
      タイトル
      <input v-model="title" type="text" />
    </label>
    <label class="wide">
      説明（一覧と OGP に出る。空なら本文の冒頭から作る）
      <input v-model="description" type="text" :placeholder="autoDescription" />
    </label>
    <label>
      タグ
      <TagInput v-model="tags" />
    </label>
    <label>
      {{ post?.status === 'published' ? '公開日時' : '公開日時（公開するとこの日時になる）' }}
      <DateTimeInput v-model="publishedAt" />
    </label>
    <label v-if="post" class="wide">
      公開パス（変えると旧パスは自動で alias に残る）
      <span class="path-row">
        <input v-model="newPath" type="text" @keyup.enter="changePath" />
        <button :disabled="busy || newPath === post.canonicalPath" @click="changePath">変える</button>
      </span>
    </label>
  </div>

  <!-- 本文とプレビューは同じ高さで並べる。書いている行と出来上がりを
       見比べられるようにするため。 -->
  <div class="editor">
    <div class="panel">
      <h2>本文</h2>
      <MarkdownEditor v-model="bodyMd" :upload="upload" :make-card="makeCard" />
    </div>
    <div class="panel">
      <h2>プレビュー</h2>
      <!-- 本文は自分で書いたものを自分で描いたもの。 -->
      <!-- eslint-disable-next-line vue/no-v-html -->
      <div class="preview" v-html="html" />
    </div>
  </div>

  <!-- 下段: 書き終わってから触るもの。 -->
  <template v-if="post">
    <div class="panels">
      <div class="panel">
        <h2>URL</h2>
        <ul class="paths">
          <li v-for="path in post.paths" :key="path.path">
            <span>/{{ path.path }}/</span>
            <span v-if="path.isCanonical" class="badge">canonical</span>
            <span class="spacer" />
            <button v-if="!path.isCanonical && path.path !== post.publicId" @click="removeAlias(path.path)">
              消す
            </button>
          </li>
        </ul>
      </div>

      <div class="panel">
        <h2>添付</h2>
        <ul class="media-list">
          <li v-for="item in post.media" :key="item.publicId">
            <span class="name">{{ item.filename }}</span>
            <span v-if="item.isOgp" class="badge">OGP</span>
            <span class="spacer" />
            <!-- 選べない形式（SVG / GIF / AVIF）にはボタンを出さない。 -->
            <button
              v-if="item.canBeOgp"
              :disabled="busy"
              @click="setOgp(item.isOgp ? null : item.publicId)"
            >
              {{ item.isOgp ? 'OGP をやめる' : 'OGP に使う' }}
            </button>
            <a :href="item.url" target="_blank" rel="noreferrer">開く</a>
            <button class="danger" @click="removeMedia(item.publicId)">消す</button>
          </li>
        </ul>
        <p v-if="post.media.length === 0" class="muted">まだ無い。</p>
        <p v-else class="muted">
          OGP に選んだ絵は、記事の og:image と Bluesky のリンクカードに出る（選ばなければ共通の
          1 枚）。
        </p>
      </div>

      <div class="panel">
        <h2>下書きプレビュー</h2>
        <p class="muted">URL を知っている人だけが下書きを読める。検索には載らない。</p>
        <p v-if="previewUrl" class="notice">
          {{ previewUrl }}
          <span class="muted">（この URL が出るのは発行したときだけ）</span>
        </p>
        <div class="actions">
          <button :disabled="busy" @click="issuePreview">
            {{ post.hasPreview ? '発行し直す' : '発行する' }}
          </button>
          <button v-if="post.hasPreview" :disabled="busy" @click="revokePreview">失効させる</button>
        </div>
      </div>

      <!-- 公開とは別の操作。**押したときだけ投げ、1 記事につき 1 回だけ。** -->
      <div class="panel">
        <h2>Bluesky</h2>
        <!-- 判定は blueskyUri。**URL は組めないことがある**（知らない形の AT-URI）
             ので、そちらで見ると告知済みの記事に告知ボタンが出てしまう。 -->
        <p v-if="post.blueskyUri" class="notice">
          告知済み
          <a v-if="post.blueskyUrl" :href="post.blueskyUrl" target="_blank" rel="noreferrer">
            投稿を開く
          </a>
          <span v-else class="muted">{{ post.blueskyUri }}</span>
        </p>
        <template v-else>
          <p class="muted">
            {{
              post.status === 'published'
                ? 'タイトルと URL をリンクカード付きで投稿する。'
                : '公開してから告知できる。'
            }}
          </p>
          <div class="actions">
            <button :disabled="busy || post.status !== 'published'" @click="announce">
              告知する
            </button>
          </div>
        </template>
      </div>
    </div>

    <div class="actions" style="margin-top: 1rem">
      <button v-if="post.status === 'draft'" :disabled="busy" @click="setStatus('publish')">
        公開する
      </button>
      <button v-else :disabled="busy" @click="setStatus('unpublish')">取り下げる</button>
      <span class="spacer" />
      <button class="danger" :disabled="busy" @click="remove">削除</button>
    </div>
  </template>
  <p v-else class="muted" style="margin-top: 1rem">
    保存すると URL・添付・プレビューを設定できる。画像を入れると、そのとき下書きとして
    保存する（添付は記事に紐づくため）。
  </p>

  <p class="muted" style="margin-top: 2rem">
    <a :href="`${MOUNT}/`" target="_blank" rel="noreferrer">ブログを開く</a>
  </p>
</template>

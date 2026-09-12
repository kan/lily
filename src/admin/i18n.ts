/**
 * 管理画面の文言。**画面に出る言葉はここだけ。**
 *
 * **公開ページと決め方が違う。** あちらは設定（`SiteConfig.uiLang`）で固定する
 * —— 共有キャッシュに載るので、ある読者に返した言語が次の読者へ配られるため
 * （`core/locale.ts`）。管理画面は認証の内側にあって共有キャッシュに載らないので、
 * **ブラウザの言語で始めて、設定画面から切り替えられる**。
 *
 * 選んだ言語は端末に覚える（`localStorage`）。deployment の設定に足さないのは、
 * 同じブログを別々の言語の人が触ることがあるため。
 *
 * **表は言語ごとに同じ形。** `AdminText` を満たさない表はコンパイルが通らないので、
 * 片方だけ足した文言が残ることはない。
 */
import { reactive, ref, watch } from 'vue';
import { resolveLocale, resolveLocales, type Locale } from '../core/locale.ts';

export type AdminText = {
  readonly common: {
    readonly save: string;
    readonly delete: string;
    readonly openBlog: string;
    readonly toList: string;
    readonly settings: string;
    readonly loading: string;
  };
  readonly tags: {
    readonly remove: string;
    readonly add: string;
  };
  readonly datetime: {
    /** 日曜始まり。**マス目の並びと対**なので、順番を変えない。 */
    readonly weekdays: readonly string[];
    readonly unset: string;
    readonly prevMonth: string;
    readonly nextMonth: string;
    /** 月の見出し。`month` は 1 始まり。 */
    readonly monthLabel: (year: number, month: number) => string;
    readonly now: string;
    readonly clear: string;
  };
  readonly list: {
    readonly newPost: string;
    readonly search: string;
    readonly searchLabel: string;
    readonly statusLabel: string;
    readonly anyStatus: string;
    readonly published: string;
    readonly draft: string;
    readonly tagLabel: string;
    readonly anyTag: string;
    readonly clearFilters: string;
    readonly filterByTag: (tag: string) => string;
    readonly noPosts: string;
    readonly noMatches: string;
    readonly tagsFailed: (reason: string) => string;
    readonly range: (from: number, to: number, total: number) => string;
    readonly empty: string;
    readonly prev: string;
    readonly next: string;
    /** 再描画の案内。lily を更新して出力が変わったときだけ出る。 */
    readonly staleNotice: (count: number) => string;
    readonly rerender: string;
    readonly rerendering: string;
    readonly rerenderStuck: (remaining: number) => string;
    readonly unresolvedMedia: (posts: string) => string;
  };
  readonly editor: {
    readonly backToList: string;
    readonly editing: string;
    readonly creating: string;
    readonly publicPage: string;
    readonly restored: string;
    readonly unresolved: (files: string) => string;
    readonly title: string;
    readonly description: string;
    readonly tags: string;
    readonly publishedAt: string;
    readonly publishedAtFuture: string;
    readonly path: string;
    readonly changePath: string;
    readonly body: string;
    readonly preview: string;
    readonly titleFirst: string;
    readonly urls: string;
    readonly removeAlias: string;
    readonly media: string;
    readonly useAsOgp: string;
    readonly dropOgp: string;
    readonly open: string;
    readonly remove: string;
    readonly noMedia: string;
    readonly ogpNote: string;
    readonly draftPreview: string;
    readonly draftPreviewNote: string;
    readonly previewOnce: string;
    readonly issuePreview: string;
    readonly reissuePreview: string;
    readonly revokePreview: string;
    readonly announced: string;
    readonly openPost: string;
    readonly announceReady: string;
    readonly announceAfterPublish: string;
    readonly announce: string;
    readonly announceConfirm: string;
    readonly publish: string;
    readonly unpublish: string;
    readonly deleteConfirm: string;
    readonly saveFirst: string;
  };
  readonly markdown: {
    readonly heading: string;
    readonly subheading: string;
    readonly bold: string;
    readonly boldSample: string;
    readonly italic: string;
    readonly italicSample: string;
    readonly inlineCode: string;
    readonly link: string;
    readonly linkSample: string;
    readonly image: string;
    readonly codeBlock: string;
    readonly quote: string;
    readonly more: string;
    readonly table: string;
    /** 差し込む表の中身。**訳す**（見出しと中身は書き換える前提の置き字）。 */
    readonly tableSample: readonly [string, string];
    readonly rule: string;
    readonly footnote: string;
    readonly bullets: string;
    readonly numbers: string;
    readonly makeCard: string;
    readonly makeCardTitle: string;
    readonly carding: string;
    readonly closeEsc: string;
    readonly help: string;
  };
  readonly settings: {
    readonly title: string;
    readonly siteName: string;
    readonly description: string;
    readonly author: string;
    readonly publicUrl: string;
    readonly language: string;
    readonly languageNote: string;
    readonly note: string;
    readonly logout: string;
    readonly logoutNote: string;
  };
};

/**
 * 月の名前。**`Intl` に任せる**ので、表に 12 個ずつ並べずに済む
 * （管理画面は日付の整形で既に `Intl` を使っている）。
 */
function monthName(locale: Locale, month: number): string {
  // **`timeZone` を付ける。** UTC で作った日付をこの端末のゾーンで整形すると、
  // UTC より西では 1 日戻って**前の月の名前**が出る（`America/Los_Angeles` で
  // 1 月が December になる）。
  return new Intl.DateTimeFormat(locale, { month: 'long', timeZone: 'UTC' }).format(
    new Date(Date.UTC(2000, month - 1, 1)),
  );
}

/**
 * 曜日の名前。**月名と同じく `Intl` に任せる。**
 *
 * **日曜始まりで 7 つ。** カレンダーのマス目がその並びで出る（`DateTimeInput`）。
 * 2000-01-02 が日曜なので、そこから 7 日ぶん数える。
 */
function weekdayNames(locale: Locale): readonly string[] {
  const format = new Intl.DateTimeFormat(locale, { weekday: 'short', timeZone: 'UTC' });
  return Array.from({ length: 7 }, (_, day) => format.format(new Date(Date.UTC(2000, 0, 2 + day))));
}

const en: AdminText = {
  common: {
    save: 'Save',
    delete: 'Delete',
    openBlog: 'Open the blog',
    toList: 'All posts',
    settings: 'Settings',
    loading: 'Loading…',
  },
  tags: {
    remove: 'Remove',
    add: 'Add a tag',
  },
  datetime: {
    weekdays: weekdayNames('en'),
    unset: 'Not set',
    prevMonth: 'Previous month',
    nextMonth: 'Next month',
    monthLabel: (year, month) => `${monthName('en', month)} ${year}`,
    now: 'Now',
    clear: 'Clear',
  },
  list: {
    newPost: 'New',
    search: 'Search titles, descriptions and bodies',
    searchLabel: 'Search posts',
    statusLabel: 'Filter by status',
    anyStatus: 'Any status',
    published: 'Published',
    draft: 'Draft',
    tagLabel: 'Filter by tag',
    anyTag: 'Any tag',
    clearFilters: 'Clear filters',
    filterByTag: (tag) => `Filter by ${tag}`,
    noPosts: 'No posts yet.',
    noMatches: 'Nothing matches those filters.',
    tagsFailed: (reason) => `Could not load the tags: ${reason}`,
    range: (from, to, total) => `${from}–${to} of ${total}`,
    empty: '0 posts',
    prev: '← Newer',
    next: 'Older →',
    // **1 件のときを分ける。** 再描画が 1 件だけ残る状態は普通に起きるので、
    // 「1 posts」は必ず誰かの目に触れる。
    staleNotice: (count) =>
      count === 1
        ? 'One post was not rendered by this renderer.'
        : `${count} posts were not rendered by this renderer.`,
    rerender: 'Render them again',
    rerendering: 'Rendering…',
    rerenderStuck: (remaining) =>
      remaining === 1
        ? "One is still left and the count stopped falling. Check the Worker's logs."
        : `${remaining} are still left and the count stopped falling. Check the Worker's logs.`,
    unresolvedMedia: (posts) => `Posts with image references that do not resolve: ${posts}`,
  },
  editor: {
    backToList: '← All posts',
    editing: 'Edit',
    creating: 'New',
    publicPage: 'Public page',
    restored: 'Restored what you had written before the session expired. It is not in the post until you save.',
    unresolved: (files) => `Image references that do not resolve: ${files}`,
    title: 'Title',
    description: 'Description (shown in the list and in OGP; taken from the opening of the body when empty)',
    tags: 'Tags',
    publishedAt: 'Publication time',
    publishedAtFuture: 'Publication time (used when you publish)',
    path: 'Path (changing it leaves the old one behind as an alias)',
    changePath: 'Change',
    body: 'Body',
    preview: 'Preview',
    titleFirst: 'Give it a title before adding images or cards (it is saved as a draft when you attach)',
    urls: 'URLs',
    removeAlias: 'Remove',
    media: 'Attachments',
    useAsOgp: 'Use for OGP',
    dropOgp: 'Stop using for OGP',
    open: 'Open',
    remove: 'Remove',
    noMedia: 'None yet.',
    ogpNote:
      "The image picked for OGP is what the post's og:image and the Bluesky card show (without one, the site-wide image is used).",
    draftPreview: 'Draft preview',
    draftPreviewNote: 'Anyone with the URL can read the draft. It is kept out of search engines.',
    previewOnce: '(this URL is shown only when it is issued)',
    issuePreview: 'Issue',
    reissuePreview: 'Issue a new one',
    revokePreview: 'Revoke',
    announced: 'Announced',
    openPost: 'Open the post',
    announceReady: 'Posts the title and the URL with a link card.',
    announceAfterPublish: 'Publish it first.',
    announce: 'Announce',
    announceConfirm: 'Announce this on Bluesky. This cannot be undone.',
    publish: 'Publish',
    unpublish: 'Unpublish',
    deleteConfirm: 'Delete this post. This cannot be undone.',
    saveFirst:
      'Saving lets you set the URL, the attachments and the preview. Adding an image saves it as a draft, because attachments belong to a post.',
  },
  markdown: {
    heading: 'Heading',
    subheading: 'Subheading',
    bold: 'Bold',
    boldSample: 'bold',
    italic: 'Italic',
    italicSample: 'italic',
    inlineCode: 'Inline code',
    link: 'Link',
    linkSample: 'link',
    image: 'Insert an image',
    codeBlock: 'Code block',
    quote: 'Quote',
    more: 'More',
    table: 'Table',
    tableSample: ['Heading', 'Cell'],
    rule: 'Horizontal rule',
    footnote: 'Footnote',
    bullets: 'Bulleted list',
    numbers: 'Numbered list',
    makeCard: 'Make it a card',
    makeCardTitle: 'Turn it into a block with the title, description and thumbnail',
    carding: 'Fetching…',
    closeEsc: 'Close (Esc)',
    help: 'Images go in by drag and drop, by pasting, or with the button. Pasting a URL makes a link with its title.',
  },
  settings: {
    title: 'Settings',
    siteName: 'Site name',
    description: 'Description',
    author: 'Author',
    publicUrl: 'Public URL',
    language: 'Language of this screen',
    languageNote: 'Kept on this device. It does not change what the blog serves.',
    note:
      'These cannot be changed here. The values live in the source configuration; edit it and ' +
      'deploy to change them. The site name shows in the browser title, the OGP tags and the ' +
      'feeds; the author shows under each post and in Atom. The bold part is the mount path, ' +
      'which has to change together with the route configuration.',
    logout: 'Sign out',
    logoutNote:
      'Ends the session in this browser. Opening the admin UI again will ask for the password.',
  },
};

const ja: AdminText = {
  common: {
    save: '保存',
    delete: '削除',
    openBlog: 'ブログを開く',
    toList: '一覧へ',
    settings: '設定',
    loading: '読み込み中…',
  },
  tags: {
    remove: '外す',
    add: 'タグを足す',
  },
  datetime: {
    weekdays: weekdayNames('ja'),
    unset: '指定なし',
    prevMonth: '前の月',
    nextMonth: '次の月',
    monthLabel: (year, month) => `${year} 年 ${month} 月`,
    now: '今',
    clear: '消す',
  },
  list: {
    newPost: '新規',
    search: 'タイトル・説明・本文を検索',
    searchLabel: '記事を検索',
    statusLabel: '状態で絞り込む',
    anyStatus: 'すべての状態',
    published: '公開',
    draft: '下書き',
    tagLabel: 'タグで絞り込む',
    anyTag: 'すべてのタグ',
    clearFilters: '絞り込みを解除',
    filterByTag: (tag) => `${tag} で絞り込む`,
    noPosts: 'まだ記事がありません。',
    noMatches: 'この条件の記事はありません。',
    tagsFailed: (reason) => `タグの一覧を読めなかった: ${reason}`,
    range: (from, to, total) => `${from}–${to} / ${total} 件`,
    empty: '0 件',
    prev: '← 前',
    next: '次 →',
    staleNotice: (count) => `この renderer で描かれていない記事が ${count} 件ある。`,
    rerender: 'まとめて描き直す',
    rerendering: '描き直している…',
    rerenderStuck: (remaining) =>
      `${remaining} 件が残ったまま減らなくなった。Worker のログを見ること。`,
    unresolvedMedia: (posts) => `解決できない画像の参照を持つ記事: ${posts}`,
  },
  editor: {
    backToList: '← 一覧',
    editing: '編集',
    creating: '新規',
    publicPage: '公開ページ',
    restored: 'セッションが切れる前の編集内容を復元した。保存するまで記事には入っていない。',
    unresolved: (files) => `解決できない画像の参照: ${files}`,
    title: 'タイトル',
    description: '説明（一覧と OGP に出る。空なら本文の冒頭から作る）',
    tags: 'タグ',
    publishedAt: '公開日時',
    publishedAtFuture: '公開日時（公開するとこの日時になる）',
    path: '公開パス（変えると旧パスは自動で alias に残る）',
    changePath: '変える',
    body: '本文',
    preview: 'プレビュー',
    titleFirst: 'タイトルを入れてから画像やカードを入れる（下書きとして保存してから添付する）',
    urls: 'URL',
    removeAlias: '消す',
    media: '添付',
    useAsOgp: 'OGP に使う',
    dropOgp: 'OGP をやめる',
    open: '開く',
    remove: '消す',
    noMedia: 'まだ無い。',
    ogpNote:
      'OGP に選んだ絵は、記事の og:image と Bluesky のリンクカードに出る（選ばなければ共通の 1 枚）。',
    draftPreview: '下書きプレビュー',
    draftPreviewNote: 'URL を知っている人だけが下書きを読める。検索には載らない。',
    previewOnce: '（この URL が出るのは発行したときだけ）',
    issuePreview: '発行する',
    reissuePreview: '発行し直す',
    revokePreview: '失効させる',
    announced: '告知済み',
    openPost: '投稿を開く',
    announceReady: 'タイトルと URL をリンクカード付きで投稿する。',
    announceAfterPublish: '公開してから告知できる。',
    announce: '告知する',
    announceConfirm: 'Bluesky に告知する。取り消せない。',
    publish: '公開する',
    unpublish: '取り下げる',
    deleteConfirm: 'この記事を消す。元に戻せない。',
    saveFirst:
      '保存すると URL・添付・プレビューを設定できる。画像を入れると、そのとき下書きとして保存する（添付は記事に紐づくため）。',
  },
  markdown: {
    heading: '見出し',
    subheading: '小見出し',
    bold: '太字',
    boldSample: '太字',
    italic: '斜体',
    italicSample: '斜体',
    inlineCode: 'インラインコード',
    link: 'リンク',
    linkSample: 'リンク',
    image: '画像を入れる',
    codeBlock: 'コードブロック',
    quote: '引用',
    more: 'そのほかの記法',
    table: '表',
    tableSample: ['見出し', '中身'],
    rule: '水平線',
    footnote: '脚注',
    bullets: '箇条書き',
    numbers: '番号付きリスト',
    makeCard: 'カードにする',
    makeCardTitle: '題と説明とサムネのブロックにする',
    carding: '取りに行っています…',
    closeEsc: '閉じる (Esc)',
    help: '画像はドラッグ＆ドロップ・貼り付け・ボタンで入る。URL を貼るとタイトル付きのリンクになる。',
  },
  settings: {
    title: '設定',
    siteName: 'サイト名',
    description: '説明',
    author: '著者',
    publicUrl: '公開 URL',
    language: 'この画面の言語',
    languageNote: 'この端末にだけ覚えます。ブログが配るものは変わりません。',
    note:
      'ここでは変更できません。値はソースのサイト設定にあり、書き換えてデプロイすると' +
      '反映されます。サイト名はブラウザの題・OGP・フィードに、著者は記事下と Atom に' +
      '出ます。太字はマウント位置で、route の設定と必ず対で変えるものです。',
    logout: 'ログアウト',
    logoutNote:
      'このブラウザのセッションを終わらせます。次に開くときはパスワードを入れ直します。',
  },
};

const TABLES: Record<Locale, AdminText> = { en, ja };

/** 言語の選択肢。**その言語の名前をその言語で出す。** */
export const LOCALE_LABELS: Record<Locale, string> = { en: 'English', ja: '日本語' };

const STORAGE_KEY = 'lily-admin-locale';

/**
 * 最初の言語。**覚えたもの → ブラウザの言語 → 既定（英語）**の順。
 *
 * `localStorage` は private window などで読めないことがある。**そこで落とすと
 * 画面ごと出ない**ので、読めなければブラウザの言語に落ちる。
 */
function initial(): Locale {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved !== null) return resolveLocale(saved);
  } catch {
    // 読めないだけ。次の手段へ。
  }
  // **並びを順に見る。** 第 1 候補が表に無い言語（`zh-CN` など）でも、
  // 2 番目に日本語を置いている人には日本語で出す。
  return resolveLocales(navigator.languages);
}

/** いま選ばれている言語。設定画面の選択に繋ぐ。 */
/** いま選ばれている言語。**これを書き換えれば、下の `watch` が残りを揃える。** */
export const locale = ref<Locale>(initial());

/** 画面に出す表。**差し替えると画面が追随する**ので、読み込み直しは要らない。 */
export const t = reactive<AdminText>({ ...TABLES[locale.value] });

// 読み込んだ時点の言語を `<html lang>` に入れる。**入口 HTML は `lang="ja"` で
// 焼かれている**ので、ここで直さないと英語の画面が日本語だと名乗り続ける
// （読み上げと、ブラウザの「翻訳しますか」に出る）。
document.documentElement.lang = locale.value;

/**
 * 言語が変わったら、表と `<html lang>` と覚え書きを揃える。
 *
 * **`locale` を書き換える経路が 1 本しかない**ので、選択欄だけ変わって文言が
 * 元のまま、という状態にならない。**最初の 1 回では走らせない** —— 起動時に
 * 覚えてしまうと、ブラウザの言語を変えた人に古い選択が残り続ける。
 */
watch(locale, (next) => {
  Object.assign(t, TABLES[next]);
  document.documentElement.lang = next;
  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch {
    // 覚えられないだけ。この画面のあいだは選んだ言語で出る。
  }
});

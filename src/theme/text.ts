/**
 * 標準テーマが出す文言。**画面に出る言葉はここだけ。**
 *
 * 言語は `SiteConfig.uiLang`（無ければ `lang`）で決める。**読み手の
 * `Accept-Language` では選ばない** —— 公開ページは共有キャッシュに載るので、
 * ある読者に返した言語が次の読者へ配られる（理由は `core/locale.ts`）。
 *
 * **表は言語ごとに同じ形。** `Text` を満たさない表はコンパイルが通らないので、
 * 片方だけ足した文言が残ることはない。写して自分のテーマにする deployment は、
 * この表ごと持っていけばよい。
 */
import type { SiteConfig } from '../core/config.ts';
import { siteLocale, type Locale } from '../core/locale.ts';

export type Text = {
  readonly rss: string;
  readonly admin: string;
  readonly editThisPost: string;
  /** JS が動かない環境で出るラベル。**どちらへ切り替わるかを言わない。** */
  readonly toggleTheme: string;
  readonly switchToLight: string;
  readonly switchToDark: string;
  readonly noPosts: string;
  /** 記事が 1 本も無いときだけ出す、管理画面への導線。 */
  readonly writeFirstPost: string;
  readonly noPostsInTag: string;
  readonly draft: string;
  readonly updatedPrefix: string;
  readonly newer: string;
  readonly older: string;
  readonly notFoundTitle: string;
  readonly notFoundBody: string;
  readonly backToIndex: string;
  /** 一覧の 2 ページ目以降。題に入れて検索結果で見分けが付くようにする。 */
  readonly page: (n: number) => string;
  readonly tagPage: (tag: string) => string;
};

const en: Text = {
  rss: 'RSS',
  admin: 'Admin',
  editThisPost: 'Edit this post',
  toggleTheme: 'Toggle theme',
  switchToLight: 'Switch to light theme',
  switchToDark: 'Switch to dark theme',
  noPosts: 'No posts yet.',
  writeFirstPost: 'Write the first one',
  noPostsInTag: 'No posts with this tag yet.',
  draft: 'draft',
  updatedPrefix: 'Updated ',
  newer: '← Newer',
  older: 'Older →',
  notFoundTitle: 'Not found',
  notFoundBody: 'That page does not exist.',
  backToIndex: 'Back to all posts',
  page: (n) => `Page ${n}`,
  tagPage: (tag) => `Posts tagged “${tag}”`,
};

const ja: Text = {
  rss: 'RSS',
  admin: '管理',
  editThisPost: 'この記事を編集',
  toggleTheme: 'テーマを切り替える',
  switchToLight: '明るいテーマにする',
  switchToDark: '暗いテーマにする',
  noPosts: 'まだ記事がありません。',
  writeFirstPost: '最初の 1 本を書く',
  noPostsInTag: 'このタグの記事はまだありません。',
  draft: '下書き',
  updatedPrefix: '更新 ',
  newer: '← 新しい',
  older: '古い →',
  notFoundTitle: 'ページがありません',
  notFoundBody: 'そのページは存在しません。',
  backToIndex: '記事の一覧へ',
  page: (n) => `${n} ページ目`,
  tagPage: (tag) => `タグ「${tag}」の記事`,
};

const TABLES: Record<Locale, Text> = { en, ja };

export function textFor(locale: Locale): Text {
  return TABLES[locale];
}

/** 設定から表を選ぶ。**どの言語になるかの規則は `core/locale.ts` が持つ。** */
export function textForSite(site: SiteConfig): Text {
  return textFor(siteLocale(site));
}

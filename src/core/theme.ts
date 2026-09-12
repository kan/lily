/**
 * テーマが実装する型。**core は配信するページの HTML を 1 バイトも持たない。**
 * （例外はログイン画面 1 枚。`core/auth/login-page.ts` に理由がある。）
 *
 * レイアウト・CSS・文言・パンくず・OGP はすべてテーマ側の持ち物で、core が
 * 渡すのはページに出すデータだけ。lily を切り出したときに、このインターフェース
 * だけを満たせば別の見た目に差し替えられる。
 */
import type { SiteConfig } from './config.ts';
import type { Urls } from './paths.ts';

export type TagView = {
  readonly name: string;
  readonly slug: string;
  readonly url: string;
};

export type PostSummaryView = {
  readonly title: string;
  readonly description: string | null;
  /** 公開日。下書きは null。 */
  readonly publishedAt: Date | null;
  readonly updatedAt: Date;
  /** canonical path から組んだ URL。 */
  readonly url: string;
  readonly tags: readonly TagView[];
  readonly isDraft: boolean;
};

/**
 * OGP に出す絵。**完成した絶対 URL**をテーマに渡す（media の URL の組み方を
 * テーマに知らせない。`adminUrl` と同じ理由）。
 */
export type ImageView = {
  readonly url: string;
  /** 分かっていれば実寸。ヘッダから読めなかった添付は null。 */
  readonly width: number | null;
  readonly height: number | null;
};

/** 記事ページ。`html` は placeholder を解決済みの、そのまま出せる HTML。 */
export type PostView = PostSummaryView & {
  readonly html: string;
  /**
   * この記事の代表画像。**選ばれていなければ null** で、そのときテーマは
   * サイト共通の絵を出す（どれを共通にするかはテーマの持ち物）。
   */
  readonly image: ImageView | null;
  /**
   * 管理画面でこの記事を開く URL。**組むのは core**（`urls.adminPost()`）で、
   * テーマは出すかどうかだけを決める。
   *
   * identity ではなく完成した URL を渡すのは、テーマに「管理画面のハッシュの形」を
   * 知らせないため。別のテーマに差し替えても、同じ機能をそのまま作れる。
   */
  readonly adminUrl: string;
};

export type PageContext = {
  readonly site: SiteConfig;
  readonly urls: Urls;
  /**
   * このページの正規 URL (絶対)。**404 とプレビューのように、それ自身の URL を
   * 持たない / 持たせたくないページは null。** テーマはそのとき canonical と
   * `og:url` を出さず、`noindex` を出す。
   */
  readonly canonicalUrl: string | null;
};

/**
 * ページを組むのは非同期でよい。テンプレートエンジンによっては (hono/html も)
 * 値に Promise が混ざると Promise を返すので、同期に固定すると呼び出し側で
 * 静かに `[object Promise]` を出す事故が起きうる。
 */
/**
 * 一覧のページ送り。**1 ページ目でも渡す**（総ページ数が 1 なら出さないのは
 * テーマの判断）。
 */
export type Pagination = {
  readonly page: number;
  readonly totalPages: number;
  /** 前後のページ。無ければ null。 */
  readonly prevUrl: string | null;
  readonly nextUrl: string | null;
};

export interface Theme {
  /** 配信する 1 本のスタイルシート。 */
  readonly stylesheet: string;
  index(
    context: PageContext,
    posts: readonly PostSummaryView[],
    pagination: Pagination,
  ): Promise<string>;
  post(context: PageContext, post: PostView): Promise<string>;
  tag(
    context: PageContext,
    tag: TagView,
    posts: readonly PostSummaryView[],
    pagination: Pagination,
  ): Promise<string>;
  notFound(context: PageContext): Promise<string>;
}

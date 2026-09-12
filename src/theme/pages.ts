/**
 * 標準テーマの各ページの中身。外枠は `layout.ts`。
 */
import { html, raw } from 'hono/html';
import type { HtmlEscapedString } from 'hono/utils/html';
import type { SiteConfig } from '../core/config.ts';
import { createDateFormat, type DateFormat } from '../core/date.ts';
import type {
  PageContext,
  Pagination,
  PostSummaryView,
  PostView,
  TagView,
} from '../core/theme.ts';
import { layout } from './layout.ts';
import { TEXT } from './text.ts';

/**
 * `html` は値に Promise が混ざると Promise を返す。組み立ての途中では
 * どちらもありうるので、この別名で受けて最後に `layout` が await する。
 */
type Html = HtmlEscapedString | Promise<HtmlEscapedString>;

type Format = { readonly parts: DateFormat; readonly display: Intl.DateTimeFormat };

/**
 * 日付の組み立て。**設定 1 つにつき 1 度だけ作る。**
 *
 * `Intl.DateTimeFormat` の構築は安くないので、リクエストごとに作らない。
 * `PageContext.site` は `createLily()` に渡した設定そのもの（リクエストごとに
 * 組み直されない）なので、**設定オブジェクトの同一性をそのままキーにできる**。
 * 値から文字列のキーを作ると、区切り文字が両方の値に現れないことを別途
 * 保証しないといけない。
 */
const formats = new WeakMap<SiteConfig, Format>();

function dateFormat(site: SiteConfig): Format {
  let format = formats.get(site);
  if (!format) {
    format = {
      parts: createDateFormat(site.timeZone),
      // **読み手向けの日付は `lang` で組む。** `<time datetime>` は ISO 8601 の
      // ままなので、機械が読む側はこの表示形式に左右されない。
      display: displayFormat(site),
    };
    formats.set(site, format);
  }
  return format;
}

/**
 * 読み手向けの日付の書式。**読めない `lang` でページを落とさない。**
 *
 * `Intl.DateTimeFormat` は不正な言語タグ (`en_US` のようにアンダースコアで
 * 書いたもの) で throw する。`lang` は deployment の設定で、他の場所では
 * `<html lang>` に出るだけで黙って劣化するのに、ここだけ**日付のある全ページが
 * 500 になる**のは釣り合わない。実行環境の既定に落として警告を出す。
 */
function displayFormat(site: SiteConfig): Intl.DateTimeFormat {
  const options: Intl.DateTimeFormatOptions = { timeZone: site.timeZone, dateStyle: 'medium' };
  try {
    return new Intl.DateTimeFormat(site.lang, options);
  } catch {
    console.warn(`lily theme: lang を読めないので既定の言語で日付を組む (${site.lang})`);
    return new Intl.DateTimeFormat(undefined, options);
  }
}

/**
 * 日付。**`label` は `<time>` の外に置く。** 中に入れると `datetime` 属性と
 * 食い違ううえ、テキストでの突き合わせも壊れる。
 */
function postDate(site: SiteConfig, date: Date, label?: string): Html {
  const { parts, display } = dateFormat(site);
  return html`<span class="post-date"
    >${label}<time datetime="${parts.isoDate(date)}">${display.format(date)}</time></span
  >`;
}

/**
 * 「更新」を出すか。**表示が日付までなので、比較も日付で行う。**
 * 素の時刻で比べると、作成と公開が別クエリなぶん数 ms ずれるだけで
 * 出したての記事に「更新」が付く。
 */
function isUpdated(site: SiteConfig, publishedAt: Date, updatedAt: Date): boolean {
  const { parts } = dateFormat(site);
  return parts.isoDate(updatedAt) > parts.isoDate(publishedAt);
}

function tagChips(tags: readonly TagView[]): Html[] {
  return tags.map((tag) => html`<a class="tag" href="${tag.url}">${tag.name}</a>`);
}

function postMeta(
  site: SiteConfig,
  post: PostSummaryView,
  options: { updated?: boolean } = {},
): Html {
  return html`<div class="post-meta">
    ${post.publishedAt ? postDate(site, post.publishedAt) : ''}
    ${options.updated && post.publishedAt && isUpdated(site, post.publishedAt, post.updatedAt)
      ? postDate(site, post.updatedAt, TEXT.updatedPrefix)
      : ''}
    ${tagChips(post.tags)} ${post.isDraft ? html`<span class="tag">${TEXT.draft}</span>` : ''}
  </div>`;
}

/** 記事の一覧。**0 件のときは呼ばない**（空の `ul` に余白だけが残る）。 */
function postList(site: SiteConfig, posts: readonly PostSummaryView[]): Html {
  return html`<ul class="post-list">
    ${posts.map(
      (post) => html`<li>
        ${postMeta(site, post)}
        <h2><a href="${post.url}">${post.title}</a></h2>
        ${post.description ? html`<p class="post-summary">${post.description}</p>` : ''}
      </li>`,
    )}
  </ul>`;
}

/** ページ送り。1 ページしか無ければ何も出さない。 */
function pager(pagination: Pagination): Html | '' {
  if (pagination.totalPages <= 1) return '';
  return html`<nav class="pager">
    ${pagination.prevUrl ? html`<a rel="prev" href="${pagination.prevUrl}">${TEXT.newer}</a>` : ''}
    <span class="muted">${pagination.page} / ${pagination.totalPages}</span>
    ${pagination.nextUrl ? html`<a rel="next" href="${pagination.nextUrl}">${TEXT.older}</a>` : ''}
  </nav>`;
}

export function indexPage(
  context: PageContext,
  posts: readonly PostSummaryView[],
  pagination: Pagination,
): Promise<string> {
  return layout(
    context,
    {
      // 2 ページ目以降はページ番号を題に入れる。同じ題が並ぶと検索結果で見分けが付かない。
      page: pagination.page > 1 ? TEXT.page(pagination.page) : undefined,
      brandIsHeading: pagination.page === 1,
      pagination,
    },
    // **0 件のときは一覧そのものを出さない。** 空の `ul` にも余白が付くので、
    // 文言の下に理由の分からない隙間が残る（記事が 1 本も無いのは、標準テーマが
    // 一番よく見られる状態）。
    html`${posts.length === 0
      ? html`<p class="post-summary">${TEXT.noPosts}</p>`
      : postList(context.site, posts)}
    ${pager(pagination)}`,
  );
}

export function postPage(context: PageContext, post: PostView): Promise<string> {
  return layout(
    context,
    {
      page: post.title,
      description: post.description ?? undefined,
      ogType: 'article',
      // 添付から選ばれていればその絵。無ければ共通の 1 枚に落ちる。
      image: post.image,
      adminUrl: post.adminUrl,
    },
    html`<article>
      ${postMeta(context.site, post, { updated: true })}
      <h1 class="post-title">${post.title}</h1>
      <!-- 本文は描画済みの HTML。placeholder は配信 URL に解決済み。 -->
      <div class="prose">${raw(post.html)}</div>
    </article>`,
  );
}

export function tagPage(
  context: PageContext,
  tag: TagView,
  posts: readonly PostSummaryView[],
  pagination: Pagination,
): Promise<string> {
  const label = TEXT.tagPage(tag.name);
  const page = pagination.page > 1 ? `${label} — ${TEXT.page(pagination.page)}` : label;
  return layout(
    context,
    { page, pagination },
    html`<h1 class="post-title">${tag.name}</h1>
      ${posts.length === 0
        ? html`<p class="post-summary">${TEXT.noPostsInTag}</p>`
        : postList(context.site, posts)}
      ${pager(pagination)}`,
  );
}

export function notFoundPage(context: PageContext): Promise<string> {
  return layout(
    context,
    { page: TEXT.notFoundTitle },
    html`<h1>404</h1>
      <p class="post-summary">${TEXT.notFoundBody}</p>
      <p><a href="${context.urls.index()}">${TEXT.backToIndex}</a></p>`,
  );
}

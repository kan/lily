/**
 * 標準テーマのページの外枠。
 *
 * **サイト固有の値は 1 つも持たない。** 名前・説明・言語・OGP の絵は
 * `PageContext.site`（= `SiteConfig`）から出る。URL を組むのは core
 * (`context.urls`) で、テーマは mount がどこかを知らない。
 */
import { html, raw } from 'hono/html';
import type { HtmlEscapedString } from 'hono/utils/html';
import { ADMIN_LINK_CLASS, ADMIN_LINK_SCRIPT } from '../core/admin-contract.ts';
import type { SiteConfig } from '../core/config.ts';
import type { ImageView, PageContext, Pagination } from '../core/theme.ts';
import { THEME_INIT, THEME_TOGGLE } from './client.ts';
import { TEXT } from './text.ts';

export type LayoutOptions = {
  /** ページ名。トップは省略してサイト名だけにする。 */
  readonly page?: string;
  readonly description?: string;
  readonly ogType?: 'website' | 'article';
  /**
   * サイト名を `h1` で出すか。一覧ではサイト名がそのままページの見出しになるが、
   * 記事ページでは `h1` は記事タイトルのものなので段落に落とす。
   */
  readonly brandIsHeading?: boolean;
  /** 一覧のページ送り。前後のページを `<link rel>` で示すのに使う。 */
  readonly pagination?: Pagination;
  /** OGP に出す絵。**省略するとサイト共通の 1 枚**（記事だけが指定する）。 */
  readonly image?: ImageView | null;
  /**
   * 管理画面のリンクの行き先。省略すると管理画面のトップに向く。
   * **リンク自体は常に出て、hidden 属性で隠してある。**
   */
  readonly adminUrl?: string;
};

/** トップはサイト名だけ、下層は「ページ名 | サイト名」。 */
export function pageTitle(siteName: string, page?: string): string {
  return page ? `${page} | ${siteName}` : siteName;
}

/**
 * OGP の絵。**記事が選んでいなければサイト共通の 1 枚**（`site.ogImage`）。
 *
 * 寸法は**分かっているときだけ**書く。添付はヘッダから読めないことがあり
 * （`media/dimensions.ts`）、共通の絵の寸法を当てると嘘になる。
 */
function ogImage(site: SiteConfig, image: ImageView | null) {
  const chosen: ImageView = image ?? site.ogImage;
  return html`<meta property="og:image" content="${chosen.url}" />
    ${chosen.width === null || chosen.height === null
      ? ''
      : html`<meta property="og:image:width" content="${chosen.width}" />
          <meta property="og:image:height" content="${chosen.height}" />`}`;
}

export async function layout(
  context: PageContext,
  options: LayoutOptions,
  body: HtmlEscapedString | Promise<HtmlEscapedString>,
): Promise<string> {
  const { site, urls, canonicalUrl } = context;
  const title = pageTitle(site.name, options.page);
  const description = options.description ?? site.description;
  const brand = options.brandIsHeading ? 'h1' : 'p';
  // 記事ページからは編集画面へ直行する (URL は core が組む)。
  const adminUrl = options.adminUrl ?? urls.admin();

  return String(await html`<!doctype html>
<html lang="${site.lang}">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="color-scheme" content="light dark" />
    <title>${title}</title>
    <meta name="description" content="${description}" />
    ${canonicalUrl === null
      ? // 404 とプレビューに canonical / og:url を出さない。実在ページとして
        // クローラに拾わせないため。
        html`<meta name="robots" content="noindex" />`
      : html`<link rel="canonical" href="${canonicalUrl}" />`}

    <script>
      ${raw(THEME_INIT)}
    </script>

    <link rel="stylesheet" href="${urls.stylesheet()}" />
    <!-- タブのアイコン。設定にあるときだけ出す (何を配るかは PageConfig.assets
         次第なので、テーマがファイル名を決め打ちすると存在しない URL を指す)。 -->
    ${site.favicon ? html`<link rel="icon" href="${site.favicon}" />` : ''}

    <!-- 前後のページを示す。一覧が分かれていることをクローラに伝えるため。 -->
    ${options.pagination?.prevUrl
      ? html`<link rel="prev" href="${options.pagination.prevUrl}" />`
      : ''}
    ${options.pagination?.nextUrl
      ? html`<link rel="next" href="${options.pagination.nextUrl}" />`
      : ''}

    <link rel="alternate" type="application/rss+xml" title="${site.name}" href="${urls.feed('rss')}" />

    <meta property="og:title" content="${title}" />
    <meta property="og:description" content="${description}" />
    <meta property="og:type" content="${options.ogType ?? 'website'}" />
    <meta property="og:site_name" content="${site.name}" />
    ${canonicalUrl === null ? '' : html`<meta property="og:url" content="${canonicalUrl}" />`}
    ${ogImage(site, options.image ?? null)}
    <!-- カードの形だけ指定する。**どのアカウントのものかは示さない**
         (lily はサイトの SNS アカウントを知らないし、知る必要もない)。 -->
    <meta name="twitter:card" content="summary_large_image" />
  </head>
  <body>
    <div class="wrap">
      <header class="site-header">
        <${brand} class="brand"><a href="${urls.index()}">${site.name}</a></${brand}>
        <nav>
          <a href="${urls.feed('rss')}">${TEXT.rss}</a>
          <!-- 管理画面へのリンク。**全員に同じ HTML を配り**、管理画面を開いた
               ことがある端末でだけ client.ts が hidden 属性を外す。訪問者ごとに
               HTML を変えると、共有キャッシュに載ったそれが読者に配られる。 -->
          <a class="${ADMIN_LINK_CLASS}" href="${adminUrl}" rel="nofollow" hidden
            >${options.adminUrl ? TEXT.editThisPost : TEXT.admin}</a
          >
          <!-- ラベルは属性で持たせる。**文言をスクリプトの中に書かない**ので、
               テーマを写して訳すときに触るのはこのファイルだけで済む。
               読み込み後に client.ts が方向つきラベルへ差し替える
               (JS が動かない環境では下の中立な文言のまま)。 -->
          <button
            class="theme-toggle"
            type="button"
            aria-label="${TEXT.toggleTheme}"
            data-label-light="${TEXT.switchToLight}"
            data-label-dark="${TEXT.switchToDark}"
          >
            ${raw(MOON_ICON)}${raw(SUN_ICON)}
          </button>
        </nav>
      </header>

      <main>${body}</main>

      <footer class="site-footer">
        <p>&copy; ${site.author}</p>
      </footer>
    </div>

    <script>
      ${raw(THEME_TOGGLE)}
      ${raw(ADMIN_LINK_SCRIPT)}
    </script>
  </body>
</html>
`);
}

// アイコンは両方置いて CSS で出し分ける。サーバー側では訪問者のテーマが
// 分からないので、JS で差し込むと一瞬まちがった方が見える。
const MOON_ICON = `<svg class="icon-moon" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>`;
const SUN_ICON = `<svg class="icon-sun" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>`;

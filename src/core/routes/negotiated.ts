/**
 * HTML と Markdown を出し分ける公開ページの応答。**ヘッダの決め方をここに集める。**
 *
 * 一覧・タグ・記事・404 の 4 か所が同じ形で返すので、`Vary` や `Link` を 1 か所で
 * 付け忘れると、その種類のページだけキャッシュに取り違えられる。
 */
import type { Context } from 'hono';
import { apiCatalogLink } from '../agent/discovery.ts';
import { pageFormat, type PageFormat } from '../agent/negotiate.ts';
import type { Urls } from '../paths.ts';
import { MARKDOWN, SHORT_EDGE } from './cache.ts';

/** リクエストの `Accept` から、返す形を選ぶ。 */
export function requestFormat(c: Context): PageFormat {
  return pageFormat(c.req.header('Accept'));
}

const FORMATS = {
  html: { type: 'text/html; charset=UTF-8', cache: SHORT_EDGE, other: 'text/markdown' },
  markdown: { type: 'text/markdown; charset=utf-8', cache: MARKDOWN, other: 'text/html' },
} as const satisfies Record<PageFormat, { type: string; cache: string; other: string }>;

export type PageResponse = (
  format: PageFormat,
  body: string,
  options: {
    /** このページの絶対 URL。404 は null（それ自身の URL を持たせない。`canonicalUrl` と同じ）。 */
    readonly self: string | null;
    readonly status?: number;
  },
) => Response;

/**
 * 応答を組む関数を作る。
 *
 * - **HTML にも Markdown にも `Vary: Accept` を付ける。** 片方だけに付けると、付いて
 *   いない方が「内容交渉していない応答」としてキャッシュに収まる
 * - `Link` ヘッダ（RFC 8288）で、エージェントが HTML を読まずにほかの形と一覧の在りかを
 *   見つけられるようにする。`self` があれば**同じ URL の別の形**を `rel="alternate"` で
 *   示し（URL は変えず、`Accept` で選ぶため）、サイトマップとフィード（RSS）と
 *   API Catalog（RFC 9727 の `rel="api-catalog"`。検索や MCP の在りか）はどの
 *   ページにも付ける
 */
export function createPageResponse(urls: Urls): PageResponse {
  const shared = [
    `<${urls.sitemap({ absolute: true })}>; rel="sitemap"; type="application/xml"`,
    `<${urls.feed('rss', { absolute: true })}>; rel="alternate"; type="application/rss+xml"`,
    apiCatalogLink(urls),
  ];

  return (format, body, { self, status = 200 }) => {
    const { type, cache, other } = FORMATS[format];
    const links = self === null ? shared : [`<${self}>; rel="alternate"; type="${other}"`, ...shared];
    return new Response(body, {
      status,
      headers: {
        'Content-Type': type,
        'Cache-Control': cache,
        Vary: 'Accept',
        Link: links.join(', '),
      },
    });
  };
}

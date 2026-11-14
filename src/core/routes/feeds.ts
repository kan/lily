/**
 * 機械向けの出力: フィード・サイトマップ・静的アセット。
 *
 * 人が読むページは `public.ts`。分けてあるのは、こちらが**テーマを一切通らない**
 * ため (見た目の差し替えでフィードの形が変わってはいけない)。
 */
import { Hono } from 'hono';
import { agentFeatures, type LilyBindings, type PageConfig } from '../config.ts';
import { listMediaByPosts } from '../db/media.ts';
import { getPublishedPosts } from '../db/posts.ts';
import { listPublishedTags } from '../db/tags.ts';
import type { PostWithPathRow } from '../db/types.ts';
import { storedOrRenderedHtml } from '../delivery.ts';
import { buildAtom, buildRss, type FeedEntry } from '../feed/index.ts';
import { toFeedHtml } from '../feed/html.ts';
import { createPaths, type Urls } from '../paths.ts';
import { postJsonEntries } from '../post-json.ts';
import type { RenderMedia } from '../render/index.ts';
import { resolveMediaUrls } from '../render/placeholder.ts';
import { searchErrorMessage, searchPosts } from '../search.ts';
import { buildSitemap, buildSitemapIndex } from '../sitemap.ts';
import { postDescription } from '../summary.ts';
import { groupByPost } from '../view.ts';
import { LONG_EDGE, SHORT_EDGE } from './cache.ts';

type Env = { Bindings: LilyBindings };

/**
 * フィードに載せる件数。**全文を配るので、全件だと際限なく重くなる。**
 * 購読者のリーダーが持つのは新しいものだけでよい。
 */
const FEED_LIMIT = 50;

/** `posts.json` の既定と上限。本体サイトの `/api/blog` と同じ考え方。 */
const POSTS_JSON_DEFAULT = 5;
const POSTS_JSON_MAX = 20;

export function feedRoutes(config: PageConfig): Hono<Env> {
  const app = new Hono<Env>();
  const { urls, assets } = createPaths(config);
  const mount = urls.mountPath;

  const xml = (body: string, cache = SHORT_EDGE): Response =>
    new Response(body, {
      headers: { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': cache },
    });

  app.get(urls.feed('rss'), async (c) =>
    xml(buildRss(config.site, urls, await feedEntries(c.env.DB, urls))),
  );

  app.get(urls.feed('atom'), async (c) =>
    xml(buildAtom(config.site, urls, await feedEntries(c.env.DB, urls))),
  );

  app.get(urls.sitemap(), () =>
    xml(buildSitemapIndex(urls.sitemapUrls({ absolute: true })), LONG_EDGE),
  );

  app.get(urls.sitemapUrls(), async (c) => {
    const db = c.env.DB;
    const [posts, tags] = await Promise.all([getPublishedPosts(db), listPublishedTags(db)]);

    return xml(
      buildSitemap([
        { url: urls.index({ absolute: true }) },
        ...posts.map((post) => ({
          url: urls.post(post.canonical_path, { absolute: true }),
          lastModified: new Date(post.updated_at),
        })),
        // 公開記事が付いているタグだけ。0 件のタグページを索引に出しても意味がない。
        ...tags.map((tag) => ({ url: urls.tag(tag, { absolute: true }) })),
      ]),
    );
  });

  /**
   * 本体サイトの Blog 付箋が読む口。**機械可読の供給と読者向けの配信を分ける。**
   *
   * これが無いあいだ、本体は RSS を正規表現で解析していた。生成側が CDATA を
   * 吐いた瞬間に壊れる結合なので、こちらを正式な出力にして本体を移す。
   * 公開・認証不要。
   */
  app.get(urls.postsJson(), async (c) => {
    const db = c.env.DB;
    const limit = clampLimit(c.req.query('limit'));
    const posts = await getPublishedPosts(db, { limit });

    return Response.json(
      { posts: await postJsonEntries(db, urls, posts) },
      { headers: { 'Cache-Control': SHORT_EDGE } },
    );
  });

  /**
   * 公開記事の全文検索。**認証不要・読み取りだけ**（issue #65）。
   *
   * 1 件の形は `posts.json` と同じ。本文は返さない。記事の `url` を
   * `Accept: text/markdown` で取れば Markdown 版が返る（`routes/negotiated.ts`）。
   *
   * 続きがあるときだけ `next` に次のページの絶対 URL を入れる。上限と続きの判定は
   * `core/search.ts` が持つ（MCP と同じ規則にするため）。
   *
   * `PageConfig.search` が false なら張らない（予約語なので、記事にも当たらず 404）。
   */
  if (agentFeatures(config).search) app.get(urls.search(), async (c) => {
    const db = c.env.DB;
    const result = await searchPosts(db, {
      q: c.req.query('q'),
      limit: Number(c.req.query('limit')),
      offset: Number(c.req.query('offset')),
    });
    if (!result.ok) {
      return Response.json(
        // 機械が読む `error` と、人が読む `message` を分ける。
        {
          error: result.error,
          message: searchErrorMessage(result.error, { query: '?q=', offset: '?offset=' }),
        },
        { status: 400, headers: { 'Cache-Control': SHORT_EDGE } },
      );
    }

    const { query, posts, limit, nextOffset } = result.value;
    let next: string | null = null;
    if (nextOffset !== null) {
      const url = new URL(urls.search({ absolute: true }));
      url.searchParams.set('q', query);
      url.searchParams.set('limit', String(limit));
      url.searchParams.set('offset', String(nextOffset));
      next = url.href;
    }

    return Response.json(
      { query, posts: await postJsonEntries(db, urls, posts), next },
      { headers: { 'Cache-Control': SHORT_EDGE } },
    );
  });

  // deployment が配ると決めた静的アセット (`PageConfig.assets`)。実体は
  // `ASSETS` バインディングの root 直下にあるので、`<mount>/favicon.svg` への
  // 要求はそこへ読み替えて出す。**名前は `createPaths()` が予約もしている。**
  for (const name of assets) {
    app.get(`${mount}/${name}`, (c) => c.env.ASSETS.fetch(new URL(`/${name}`, c.req.url)));
  }

  return app;
}

/**
 * `?limit=` を丸める。**読めない値は既定に落とす。**
 * 上限を超える要求で全件返すと、増えたぶんだけ本体サイトが重くなる。
 */
function clampLimit(raw: string | undefined): number {
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) return POSTS_JSON_DEFAULT;
  return Math.min(value, POSTS_JSON_MAX);
}

/**
 * フィードに載せる記事。
 *
 * 本文は記事ページと同じ HTML を使い、media の placeholder を**絶対 URL**で
 * 解決してから `toFeedHtml` に通す (リーダーは記事の URL を起点に相対 URL を
 * 解決してくれない)。
 */
async function feedEntries(db: D1Database, urls: Urls): Promise<FeedEntry[]> {
  const posts = await getPublishedPosts(db, { limit: FEED_LIMIT });
  const mediaByPost = await loadMediaFor(db, posts);

  return await Promise.all(
    posts.map(async (post) => {
      const url = urls.post(post.canonical_path, { absolute: true });
      const stored = await storedOrRenderedHtml(post, async () => mediaByPost.get(post.id) ?? []);
      return {
        publicId: post.public_id,
        title: post.title,
        description: postDescription(post),
        url,
        // 公開記事なので published_at は必ずある (DB の CHECK)。
        publishedAt: new Date(post.published_at as string),
        updatedAt: new Date(post.updated_at),
        html: toFeedHtml(resolveMediaUrls(stored, urls, { absolute: true }), url),
      };
    }),
  );
}

/**
 * `body_html` がまだ無い記事のぶんだけ添付をまとめて引く。
 * 全部そろっていれば問い合わせない。
 */
async function loadMediaFor(
  db: D1Database,
  posts: readonly PostWithPathRow[],
): Promise<Map<number, RenderMedia[]>> {
  const needsRender = posts.filter((post) => post.body_html === null).map((post) => post.id);
  return groupByPost(await listMediaByPosts(db, needsRender));
}

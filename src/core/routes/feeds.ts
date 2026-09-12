/**
 * 機械向けの出力: フィード・サイトマップ・静的アセット。
 *
 * 人が読むページは `public.ts`。分けてあるのは、こちらが**テーマを一切通らない**
 * ため (見た目の差し替えでフィードの形が変わってはいけない)。
 */
import { Hono } from 'hono';
import type { LilyBindings, PageConfig } from '../config.ts';
import { listMediaByPosts } from '../db/media.ts';
import { getPublishedPosts } from '../db/posts.ts';
import { getTagsForPosts, listTagsWithCounts } from '../db/tags.ts';
import type { PostWithPathRow } from '../db/types.ts';
import { storedOrRenderedHtml } from '../delivery.ts';
import { buildAtom, buildRss, type FeedEntry } from '../feed/index.ts';
import { toFeedHtml } from '../feed/html.ts';
import { createPaths, type Urls } from '../paths.ts';
import type { RenderMedia } from '../render/index.ts';
import { resolveMediaUrls } from '../render/placeholder.ts';
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
    const [posts, tags] = await Promise.all([getPublishedPosts(db), listTagsWithCounts(db)]);

    return xml(
      buildSitemap([
        { url: urls.index({ absolute: true }) },
        ...posts.map((post) => ({
          url: urls.post(post.canonical_path, { absolute: true }),
          lastModified: new Date(post.updated_at),
        })),
        // 公開記事が付いているタグだけ。0 件のタグページを索引に出しても意味がない。
        ...tags
          .filter((tag) => tag.post_count > 0)
          .map((tag) => ({ url: urls.tag(tag, { absolute: true }) })),
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
    const tags = groupByPost(await getTagsForPosts(db, posts.map((post) => post.id)));

    return Response.json(
      {
        posts: posts.map((post) => ({
          id: post.public_id,
          title: post.title,
          // canonical の絶対 URL。読む側が組み立て直さずに済む。
          url: urls.post(post.canonical_path, { absolute: true }),
          // 公開記事なので published_at は必ずある (DB の CHECK)。
          published_at: post.published_at as string,
          description: postDescription(post),
          tags: (tags.get(post.id) ?? []).map((tag) => tag.name),
        })),
      },
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

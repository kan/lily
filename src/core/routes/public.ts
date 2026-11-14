/**
 * 公開側のルータ。**URL の形も予約も `core/paths.ts` の `createPaths()` が決める。**
 *
 * ここが持つのは「どのデータをどのテーマ関数に渡すか」と、308 の張り方だけ。
 */
import { Hono, type Context } from 'hono';
import { blogJsonLd, postJsonLd, tagJsonLd } from '../agent/json-ld.ts';
import { createMarkdownPages } from '../agent/markdown.ts';
import { publishedPostMarkdown } from '../agent/post-markdown.ts';
import { webMcpScript } from '../agent/webmcp.ts';
import { agentFeatures, type LilyBindings, type PageConfig } from '../config.ts';
import { getCanonicalPath, resolvePublishedPost } from '../db/post-paths.ts';
import {
  countPublishedPosts,
  countPublishedPostsByTagSlug,
  getPostByPreviewTokenHash,
  getPublishedPosts,
  getPublishedPostsByTagSlug,
} from '../db/posts.ts';
import { getOgpMedia, listMediaByPost } from '../db/media.ts';
import { storedOrRenderedHtml } from '../delivery.ts';
import { getTagBySlug, getTagsForPost, getTagsForPosts } from '../db/tags.ts';
import { createPaths } from '../paths.ts';
import { renderMarkdown } from '../render/index.ts';
import { resolveMediaUrls } from '../render/placeholder.ts';
import type { PageContext, Pagination } from '../theme.ts';
import { hashPreviewToken } from '../tokens.ts';
import { groupByPost, toPostSummary, toPostView, toTagView } from '../view.ts';
import { fixedResponse, NO_STORE, LONG_EDGE } from './cache.ts';
import { ROUTE } from './fixed.ts';
import { createPageResponse, requestFormat } from './negotiated.ts';
import { createNotFound } from './not-found.ts';

type Env = { Bindings: LilyBindings };

export function publicRoutes(config: PageConfig): Hono<Env> {
  const app = new Hono<Env>();
  const paths = createPaths(config);
  const { urls } = paths;
  const mount = urls.mountPath;
  const { theme } = config;
  // 中身が変わるのはデプロイのときだけなので、ETag は起動時に 1 度だけ組む。
  const stylesheet = fixedResponse(theme.stylesheet, {
    'Content-Type': 'text/css; charset=utf-8',
    'Cache-Control': LONG_EDGE,
  });

  /**
   * 308 の飛び先。**クエリ文字列を落とさない。**
   *
   * 計測パラメータ付きの共有リンク (`?utm_source=…`) は末尾スラッシュ補正に
   * 引っかかりやすく、ここで落とすと計測が丸ごと消える (本体側で同種の事故を
   * 踏んでいる)。
   */
  const redirectTo = (path: string, requestUrl: string): string =>
    `${path}${new URL(requestUrl).search}`;

  // WebMCP の登録も設定だけで決まる。それ自身の URL を持つページにだけ置く
  // （プレビューは下書きを見るためのページなので、道具を出さない）。
  const webMcp = webMcpScript(urls, agentFeatures(config));
  const context = (canonicalUrl: string | null, jsonLd: string | null): PageContext => ({
    site: config.site,
    urls,
    canonicalUrl,
    jsonLd,
    webMcp: canonicalUrl === null ? null : webMcp,
  });

  // 404 は `Accept` を自分で読む。**記事・一覧・タグ・404 が HTML と Markdown を
  // 出し分ける。** 下書きプレビューは HTML だけ（保存直後の見た目を確かめるページなので）。
  const notFound = createNotFound(config);
  const respond = createPageResponse(urls);
  const markdown = createMarkdownPages(config.site);
  // トップの JSON-LD は設定だけで決まるので、1 度だけ組む。
  const blogLd = blogJsonLd(config.site, urls);

  // マウント直下のスラッシュ無し。`/blog` → `/blog/`
  if (mount !== '') {
    app.get(mount, (c) => c.redirect(redirectTo(urls.index(), c.req.url), 308));
  }

  /**
   * 一覧を組む。`page` は 2 ページ目以降だけ URL に出る。
   *
   * **Markdown 版はページ送りと記事の URL を絶対で組む**（HTML は相対のまま）。
   */
  const indexPage = async (c: Context<Env>, page: number): Promise<Response> => {
    const db = c.env.DB;
    const format = requestFormat(c);
    const absolute = format === 'markdown';
    const pages = await paginate(page, await countPublishedPosts(db), (n) =>
      urls.index({ page: n, absolute }),
    );
    if (pages === null) return await notFound(c);

    const posts = await getPublishedPosts(db, { limit: PER_PAGE, offset: (page - 1) * PER_PAGE });
    const tags = groupByPost(await getTagsForPosts(db, posts.map((p) => p.id)));
    const views = posts.map((p) => toPostSummary(urls, p, tags.get(p.id) ?? [], { absolute }));
    const self = urls.index({ page, absolute: true });

    const body =
      format === 'markdown'
        ? markdown.list(
            { title: config.site.name, description: config.site.description, url: self, pagination: pages },
            views,
          )
        : await theme.index(context(self, blogLd), views, pages);
    return respond(format, body, { self });
  };

  app.get(urls.index(), (c) => indexPage(c, 1));

  // **`/page/1/` は用意しない。** 1 ページ目は `/` なので、両方あると同じ中身が
  // 2 つの URL で出る。来たら canonical へ寄せる。
  app.get(`${mount}/${ROUTE.page}/:page/`, async (c) => {
    const page = pageNumber(c.req.param('page'));
    if (page === null) return await notFound(c);
    if (page === 1) return c.redirect(redirectTo(urls.index(), c.req.url), 308);
    return await indexPage(c, page);
  });

  app.get(`${mount}/${ROUTE.page}/:page`, (c) =>
    c.redirect(redirectTo(`${mount}/${ROUTE.page}/${c.req.param('page')}/`, c.req.url), 308),
  );

  app.get(urls.stylesheet(), (c) => stylesheet(c.req.header('If-None-Match')));

  app.get(`${mount}/${ROUTE.tags}/:slug`, (c) =>
    c.redirect(redirectTo(urls.tag({ slug: c.req.param('slug') }), c.req.url), 308),
  );

  const tagPage = async (c: Context<Env>, slug: string, page: number): Promise<Response> => {
    const db = c.env.DB;
    const tag = await getTagBySlug(db, slug);
    if (!tag) return await notFound(c);

    const format = requestFormat(c);
    const absolute = format === 'markdown';
    const total = await countPublishedPostsByTagSlug(db, slug);
    const pages = await paginate(page, total, (n) => urls.tag(tag, { page: n, absolute }));
    if (pages === null) return await notFound(c);

    const posts = await getPublishedPostsByTagSlug(db, slug, {
      limit: PER_PAGE,
      offset: (page - 1) * PER_PAGE,
    });
    const tags = groupByPost(await getTagsForPosts(db, posts.map((p) => p.id)));
    const views = posts.map((p) => toPostSummary(urls, p, tags.get(p.id) ?? [], { absolute }));
    const self = urls.tag(tag, { page, absolute: true });

    let body: string;
    if (format === 'markdown') {
      body = markdown.list({ title: tag.name, url: self, pagination: pages }, views);
    } else {
      const tagView = toTagView(urls, tag);
      const jsonLd = tagJsonLd(config.site, urls, tagView, self);
      body = await theme.tag(context(self, jsonLd), tagView, views, pages);
    }
    return respond(format, body, { self });
  };

  app.get(`${mount}/${ROUTE.tags}/:slug/`, (c) => tagPage(c, c.req.param('slug'), 1));

  app.get(`${mount}/${ROUTE.tags}/:slug/${ROUTE.page}/:page/`, async (c) => {
    const slug = c.req.param('slug');
    const page = pageNumber(c.req.param('page'));
    if (page === null) return await notFound(c);
    if (page === 1) return c.redirect(redirectTo(urls.tag({ slug }), c.req.url), 308);
    return await tagPage(c, slug, page);
  });

  // 下書きプレビュー。**公開ページと同じ renderer を通す**が、毎回 body_md から
  // 描画してキャッシュしない (保存直後の姿を見るためのもの)。
  app.get(`${mount}/${ROUTE.preview}/:token`, async (c) => {
    const db = c.env.DB;
    const post = await getPostByPreviewTokenHash(db, await hashPreviewToken(c.req.param('token')));
    if (!post) return await notFound(c);

    const canonical = (await getCanonicalPath(db, post.id)) ?? post.public_id;
    // 保存済みの HTML は使わない。保存直後の姿を見るためのページなので、
    // 毎回 body_md から描き直す (キャッシュもしない)。
    const rendered = await renderMarkdown(post.body_md, {
      media: await listMediaByPost(db, post.id),
    });
    const html = resolveMediaUrls(rendered.html, urls);
    const [tags, ogp] = await Promise.all([getTagsForPost(db, post.id), getOgpMedia(db, post.id)]);
    const view = toPostView(urls, post, canonical, tags, html, ogp);

    return c.html(await theme.post(context(null, null), view), 200, {
      'Cache-Control': NO_STORE,
      'X-Robots-Tag': 'noindex',
    });
  });

  app.get(`${mount}/*`, async (c) => {
    const db = c.env.DB;
    // ワイルドカードは名前付きパラメータとして取れないので、パスから直接切り出す。
    // この route は mount の下にしか当たらないはずで、null ならルータと `underMount`
    // の規則が食い違っている（黙って mount の root として読まない）。
    const requested = urls.underMount(c.req.path);
    if (requested === null) return await notFound(c);

    // 正規化と公開判定は `resolvePublishedPost`（MCP の `get_post` と同じ規則）。
    // 公開判定は 308 より先。後にすると、下書きのパスを当てられたときに
    // リダイレクトの有無で存在が分かってしまう。
    const resolved = await resolvePublishedPost(db, paths, requested);
    if (!resolved) return await notFound(c);

    // alias・大小文字違い・末尾スラッシュ無し・連続スラッシュ・エンコードの揺れを
    // まとめて canonical へ寄せる。**比較はリクエストのパスそのもの**で行う。
    // 正規化後の値だけを見ると、`//now/` のように正規化で消える差が残ってしまい、
    // 同じ記事が 2 つの URL で 200 を返す。飛び先は自分自身と一致するので、
    // 308 が繰り返すことはない。
    const canonicalPath = urls.post(resolved.canonical_path);
    if (c.req.path !== canonicalPath) {
      return c.redirect(redirectTo(canonicalPath, c.req.url), 308);
    }

    const format = requestFormat(c);
    const self = urls.post(resolved.canonical_path, { absolute: true });

    // **Markdown は原本（`body_md`）から返す**（MCP の `get_post` と同じもの）。
    if (format === 'markdown') {
      return respond(format, await publishedPostMarkdown(db, urls, markdown, resolved), { self });
    }

    const stored = await storedOrRenderedHtml(resolved, () => listMediaByPost(db, resolved.id));
    const html = resolveMediaUrls(stored, urls);
    const [tags, ogp] = await Promise.all([
      getTagsForPost(db, resolved.id),
      getOgpMedia(db, resolved.id),
    ]);
    const view = toPostView(urls, resolved, resolved.canonical_path, tags, html, ogp);
    const jsonLd = postJsonLd(config.site, urls, view, self);

    return respond(format, await theme.post(context(self, jsonLd), view), { self });
  });

  return app;
}

/** 一覧 1 ページの件数。 */
const PER_PAGE = 20;

/** `/page/<n>/` の n。数字でなければ null。 */
function pageNumber(raw: string | undefined): number | null {
  if (raw === undefined || !/^[1-9]\d*$/.test(raw)) return null;
  return Number(raw);
}

/**
 * ページ送りを組む。**範囲の外なら null**（呼び出し側が 404 にする）。
 *
 * 記事が 0 件でも 1 ページ目は有効。空の一覧は出したいが `/page/2/` は無い、
 * という形にする。
 */
async function paginate(
  page: number,
  total: number,
  urlFor: (page: number) => string,
): Promise<Pagination | null> {
  const totalPages = Math.max(1, Math.ceil(total / PER_PAGE));
  if (page > totalPages) return null;
  return {
    page,
    totalPages,
    prevUrl: page > 1 ? urlFor(page - 1) : null,
    nextUrl: page < totalPages ? urlFor(page + 1) : null,
  };
}

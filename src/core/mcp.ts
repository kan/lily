/**
 * MCP サーバ。**公開記事を読む道具だけを出す**（issue #65）。書き込みの道具は無いので、
 * 認証の無い入口が書き込みに届くことはない。
 *
 * 道具の中身は公開側と同じものを呼ぶ。検索は `core/search.ts`（規則も上限もそちら）、
 * 記事 1 件の形は `post-json.ts`、記事の解決は `resolvePublishedPost`、記事の Markdown は
 * `agent/post-markdown.ts`。道具ごとに写すと、`search.json` や公開ページと MCP で
 * 返るものが黙って食い違う。
 *
 * プロトコルは `@modelcontextprotocol/server` の `createMcpHandler` に任せる。
 * 2026-07-28 版と、それより前の版（initialize の握手がある）の両方を、要求ごとに
 * 作り直すサーバで受ける（stateless。セッションを持たない）。
 */
import { createMcpHandler, McpServer, type CallToolResult } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { createMarkdownPages } from './agent/markdown.ts';
import { publishedPostMarkdown } from './agent/post-markdown.ts';
import { GET_POST, notFoundMessage, SEARCH_POSTS, TOOLS_VERSION } from './agent/tools.ts';
import type { AgentFeatures, SiteConfig } from './config.ts';
import { resolvePublishedPost } from './db/post-paths.ts';
import { listPublishedTags } from './db/tags.ts';
import type { Paths } from './paths.ts';
import { postJsonEntries } from './post-json.ts';
import { NO_STORE } from './routes/cache.ts';
import { searchErrorMessage, searchPosts } from './search.ts';

/** 1 回の要求の本文の上限。道具の引数は短い文字列だけなので、既定（4 MiB）は要らない。 */
const MAX_REQUEST_BODY = 64 * 1024;

/**
 * 道具の注釈。**3 つとも同じ。** 読むだけ（readOnly）、何度呼んでも同じ（idempotent）、
 * 外の世界には出ない（このサイトの記事しか見ない。openWorld は false）。
 */
const ANNOTATIONS = { readOnlyHint: true, idempotentHint: true, openWorldHint: false };

export type McpDeps = {
  readonly site: SiteConfig;
  readonly paths: Paths;
  /** `search` が false なら `search_posts` を出さない（`PageConfig.search`）。 */
  readonly features: AgentFeatures;
};

/**
 * `<mount>/mcp` に来た要求を処理する関数を作る。設定 1 つにつき 1 度だけ呼ぶ。
 *
 * サーバは要求ごとに作る（SDK の McpServer は、同時に走る要求で共有できない）。
 * DB は要求に付いてくるので、それを閉じ込めたサーバを作る。
 */
export function createMcpEndpoint(
  deps: McpDeps,
): (request: Request, db: D1Database) => Promise<Response> {
  const { site, paths, features } = deps;
  const { urls } = paths;
  const pages = createMarkdownPages(site);
  const siteUrl = urls.index({ absolute: true });
  const origin = new URL(siteUrl).origin;
  const getPostInput = GET_POST.input(features.search);
  const uses = [
    ...(features.search ? [`${SEARCH_POSTS.name} to find posts by words`] : []),
    `${GET_POST.name} to read one as Markdown`,
    'list_tags to see the topics',
  ];
  const instructions =
    `Read-only access to the published posts of ${site.name} (${siteUrl}). ` +
    `Use ${uses.join(', ')}. Drafts are never visible.`;

  const createServer = (db: D1Database): McpServer => {
    const server = new McpServer(
      { name: 'lily', title: site.name, version: TOOLS_VERSION, websiteUrl: siteUrl },
      { instructions },
    );

    if (features.search) {
      server.registerTool(
        SEARCH_POSTS.name,
        {
          title: SEARCH_POSTS.title,
          description: SEARCH_POSTS.description,
          inputSchema: SEARCH_POSTS.input,
          annotations: ANNOTATIONS,
        },
        async ({ query, limit, offset }) => {
          const result = await searchPosts(db, { q: query, limit, offset });
          if (!result.ok) {
            return toolError(searchErrorMessage(result.error, { query: 'query', offset: 'offset' }));
          }
          const { query: normalized, posts, nextOffset } = result.value;
          return toolJson({
            query: normalized,
            posts: await postJsonEntries(db, urls, posts),
            next_offset: nextOffset,
          });
        },
      );
    }

    server.registerTool(
      GET_POST.name,
      {
        title: GET_POST.title,
        description: GET_POST.description,
        inputSchema: getPostInput,
        annotations: ANNOTATIONS,
      },
      async ({ url }) => {
        const path = postPathOf(url);
        const post = path === null ? null : await resolvePublishedPost(db, paths, path);
        if (post === null) return toolError(notFoundMessage(url));
        return {
          content: [{ type: 'text', text: await publishedPostMarkdown(db, urls, pages, post) }],
        };
      },
    );

    server.registerTool(
      'list_tags',
      {
        title: 'List tags',
        description: 'List the tags that have published posts, with how many posts each has, most used first.',
        inputSchema: z.object({}),
        annotations: ANNOTATIONS,
      },
      async () =>
        toolJson({
          tags: (await listPublishedTags(db)).map((tag) => ({
            name: tag.name,
            url: urls.tag(tag, { absolute: true }),
            post_count: tag.post_count,
          })),
        }),
    );

    return server;
  };

  /**
   * `get_post` に渡された参照を、mount より下のパスにする。**引けないものは null。**
   *
   * **参照はトップページの URL を起点にした URL として読む**（ブラウザがリンクを解決する
   * のと同じ規則）。形ごとに分けて読むと、クエリ（`?utm=…`）やフラグメント（`#…`）の
   * 扱いが形によって違ってしまう。
   *
   * - 絶対 URL。**このサイトのオリジンで、mount の下にあるものだけ**（`javascript:` や
   *   `//よそ` もオリジンで落ちる）
   * - mount を含むパス（`/blog/my-post/`）か、mount を除いたパス（`my-post`）
   * - 記事の id（public_id）。public_id は常に alias として `post_paths` にあるので、
   *   パスとして引ける
   */
  const postPathOf = (reference: string): string | null => {
    let url: URL;
    try {
      url = new URL(reference.trim(), siteUrl);
    } catch {
      return null;
    }
    return url.origin === origin ? urls.underMount(url.pathname) : null;
  };

  return async (request, db) => {
    // DNS rebinding の対策（仕様の MUST）。**Origin が付いていれば、サイトのオリジンと
    // 完全に一致するものだけを通す。** SDK の検査関数はホスト名しか比べない。
    // 付いていない要求（サーバで動くクライアント）は通す。
    const requestOrigin = request.headers.get('Origin');
    if (requestOrigin !== null && requestOrigin !== origin) {
      return Response.json(
        { jsonrpc: '2.0', error: { code: -32000, message: 'Origin not allowed.' }, id: null },
        { status: 403, headers: { 'Cache-Control': NO_STORE } },
      );
    }

    // `responseMode` は既定（auto）のまま。道具は途中で通知を出さないので、2026 版の
    // 応答は JSON 1 本になる。`'json'` を指定すると、SDK がハンドラを作るたびに警告を
    // ログへ出す。旧い版の応答は SDK が SSE で返す（どちらも仕様が許す形）。
    const handler = createMcpHandler(() => createServer(db), {
      maxRequestBodySize: MAX_REQUEST_BODY,
    });
    const response = await handler.fetch(request);
    // 問い合わせごとに違うので、共有キャッシュに残させない。
    const headers = new Headers(response.headers);
    headers.set('Cache-Control', NO_STORE);
    return new Response(response.body, { status: response.status, headers });
  };
}

/** 道具の失敗。**プロトコルのエラーにはしない**（相手のモデルが読んで直せるように、結果として返す）。 */
function toolError(message: string): CallToolResult {
  return { isError: true, content: [{ type: 'text', text: message }] };
}

/**
 * JSON で返す結果。`structuredContent` に入れ、同じものを文字列でも入れる
 * （仕様の SHOULD。structuredContent を読まないクライアントのため）。
 */
function toolJson(value: Record<string, unknown>): CallToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(value) }], structuredContent: value };
}

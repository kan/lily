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
import type { SiteConfig } from './config.ts';
import { resolvePublishedPost } from './db/post-paths.ts';
import { listPublishedTags } from './db/tags.ts';
import type { Paths } from './paths.ts';
import { postJsonEntries } from './post-json.ts';
import { NO_STORE } from './routes/cache.ts';
import {
  SEARCH_LIMIT_DEFAULT,
  SEARCH_LIMIT_MAX,
  SEARCH_OFFSET_MAX,
  SEARCH_QUERY_MAX,
  searchErrorMessage,
  searchPosts,
} from './search.ts';

/**
 * serverInfo の版。**道具の一覧と形の版**で、lily のパッケージの版ではない（コードから
 * パッケージの版を読む手段を持たせていない）。道具を足す・形を変えるときに上げる。
 */
export const MCP_SERVER_VERSION = '1';

/** 1 回の要求の本文の上限。道具の引数は短い文字列だけなので、既定（4 MiB）は要らない。 */
const MAX_REQUEST_BODY = 64 * 1024;

/**
 * 道具の注釈。**3 つとも同じ。** 読むだけ（readOnly）、何度呼んでも同じ（idempotent）、
 * 外の世界には出ない（このサイトの記事しか見ない。openWorld は false）。
 */
const ANNOTATIONS = { readOnlyHint: true, idempotentHint: true, openWorldHint: false };

/**
 * 道具の引数。**型と説明だけを書き、上限は書かない。** 上限は `searchPosts` が持ち、
 * 超えたら道具の失敗として説明を返す（相手のモデルが読んで直せる）。ここにも書くと、
 * 上限を変えた日に 2 か所を直すことになり、SDK の検査で断られた側はプロトコルの
 * エラーになって形が揃わない。
 */
const SEARCH_INPUT = z.object({
  query: z.string().describe(`Words to search for, separated by spaces (up to ${SEARCH_QUERY_MAX} characters).`),
  // 整数でない値も `searchPosts` が既定に落とす（search.json と同じ）。
  limit: z.number().optional().describe(`How many posts to return (default ${SEARCH_LIMIT_DEFAULT}, at most ${SEARCH_LIMIT_MAX}).`),
  offset: z.number().optional().describe(`How many matching posts to skip (at most ${SEARCH_OFFSET_MAX}). Use next_offset from the previous result.`),
});

const GET_POST_INPUT = z.object({
  // 長さの上限も書かない。長すぎる参照は記事のパスとして通らず、「無い」と答える
  // (本文の大きさは `MAX_REQUEST_BODY` が抑える)。
  url: z
    .string()
    .describe("The post's URL as search_posts returns it. A path under the site, or the post's id, also works."),
});

/** 「無い」と答えるときに埋め返す参照の長さ。受け取った文字列をそのまま長く返さない。 */
const ECHO_MAX = 200;

export type McpDeps = {
  readonly site: SiteConfig;
  readonly paths: Paths;
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
  const { site, paths } = deps;
  const { urls } = paths;
  const pages = createMarkdownPages(site);
  const siteUrl = urls.index({ absolute: true });
  const origin = new URL(siteUrl).origin;
  const instructions =
    `Read-only access to the published posts of ${site.name} (${siteUrl}). ` +
    'Use search_posts to find posts by words, get_post to read one as Markdown, ' +
    'and list_tags to see the topics. Drafts are never visible.';

  const createServer = (db: D1Database): McpServer => {
    const server = new McpServer(
      { name: 'lily', title: site.name, version: MCP_SERVER_VERSION, websiteUrl: siteUrl },
      { instructions },
    );

    server.registerTool(
      'search_posts',
      {
        title: 'Search posts',
        description:
          'Search the published posts. A post matches when it contains every word ' +
          '(space-separated) in its title, description or body; words match as substrings, ' +
          'so a word inside a Japanese sentence is found. Results are newest first, without ' +
          "the body: call get_post with a result's url to read it.",
        inputSchema: SEARCH_INPUT,
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

    server.registerTool(
      'get_post',
      {
        title: 'Get a post',
        description:
          'Read one published post as Markdown: a YAML frontmatter block (title, description, ' +
          'url, published, updated, tags, lang), then the title and the body as it was written. ' +
          'Attachment links are absolute URLs.',
        inputSchema: GET_POST_INPUT,
        annotations: ANNOTATIONS,
      },
      async ({ url }) => {
        const path = postPathOf(url);
        const post = path === null ? null : await resolvePublishedPost(db, paths, path);
        if (post === null) {
          const shown = [...url.trim()].slice(0, ECHO_MAX).join('');
          return toolError(`No published post at ${shown}.`);
        }
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

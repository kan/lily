/**
 * WebMCP（W3C の Community Group の草案）。**ページの JS から、検索と記事の読み出しを
 * 道具として登録する。** 組むのは core、ページに置くのはテーマ（`PageContext.webMcp`。
 * JSON-LD と同じ分担）。
 *
 * - 道具の名前・説明・引数は MCP サーバと同じ（`agent/tools.ts`。引数は zod から
 *   JSON Schema にして渡す）。中身は `search.json` と、記事の URL を
 *   `Accept: text/markdown` で取ったもの。**サーバ側に新しい口を作らない**
 * - **参照の解決はサーバに任せる。** ブラウザが見るのは「このサイトの、mount の下の
 *   URL か」だけ（`urls.underMount` と同じ規則）で、alias・public_id・下書きの判定は
 *   公開ページの route が MCP と同じ `resolvePublishedPost` で行う
 * - **`document.modelContext` が無いブラウザでは何もしない。** 登録が断られても
 *   （Permissions Policy の `tools` が切られているなど）ページを壊さない
 * - **失敗は投げる**（MCP の `isError` にあたる）。断られた検索、「無い」記事、記事でない
 *   ページ（一覧・タグ・JSON）、通信の失敗のどれも、結果の文字列として返さない
 * - 要求は**ページのオリジン**へ送る。`site.url` で組むと、プレビュー用のホスト
 *   （`*.workers.dev`）で開いたページから本番へ要求が飛ぶ。`get_post` に渡された
 *   `site.url` の URL（検索の結果に入っているもの）は、ページのオリジンへ読み替えて取る。
 *   検索の結果そのものは書き換えない（`search.json` と同じ JSON を返す）
 */
import { z } from 'zod';
import type { AgentFeatures } from '../config.ts';
import type { Urls } from '../paths.ts';
import { POST_ONLY_KEY } from './markdown.ts';
import { scriptJson } from './script-json.ts';
import { ECHO_MAX, GET_POST, NOT_FOUND_TEXT, SEARCH_POSTS } from './tools.ts';

/**
 * ブラウザで走る本体。**関数ではなく文字列で持つ。** 関数を `toString()` すると、
 * 利用側のバンドラ（wrangler の esbuild は `keepNames` が既定）が中に `__name(...)` を
 * 差し込み、ページでは未定義の関数を呼んで落ちる。
 *
 * `c` は `webMcpScript` が埋める設定。
 */
const RUNTIME = `
const m = document.modelContext;
if (m && typeof m.registerTool === 'function') {
  // 草案の版によって、registerTool は Promise を返すことも、何も返さず同期で
  // 投げることもある。どちらで断られても、ほかの道具とページは止めない。
  const add = (tool, execute) => {
    try {
      Promise.resolve(m.registerTool({ ...tool, annotations: { readOnlyHint: true }, execute })).catch(() => {});
    } catch {}
  };
  if (c.search) {
    add(c.search.tool, async (input) => {
      const url = new URL(c.search.url, location.href);
      url.searchParams.set('q', String(input.query ?? ''));
      if (input.limit != null) url.searchParams.set('limit', String(input.limit));
      if (input.offset != null) url.searchParams.set('offset', String(input.offset));
      const response = await fetch(url, { headers: { Accept: 'application/json' } });
      // 断られた検索（400）は失敗として投げる。説明は search.json の message。
      if (!response.ok) throw new Error((await response.json()).message);
      return await response.text();
    });
  }
  add(c.getPost, async (input) => {
    const reference = String(input.url ?? '').trim();
    const missing = new Error(c.missing[0] + [...reference].slice(0, c.missing[2]).join('') + c.missing[1]);
    let url;
    try {
      url = new URL(reference, location.origin + c.mount + '/');
    } catch {
      throw missing;
    }
    const mounted = url.pathname === c.mount || url.pathname.startsWith(c.mount + '/');
    if ((url.origin !== location.origin && url.origin !== c.site) || !mounted) throw missing;
    const response = await fetch(location.origin + url.pathname, { headers: { Accept: 'text/markdown' } });
    const type = response.headers.get('Content-Type') ?? '';
    if (!response.ok || !type.startsWith('text/markdown')) throw missing;
    // 記事の Markdown だけを返す。一覧とタグの Markdown は frontmatter に c.postKey が無い。
    const text = await response.text();
    const head = text.startsWith('---\\n') ? text.slice(4, text.indexOf('\\n---\\n', 4) + 1) : '';
    if (!head.split('\\n').some((line) => line.startsWith(c.postKey + ':'))) throw missing;
    return text;
  });
}`;

/** 道具の名前・題・説明・引数（JSON Schema）。 */
function toolOf(
  tool: { readonly name: string; readonly title: string; readonly description: string },
  input: z.ZodType,
) {
  return {
    name: tool.name,
    title: tool.title,
    description: tool.description,
    // 引数として受ける側の形（`io: 'input'`）。MCP の SDK が tools/list に出すのと同じ。
    inputSchema: z.toJSONSchema(input, { io: 'input' }),
  };
}

/**
 * `<script>` の中にそのまま置ける JS。設定から決まるので、起動時に 1 度だけ組む。
 * 埋める値は `scriptJson`（`<` などをエスケープする）を通す。
 */
export function webMcpScript(urls: Urls, features: AgentFeatures): string {
  const config = scriptJson({
    // 検索を止めていれば search_posts を登録しない。
    search: features.search
      ? { tool: toolOf(SEARCH_POSTS, SEARCH_POSTS.input), url: urls.search() }
      : null,
    getPost: toolOf(GET_POST, GET_POST.input(features.search)),
    mount: urls.mountPath,
    site: new URL(urls.index({ absolute: true })).origin,
    missing: [NOT_FOUND_TEXT.before, NOT_FOUND_TEXT.after, ECHO_MAX],
    postKey: POST_ONLY_KEY,
  });
  return `{ const c = ${config};${RUNTIME}\n}`;
}

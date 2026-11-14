/**
 * エージェント向けの道具の定義（名前の付いた引数・説明・版）。**MCP サーバ（`core/mcp.ts`）と
 * WebMCP（`agent/webmcp.ts`）が同じものを出す**ので、ここに 1 つだけ置く。片方だけ直すと、
 * 同じ名前の道具が入口ごとに違う説明や引数になる。
 *
 * **MCP の SDK に依存させない。** 公開ページ（WebMCP）と発見用の文書（Server Card の版）も
 * ここを読むので、SDK を import すると、MCP を止めたサイトの公開側まで SDK に繋がる。
 */
import { z } from 'zod';
import {
  SEARCH_LIMIT_DEFAULT,
  SEARCH_LIMIT_MAX,
  SEARCH_OFFSET_MAX,
  SEARCH_QUERY_MAX,
} from '../search.ts';

/**
 * 道具の一覧と形の版（MCP の serverInfo と Server Card の `version`）。lily のパッケージの
 * 版ではない（コードからパッケージの版を読む手段を持たせていない）。道具を足す・形を
 * 変えるときに上げる。
 */
export const TOOLS_VERSION = '1.0.0';

export const SEARCH_POSTS = {
  name: 'search_posts',
  title: 'Search posts',
  description:
    'Search the published posts. A post matches when it contains every word ' +
    '(space-separated) in its title, description or body; words match as substrings, ' +
    'so a word inside a Japanese sentence is found. Results are newest first, without ' +
    "the body: call get_post with a result's url to read it.",
  /**
   * 引数。**型と説明だけを書き、上限は書かない。** 上限は `searchPosts` が持ち、超えたら
   * 道具の失敗として説明を返す（相手のモデルが読んで直せる）。ここにも書くと、上限を
   * 変えた日に 2 か所を直すことになり、SDK の検査で断られた側はプロトコルのエラーに
   * なって形が揃わない。
   */
  input: z.object({
    query: z.string().describe(`Words to search for, separated by spaces (up to ${SEARCH_QUERY_MAX} characters).`),
    // 整数でない値も `searchPosts` が既定に落とす（search.json と同じ）。
    limit: z.number().optional().describe(`How many posts to return (default ${SEARCH_LIMIT_DEFAULT}, at most ${SEARCH_LIMIT_MAX}).`),
    offset: z.number().optional().describe(`How many matching posts to skip (at most ${SEARCH_OFFSET_MAX}). Use next_offset from the previous result.`),
  }),
} as const;

export const GET_POST = {
  name: 'get_post',
  title: 'Get a post',
  description:
    'Read one published post as Markdown: a YAML frontmatter block (title, description, ' +
    'url, published, updated, tags, lang), then the title and the body as it was written. ' +
    'Attachment links are absolute URLs.',
  /**
   * 引数。**検索を止めたサイトでは `search_posts` に触れない**（登録されていない道具を
   * 指すと、相手のモデルがそれを呼ぼうとする）。
   */
  input: (search: boolean) =>
    z.object({
      // 長さの上限も書かない。長すぎる参照は記事のパスとして通らず、「無い」と答える。
      url: z
        .string()
        .describe(
          `The post's URL${search ? ' as search_posts returns it' : ''}. ` +
            "A path under the site, or the post's id, also works.",
        ),
    }),
} as const;

/** 「無い」と答えるときに埋め返す参照の長さ。受け取った文字列をそのまま長く返さない。 */
export const ECHO_MAX = 200;

/** 「無い」の答え。ブラウザ側（WebMCP）は関数を持ち込めないので、前後の文言を設定で渡す。 */
export const NOT_FOUND_TEXT = { before: 'No published post at ', after: '.' } as const;

export function notFoundMessage(reference: string): string {
  return `${NOT_FOUND_TEXT.before}${clip(reference.trim(), ECHO_MAX)}${NOT_FOUND_TEXT.after}`;
}

/** 文字（コードポイント）で数えて切り詰める。 */
export function clip(text: string, max: number): string {
  return [...text].slice(0, max).join('');
}

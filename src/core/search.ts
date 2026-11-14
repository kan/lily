/**
 * 公開の検索。**認証の無い入口から来るので、形と量をここで絞る。**
 *
 * `search.json` と MCP (issue #65) はどちらもここを呼ぶ。語の切り方・件数と
 * offset の上限・続きの有無の判定をここに置くのは、入口ごとに写すと、片方だけ
 * 上限を書き漏らした経路ができるため。入口が持つのは、URL の組み立てと応答の形だけ。
 * SQL は `db/posts.ts` の `searchPublishedPosts`。
 */
import { searchPublishedPosts } from './db/posts.ts';
import type { PostWithPathRow } from './db/types.ts';
import { err, ok, type Result } from './result.ts';

/** 問い合わせ全体の長さの上限 (文字数)。長い語ほど索引を引く回数が増える。 */
export const SEARCH_QUERY_MAX = 100;

/** 語の数の上限。語ごとに条件が 1 つ増える。 */
export const SEARCH_TERMS_MAX = 5;

/** 1 回で返す件数の既定と上限。上限は `posts.json` と同じ。 */
export const SEARCH_LIMIT_DEFAULT = 10;
export const SEARCH_LIMIT_MAX = 20;

/**
 * offset の上限。大きな offset でも、一致した行をそこまで読み飛ばす分の走査が要る。
 * 超えたら断る (`offset-too-large`)。続きのページもこの先は案内しない。
 */
export const SEARCH_OFFSET_MAX = 1000;

export type SearchQueryError = 'empty' | 'too-long' | 'too-many-terms' | 'offset-too-large';

/**
 * 断った理由の説明（英語。機械が読む相手に返す）。**上限の数をここで埋める**ので、
 * `search.json` と MCP で説明が食い違わない。引数の名前だけは入口ごとに違う
 * (`?q=` と `query`) ので、呼ぶ側が渡す。
 */
export function searchErrorMessage(
  error: SearchQueryError,
  names: { readonly query: string; readonly offset: string },
): string {
  switch (error) {
    case 'empty':
      return `Give the words to search for in ${names.query}.`;
    case 'too-long':
      return `${names.query} is limited to ${SEARCH_QUERY_MAX} characters.`;
    case 'too-many-terms':
      return `${names.query} is limited to ${SEARCH_TERMS_MAX} words.`;
    case 'offset-too-large':
      return `${names.offset} is limited to ${SEARCH_OFFSET_MAX}.`;
  }
}

export type SearchRequest = {
  /** 利用者が書いたままの問い合わせ。 */
  readonly q: string | undefined;
  /** 読めない値・範囲外の値は丸める (400 にはしない)。 */
  readonly limit?: number;
  readonly offset?: number;
};

export type SearchResult = {
  /** 語を空白 1 つでつなぎ直したもの。続きのページを頼むときはこれを `q` に渡す。 */
  readonly query: string;
  readonly posts: PostWithPathRow[];
  readonly limit: number;
  /** 続きがあれば次の offset。無ければ null。 */
  readonly nextOffset: number | null;
};

/**
 * 公開記事を検索する。**語をすべて含む記事を新しい順で返す。**
 *
 * 件数は数えない。1 件多く取って続きの有無だけを決める (全件を数えると、
 * 索引を引く回数が倍になる)。
 */
export async function searchPosts(
  db: D1Database,
  request: SearchRequest,
): Promise<Result<SearchResult, SearchQueryError>> {
  const terms = parseSearchQuery(request.q);
  if (!terms.ok) return terms;

  const limit = clamp(request.limit, 1, SEARCH_LIMIT_MAX, SEARCH_LIMIT_DEFAULT);
  const offset = clamp(request.offset, 0, Number.MAX_SAFE_INTEGER, 0);
  // **上限を超えた offset は丸めずに断る。** 丸めると上限のページが何度でも返り、
  // offset を自分で数えて進むクライアントは同じ記事を新しいページとして集め続ける。
  if (offset > SEARCH_OFFSET_MAX) return err('offset-too-large');

  const found = await searchPublishedPosts(db, terms.value, { limit: limit + 1, offset });
  const nextOffset = offset + limit;

  return ok({
    query: terms.value.join(' '),
    posts: found.slice(0, limit),
    limit,
    // 次の offset が上限を超えるなら、続きは無いことにする (頼まれても断るため)。
    nextOffset: found.length > limit && nextOffset <= SEARCH_OFFSET_MAX ? nextOffset : null,
  });
}

/**
 * 問い合わせを語に切る。**語はすべて含む記事を探す (AND)。**
 *
 * 区切りは空白 (全角の空白も含む)。同じ語が 2 度出ても条件は変わらないので
 * 1 つにまとめる。
 *
 * **Unicode の正規化はしない。** 索引には本文が保存したときの形のまま入っていて
 * (保存の経路は正規化しない)、問い合わせだけを NFC にすると、NFD で保存された
 * 本文は同じ NFD の語で頼んでも当たらなくなる。
 *
 * 長さは**文字 (コードポイント) で数える。** UTF-16 の長さで数えると、絵文字が
 * 多いだけで上限に当たる。
 */
function parseSearchQuery(raw: string | undefined): Result<string[], SearchQueryError> {
  const text = (raw ?? '').trim();
  if (text === '') return err('empty');
  if ([...text].length > SEARCH_QUERY_MAX) return err('too-long');

  const terms = [...new Set(text.split(/\s+/u))];
  if (terms.length > SEARCH_TERMS_MAX) return err('too-many-terms');
  return ok(terms);
}

/** 整数でなければ既定に落とし、範囲に収める。 */
function clamp(value: number | undefined, min: number, max: number, fallback: number): number {
  if (value === undefined || !Number.isInteger(value) || value < min) return fallback;
  return Math.min(value, max);
}

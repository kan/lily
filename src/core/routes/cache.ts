/**
 * 配信するときのキャッシュ方針。
 *
 * エッジには 60 秒載せ、ブラウザには毎回確認させる。記事を更新しても他の colo の
 * `caches.default` は消せないので、短い TTL で吸収する
 * (purge API は使わない。60 秒の遅れで困るのは書いた本人だけ)。
 */
export const SHORT_EDGE = 'public, max-age=0, must-revalidate, s-maxage=60';

/** デプロイのときしか変わらないもの (スタイルシート・静的アセット)。 */
export const LONG_EDGE = 'public, max-age=0, must-revalidate, s-maxage=3600';

/**
 * 公開ページの Markdown 版（`Accept: text/markdown`）。**共有キャッシュには置かせない。**
 *
 * HTML と同じ URL から返すので、`Vary: Accept` を見ないキャッシュ（Cloudflare のエッジは
 * `Accept-Encoding` 以外の `Vary` を見ない。`routes/media.ts`）に載ると、次にブラウザで
 * 開いた人へ Markdown が配られる。共有キャッシュに入るのは常に HTML（誰でも読める既定の
 * 形）だけにする。画像の内容交渉と同じ形。
 */
export const MARKDOWN = 'private, max-age=0, must-revalidate';

/** 下書きプレビューは残さない。 */
export const NO_STORE = 'no-store';

/**
 * 発見のための文書（API Catalog・Server Card）。**MCP Server Card の提案が
 * `public, max-age=3600` を SHOULD にしている**ので、ほかの 2 本も揃える。
 * 中身はデプロイのときしか変わらない。
 */
export const DISCOVERY = 'public, max-age=3600';

/**
 * デプロイのときしか変わらない本文（スタイルシート・発見のための文書）を返す関数を作る。
 * **ETag は作るときに 1 度だけ計り**、`If-None-Match` が合えば 304 を返す（返すだけで
 * 見ないと ETag は飾りになる）。
 */
export function fixedResponse(
  body: string,
  headers: Readonly<Record<string, string>>,
): (ifNoneMatch: string | undefined) => Response {
  const all = { ...headers, ETag: etagOf(body) };
  return (ifNoneMatch) =>
    matches(ifNoneMatch, all.ETag)
      ? new Response(null, { status: 304, headers: all })
      : new Response(body, { headers: all });
}

/**
 * `If-None-Match` が ETag に当たるか（RFC 9110 の弱い比較）。**`W/` を外して比べ、
 * カンマで並んだ複数の値と `*` も読む。** Cloudflare は圧縮した応答の ETag を弱いもの
 * （`W/"…"`）に書き換えるので、完全一致だとブラウザが送り返す値に当たらない。
 */
function matches(ifNoneMatch: string | undefined, etag: string): boolean {
  if (ifNoneMatch === undefined) return false;
  const strip = (tag: string) => tag.trim().replace(/^W\//, '');
  return ifNoneMatch.split(',').some((tag) => tag.trim() === '*' || strip(tag) === etag);
}

/** 設定から決まる中身の ETag。衝突しても 304 が減るだけなので暗号強度は要らない。 */
function etagOf(input: string): string {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return `"${(h >>> 0).toString(36)}"`;
}

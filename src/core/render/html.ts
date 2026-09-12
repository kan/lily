/**
 * 生成済み HTML への後処理を、**開始タグの中だけ**に閉じ込めるための道具。
 *
 * HTML 全体に正規表現を掛けると、コードブロックに書いた `<img src="./dog.png">` の
 * ような**本文**まで書き換えてしまう。text ノードでは `<` と `>` はエスケープされるが
 * `"` は生のまま残るので、属性を狙った正規表現がそのまま食い付く
 * (Astro 版の RSS 後処理で実際に踏んだ)。
 */

/**
 * 開始タグ 1 つ。引用符の中をひとまとまりで食べるので、属性値に `>` があっても
 * そこで切れない (シリアライザは属性値の `>` を素のまま出す)。
 *
 * 見るのは二重引用符だけ。記事に直接書いた `src='./a>b.png'` のように、
 * **一重引用符の中に `>` がある**場合はそこでタグが切れたことになり、後処理が
 * 当たらない (書き換えないだけなので壊れはしない)。シリアライザの出力は常に
 * 二重引用符なので、当たらないのは生 HTML のこの形だけ。
 */
const OPEN_TAG = /<[a-z][a-z0-9-]*(?:"[^"]*"|[^>"])*>/gi;

export function mapOpenTags(html: string, transform: (tag: string) => string): string {
  return html.replace(OPEN_TAG, transform);
}

/** URL を持つ属性。placeholder の解決もフィードの絶対化も同じ範囲を見る。 */
export const URL_ATTRIBUTES = ['src', 'href'] as const;

/**
 * 開始タグの中の `src` / `href`。
 *
 * **大小文字とクォートの形を選ばない。** 記事に直接書く HTML は `SRC=` でも
 * `src='...'` でも `src=x.png` でもありうる。ここが狭いと、書き換えたかった URL が
 * 素通りしてページやフィードに相対のまま残る (どちらでも実際に踏んだ)。
 */
const URL_ATTRIBUTE = new RegExp(
  `\\s(${URL_ATTRIBUTES.join('|')})\\s*=\\s*("[^"]*"|'[^']*'|[^\\s"'>]+)`,
  'gi',
);

/**
 * 開始タグ 1 つの中の URL 属性を書き換える。`transform` が null を返した属性は
 * そのまま残す (壊すより素通しの方が実害が小さい)。
 */
export function rewriteUrlAttributes(
  tag: string,
  transform: (value: string) => string | null,
): string {
  return tag.replace(URL_ATTRIBUTE, (whole, attribute: string, value: string) => {
    const replaced = transform(unquote(value));
    // 書き換えた値は必ず二重引用符で囲み直す
    return replaced === null ? whole : ` ${attribute}="${replaced}"`;
  });
}

function unquote(value: string): string {
  const first = value[0];
  return (first === '"' || first === "'") && value.endsWith(first) ? value.slice(1, -1) : value;
}

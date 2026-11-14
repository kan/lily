/**
 * `<script>` の中に置ける JSON。JSON-LD（`json-ld.ts`）と WebMCP の設定（`webmcp.ts`）が
 * 使う。**エスケープの正をここに置く**（片方の都合で変えると、もう片方の安全性が変わる）。
 */

/**
 * エスケープする字。`<` `>` `&` に加えて、行区切り（U+2028）と段落区切り（U+2029）。
 * 後の 2 つは JSON では生のまま書けるが、古い JavaScript の文字列リテラルでは改行として
 * 扱われる。**ソースに生の字を置かない**（編集の道具が改行に変えてしまう）ので、
 * 文字コードから組む。
 */
const UNSAFE = new RegExp(`[<>&${String.fromCharCode(0x2028, 0x2029)}]`, 'g');

/**
 * 記事の題に `</script>` と書かれていても、そこで script が閉じない。JSON としての値は
 * 変わらない（エスケープした字は、JSON を読む側が元の字に戻す）。`undefined` の項目は
 * `JSON.stringify` が落とす。
 */
export function scriptJson(value: unknown): string {
  return JSON.stringify(value).replace(
    UNSAFE,
    (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`,
  );
}

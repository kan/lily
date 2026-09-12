/**
 * XML の組み立て。
 *
 * **本文は CDATA ではなく実体参照で書く。** 本体サイトの `/api/blog` が
 * `<content:encoded>` を正規表現で読んでいて、CDATA を吐いた瞬間に壊れる
 * (XML 中に生の `<` がタグしか現れない、という前提で item を切っている)。
 * 本体を `posts.json` へ移すまでは、この書き方を変えないこと。
 */

/** XML 1.0 に置けない制御文字。DB から来た値に混ざっていると文書ごと壊れる。 */
const INVALID = /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g;

export function xmlText(value: string): string {
  return value
    .replace(INVALID, '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

export function xmlAttr(value: string): string {
  return xmlText(value).replaceAll('"', '&quot;');
}

/** RSS の `pubDate`。RFC 822 の GMT 表記 (`Wed, 26 Aug 2026 00:00:00 GMT`)。 */
export function rfc822(date: Date): string {
  return date.toUTCString();
}

/** Atom の日付。UTC の ISO8601。 */
export function iso8601(date: Date): string {
  return date.toISOString();
}

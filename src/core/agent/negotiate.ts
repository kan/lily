/**
 * 公開ページを HTML と Markdown のどちらで返すか。**URL は変えず、`Accept` だけで選ぶ。**
 *
 * Markdown を返すのは、`text/markdown` を HTML より**はっきり高く**求められたときだけ。
 * ブラウザは `text/html` を名指しし、`curl` や素の fetch は `*\/*` か `Accept` 無しで
 * 来るので、どれも今までどおり HTML になる。同点も HTML に倒す（`text/html,
 * text/markdown` のように両方を同じ重さで並べた相手は、HTML を読める）。
 *
 * **406 は返さない。** どちらも受けない `Accept`（`application/json` だけ、など）にも
 * HTML を返す。公開ページは誰にでも読める形を 1 つ持っているので、断るより
 * 既定の形を出す方が役に立つ。
 */

export type PageFormat = 'html' | 'markdown';

export function pageFormat(accept: string | null | undefined): PageFormat {
  if (!accept) return 'html';
  const ranges = parseAccept(accept);
  const markdown = quality(ranges, 'text', 'markdown');
  return markdown > 0 && markdown > quality(ranges, 'text', 'html') ? 'markdown' : 'html';
}

type MediaRange = { readonly type: string; readonly subtype: string; readonly q: number };

function parseAccept(accept: string): MediaRange[] {
  const ranges: MediaRange[] = [];
  for (const part of accept.split(',')) {
    const [range, ...params] = part.split(';');
    const [type, subtype] = (range ?? '').trim().toLowerCase().split('/');
    if (!type || !subtype) continue;
    let q = 1;
    for (const param of params) {
      const [name, value] = param.split('=').map((s) => s.trim());
      if (name?.toLowerCase() !== 'q' || value === undefined) continue;
      const parsed = Number(value);
      // 読めない q は 0 とみなす（壊れた値で重さを上げない）
      q = Number.isFinite(parsed) ? Math.min(Math.max(parsed, 0), 1) : 0;
    }
    ranges.push({ type, subtype, q });
  }
  return ranges;
}

/**
 * その型の重さ。**一番具体的な range の q を採る**（RFC 9110 12.5.1）。
 * `text/markdown;q=0` があれば、`*\/*` があっても Markdown は 0。
 */
function quality(ranges: readonly MediaRange[], type: string, subtype: string): number {
  let best: { specificity: number; q: number } | null = null;
  for (const range of ranges) {
    const specificity =
      range.type === type && range.subtype === subtype
        ? 2
        : range.type === type && range.subtype === '*'
          ? 1
          : range.type === '*' && range.subtype === '*'
            ? 0
            : -1;
    if (specificity < 0) continue;
    if (best === null || specificity > best.specificity) best = { specificity, q: range.q };
  }
  return best?.q ?? 0;
}

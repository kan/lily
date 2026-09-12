/**
 * 記事ページと同じ HTML をフィードに載せるための後処理。
 *
 * ページの中では正しく動く書き方でも、リーダーの中では前提が崩れる:
 *   - 相対 URL … リーダーは記事の URL を起点に解決してくれない
 *   - CSS 変数 … リーダーはこのブログのスタイルシートを読み込まない
 *
 * どちらもここで潰す。media の placeholder は先に `resolveMediaUrls` が
 * 絶対 URL へ解決している前提。
 *
 * **書き換えは開始タグの中だけ** (`mapOpenTags`)。HTML 全体に正規表現を掛けると、
 * コードブロックに書いた `<img src="./dog.png">` のような**本文**まで書き換わる。
 */
import { mapOpenTags, rewriteUrlAttributes } from '../render/html.ts';

export function toFeedHtml(html: string, postUrl: string): string {
  const base = new URL(postUrl);
  return mapOpenTags(html, (tag) => expandShikiColors(absolutizeUrls(tag, base)));
}

/**
 * `src` / `href` を記事の URL 基準で絶対化する。
 *
 * 記事内の相対リンク (`../../CONTRACT.md`) と脚注のアンカー (`#user-content-fn-x`) が
 * 対象。絶対 URL や `mailto:` / `data:` は `new URL()` がそのまま返すので素通しでよい。
 *
 * 属性の見方は placeholder の解決と同じ (`rewriteUrlAttributes`)。片方だけ狭いと、
 * ページでは解決されるのにフィードでは相対のまま、という食い違いが生まれる。
 */
function absolutizeUrls(tag: string, base: URL): string {
  return rewriteUrlAttributes(tag, (value) => resolve(value, base));
}

/** 解決できない値は書き換えずに残す (壊すより素通しの方が実害が小さい)。 */
function resolve(value: string, base: URL): string | null {
  if (!value) return null;
  try {
    return new URL(value, base).href;
  } catch {
    return null;
  }
}

/**
 * Shiki の CSS 変数をライトテーマの色に展開する。
 *
 * renderer は `defaultColor: false` なので、Shiki は色を直接書かず
 * `--shiki-light` / `--shiki-dark` だけを出す。ページ側はそれを `blog.css` の
 * `light-dark()` に渡している (変数名を増やすなら両方直すこと)。リーダーには
 * その CSS が無いので、フィードでだけライト側の値をベタの色にする。
 */
function expandShikiColors(tag: string): string {
  return tag.replace(/\sstyle="([^"]*)"/g, (whole, style: string) => {
    if (!style.includes('--shiki-')) return whole;
    const expanded = style
      .replace(/--shiki-dark(-bg)?:[^;]*;?/g, '')
      .replace('--shiki-light-bg:', 'background-color:')
      .replace('--shiki-light:', 'color:');
    return ` style="${expanded}"`;
  });
}

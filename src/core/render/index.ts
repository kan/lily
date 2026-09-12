/**
 * Markdown → HTML。**保存する側と配信する側で 2 段に分ける。**
 *
 *   body_md ──renderMarkdown()──▶ body_html (mount を知らない。placeholder のまま)
 *                                    └──resolveMediaUrls()──▶ 配信する HTML
 *
 * プレビューと公開ページは同じ renderer を通す (プレビューは毎回 body_md から
 * 描画してキャッシュしない)。
 */
import rehypeShikiFromHighlighter from '@shikijs/rehype/core';
import rehypeStringify from 'rehype-stringify';
import remarkGfm from 'remark-gfm';
import remarkParse from 'remark-parse';
import remarkRehype from 'remark-rehype';
import { unified } from 'unified';

import { getHighlighter, THEMES } from './highlighter.ts';
import { rehypeMedia, type RenderMedia } from './media.ts';

export type { RenderMedia } from './media.ts';

/**
 * `body_html` は派生データなので、renderer を変えたら作り直す必要がある。
 * **出力が変わる変更をしたらここを上げる**（`POST /api/rerender` が拾う）。
 */
export const RENDERER_VERSION = '2';

export type RenderOptions = {
  /** 記事に紐づく添付。本文の `./sample.png` はこれと突き合わせる。 */
  readonly media?: readonly RenderMedia[];
};

export type RenderResult = {
  /** 保存する HTML。media 参照は placeholder のまま。 */
  readonly html: string;
  /** 解決できなかった `./…` の参照。管理画面で警告に使う。 */
  readonly unresolvedMedia: readonly string[];
};

export async function renderMarkdown(
  markdown: string,
  options: RenderOptions = {},
): Promise<RenderResult> {
  // 同じ参照が本文に何度出てきても 1 回にする (警告一覧に同じ名前が並ばないように)
  const unresolvedMedia = new Set<string>();
  const highlighter = await getHighlighter();

  const file = await unified()
    .use(remarkParse)
    .use(remarkGfm)
    // 記事に書いた生 HTML はそのまま出す (raw ノードのまま最後まで運ぶ)。
    //
    // **rehype-raw は使わない。** あれは HTML を parse5 で読み直すので、
    // mdast-util-to-hast が表の中に入れた改行が foster parenting で表の外へ
    // 追い出され、`</pre>` と `<table>` の間に空行が 14 行並ぶ (実測)。
    // parse5 のぶんバンドルも大きい。
    .use(remarkRehype, {
      allowDangerousHtml: true,
      // 脚注の見出しと戻りリンクの読み上げ文。既定は英語で、**画面には出ない
      // (sr-only) が読み上げには出る**ので日本語にしておく。
      footnoteLabel: '脚注',
      footnoteBackLabel: (index: number) => `本文の ${index + 1} に戻る`,
    })
    .use(rehypeShikiFromHighlighter, highlighter, {
      themes: THEMES,
      defaultColor: false,
      // 言語指定なしのフェンスも Shiki を通す。通さないと `.shiki` が付かず、
      // そのブロックだけスタイルが当たらない。
      defaultLanguage: 'text',
      // 載せていない言語のフェンスでも落とさない。ハイライトが素になるだけ。
      fallbackLanguage: 'text',
      // 折り返しは CSS で決める。保存する HTML に見せ方を焼き込まない
      // (Astro の shikiConfig.wrap は pre にインライン style を書いていた)。
    })
    .use(rehypeMedia, { media: options.media ?? [], onUnresolved: (r) => unresolvedMedia.add(r) })
    .use(rehypeStringify, { allowDangerousHtml: true })
    .process(markdown);

  return { html: String(file), unresolvedMedia: [...unresolvedMedia] };
}

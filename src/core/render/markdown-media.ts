/**
 * Markdown のまま配るときに、本文の相対参照（`./sample.png`）を**添付の絶対 URL**へ直す。
 *
 * 保存してある `body_md` は deployment を知らない（外せない 3 点の 2）。HTML は描画の
 * 時に placeholder を経て解決するが、Markdown を配るときは描画を通らないので、
 * ここで同じ突き合わせを行う。相対のまま渡すと、読む側は記事の URL から解決して
 * `<記事>/sample.png` という存在しない場所を取りに行く。
 *
 * - **書き換えるのは URL の部分だけ。** 本文のほかの字は 1 バイトも変えない
 *   （構文木から Markdown を書き直すと、書き手の記法が揃え直されてしまう）
 * - 対象は画像・リンク・参照の定義の行き先と、生 HTML の `src` / `href`。
 *   **コードブロックや inline code の中は触らない**（構文木の上でそれらは別の型）
 * - 構文も突き合わせも描画と同じもの（`markdownSyntax` / `createMediaMatcher`）。
 *   添付に無い参照（記事間のリンクなど）はそのまま残す
 */
import type { Root } from 'mdast';
import type { Node } from 'unist';
import { visit } from 'unist-util-visit';
import type { MediaRef, Urls } from '../paths.ts';
import { mapOpenTags, rewriteUrlAttributes } from './html.ts';
import { markdownSyntax } from './index.ts';
import { createMediaMatcher } from './media.ts';

/** 行き先 1 つ。`<…>` で囲んだ形と、括弧の対応を許す素の形（CommonMark）。 */
const DESTINATION = String.raw`<(?:[^<>\n\\]|\\.)*>|(?:[^\s()\\]|\\.|\((?:[^\s()\\]|\\.)*\))+`;

/**
 * インラインの画像とリンク。**ラベルを閉じる `]` の直後から読む**（`labelEnd`）。
 * 「最後の `](`」で探すと、title の中の `](` に当たる。
 */
const INLINE_DESTINATION = new RegExp(String.raw`\(\s*(${DESTINATION})`, 'y');

/** 参照の定義（`[x]: ./a.png "題"`）。行き先は先頭の `]:` の後ろ。 */
const DEFINITION_DESTINATION = new RegExp(
  String.raw`^\[(?:[^\]\\]|\\.)*\]:\s*(${DESTINATION})`,
);

type Edit = { readonly start: number; readonly end: number; readonly text: string };

export function absolutizeMediaReferences(
  markdown: string,
  media: readonly MediaRef[],
  urls: Urls,
): string {
  if (media.length === 0) return markdown;
  const find = createMediaMatcher(media);

  const absolute = (value: string): string | null => {
    const found = find(value);
    return found === null ? null : urls.media(found, { absolute: true });
  };

  const tree: Root = markdownSyntax().parse(markdown);
  const edits: Edit[] = [];

  visit(tree, (node) => {
    const start = node.position?.start.offset;
    const end = node.position?.end.offset;
    if (start === undefined || end === undefined) return;
    const source = markdown.slice(start, end);

    if (node.type === 'html') {
      const rewritten = mapOpenTags(source, (tag) => rewriteUrlAttributes(tag, absolute));
      if (rewritten !== source) edits.push({ start, end, text: rewritten });
      return;
    }

    if (node.type !== 'image' && node.type !== 'link' && node.type !== 'definition') return;
    const url = absolute(node.url);
    if (url === null) return;

    let match: RegExpExecArray | null;
    if (node.type === 'definition') {
      match = DEFINITION_DESTINATION.exec(source);
    } else {
      const close = labelEnd(source, node, start);
      if (close === -1) return;
      INLINE_DESTINATION.lastIndex = close + 1;
      match = INLINE_DESTINATION.exec(source);
    }
    const token = match?.[1];
    if (!match || token === undefined) return;

    // 一致の末尾が行き先の末尾。`<…>` で囲み直すのは、括弧や空白を含む URL でも
    // 行き先として読まれるようにするため（`encodeURIComponent` は括弧を残す）。
    const tokenEnd = start + match.index + match[0].length;
    edits.push({ start: tokenEnd - token.length, end: tokenEnd, text: `<${url}>` });
  });

  // 後ろから当てる。リンクの中の画像のように範囲が入れ子になっても、書き換えるのは
  // 行き先の字だけなので重ならない。
  let result = markdown;
  for (const edit of edits.sort((a, b) => b.start - a.start)) {
    result = result.slice(0, edit.start) + edit.text + result.slice(edit.end);
  }
  return result;
}

/**
 * 画像・リンクのラベルを閉じる `]` の位置（`source` の中での添字）。見つからなければ -1。
 *
 * - 中身のあるリンクは、最後の子の終わりの直後が `]`（中に画像があっても確実）
 * - それ以外（画像の alt、空のリンク）は括弧の対応を数える。`\]` と inline code の
 *   中の括弧は数えない
 */
function labelEnd(
  source: string,
  node: { readonly type: string; readonly children?: readonly Node[] },
  start: number,
): number {
  const last = node.children?.at(-1)?.position?.end.offset;
  if (last !== undefined && source[last - start] === ']') return last - start;

  let depth = 0;
  for (let i = node.type === 'image' ? 1 : 0; i < source.length; i++) {
    const c = source[i];
    if (c === '\\') {
      i++;
    } else if (c === '`') {
      const run = /^`+/.exec(source.slice(i))![0];
      const closing = source.indexOf(run, i + run.length);
      if (closing !== -1) i = closing + run.length - 1;
      else i += run.length - 1;
    } else if (c === '[') {
      depth++;
    } else if (c === ']' && --depth === 0) {
      return i;
    }
  }
  return -1;
}

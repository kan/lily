/**
 * 本文から説明文を作る。
 *
 * `description` が空の記事のための**控え**で、**DB には保存しない**。配信のたびに
 * 本文から組み直すので、本文を直せばそのまま追従する。手で書いた説明があるときは
 * 常にそちらが勝つ（`postDescription()`）。
 *
 * 取るのは**最初の段落 1 つだけ**。段落をまたいで繋ぐと、元の文章に無い並びの文が
 * 一覧と OGP に出る。書き出しが説明にならない記事は手で書けばよい。
 *
 * **読むのは renderer と同じパーサ。** 記法を正規表現で読み直すと、見出し・水平線・
 * 表・字下げコードの書き方ごとに取りこぼしが出て、同じ本文から出る OGP と記事本文が
 * 食い違う（実際 setext 見出しの下線が説明に漏れ、`- - -` が `-` という説明になった）。
 * mdast まで読めば「段落とは何か」はパーサが決める。HTML を作る段（remark-rehype と
 * Shiki）は通さないので、ここで増える仕事は解析だけ。
 */
import type { Nodes, Paragraph, RootContent } from 'mdast';
import remarkGfm from 'remark-gfm';
import remarkParse from 'remark-parse';
import { unified } from 'unified';

/** 一覧・OGP・フィードに出す長さ。OGP は 100 字前後で切られることが多い。 */
const DEFAULT_LIMIT = 120;

/** 句点で切るのは、切った結果が短くなりすぎないときだけ。 */
const MIN_SENTENCE_RATIO = 0.5;

/**
 * 解析だけの unified。**`freeze()` して使い回す。**
 *
 * `parse()` は同期なので、呼ぶ側を async にせずに済む（`renderMarkdown` が
 * 非同期なのは Shiki の読み込みのため）。
 */
const parser = unified().use(remarkParse).use(remarkGfm).freeze();

export function summarize(bodyMd: string, limit: number = DEFAULT_LIMIT): string | null {
  const text = firstText(parser.parse(bodyMd).children);
  if (text === null) return null;
  const trimmed = collapse(text).trim();
  return trimmed === '' ? null : truncate(trimmed, limit);
}

/**
 * 手で書いた説明を優先し、無ければ本文から作る。**出す側は全部ここを通す。**
 *
 * **空白だけの説明は書いていないものとして扱う。** API は zod が空文字を null に
 * 潰すが、import が通る frontmatter（`description: "   "`）はそのまま DB に入る。
 */
export function postDescription(post: {
  description: string | null;
  body_md: string;
}): string | null {
  const written = post.description?.trim();
  return written === undefined || written === '' ? summarize(post.body_md) : written;
}

/**
 * 最初の段落の文字列。見つからなければ null。
 *
 * 見出し・コード・水平線・表・生 HTML・各種の定義は**型で分かる**ので飛ばす。
 * 引用と箇条書きは中に入って探す（そこから書き始める記事があるため）。
 */
function firstText(nodes: readonly RootContent[]): string | null {
  for (const node of nodes) {
    if (node.type === 'paragraph') return textOf(node);
    if (node.type === 'blockquote') {
      const quoted = firstText(node.children);
      if (quoted !== null) return quoted;
    }
    if (node.type === 'list') {
      // **項目は空白で繋ぐ。** 詰めると隣の項目と 1 つの文に見える。
      const items = node.children.flatMap((item) => firstText(item.children) ?? []);
      if (items.length > 0) return items.join(' ');
    }
  }
  return null;
}

/**
 * ノードの文字列。**画像と脚注参照は落とす。**
 *
 * 画像の alt は本文の続きではないし、脚注の番号は説明に出ても読めない。
 * リンクは題（children）が本文の一部なのでそのまま拾う。
 */
function textOf(node: Nodes | Paragraph): string {
  switch (node.type) {
    case 'text':
    case 'inlineCode':
      return node.value;
    case 'image':
    case 'imageReference':
    case 'footnoteReference':
    case 'html':
    case 'code':
      return '';
    case 'break':
      return '\n';
    default:
      return 'children' in node ? node.children.map(textOf).join('') : '';
  }
}

/**
 * 空白を 1 つに潰す。**日本語のあいだの改行は詰める。**
 *
 * CommonMark の softbreak は空白扱いだが、行末で折り返して書いた日本語に空白が
 * 挟まると語の途中が割れて見える。
 */
function collapse(text: string): string {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')
    .reduce((joined, line, index) => {
      if (index === 0) return line;
      const gap = isCjk(joined.at(-1)) && isCjk(line[0]) ? '' : ' ';
      return `${joined}${gap}${line}`;
    }, '')
    .replace(/\s+/g, ' ');
}

function isCjk(char: string | undefined): boolean {
  return char !== undefined && /[　-ヿ㐀-鿿＀-｠￠-￦]/.test(char);
}

/** 長すぎるぶんを落とす。**句点で切れるならそこで切る。** */
function truncate(text: string, limit: number): string {
  const chars = [...text];
  if (chars.length <= limit) return text;

  const head = chars.slice(0, limit).join('');
  const end = Math.max(...['。', '！', '？', '. '].map((mark) => head.lastIndexOf(mark)));
  // 句点が前の方にしか無いときに切ると、説明が数文字になってしまう。
  if (end >= limit * MIN_SENTENCE_RATIO) return head.slice(0, end + 1).trim();
  return `${head.trimEnd()}…`;
}

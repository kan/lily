/**
 * 公開ページの Markdown 版。`Accept: text/markdown` で来た相手に、HTML と同じ URL で返す。
 *
 * **画面の文言を持たない。** 文言の置き場は 3 つに決めてある（CLAUDE.md「踏みやすい穴」）
 * ので、ここに「次のページ」のような言葉を書くと 4 つ目になる。代わりに、前後のページは
 * frontmatter の `prev` / `next` に URL で載せ、見出しにはサイト名・記事の題・タグの名前
 * （どれも書き手が決めたもの）だけを使う。
 *
 * **URL はすべて絶対で受け取る**（組むのは呼ぶ側の `urls.*({ absolute: true })`）。
 * Markdown を受け取った側は、どこから取ってきたかを覚えているとは限らない。
 */
import type { SiteConfig } from '../config.ts';
import { createDateFormat } from '../date.ts';
import type { Urls } from '../paths.ts';
import type { Pagination, PostSummaryView } from '../theme.ts';
import { stringifyFrontmatter, type FmEntry } from '../transfer/frontmatter.ts';

export type MarkdownPages = {
  /** 記事 1 本。`post.url` は絶対 URL、`body` は添付の参照を絶対 URL に直したもの。 */
  post(post: PostSummaryView, body: string): string;
  /**
   * 一覧（トップ・ページ送り・タグ）。記事へのリンクを新しい順に並べる。
   * `page.url`・`pagination` の URL・各記事の `url` は絶対 URL。
   */
  list(
    page: {
      /** 見出し。トップはサイト名、タグはタグの名前。 */
      readonly title: string;
      readonly description?: string;
      readonly url: string;
      readonly pagination: Pagination;
    },
    posts: readonly PostSummaryView[],
  ): string;
};

/** 設定 1 つにつき 1 度だけ作る（日付の書式の構築は安くない。`Intl`）。 */
export function createMarkdownPages(site: SiteConfig): MarkdownPages {
  const { isoDate } = createDateFormat(site.timeZone);

  return {
    post: (post, body) =>
      stringifyFrontmatter(
        [
          ['title', post.title],
          ['description', post.description ?? undefined],
          ['url', post.url],
          ['published', post.publishedAt === null ? undefined : isoDate(post.publishedAt)],
          ['updated', isoDate(post.updatedAt)],
          ['tags', post.tags.map((t) => t.name)],
          ['lang', site.lang],
        ],
        `\n# ${inline(post.title)}\n\n${body}`,
      ),

    list: (page, posts) => {
      const entries: FmEntry[] = [
        ['title', page.title],
        ['description', page.description],
        ['url', page.url],
        ['lang', site.lang],
        ['prev', page.pagination.prevUrl ?? undefined],
        ['next', page.pagination.nextUrl ?? undefined],
      ];
      const lines = [`# ${inline(page.title)}`, ''];
      if (page.description) lines.push(inline(page.description), '');
      for (const post of posts) {
        const date = post.publishedAt === null ? '' : ` — ${isoDate(post.publishedAt)}`;
        lines.push(`- [${inline(post.title)}](<${post.url}>)${date}`);
        if (post.description) lines.push(`  ${inline(post.description)}`);
      }
      return stringifyFrontmatter(entries, `\n${lines.join('\n')}\n`);
    },
  };
}

/**
 * 404。**行き先だけを示す。** 状態は HTTP のステータスが伝えるので、見出しは
 * そのステータスの名前にする（訳す文言を増やさない）。
 */
export function notFoundMarkdown(site: SiteConfig, urls: Urls): string {
  return [
    '# 404 Not Found',
    '',
    `- [${inline(site.name)}](<${urls.index({ absolute: true })}>)`,
    `- <${urls.sitemap({ absolute: true })}>`,
    '',
  ].join('\n');
}

/**
 * 1 行に収まる地の文として書く。**題や説明に Markdown の記号があっても記法にしない。**
 *
 * - 改行は空白に寄せる（一覧の 1 項目や見出しを途中で切らない）
 * - 行内の記号（強調・リンク・コード・HTML・実体参照の `&`）をエスケープする
 * - 行頭のブロックの記号（`-` `+` `=` と `1.` `1)`）もエスケープする。説明は一覧の項目の
 *   続きの行に置くので、`- 下書き` のままだと入れ子のリストになる
 */
function inline(text: string): string {
  // 改行は正規表現（`/\s*\n\s*/`）で寄せない。空白が長く続く題で照合が長さの 2 乗に
  // なる（CodeQL の js/polynomial-redos）。行に分けて前後の空白を落とす。
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')
    .join(' ')
    .replace(/[\\`*_[\]<>#!|&]/g, '\\$&')
    .replace(/^[-+=]/, '\\$&')
    .replace(/^(\d+)([.)])/, '$1\\$2');
}

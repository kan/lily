/**
 * Row 型 → テーマに渡す view model。
 *
 * URL を組むのと日付を Date にするのがここの仕事。テーマが Row 型や
 * `post_paths` の存在を知らずに済むようにする。
 */
import type { MediaRow, PostRow, PostWithPathRow, TagRow } from './db/types.ts';
import type { Urls } from './paths.ts';
import { postDescription } from './summary.ts';
import type { PostSummaryView, PostView, TagView } from './theme.ts';

export function toTagView(urls: Urls, tag: TagRow): TagView {
  return { name: tag.name, slug: tag.slug, url: urls.tag(tag) };
}

export function toPostSummary(
  urls: Urls,
  row: PostWithPathRow,
  tags: readonly TagRow[] = [],
): PostSummaryView {
  return {
    title: row.title,
    // 空なら本文の冒頭から作る。**出す側は全部 postDescription を通す。**
    description: postDescription(row),
    publishedAt: row.published_at === null ? null : new Date(row.published_at),
    updatedAt: new Date(row.updated_at),
    url: urls.post(row.canonical_path),
    tags: tags.map((t) => toTagView(urls, t)),
    isDraft: row.status === 'draft',
  };
}

export function toPostView(
  urls: Urls,
  row: PostRow,
  canonicalPath: string,
  tags: readonly TagRow[],
  html: string,
  /** OGP に選ばれている添付。無ければテーマがサイト共通の絵を出す。 */
  ogp: MediaRow | null = null,
): PostView {
  return {
    ...toPostSummary(urls, { ...row, canonical_path: canonicalPath }, tags),
    html,
    adminUrl: urls.adminPost(row.public_id),
    // **絶対 URL。** クローラは相対 URL を解決してくれない。
    image:
      ogp === null
        ? null
        : { url: urls.media(ogp, { absolute: true }), width: ogp.width, height: ogp.height },
  };
}

/**
 * まとめ取得した行を記事ごとに束ねる。一覧やフィードで N+1 を避けるための道具で、
 * タグにも添付にも同じものを使う (`post_id` が null の行は落とす)。
 */
export function groupByPost<T extends { post_id: number | null }>(
  rows: readonly T[],
): Map<number, T[]> {
  const byPost = new Map<number, T[]>();
  for (const row of rows) {
    if (row.post_id === null) continue;
    const list = byPost.get(row.post_id);
    if (list) list.push(row);
    else byPost.set(row.post_id, [row]);
  }
  return byPost;
}

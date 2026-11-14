/**
 * 機械に渡す記事 1 件の形。**`posts.json`・`search.json`・MCP の `search_posts` が
 * 同じ形で返す**ので 1 箇所に置く。口ごとに組むと、どれか 1 つだけ項目が欠ける。
 *
 * 本文は入れない。読む側は `url` を `Accept: text/markdown` で取るか、MCP なら
 * `get_post` を呼ぶ。
 */
import { getTagsForPosts } from './db/tags.ts';
import type { PostWithPathRow } from './db/types.ts';
import type { Urls } from './paths.ts';
import { postDescription } from './summary.ts';
import { groupByPost } from './view.ts';

export type PostJson = {
  id: string;
  title: string;
  /** canonical の絶対 URL。読む側が組み立て直さずに済む。 */
  url: string;
  published_at: string;
  description: string | null;
  tags: string[];
};

/** 公開記事を `PostJson` にする。タグはまとめて 1 回で引く。 */
export async function postJsonEntries(
  db: D1Database,
  urls: Urls,
  posts: readonly PostWithPathRow[],
): Promise<PostJson[]> {
  const tags = groupByPost(await getTagsForPosts(db, posts.map((post) => post.id)));
  return posts.map((post) => ({
    id: post.public_id,
    title: post.title,
    url: urls.post(post.canonical_path, { absolute: true }),
    // 公開記事なので published_at は必ずある (DB の CHECK)。
    published_at: post.published_at as string,
    description: postDescription(post),
    tags: (tags.get(post.id) ?? []).map((tag) => tag.name),
  }));
}

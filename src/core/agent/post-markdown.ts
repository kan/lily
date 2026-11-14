/**
 * 公開記事 1 本の Markdown 版。**`Accept: text/markdown` の記事ページと、MCP の
 * `get_post` が同じものを返す**ので、組み立てをここに置く。
 *
 * Markdown は原本（`body_md`）から作る。HTML から変換しないので、書き手の記法が
 * そのまま届く。添付の参照だけを絶対 URL に直す（保存してある本文は変えない）。
 */
import { listMediaByPost } from '../db/media.ts';
import { getTagsForPost } from '../db/tags.ts';
import type { PostWithPathRow } from '../db/types.ts';
import type { Urls } from '../paths.ts';
import { absolutizeMediaReferences } from '../render/markdown-media.ts';
import { toPostSummary } from '../view.ts';
import type { MarkdownPages } from './markdown.ts';

export async function publishedPostMarkdown(
  db: D1Database,
  urls: Urls,
  pages: MarkdownPages,
  post: PostWithPathRow,
): Promise<string> {
  const [tags, media] = await Promise.all([
    getTagsForPost(db, post.id),
    listMediaByPost(db, post.id),
  ]);
  const body = absolutizeMediaReferences(post.body_md, media, urls);
  return pages.post(toPostSummary(urls, post, tags, { absolute: true }), body);
}

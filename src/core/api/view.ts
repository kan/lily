/**
 * 管理 API が返す形。
 *
 * **Row をそのまま出さない。** `preview_token_hash` を漏らさないためと、
 * `body_html` のような派生データを管理画面に持たせないため。ここが唯一の
 * 出口なので、列を足しても勝手に外へ出ることがない。
 */
import { blueskyPostUrl } from '../bluesky.ts';
import { listMediaByPost } from '../db/media.ts';
import { listPaths } from '../db/post-paths.ts';
import { getTagsForPost } from '../db/tags.ts';
import type { MediaRow, PostRow, TagRow } from '../db/types.ts';
import { canBeOgp } from '../media/formats.ts';
import type { Urls } from '../paths.ts';

export type MediaView = {
  publicId: string;
  filename: string;
  mime: string;
  bytes: number;
  url: string;
  /** この記事の OGP に選ばれている 1 枚か。 */
  isOgp: boolean;
  /**
   * OGP に選べる形式か。**判断するのは core。** 管理画面が MIME の表を
   * 持つと、受け付ける形式を増やした日に片方だけ古い規則で描かれる。
   */
  canBeOgp: boolean;
};

export type PostView = {
  publicId: string;
  title: string;
  description: string | null;
  bodyMd: string;
  status: 'draft' | 'published';
  publishedAt: string | null;
  updatedAt: string;
  createdAt: string;
  /** プレビュー URL を発行済みか。**トークンそのものは発行時にしか返さない。** */
  hasPreview: boolean;
  blueskyUri: string | null;
  /**
   * 告知した投稿を開く URL。**組むのは core。**
   *
   * `adminUrl` と同じ理由で、完成した URL を渡す（`at://` を bsky.app の URL に
   * 組み替える規則を、管理画面にもテーマにも持たせない）。
   */
  blueskyUrl: string | null;
  canonicalPath: string;
  url: string;
  paths: { path: string; isCanonical: boolean }[];
  tags: TagRef[];
  media: MediaView[];
};

/** レスポンスに載せるタグ。**一覧と個別取得で同じ形にする。** */
export type TagRef = { name: string; slug: string };

export function toTagRefs(tags: readonly TagRow[]): TagRef[] {
  return tags.map((tag) => ({ name: tag.name, slug: tag.slug }));
}

export function toMediaView(urls: Urls, media: MediaRow): MediaView {
  return {
    publicId: media.public_id,
    filename: media.filename,
    mime: media.mime,
    bytes: media.bytes,
    url: urls.media(media),
    isOgp: media.is_ogp === 1,
    canBeOgp: canBeOgp(media.mime),
  };
}

/** 記事 1 件の詳細。paths / tags / media をまとめて引く。 */
export async function toPostView(db: D1Database, urls: Urls, post: PostRow): Promise<PostView> {
  const [paths, tags, media] = await Promise.all([
    listPaths(db, post.id),
    getTagsForPost(db, post.id),
    listMediaByPost(db, post.id),
  ]);
  const canonical = paths.find((p) => p.is_canonical === 1)?.path ?? post.public_id;

  return {
    publicId: post.public_id,
    title: post.title,
    description: post.description,
    bodyMd: post.body_md,
    status: post.status,
    publishedAt: post.published_at,
    updatedAt: post.updated_at,
    createdAt: post.created_at,
    hasPreview: post.preview_token_hash !== null,
    blueskyUri: post.bluesky_uri,
    blueskyUrl: post.bluesky_uri === null ? null : blueskyPostUrl(post.bluesky_uri),
    canonicalPath: canonical,
    url: urls.post(canonical),
    paths: paths.map((p) => ({ path: p.path, isCanonical: p.is_canonical === 1 })),
    tags: toTagRefs(tags),
    media: media.map((m) => toMediaView(urls, m)),
  };
}

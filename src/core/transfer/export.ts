/**
 * portable export。**D1 と R2 の中身を、import がそのまま読める 1 つの書庫にする。**
 *
 * D1 の dump (運用復旧用) とは別物。あちらは D1 / R2 という構成に依存するが、
 * こちらは Markdown と画像なので、lily を捨てても記事が残る。
 *
 * 出力は**決定的**にしてある (記事はパス順、添付はファイル名順、zip は無圧縮、
 * 日時はデータ由来)。同じ DB からは毎回同じバイト列が出るので、往復の検証を
 * 「同じ書庫になるか」で書ける。
 *
 * **書庫に載せる日時は `posts.updated_at` だけ。** 添付の `created_at` は
 * portable な形式が持っていないので、載せると export → import → export で
 * バイト列が変わり、その検証が「時計が進まなかったこと」の確認に成り下がる。
 */
import { listMediaByPosts } from '../db/media.ts';
import { listPathsForPosts } from '../db/post-paths.ts';
import { listAllPosts } from '../db/posts.ts';
import { getTagsForPosts } from '../db/tags.ts';
import type { MediaRow, PostWithPathRow } from '../db/types.ts';
import { groupByPost } from '../view.ts';
import { buildPostFile, POST_FILENAME, POSTS_DIR } from './format.ts';
import { createZip, type ZipEntry } from './zip.ts';

export type ExportWarning = {
  readonly postPath: string;
  readonly filename: string;
  readonly reason: 'media-missing';
};

export type ExportResult = {
  readonly archive: Uint8Array;
  readonly posts: number;
  readonly media: number;
  /**
   * 書庫に入れられなかった添付。**export 自体は止めない。**
   * DB に行があるのに R2 の実体が無い状態を、書庫が作れないことで隠さない。
   */
  readonly warnings: readonly ExportWarning[];
};

/**
 * 書庫に入れられなかった添付を記録する。**export 自体は止めない**ので、
 * DB に行があるのに R2 の実体が無い事実をログにだけ残す。
 *
 * 呼ぶ側が 2 つある（`/api/export` と毎日の控え）ので、文の形をここに 1 つ置く。
 * `source` はどちらから出たものかの目印。
 */
export function logExportWarnings(source: string, warnings: readonly ExportWarning[]): void {
  for (const warning of warnings) {
    console.warn(`lily ${source}: ${warning.reason} ${warning.postPath}/${warning.filename}`);
  }
}

export async function exportArchive(db: D1Database, bucket: R2Bucket): Promise<ExportResult> {
  // 下書きも含めて全部。portable export は「記事が残る」ためのものなので、
  // 公開したものだけでは足りない。
  const posts = [...(await listAllPosts(db))].sort(byCanonicalPath);
  const ids = posts.map((post) => post.id);
  const [paths, media] = await Promise.all([
    listPathsForPosts(db, ids),
    listMediaByPosts(db, ids),
  ]);
  const tags = await tagNamesByPost(db, ids);

  const pathsByPost = groupByPost(paths);
  const mediaByPost = groupByPost(media);

  const entries: ZipEntry[] = [];
  const warnings: ExportWarning[] = [];
  let mediaCount = 0;

  for (const post of posts) {
    const directory = `${POSTS_DIR}/${post.canonical_path}`;
    const attachments = [...(mediaByPost.get(post.id) ?? [])].sort(byFilename);
    const included: MediaRow[] = [];

    // 1 記事ぶんの添付はまとめて取る。直列だと記事が増えたぶんだけ往復が伸びる
    // (Promise.all は順序を保つので、書庫が決定的であることは変わらない)。
    const objects = await Promise.all(attachments.map((item) => bucket.get(item.r2_key)));

    for (const [index, item] of attachments.entries()) {
      const object = objects[index];
      if (!object) {
        warnings.push({
          postPath: post.canonical_path,
          filename: item.filename,
          reason: 'media-missing',
        });
        continue;
      }
      included.push(item);
      entries.push({
        path: `${directory}/${item.filename}`,
        data: new Uint8Array(await object.arrayBuffer()),
        // **添付の created_at は使わない。** portable な形式が持っていない列なので、
        // 取り込み直すと現在時刻に変わり、往復で書庫のバイト列が食い違う。
        // 書庫に載せてよいのは、往復で保たれる値だけ。
        modified: new Date(post.updated_at),
      });
      mediaCount++;
    }

    const text = buildPostFile({
      post,
      // canonical が先頭。listPathsForPosts が並びを固定している。
      paths: (pathsByPost.get(post.id) ?? []).map((row) => row.path),
      tags: tags.get(post.id) ?? [],
      media: included,
    });
    entries.push({
      path: `${directory}/${POST_FILENAME}`,
      data: new TextEncoder().encode(text),
      modified: new Date(post.updated_at),
    });
  }

  // 書庫の中の並びもパス順にする (記事の中では index.md が添付より後に来るが、
  // 中身が同じなら並びも同じ、が保てればよい)。
  entries.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));

  return { archive: createZip(entries), posts: posts.length, media: mediaCount, warnings };
}

/** 記事の並び。**canonical path 昇順**で、書庫の中身を決定的にする。 */
function byCanonicalPath(a: PostWithPathRow, b: PostWithPathRow): number {
  return a.canonical_path < b.canonical_path ? -1 : a.canonical_path > b.canonical_path ? 1 : 0;
}

function byFilename(a: MediaRow, b: MediaRow): number {
  return a.filename < b.filename ? -1 : a.filename > b.filename ? 1 : 0;
}

/**
 * 記事ごとのタグ名。`getTagsForPosts` と同じ並び (name 昇順) をそのまま使う。
 */
async function tagNamesByPost(db: D1Database, ids: number[]): Promise<Map<number, string[]>> {
  const byPost = groupByPost(await getTagsForPosts(db, ids));
  return new Map([...byPost].map(([id, tags]) => [id, tags.map((tag) => tag.name)]));
}

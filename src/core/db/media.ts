/**
 * 添付。本文の相対参照 (`./sample.png`) と `(post_id, filename)` で突き合わせる。
 *
 * 原本は R2 にあり、この表は「どの記事のどのファイル名が、どの R2 キーか」の
 * 対応だけを持つ。配信 URL は `urlForMedia()` が `public_id` から組む。
 */
import { newPublicId, nowIso } from '../ids.ts';
import { queryInChunks } from './chunk.ts';
import { MEDIA_COLUMNS, type MediaRow } from './types.ts';

const MEDIA_SELECT = MEDIA_COLUMNS.join(', ');

/**
 * R2 のキー。**(記事, ファイル名) から決まる。**
 *
 * 管理画面からのアップロードと import の両方がここを通る。片方だけ規則を変えると、
 * 同じ添付が 2 つのキーに散り、消したはずの実体が残る。
 */
export function mediaR2Key(postPublicId: string, filename: string): string {
  return `posts/${postPublicId}/${filename}`;
}

export type CreateMediaInput = {
  postId: number | null;
  filename: string;
  r2Key: string;
  mime: string;
  bytes: number;
  width?: number | null;
  height?: number | null;
  /** import で既存の public_id を保つときだけ渡す。 */
  publicId?: string;
};

export async function createMedia(db: D1Database, input: CreateMediaInput): Promise<MediaRow> {
  const publicId = input.publicId ?? newPublicId();
  await db
    .prepare(
      `INSERT INTO media (public_id, post_id, filename, r2_key, mime, bytes, width, height, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)`,
    )
    .bind(
      publicId,
      input.postId,
      input.filename,
      input.r2Key,
      input.mime,
      input.bytes,
      input.width ?? null,
      input.height ?? null,
      nowIso(),
    )
    .run();

  const created = await getMediaByPublicId(db, publicId);
  if (!created) throw new Error(`createMedia: 作った直後の media が読めない (${publicId})`);
  return created;
}

export async function getMediaByPublicId(
  db: D1Database,
  publicId: string,
): Promise<MediaRow | null> {
  return await db
    .prepare(`SELECT ${MEDIA_SELECT} FROM media WHERE public_id = ?1`)
    .bind(publicId)
    .first<MediaRow>();
}

/** 本文の `./sample.png` を placeholder に置き換えるときに使う。 */
export async function findByPostAndFilename(
  db: D1Database,
  postId: number,
  filename: string,
): Promise<MediaRow | null> {
  return await db
    .prepare(`SELECT ${MEDIA_SELECT} FROM media WHERE post_id = ?1 AND filename = ?2`)
    .bind(postId, filename)
    .first<MediaRow>();
}

export async function listMediaByPost(db: D1Database, postId: number): Promise<MediaRow[]> {
  const { results } = await db
    .prepare(`SELECT ${MEDIA_SELECT} FROM media WHERE post_id = ?1 ORDER BY filename ASC`)
    .bind(postId)
    .all<MediaRow>();
  return results;
}

/** フィードのように複数記事をまとめて描画するときの N+1 回避。 */
export async function listMediaByPosts(
  db: D1Database,
  postIds: number[],
): Promise<MediaRow[]> {
  return await queryInChunks(postIds, async (chunk) => {
    const placeholders = chunk.map((_, i) => `?${i + 1}`).join(', ');
    const { results } = await db
      .prepare(
        `SELECT ${MEDIA_SELECT} FROM media WHERE post_id IN (${placeholders}) ORDER BY filename ASC`,
      )
      .bind(...chunk)
      .all<MediaRow>();
    return results;
  });
}

/**
 * この記事の OGP に使う添付。選んでいなければ null。
 *
 * **`is_ogp = 1` を読む場所はここだけ。** 配信（`og:image`）と告知（リンクカードの
 * サムネ）と export が同じ 1 本を通るので、条件を変える日に片方だけ古い規則が残らない。
 */
export async function getOgpMedia(db: D1Database, postId: number): Promise<MediaRow | null> {
  return await db
    .prepare(`SELECT ${MEDIA_SELECT} FROM media WHERE post_id = ?1 AND is_ogp = 1`)
    .bind(postId)
    .first<MediaRow>();
}

/**
 * OGP に使う添付を選び直す。`mediaId` が null なら選択を外す。
 *
 * **外してから立てるのを 1 トランザクションで行う**（`batch`）。部分ユニーク索引は
 * 「2 枚選ばれている」を防ぐが、途中の状態は防げないので、別々に流すと
 * 立てる側が索引に弾かれる。
 *
 * 立てる方は `post_id` も条件に入れているので、**他の記事の添付は立たない**
 * （呼び出し側の検証と二重に守る）。そのときは外れるだけになる ―― 呼び出し側の
 * 誤りなので、どちらにも倒せるが「知らない絵が選ばれたまま」よりは安全な方へ倒す。
 */
export async function setOgpMedia(
  db: D1Database,
  postId: number,
  mediaId: number | null,
): Promise<void> {
  const statements = [
    db.prepare('UPDATE media SET is_ogp = 0 WHERE post_id = ?1 AND is_ogp = 1').bind(postId),
  ];
  if (mediaId !== null) {
    statements.push(
      db.prepare('UPDATE media SET is_ogp = 1 WHERE id = ?1 AND post_id = ?2').bind(mediaId, postId),
    );
  }
  await db.batch(statements);
}

/**
 * 記事に紐づく R2 のキー。記事を消す前に控えておくために使う
 * (`media` を読むのはこのファイルだけ、という線を守るために置いている)。
 */
export async function listR2KeysByPost(db: D1Database, postId: number): Promise<string[]> {
  const { results } = await db
    .prepare('SELECT r2_key FROM media WHERE post_id = ?1')
    .bind(postId)
    .all<{ r2_key: string }>();
  return results.map((r) => r.r2_key);
}

/** 消した行の R2 キーを返す。R2 のオブジェクト削除は呼び出し側がコミット後に行う。 */
export async function deleteMedia(db: D1Database, id: number): Promise<string | null> {
  const row = await db
    .prepare('SELECT r2_key FROM media WHERE id = ?1')
    .bind(id)
    .first<{ r2_key: string }>();
  if (!row) return null;
  await db.prepare('DELETE FROM media WHERE id = ?1').bind(id).run();
  return row.r2_key;
}

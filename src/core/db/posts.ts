/**
 * 記事の読み書き。**SQL を route や service に書かない。**
 *
 * 並び順は `published_at DESC`、同一時刻のときは `public_id ASC` を stable
 * tie-breaker にする。内部 id ではなく public_id なのは、export / import で
 * integer が振り直されても並びが変わらないようにするため。
 */
import { newPublicId, nowIso } from '../ids.ts';
import type { PostPaths } from '../paths.ts';
import { err, ok, type Result } from '../result.ts';
import { uniqueViolationTarget } from './errors.ts';
import { listR2KeysByPost } from './media.ts';
import { findByPathCi, initialPathStatements, isPathTakenViolation, type PathWriteError } from './post-paths.ts';
import {
  postColumns,
  type PostRow,
  type PostStatus,
  type PostWithPathRow,
} from './types.ts';

/** 一覧・フィード共通の並び。 */
const PUBLISHED_ORDER = 'p.published_at DESC, p.public_id ASC';

/**
 * 「公開記事とは何か」。並び順と同じくここを正にする (`tags.ts` の件数集計も読む)。
 * 条件を変える日に 1 箇所で済み、タグの件数だけ古い条件のまま残ることがない。
 */
export function PUBLISHED_WHERE(alias: string): string {
  return `${alias}.status = 'published'`;
}

/** posts の UNIQUE 制約。identity の衝突とパスの衝突を取り違えないため。 */
const PUBLIC_ID_UNIQUE_TARGET = 'posts.public_id';

export type CreatePostInput = {
  title: string;
  bodyMd: string;
  description?: string | null;
  status?: PostStatus;
  /** UTC ISO8601。`published` で省略したときは現在時刻。 */
  publishedAt?: string | null;
  /** 省略時は新規採番。import では既存の public_id をそのまま渡す。 */
  publicId?: string;
  /** canonical path。省略時は public_id そのもの。 */
  path?: string;
  createdAt?: string;
  updatedAt?: string;
};

/**
 * 記事を作る。posts への INSERT と canonical 行の INSERT を 1 トランザクションで行う。
 *
 * canonical を明示したときは `public_id` を alias としても入れる。**記事は常に
 * public_id で引ける**という不変条件を、URL を変えても保つため。
 */
export async function createPost(
  db: D1Database,
  paths: PostPaths,
  input: CreatePostInput,
): Promise<Result<PostRow, PathWriteError>> {
  const publicId = input.publicId ?? newPublicId();
  const now = nowIso();
  const status = input.status ?? 'draft';
  const publishedAt =
    input.publishedAt ?? (status === 'published' ? now : null);

  let canonical = publicId;
  if (input.path !== undefined) {
    const normalized = paths.normalizePostPath(input.path);
    if (!normalized.ok) return err(normalized.error);
    canonical = normalized.value;

    if (await findByPathCi(db, canonical)) return err({ code: 'path-taken' });
  }

  const statements = [
    db
      .prepare(
        `INSERT INTO posts
           (public_id, title, description, body_md, status, published_at, updated_at, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`,
      )
      .bind(
        publicId,
        input.title,
        input.description ?? null,
        input.bodyMd,
        status,
        publishedAt,
        input.updatedAt ?? now,
        input.createdAt ?? now,
      ),
    ...initialPathStatements(db, { publicId, canonical, now }),
  ];
  try {
    await db.batch(statements);
  } catch (error) {
    // 上の SELECT との間に同じものを作られた場合。check-then-act の隙間を埋める。
    // posts と post_paths の両方に INSERT するので、どちらの衝突かで分ける。
    if (uniqueViolationTarget(error) === PUBLIC_ID_UNIQUE_TARGET) {
      return err({ code: 'public-id-taken' });
    }
    if (isPathTakenViolation(error)) return err({ code: 'path-taken' });
    throw error;
  }

  const created = await getPostByPublicId(db, publicId);
  if (!created) throw new Error(`createPost: 作った直後の記事が読めない (${publicId})`);
  return ok(created);
}

export async function getPostById(db: D1Database, id: number): Promise<PostRow | null> {
  return await db
    .prepare(`SELECT ${postColumns('p')} FROM posts p WHERE p.id = ?1`)
    .bind(id)
    .first<PostRow>();
}

export async function getPostByPublicId(db: D1Database, publicId: string): Promise<PostRow | null> {
  return await db
    .prepare(`SELECT ${postColumns('p')} FROM posts p WHERE p.public_id = ?1`)
    .bind(publicId)
    .first<PostRow>();
}

/** 下書きプレビュー。ハッシュで引くので、生トークンは DB に無くてよい。 */
export async function getPostByPreviewTokenHash(
  db: D1Database,
  tokenHash: string,
): Promise<PostRow | null> {
  return await db
    .prepare(`SELECT ${postColumns('p')} FROM posts p WHERE p.preview_token_hash = ?1`)
    .bind(tokenHash)
    .first<PostRow>();
}

export type ListOptions = { limit?: number; offset?: number };

export async function getPublishedPosts(
  db: D1Database,
  options: ListOptions = {},
): Promise<PostWithPathRow[]> {
  const { results } = await db
    .prepare(
      `SELECT ${postColumns('p')}, c.path AS canonical_path
         FROM posts p
         JOIN post_paths c ON c.post_id = p.id AND c.is_canonical = 1
        WHERE ${PUBLISHED_WHERE('p')}
        ORDER BY ${PUBLISHED_ORDER}
        LIMIT ?1 OFFSET ?2`,
    )
    .bind(options.limit ?? -1, options.offset ?? 0)
    .all<PostWithPathRow>();
  return results;
}

export async function getPublishedPostsByTagSlug(
  db: D1Database,
  slug: string,
  options: ListOptions = {},
): Promise<PostWithPathRow[]> {
  const { results } = await db
    .prepare(
      `SELECT ${postColumns('p')}, c.path AS canonical_path
         FROM posts p
         JOIN post_paths c ON c.post_id = p.id AND c.is_canonical = 1
         JOIN post_tags pt ON pt.post_id = p.id
         JOIN tags t ON t.id = pt.tag_id
        WHERE ${PUBLISHED_WHERE('p')} AND t.slug = ?1
        ORDER BY ${PUBLISHED_ORDER}
        LIMIT ?2 OFFSET ?3`,
    )
    .bind(slug, options.limit ?? -1, options.offset ?? 0)
    .all<PostWithPathRow>();
  return results;
}

export async function countPublishedPosts(db: D1Database): Promise<number> {
  const row = await db
    .prepare(`SELECT count(*) AS n FROM posts p WHERE ${PUBLISHED_WHERE('p')}`)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

/** タグで絞った公開記事の件数。ページ送りに使う。 */
export async function countPublishedPostsByTagSlug(db: D1Database, slug: string): Promise<number> {
  const row = await db
    .prepare(
      `SELECT count(*) AS n
         FROM posts p
         JOIN post_tags pt ON pt.post_id = p.id
         JOIN tags t ON t.id = pt.tag_id
        WHERE ${PUBLISHED_WHERE('p')} AND t.slug = ?1`,
    )
    .bind(slug)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

/**
 * 管理画面の絞り込み。**一覧と件数が同じ条件を見るための型。**
 *
 * 2 つのクエリに別々に条件を書くと、片方だけ直した日にページャが嘘をつく
 * (`total` は全件のまま、行だけ絞られる)。条件の組み立ては `postFilter()` 1 箇所。
 */
export type PostFilter = {
  status?: PostStatus;
  /** タグの slug。`tags.slug` は UNIQUE なので 1 つに定まる。 */
  tag?: string;
  /** タイトル・説明・本文の部分一致。空文字は絞り込み無しと同じ。 */
  q?: string;
};

/**
 * LIKE のパターンに使えない文字を無害にする。
 *
 * **これをしないと `_` を含む語がほぼ全件に一致する** (LIKE の `_` は任意の
 * 1 文字)。`%` も同様。エスケープ文字自身が先。
 */
function likePattern(q: string): string {
  return `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

/**
 * WHERE 句と bind する値を組む。**`p` の別名を前提**にする。
 *
 * 番号付きの placeholder は使わず `?` を並べる。値の順番と並びが 1 対 1 で
 * 対応するので、条件を足したときに番号を振り直す必要がない。
 */
function postFilter(filter: PostFilter): { where: string; values: (string | null)[] } {
  const conditions: string[] = [];
  const values: (string | null)[] = [];

  if (filter.status) {
    conditions.push('p.status = ?');
    values.push(filter.status);
  }
  if (filter.tag) {
    // JOIN ではなく EXISTS。JOIN だと (将来 slug 以外で絞ったときに) 同じ記事が
    // タグの数だけ並び、LIMIT と件数が食い違う。
    conditions.push(
      `EXISTS (SELECT 1 FROM post_tags pt JOIN tags t ON t.id = pt.tag_id
                WHERE pt.post_id = p.id AND t.slug = ?)`,
    );
    values.push(filter.tag);
  }
  if (filter.q) {
    // 本文まで見る。「あの記事どこだっけ」で引けないと検索の意味が薄いので、
    // 全走査になることは承知で入れてある (数百本までは D1 でも一瞬)。
    const pattern = likePattern(filter.q);
    conditions.push(
      `(p.title LIKE ? ESCAPE '\\'
        OR coalesce(p.description, '') LIKE ? ESCAPE '\\'
        OR p.body_md LIKE ? ESCAPE '\\')`,
    );
    values.push(pattern, pattern, pattern);
  }

  return {
    where: conditions.length === 0 ? '1 = 1' : conditions.join(' AND '),
    values,
  };
}

/** 管理画面のページャ用。**一覧と同じ絞り込みを渡すこと。** */
export async function countPosts(db: D1Database, filter: PostFilter = {}): Promise<number> {
  const { where, values } = postFilter(filter);
  const row = await db
    .prepare(`SELECT count(*) AS n FROM posts p WHERE ${where}`)
    .bind(...values)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

/** 管理画面と export 用。下書きも含めて全部返す。 */
export async function listAllPosts(
  db: D1Database,
  options: ListOptions & PostFilter = {},
): Promise<PostWithPathRow[]> {
  const { where, values } = postFilter(options);
  const { results } = await db
    .prepare(
      `SELECT ${postColumns('p')}, c.path AS canonical_path
         FROM posts p
         JOIN post_paths c ON c.post_id = p.id AND c.is_canonical = 1
        WHERE ${where}
        ORDER BY coalesce(p.published_at, p.created_at) DESC, p.public_id ASC
        LIMIT ? OFFSET ?`,
    )
    .bind(...values, options.limit ?? -1, options.offset ?? 0)
    .all<PostWithPathRow>();
  return results;
}

/** UPDATE で受け付ける列。ここに無い列はこの関数からは触れない。 */
/**
 * UPDATE で受け付ける列。
 *
 * **`status` は入れない。** `published_at` と CHECK で結ばれているので、
 * 片方だけ動かすと DB に弾かれる。`body_html` / `renderer_version` を
 * `setRenderedHtml` に分けたのと同じ理由で、公開・取り下げは名前の付いた
 * 操作 (`publishPost` / `unpublishPost`) にする。
 *
 * **`preview_token_hash` と `bluesky_uri` も入れない。** 読者から見えるものは
 * 何も変わらないのに `updated_at` が動くと、sitemap の lastmod と Atom の
 * <updated> が進み、購読者のリーダーに記事が浮き上がる
 * (`setPreviewToken` / `setBlueskyUri` を使う)。
 */
const PATCHABLE = [
  'title',
  'description',
  'body_md',
  'published_at',
] as const;

/** 値の型は PostRow から取る。列の一覧と型を二重に書かないため。 */
export type PostPatch = Partial<Pick<PostRow, (typeof PATCHABLE)[number]>>;

/** 記事を更新する。列を機械的に流すだけで、呼び出し側の意図は推測しない。 */
export async function updatePost(
  db: D1Database,
  id: number,
  patch: PostPatch,
): Promise<PostRow | null> {
  const assignments: string[] = [];
  const values: (string | null)[] = [];
  for (const column of PATCHABLE) {
    const value = patch[column];
    if (value === undefined) continue;
    values.push(value);
    assignments.push(`${column} = ?${values.length}`);
  }
  values.push(nowIso());
  assignments.push(`updated_at = ?${values.length}`);

  await db
    .prepare(`UPDATE posts SET ${assignments.join(', ')} WHERE id = ?${values.length + 1}`)
    .bind(...values, id)
    .run();
  return await getPostById(db, id);
}

/**
 * 公開する。
 *
 * `published_at` は初回だけ入れて、取り下げてから再公開したときは元の日付を保つ
 * (`coalesce`)。日付を明示したいときだけ `publishedAt` を渡す。
 */
export async function publishPost(
  db: D1Database,
  id: number,
  publishedAt?: string,
): Promise<PostRow | null> {
  await db
    .prepare(
      `UPDATE posts
          SET status = 'published',
              published_at = coalesce(?1, published_at, ?2),
              updated_at = ?2
        WHERE id = ?3`,
    )
    .bind(publishedAt ?? null, nowIso(), id)
    .run();
  return await getPostById(db, id);
}

/** 取り下げる。`published_at` は残すので、再公開すると元の日付に戻る。 */
export async function unpublishPost(db: D1Database, id: number): Promise<PostRow | null> {
  await db
    .prepare("UPDATE posts SET status = 'draft', updated_at = ?1 WHERE id = ?2")
    .bind(nowIso(), id)
    .run();
  return await getPostById(db, id);
}

/**
 * プレビューのトークン (のハッシュ) を入れ替える。`null` で失効。
 *
 * **`updated_at` を動かさない。** 読者から見えるものは変わらないので、
 * フィードや sitemap に「更新された」と伝わってはいけない。
 */
export async function setPreviewToken(
  db: D1Database,
  id: number,
  hash: string | null,
): Promise<void> {
  await db
    .prepare('UPDATE posts SET preview_token_hash = ?1 WHERE id = ?2')
    .bind(hash, id)
    .run();
}

/**
 * 告知した投稿の AT-URI を記録する。**二重投稿の抑止はこの列。**
 *
 * `setPreviewToken` と同じく **`updated_at` を動かさない**。告知しても読者から
 * 見える中身は 1 バイトも変わらないので、Atom の `<updated>` と sitemap の
 * `lastmod` が進んではいけない（購読者のリーダーに記事が浮き上がる）。
 *
 * **既に入っていたら上書きしない**（入れられたら true）。告知は「読んで →
 * 数秒かけて外へ投げて → 書く」なので、続けて 2 回押されると両方が空を見る。
 * 上書きすると**先に投げた方の AT-URI が消える**（消せない投稿が DB から
 * 辿れなくなる）。呼び出し側は false を記録に残す。
 */
export async function setBlueskyUri(db: D1Database, id: number, uri: string): Promise<boolean> {
  const result = await db
    .prepare('UPDATE posts SET bluesky_uri = ?1 WHERE id = ?2 AND bluesky_uri IS NULL')
    .bind(uri, id)
    .run();
  return (result.meta.changes ?? 0) > 0;
}

/**
 * `body_html` が古い renderer で作られた記事。再描画の対象を絞るのに使う。
 */
export async function listPostsNeedingRender(
  db: D1Database,
  rendererVersion: string,
  limit: number,
): Promise<PostRow[]> {
  const { results } = await db
    .prepare(
      `SELECT ${postColumns('p')} FROM posts p
        WHERE p.renderer_version IS NULL OR p.renderer_version <> ?1
        ORDER BY p.id ASC LIMIT ?2`,
    )
    .bind(rendererVersion, limit)
    .all<PostRow>();
  return results;
}

/** 再描画がまだ要る記事の数。 */
export async function countPostsNeedingRender(
  db: D1Database,
  rendererVersion: string,
): Promise<number> {
  const row = await db
    .prepare(
      'SELECT count(*) AS n FROM posts WHERE renderer_version IS NULL OR renderer_version <> ?1',
    )
    .bind(rendererVersion)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

/**
 * 描画結果を保存する。`body_html` は派生データなので、renderer を更新したときは
 * 全記事についてこれを呼び直す。
 */
export async function setRenderedHtml(
  db: D1Database,
  id: number,
  bodyHtml: string,
  rendererVersion: string,
): Promise<void> {
  await db
    .prepare('UPDATE posts SET body_html = ?1, renderer_version = ?2 WHERE id = ?3')
    .bind(bodyHtml, rendererVersion, id)
    .run();
}

/**
 * 記事を消す。paths / media / post_tags は CASCADE で落ちる。
 *
 * **R2 のオブジェクト削除はコミット後**に行うので、消すべきキーを返す。
 * 失敗した分は孤児掃除に任せる (DB を巻き戻すより残骸の方が安い)。
 */
export async function deletePost(db: D1Database, id: number): Promise<string[]> {
  const keys = await listR2KeysByPost(db, id);
  await db.prepare('DELETE FROM posts WHERE id = ?1').bind(id).run();
  return keys;
}

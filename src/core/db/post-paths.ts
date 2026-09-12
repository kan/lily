/**
 * 公開 URL の正。`post_paths` に触るのはこのファイルだけ。
 *
 * 記事の identity は `posts.public_id`、URL は `post_paths` と分けてあるので、
 * URL は後から変えられて旧 URL は alias として残る。
 */
import type { PathErrorCode, PostPaths } from '../paths.ts';
import { err, ok, type Result } from '../result.ts';
import { nowIso } from '../ids.ts';
import { queryInChunks } from './chunk.ts';
import { uniqueViolationTarget } from './errors.ts';
import { postColumns, type PostPathRow, type ResolvedPathRow } from './types.ts';

export type PathWriteErrorCode =
  | PathErrorCode
  /** 同じパス (大小文字違いを含む) を別の記事が持っている。 */
  | 'path-taken'
  /** 同じ public_id の記事が既にある (import で持ち込んだときだけ起こる)。 */
  | 'public-id-taken'
  | 'post-not-found'
  /** canonical は 1 本必要なので消せない。 */
  | 'canonical-required'
  /** public_id のパスは identity なので消せない。 */
  | 'public-id-path';

export type PathWriteError = { readonly code: PathWriteErrorCode; readonly segment?: string };

/**
 * リクエストされたパスから記事を引く。
 *
 * **照合は `lower(path)`**。`post_paths_path_ci` の索引と同じ土俵に乗るので、
 * 大小文字が違うだけの URL も記事に辿り着き、canonical と違えば route が 308 する
 * (alias と同じ扱い)。SQLite の `lower()` は ASCII しか畳まないが、索引側も
 * 同じ関数なので食い違わない。
 */
export async function resolvePath(db: D1Database, path: string): Promise<ResolvedPathRow | null> {
  return await db
    .prepare(
      `SELECT ${postColumns('p')},
              m.path AS matched_path,
              m.is_canonical AS matched_is_canonical,
              c.path AS canonical_path
         FROM post_paths m
         JOIN posts p ON p.id = m.post_id
         JOIN post_paths c ON c.post_id = p.id AND c.is_canonical = 1
        WHERE lower(m.path) = lower(?1)`,
    )
    .bind(path)
    .first<ResolvedPathRow>();
}

/**
 * パスの並び。**canonical が先頭、以下 path 昇順。**
 *
 * 1 件版とまとめ取得で別々に書くと、export の frontmatter が「記事の取り方」で
 * 変わってしまう (`paths` の先頭が canonical でなくなる)。
 */
const PATH_ORDER = 'is_canonical DESC, path ASC';

export async function listPaths(db: D1Database, postId: number): Promise<PostPathRow[]> {
  const { results } = await db
    .prepare(
      `SELECT path, post_id, is_canonical, created_at
         FROM post_paths WHERE post_id = ?1 ORDER BY ${PATH_ORDER}`,
    )
    .bind(postId)
    .all<PostPathRow>();
  return results;
}

/**
 * 複数記事のパスをまとめて引く。export が記事の数だけ問い合わせないようにするため。
 * 並びは 1 記事版と同じ (`PATH_ORDER`)。
 */
export async function listPathsForPosts(
  db: D1Database,
  postIds: number[],
): Promise<PostPathRow[]> {
  return await queryInChunks(postIds, async (chunk) => {
    const placeholders = chunk.map((_, i) => `?${i + 1}`).join(', ');
    const { results } = await db
      .prepare(
        `SELECT path, post_id, is_canonical, created_at
           FROM post_paths WHERE post_id IN (${placeholders})
          ORDER BY post_id ASC, ${PATH_ORDER}`,
      )
      .bind(...chunk)
      .all<PostPathRow>();
    return results;
  });
}

export async function getCanonicalPath(db: D1Database, postId: number): Promise<string | null> {
  const row = await db
    .prepare('SELECT path FROM post_paths WHERE post_id = ?1 AND is_canonical = 1')
    .bind(postId)
    .first<{ path: string }>();
  return row?.path ?? null;
}

/**
 * 大小文字違いも含めて、そのパスを既に持っている行。
 *
 * `post_paths` を読むのはこのファイルだけ、という線を守るために公開している
 * (`createPost` も自前の SELECT ではなくこれを通す)。
 */
export async function findByPathCi(
  db: D1Database,
  path: string,
): Promise<{ path: string; post_id: number } | null> {
  return await db
    .prepare('SELECT path, post_id FROM post_paths WHERE lower(path) = lower(?1)')
    .bind(path)
    .first<{ path: string; post_id: number }>();
}

/** 記事の identity。パスが identity 行かどうかの判定にも使う。 */
async function getPostPublicId(db: D1Database, postId: number): Promise<string | null> {
  const row = await db
    .prepare('SELECT public_id FROM posts WHERE id = ?1')
    .bind(postId)
    .first<{ public_id: string }>();
  return row?.public_id ?? null;
}

/** `post_paths` の UNIQUE 制約。どの制約が破れたかで呼び出し側の分岐が変わる。 */
const PATH_UNIQUE_TARGETS = new Set(['post_paths_path_ci', 'post_paths.path']);

export function isPathTakenViolation(error: unknown): boolean {
  const target = uniqueViolationTarget(error);
  return target !== null && PATH_UNIQUE_TARGETS.has(target);
}

function insertPathStatement(
  db: D1Database,
  input: { path: string; publicId: string; isCanonical: boolean; now: string },
): D1PreparedStatement {
  // post_id は last_insert_rowid() ではなく public_id の副問い合わせで引く。
  // batch の中で前の文の副作用に依存しないぶん、読んで分かる形になる。
  return db
    .prepare(
      `INSERT INTO post_paths (path, post_id, is_canonical, created_at)
       VALUES (?1, (SELECT id FROM posts WHERE public_id = ?2), ?3, ?4)`,
    )
    .bind(input.path, input.publicId, input.isCanonical ? 1 : 0, input.now);
}

/**
 * 新しい記事の paths を作る文。**canonical と identity をまとめて作る。**
 *
 * 「記事は常に public_id で引ける」という不変条件を守るコードをこのファイルに
 * 閉じ込めるため、1 行ずつの INSERT は外へ出さない。別の作成経路 (import /
 * 複製 / restore) を足したときに identity 行を入れ忘れると、
 * `removePath` や `changeCanonicalPath` のガードは「無い行」を守れない。
 */
export function initialPathStatements(
  db: D1Database,
  input: { publicId: string; canonical: string; now: string },
): D1PreparedStatement[] {
  const statements = [
    insertPathStatement(db, {
      path: input.canonical,
      publicId: input.publicId,
      isCanonical: true,
      now: input.now,
    }),
  ];
  if (input.canonical !== input.publicId) {
    statements.push(
      insertPathStatement(db, {
        path: input.publicId,
        publicId: input.publicId,
        isCanonical: false,
        now: input.now,
      }),
    );
  }
  return statements;
}

/**
 * canonical を張り替える。**旧 canonical は alias として残す。**
 *
 * 部分ユニーク索引は「canonical が 2 本」を防げても「0 本」の途中状態は防げないので、
 * 1 トランザクション (`batch`) で 0 にしてから 1 にする。
 */
export async function changeCanonicalPath(
  db: D1Database,
  paths: PostPaths,
  postId: number,
  rawPath: string,
): Promise<Result<string, PathWriteError>> {
  const normalized = paths.normalizePostPath(rawPath);
  if (!normalized.ok) return err(normalized.error);
  const path = normalized.value;

  // 互いに独立した 2 本なので同時に投げる
  const [publicId, existing] = await Promise.all([
    getPostPublicId(db, postId),
    findByPathCi(db, path),
  ]);
  if (publicId === null) return err({ code: 'post-not-found' });
  if (existing && existing.post_id !== postId) return err({ code: 'path-taken' });
  // identity 行 (path === public_id) は大小文字であっても書き換えない。書き換えると
  // 素の public_id では引けなくなり、「記事は常に public_id で引ける」が壊れる。
  if (existing && existing.path !== path && existing.path.toLowerCase() === publicId.toLowerCase()) {
    return err({ code: 'public-id-path' });
  }

  const now = nowIso();
  const statements: D1PreparedStatement[] = [];
  if (!existing) {
    statements.push(
      db
        .prepare(
          `INSERT INTO post_paths (path, post_id, is_canonical, created_at) VALUES (?1, ?2, 0, ?3)`,
        )
        .bind(path, postId, now),
    );
  } else if (existing.path !== path) {
    // 大小文字だけの変更。ci 索引があるので 2 行は並べられず、同じ行を書き換える
    // (この 1 ケースだけ旧パスが alias として残らない)。
    statements.push(
      db.prepare('UPDATE post_paths SET path = ?1 WHERE path = ?2').bind(path, existing.path),
    );
  }
  statements.push(
    db
      .prepare('UPDATE post_paths SET is_canonical = 0 WHERE post_id = ?1 AND path <> ?2')
      .bind(postId, path),
    db
      .prepare('UPDATE post_paths SET is_canonical = 1 WHERE post_id = ?1 AND path = ?2')
      .bind(postId, path),
  );
  await db.batch(statements);
  return ok(path);
}

export async function addAlias(
  db: D1Database,
  paths: PostPaths,
  postId: number,
  rawPath: string,
): Promise<Result<string, PathWriteError>> {
  const normalized = paths.normalizePostPath(rawPath);
  if (!normalized.ok) return err(normalized.error);
  const path = normalized.value;

  const [existing, publicId] = await Promise.all([
    findByPathCi(db, path),
    getPostPublicId(db, postId),
  ]);
  // 同じ記事が大小文字違いで持っている場合も弾く。ci 索引で 2 行は並べられず、
  // ここで黙って既存行を書き換えると canonical のパスが変わってしまう。
  if (existing) return err({ code: 'path-taken' });
  if (publicId === null) return err({ code: 'post-not-found' });

  try {
    await db
      .prepare('INSERT INTO post_paths (path, post_id, is_canonical, created_at) VALUES (?1, ?2, 0, ?3)')
      .bind(path, postId, nowIso())
      .run();
  } catch (error) {
    // 上の SELECT との間に同じパスを作られた場合。check-then-act の隙間を埋める。
    if (isPathTakenViolation(error)) return err({ code: 'path-taken' });
    throw error;
  }
  return ok(path);
}

export async function removePath(
  db: D1Database,
  paths: PostPaths,
  postId: number,
  rawPath: string,
): Promise<Result<void, PathWriteError>> {
  const normalized = paths.normalizePostPath(rawPath);
  if (!normalized.ok) return err(normalized.error);
  const path = normalized.value;

  const row = await db
    .prepare(
      `SELECT pp.path, pp.is_canonical, p.public_id
         FROM post_paths pp JOIN posts p ON p.id = pp.post_id
        WHERE pp.post_id = ?1 AND lower(pp.path) = lower(?2)`,
    )
    .bind(postId, path)
    .first<{ path: string; is_canonical: 0 | 1; public_id: string }>();
  if (!row) return err({ code: 'post-not-found' });
  if (row.is_canonical === 1) return err({ code: 'canonical-required' });
  // 行引きが lower() なので、ここも lower() で比べる。identity 行が public_id と
  // 大小文字違いになる経路は今は塞いである (changeCanonicalPath が identity 行を
  // 書き換えない) ので、これは二重の守り。片方だけ厳密にすると、その経路が
  // 開いた日にガードだけがすり抜ける。
  if (row.path.toLowerCase() === row.public_id.toLowerCase()) {
    return err({ code: 'public-id-path' });
  }

  await db.prepare('DELETE FROM post_paths WHERE path = ?1').bind(row.path).run();
  return ok(undefined);
}

/**
 * タグ。名前が正で、slug は URL 用の派生。
 */
import { err, ok, type Result } from '../result.ts';
import { slugifyTag } from '../slug.ts';
import { queryInChunks } from './chunk.ts';
import { PUBLISHED_WHERE } from './posts.ts';
import { qualify, TAG_COLUMNS, type PostTagRow, type TagRow, type TagWithCountRow } from './types.ts';

export async function getTagBySlug(db: D1Database, slug: string): Promise<TagRow | null> {
  return await db
    .prepare(`SELECT ${TAG_COLUMNS.join(', ')} FROM tags WHERE slug = ?1`)
    .bind(slug)
    .first<TagRow>();
}

/** タグ一覧ページ用。**公開記事だけを数える**ので、下書きしか無いタグは 0 件になる。 */
export async function listTagsWithCounts(db: D1Database): Promise<TagWithCountRow[]> {
  const { results } = await db
    .prepare(
      `SELECT ${qualify(TAG_COLUMNS, 't')}, count(p.id) AS post_count
         FROM tags t
         LEFT JOIN post_tags pt ON pt.tag_id = t.id
         LEFT JOIN posts p ON p.id = pt.post_id AND ${PUBLISHED_WHERE('p')}
        GROUP BY ${qualify(TAG_COLUMNS, 't')}
        ORDER BY post_count DESC, t.name ASC`,
    )
    .all<TagWithCountRow>();
  return results;
}

export async function getTagsForPost(db: D1Database, postId: number): Promise<TagRow[]> {
  const { results } = await db
    .prepare(
      `SELECT ${qualify(TAG_COLUMNS, 't')}
         FROM tags t JOIN post_tags pt ON pt.tag_id = t.id
        WHERE pt.post_id = ?1 ORDER BY t.name ASC`,
    )
    .bind(postId)
    .all<TagRow>();
  return results;
}

/** 一覧ページで N+1 を避けるためのまとめ取得。 */
export async function getTagsForPosts(db: D1Database, postIds: number[]): Promise<PostTagRow[]> {
  return await queryInChunks(postIds, async (chunk) => {
    const placeholders = chunk.map((_, i) => `?${i + 1}`).join(', ');
    const { results } = await db
      .prepare(
        `SELECT pt.post_id, ${qualify(TAG_COLUMNS, 't')}
           FROM tags t JOIN post_tags pt ON pt.tag_id = t.id
          WHERE pt.post_id IN (${placeholders})
          ORDER BY t.name ASC`,
      )
      .bind(...chunk)
      .all<PostTagRow>();
    return results;
  });
}

export type SetPostTagsError = {
  readonly code: 'invalid-slug' | 'slug-taken';
  readonly name: string;
  /** `slug-taken` のとき、その slug を既に持っているタグの名前。 */
  readonly existingName?: string;
};

/**
 * 記事のタグを丸ごと置き換える。付け外しを 1 トランザクションで行う。
 *
 * 名前が違うのに slug が同じになるタグ (`Dev` に対する `dev`) は、管理画面から
 * 普通に起こりうる入力なので `Result` で返す。DB の `tags.slug` UNIQUE は
 * 最終防衛線として残っているが、そこまで届く前にここで畳む。
 */
export type ResolvedTag = { readonly name: string; readonly slug: string };

/**
 * タグ名を slug まで解決し、衝突を洗う。**書き込みはしない。**
 *
 * 記事を作る前に呼べるように分けてある。作ってから弾くと、失敗を返したのに
 * 記事だけ残る (呼び出し側は「作成に失敗した」と見ているのに、一覧には出るし
 * 同じパスで作り直すと 409 になる)。
 */
export async function resolveTags(
  db: D1Database,
  names: readonly string[],
): Promise<Result<ResolvedTag[], SetPostTagsError>> {
  const tags: ResolvedTag[] = [];
  /** slug → 名前。渡された中での衝突もここで見る。 */
  const bySlug = new Map<string, string>();

  for (const raw of names) {
    const name = raw.normalize('NFC').trim();
    if (name === '') continue;
    if (tags.some((t) => t.name === name)) continue;

    const slug = slugifyTag(name);
    if (!slug.ok) return err({ code: 'invalid-slug', name });

    // `['Dev', 'dev']` のように、1 回の呼び出しの中で slug が衝突する組。
    // ON CONFLICT (name) は名前の衝突しか吸収しないので、ここで止めないと
    // tags.slug の UNIQUE 違反が batch ごと生の例外になって漏れる。
    const owner = bySlug.get(slug.value);
    if (owner !== undefined) return err({ code: 'slug-taken', name, existingName: owner });

    bySlug.set(slug.value, name);
    tags.push({ name, slug: slug.value });
  }

  const conflict = await findSlugConflict(db, bySlug);
  return conflict ? err(conflict) : ok(tags);
}

export async function setPostTags(
  db: D1Database,
  postId: number,
  names: string[],
): Promise<Result<void, SetPostTagsError>> {
  const resolved = await resolveTags(db, names);
  if (!resolved.ok) return resolved;
  await applyTags(db, postId, resolved.value);
  return ok(undefined);
}

/** 解決済みのタグを付け替える。付け外しを 1 トランザクションで行う。 */
export async function applyTags(
  db: D1Database,
  postId: number,
  tags: readonly ResolvedTag[],
): Promise<void> {
  const statements = [
    db.prepare('DELETE FROM post_tags WHERE post_id = ?1').bind(postId),
    ...tags.map((t) =>
      db
        .prepare('INSERT INTO tags (name, slug) VALUES (?1, ?2) ON CONFLICT (name) DO NOTHING')
        .bind(t.name, t.slug),
    ),
    ...tags.map((t) =>
      db
        .prepare('INSERT INTO post_tags (post_id, tag_id) SELECT ?1, id FROM tags WHERE name = ?2')
        .bind(postId, t.name),
    ),
  ];
  await db.batch(statements);
}

/** 同じ slug を別の名前のタグが既に DB に持っていないか。 */
async function findSlugConflict(
  db: D1Database,
  bySlug: ReadonlyMap<string, string>,
): Promise<SetPostTagsError | null> {
  if (bySlug.size === 0) return null;
  const slugs = [...bySlug.keys()];
  const placeholders = slugs.map((_, i) => `?${i + 1}`).join(', ');
  const { results } = await db
    .prepare(`SELECT name, slug FROM tags WHERE slug IN (${placeholders})`)
    .bind(...slugs)
    .all<{ name: string; slug: string }>();

  for (const row of results) {
    const wanted = bySlug.get(row.slug);
    if (wanted !== undefined && wanted !== row.name) {
      return { code: 'slug-taken', name: wanted, existingName: row.name };
    }
  }
  return null;
}

/** どの記事にも付いていないタグを掃除する。 */
export async function deleteOrphanTags(db: D1Database): Promise<void> {
  await db.prepare('DELETE FROM tags WHERE id NOT IN (SELECT tag_id FROM post_tags)').run();
}

import { beforeEach, describe, expect, it } from 'vitest';
import { createPost, getPublishedPostsByTagSlug } from '../../src/core/db/posts.ts';
import {
  deleteOrphanTags,
  getTagBySlug,
  getTagsForPost,
  getTagsForPosts,
  listTagsWithCounts,
  setPostTags,
} from '../../src/core/db/tags.ts';
import { slugifyTag } from '../../src/core/slug.ts';
import type { PostRow } from '../../src/core/db/types.ts';
import { db, paths, resetDb } from './helpers.ts';

beforeEach(resetDb);

async function create(path: string, status: 'draft' | 'published' = 'published'): Promise<PostRow> {
  const result = await createPost(db, paths, {
    title: path,
    bodyMd: 'x',
    path,
    status,
    publishedAt: status === 'published' ? '2026-01-01T00:00:00.000Z' : null,
  });
  if (!result.ok) throw new Error(`createPost に失敗した: ${result.error.code}`);
  return result.value;
}

describe('slugifyTag', () => {
  /** 失敗を null にして 1 行で比べられるようにする。 */
  function slug(name: string): string | null {
    const result = slugifyTag(name);
    return result.ok ? result.value : null;
  }

  it('URL に置ける形にする', () => {
    expect(slug('Dev')).toBe('dev');
    expect(slug('web dev')).toBe('web-dev');
    expect(slug('  a  b  ')).toBe('a-b');
  });

  it('日本語はそのまま slug になる (URL を組むときにエンコードする)', () => {
    expect(slug('日記')).toBe('日記');
  });

  it('パスに置けない文字は落とす', () => {
    expect(slug('a/b?c')).toBe('abc');
  });

  it('落とした結果が空なら失敗にする', () => {
    expect(slug('///')).toBeNull();
    expect(slug('  ')).toBeNull();
  });

  it('. と .. は拒否する (/tags/../ のような URL を組まないため)', () => {
    expect(slug('.')).toBeNull();
    expect(slug('..')).toBeNull();
    // encodeURIComponent はドットを素通しするので、slug 側で止めるしかない
    expect(encodeURIComponent('..')).toBe('..');
  });

  it('記事パスと同じ規則で弾く (規則を 2 本持たない)', () => {
    // normalizeSegment を通しているので、Windows 予約名も末尾ドットも同じ扱いになる
    expect(slug('con')).toBeNull();
    expect(slug('foo.')).toBeNull();
    expect(slug('a'.repeat(81))).toBeNull();
  });
});

describe('setPostTags', () => {
  it('タグを作って紐付ける', async () => {
    const post = await create('a');
    expect((await setPostTags(db, post.id, ['Dev', '日記'])).ok).toBe(true);

    expect((await getTagsForPost(db, post.id)).map((t) => t.name).sort()).toEqual(['Dev', '日記']);
    expect((await getTagBySlug(db, 'dev'))?.name).toBe('Dev');
  });

  it('丸ごと置き換える', async () => {
    const post = await create('a');
    await setPostTags(db, post.id, ['x', 'y']);
    await setPostTags(db, post.id, ['y', 'z']);
    expect((await getTagsForPost(db, post.id)).map((t) => t.name)).toEqual(['y', 'z']);
  });

  it('同じ名前を重ねて渡しても 1 つ', async () => {
    const post = await create('a');
    await setPostTags(db, post.id, ['dev', 'dev', ' dev ']);
    expect(await getTagsForPost(db, post.id)).toHaveLength(1);
  });

  it('slug が空になる名前は拒否する', async () => {
    const post = await create('a');
    const result = await setPostTags(db, post.id, ['///']);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('invalid-slug');
  });

  it('1 回の呼び出しの中で slug が衝突しても Result で返す', async () => {
    // ON CONFLICT (name) は名前の衝突しか吸収しないので、ここを通すと
    // tags.slug の UNIQUE 違反が batch ごと生の例外になって漏れる。
    const post = await create('a');
    const result = await setPostTags(db, post.id, ['Dev', 'dev']);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('slug-taken');
      expect(result.error.existingName).toBe('Dev');
    }
    expect(await getTagsForPost(db, post.id)).toEqual([]);
  });

  it('既存タグとの衝突は、先頭以外の位置でも見つかる', async () => {
    const first = await create('a');
    await setPostTags(db, first.id, ['Dev']);

    const second = await create('b');
    const result = await setPostTags(db, second.id, ['life', 'dev']);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.existingName).toBe('Dev');
  });

  it('名前が違うのに slug が同じタグは Result で返す (500 にしない)', async () => {
    const post = await create('a');
    await setPostTags(db, post.id, ['Dev']);
    const other = await create('b');

    const result = await setPostTags(db, other.id, ['dev']);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('slug-taken');
      expect(result.error.existingName).toBe('Dev');
    }
    // 弾いたので、既存のタグ付けは変わっていない
    expect((await getTagsForPost(db, post.id)).map((t) => t.name)).toEqual(['Dev']);
  });
});

describe('タグでの絞り込み', () => {
  it('タグの付いた公開記事だけを新しい順で返す', async () => {
    const a = await create('a');
    const b = await create('b');
    const draft = await create('d', 'draft');
    await setPostTags(db, a.id, ['dev']);
    await setPostTags(db, b.id, ['life']);
    await setPostTags(db, draft.id, ['dev']);

    const posts = await getPublishedPostsByTagSlug(db, 'dev');
    expect(posts.map((p) => p.canonical_path)).toEqual(['a']);
  });

  it('件数は公開記事だけ数える', async () => {
    const post = await create('a');
    const draft = await create('d', 'draft');
    await setPostTags(db, post.id, ['dev']);
    await setPostTags(db, draft.id, ['dev', 'secret']);

    const counts = Object.fromEntries((await listTagsWithCounts(db)).map((t) => [t.slug, t.post_count]));
    expect(counts).toEqual({ dev: 1, secret: 0 });
  });

  it('まとめ取得で N+1 を避けられる', async () => {
    const a = await create('a');
    const b = await create('b');
    await setPostTags(db, a.id, ['dev']);
    await setPostTags(db, b.id, ['dev', 'life']);

    const rows = await getTagsForPosts(db, [a.id, b.id]);
    expect(rows.filter((r) => r.post_id === a.id).map((r) => r.name)).toEqual(['dev']);
    expect(rows.filter((r) => r.post_id === b.id).map((r) => r.name)).toEqual(['dev', 'life']);
    expect(await getTagsForPosts(db, [])).toEqual([]);
  });

  it('id が 100 個を超えても引ける (D1 のバインドパラメータ上限)', async () => {
    // `IN (?1, ?2, …)` を id の数だけ並べると 101 本目で 500 になる。
    // 件数が増えて初めて壊れるので、その日まで誰も気付けない。
    const post = await create('a');
    await setPostTags(db, post.id, ['dev']);

    const ids = [post.id, ...Array.from({ length: 250 }, (_, i) => post.id + i + 1)];
    const rows = await getTagsForPosts(db, ids);
    expect(rows.map((r) => r.name)).toEqual(['dev']);
  });

  it('孤児タグを掃除できる', async () => {
    const post = await create('a');
    await setPostTags(db, post.id, ['dev']);
    await setPostTags(db, post.id, []);
    await deleteOrphanTags(db);
    expect(await listTagsWithCounts(db)).toEqual([]);
  });
});

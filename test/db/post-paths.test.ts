import { beforeEach, describe, expect, it } from 'vitest';
import { createPost } from '../../src/core/db/posts.ts';
import {
  addAlias,
  changeCanonicalPath,
  getCanonicalPath,
  listPaths,
  removePath,
  resolvePath,
} from '../../src/core/db/post-paths.ts';
import type { PostRow } from '../../src/core/db/types.ts';
import { db, paths, resetDb } from './helpers.ts';

beforeEach(resetDb);

async function create(path?: string): Promise<PostRow> {
  const result = await createPost(db, paths, { title: 'x', bodyMd: 'y', path });
  if (!result.ok) throw new Error(`createPost に失敗した: ${result.error.code}`);
  return result.value;
}

/** canonical が必ず 1 本であること。途中状態で 0 本になっていないかを見る。 */
async function canonicalCount(postId: number): Promise<number> {
  const paths = await listPaths(db, postId);
  return paths.filter((p) => p.is_canonical === 1).length;
}

describe('resolvePath', () => {
  it('canonical でも public_id でも同じ記事に辿り着く', async () => {
    const post = await create('ratatoskr/1');

    const byCanonical = await resolvePath(db, 'ratatoskr/1');
    expect(byCanonical?.id).toBe(post.id);
    expect(byCanonical?.matched_is_canonical).toBe(1);
    expect(byCanonical?.canonical_path).toBe('ratatoskr/1');

    const byPublicId = await resolvePath(db, post.public_id);
    expect(byPublicId?.id).toBe(post.id);
    expect(byPublicId?.matched_is_canonical).toBe(0);
    // canonical を返すので、route はここへ 308 できる
    expect(byPublicId?.canonical_path).toBe('ratatoskr/1');
  });

  it('大小文字が違うだけの URL も記事に辿り着く (索引と同じ lower() で照合する)', async () => {
    await create('Ratatoskr');
    const resolved = await resolvePath(db, 'ratatoskr');
    expect(resolved?.matched_path).toBe('Ratatoskr');
    expect(resolved?.canonical_path).toBe('Ratatoskr');
  });

  it('知らないパスは null', async () => {
    expect(await resolvePath(db, 'nope')).toBeNull();
  });
});

describe('addAlias', () => {
  it('別名からも引ける', async () => {
    const post = await create('now');
    expect((await addAlias(db, paths, post.id, 'then')).ok).toBe(true);

    const resolved = await resolvePath(db, 'then');
    expect(resolved?.id).toBe(post.id);
    expect(resolved?.canonical_path).toBe('now');
    expect(await canonicalCount(post.id)).toBe(1);
  });

  it('使われているパスは拒否する (大小文字違い・自分の記事でも)', async () => {
    const a = await create('a');
    const b = await create('b');
    expect((await addAlias(db, paths, b.id, 'A')).ok).toBe(false);
    expect((await addAlias(db, paths, a.id, 'A')).ok).toBe(false);
  });

  it('予約パスは拒否する', async () => {
    const post = await create('a');
    const result = await addAlias(db, paths, post.id, 'rss.xml');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('reserved-path');
  });

  it('前後スラッシュは取り除いて受け入れる', async () => {
    const post = await create('a');
    const result = await addAlias(db, paths, post.id, '/b/');
    expect(result.ok && result.value).toBe('b');
  });
});

describe('changeCanonicalPath', () => {
  it('旧 canonical は alias として残る', async () => {
    const post = await create('old');
    expect((await changeCanonicalPath(db, paths, post.id, 'new')).ok).toBe(true);

    expect(await getCanonicalPath(db, post.id)).toBe('new');
    expect(await canonicalCount(post.id)).toBe(1);
    // 旧 URL は 308 で新 URL に飛ばせる
    const resolved = await resolvePath(db, 'old');
    expect(resolved?.canonical_path).toBe('new');
  });

  it('alias を canonical に昇格できる', async () => {
    const post = await create('first');
    await addAlias(db, paths, post.id, 'second');
    expect((await changeCanonicalPath(db, paths, post.id, 'second')).ok).toBe(true);
    expect(await getCanonicalPath(db, post.id)).toBe('second');
    expect(await canonicalCount(post.id)).toBe(1);
    expect((await listPaths(db, post.id)).map((p) => p.path).sort()).toEqual(
      [post.public_id, 'first', 'second'].sort(),
    );
  });

  it('他の記事のパスには変えられず、canonical は元のまま', async () => {
    await create('a');
    const b = await create('b');
    const result = await changeCanonicalPath(db, paths, b.id, 'a');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('path-taken');
    expect(await getCanonicalPath(db, b.id)).toBe('b');
    expect(await canonicalCount(b.id)).toBe(1);
  });

  it('大小文字だけの変更は同じ行を書き換える (ci 索引で 2 行は並べられない)', async () => {
    const post = await create('Foo');
    expect((await changeCanonicalPath(db, paths, post.id, 'foo')).ok).toBe(true);
    expect(await getCanonicalPath(db, post.id)).toBe('foo');
    expect(await canonicalCount(post.id)).toBe(1);
    expect((await listPaths(db, post.id)).map((p) => p.path).sort()).toEqual(
      [post.public_id, 'foo'].sort(),
    );
  });

  it('public_id の大小文字違いには変えられない (identity 行を書き換えない)', async () => {
    const post = await create('a');
    const result = await changeCanonicalPath(db, paths, post.id, post.public_id.toUpperCase());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('public-id-path');

    // 素の public_id で引けるまま
    expect((await resolvePath(db, post.public_id))?.matched_path).toBe(post.public_id);
    expect(await getCanonicalPath(db, post.id)).toBe('a');
  });

  it('public_id 自体は canonical に戻せる', async () => {
    const post = await create('a');
    expect((await changeCanonicalPath(db, paths, post.id, post.public_id)).ok).toBe(true);
    expect(await getCanonicalPath(db, post.id)).toBe(post.public_id);
    expect(await canonicalCount(post.id)).toBe(1);
  });

  it('無効なパスは拒否して canonical を壊さない', async () => {
    const post = await create('keep');
    for (const bad of ['admin', 'a//b', '..', 'a\\b', '']) {
      expect((await changeCanonicalPath(db, paths, post.id, bad)).ok).toBe(false);
    }
    expect(await getCanonicalPath(db, post.id)).toBe('keep');
    expect(await canonicalCount(post.id)).toBe(1);
  });
});

describe('removePath', () => {
  it('alias は消せる', async () => {
    const post = await create('a');
    await addAlias(db, paths, post.id, 'b');
    expect((await removePath(db, paths, post.id, 'b')).ok).toBe(true);
    expect(await resolvePath(db, 'b')).toBeNull();
  });

  it('canonical と public_id のパスは消せない', async () => {
    const post = await create('a');
    const canonical = await removePath(db, paths, post.id, 'a');
    expect(canonical.ok).toBe(false);
    if (!canonical.ok) expect(canonical.error.code).toBe('canonical-required');

    const identity = await removePath(db, paths, post.id, post.public_id);
    expect(identity.ok).toBe(false);
    if (!identity.ok) expect(identity.error.code).toBe('public-id-path');
  });

  it('public_id を大文字で指定しても消せない (行引きが lower() なので届く)', async () => {
    const post = await create('a');
    const result = await removePath(db, paths, post.id, post.public_id.toUpperCase());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('public-id-path');
    expect(await resolvePath(db, post.public_id)).not.toBeNull();
  });
});

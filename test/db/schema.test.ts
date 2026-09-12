import { beforeEach, describe, expect, it } from 'vitest';
import { isUniqueViolation } from '../../src/core/db/errors.ts';
import { MEDIA_COLUMNS, POST_COLUMNS, TAG_COLUMNS } from '../../src/core/db/types.ts';
import { db, insertPostRaw, resetDb } from './helpers.ts';

/**
 * DB 制約が最終防衛線として効いていることを確かめる。
 *
 * アプリ側の検証を通さない経路 (import の取りこぼし・手 SQL・将来のバグ) でも
 * 壊れた行が入らないこと自体が仕様なので、query layer ではなく生 SQL で叩く。
 */
beforeEach(resetDb);

async function insertPost(publicId: string): Promise<number> {
  await insertPostRaw({ public_id: publicId });
  const row = await db
    .prepare('SELECT id FROM posts WHERE public_id = ?1')
    .bind(publicId)
    .first<{ id: number }>();
  return row!.id;
}

describe('posts', () => {
  it('STRICT でも TEXT 列への数値は通る (可逆な変換は許される)', async () => {
    // STRICT が拒むのは「失われる変換」だけ。12345 は '12345' にできるので通る。
    // 型の取り違えを DB で止められる範囲を、思い違いのまま広く見積もらないための確認。
    await expect(insertPostRaw({ updated_at: 12345 })).resolves.toBeDefined();
  });

  it('title が空だと入らない', async () => {
    await expect(insertPostRaw({ title: '' })).rejects.toThrow();
  });

  it('status は draft / published だけ', async () => {
    await expect(
      insertPostRaw({ status: 'archived', published_at: '2026-08-27T00:00:00.000Z' }),
    ).rejects.toThrow();
  });

  it('published なら published_at が要る', async () => {
    await expect(insertPostRaw({ status: 'published' })).rejects.toThrow();
  });

  it('body_html があれば renderer_version が要る', async () => {
    await expect(insertPostRaw({ body_html: '<p>x</p>' })).rejects.toThrow();
    await expect(
      insertPostRaw({ body_html: '<p>x</p>', renderer_version: '1' }),
    ).resolves.toBeDefined();
  });

  it('public_id は重複しない', async () => {
    await insertPostRaw({ public_id: 'dup' });
    await expect(insertPostRaw({ public_id: 'dup' })).rejects.toThrow();
  });

  it('preview_token_hash は NULL 以外が重複しない', async () => {
    await insertPostRaw({ preview_token_hash: 'h' });
    await expect(insertPostRaw({ preview_token_hash: 'h' })).rejects.toThrow();
    // NULL は何本でも並ぶ
    await expect(insertPostRaw({})).resolves.toBeDefined();
    await expect(insertPostRaw({})).resolves.toBeDefined();
  });
});

describe('post_paths', () => {
  async function insertPath(postId: number, path: string, isCanonical = 0): Promise<unknown> {
    return await db
      .prepare(
        'INSERT INTO post_paths (path, post_id, is_canonical, created_at) VALUES (?1, ?2, ?3, ?4)',
      )
      .bind(path, postId, isCanonical, '2026-08-27T00:00:00.000Z')
      .run();
  }

  it('パスの形を CHECK で守る', async () => {
    const id = await insertPost('p1');
    await expect(insertPath(id, '/leading')).rejects.toThrow();
    await expect(insertPath(id, 'trailing/')).rejects.toThrow();
    await expect(insertPath(id, 'a//b')).rejects.toThrow();
    await expect(insertPath(id, 'a\\b')).rejects.toThrow();
    await expect(insertPath(id, 'a%2Fb')).rejects.toThrow();
    await expect(insertPath(id, '')).rejects.toThrow();
    await expect(insertPath(id, 'a/b')).resolves.toBeDefined();
  });

  it('canonical は 1 記事に 1 本だけ', async () => {
    const id = await insertPost('p2');
    await insertPath(id, 'one', 1);
    await expect(insertPath(id, 'two', 1)).rejects.toThrow();
    await expect(insertPath(id, 'two', 0)).resolves.toBeDefined();
  });

  it('is_canonical は 0 / 1 だけ', async () => {
    const id = await insertPost('p3');
    await expect(insertPath(id, 'x', 2)).rejects.toThrow();
  });

  it('大文字小文字違いのパスは並べられない', async () => {
    const id = await insertPost('p4');
    await insertPath(id, 'Foo');
    await expect(insertPath(id, 'foo')).rejects.toThrow();
    const other = await insertPost('p5');
    await expect(insertPath(other, 'FOO')).rejects.toThrow();
  });

  it('記事を消すとパスも消える', async () => {
    const id = await insertPost('p6');
    await insertPath(id, 'gone', 1);
    await db.prepare('DELETE FROM posts WHERE id = ?1').bind(id).run();
    const row = await db
      .prepare('SELECT count(*) AS n FROM post_paths WHERE post_id = ?1')
      .bind(id)
      .first<{ n: number }>();
    expect(row?.n).toBe(0);
  });
});

describe('media', () => {
  async function insertMedia(postId: number, values: Record<string, unknown> = {}) {
    const row = {
      public_id: crypto.randomUUID(),
      post_id: postId,
      filename: 'sample.png',
      r2_key: `posts/${crypto.randomUUID()}/sample.png`,
      mime: 'image/png',
      bytes: 100,
      created_at: '2026-08-27T00:00:00.000Z',
      ...values,
    };
    const columns = Object.keys(row);
    return await db
      .prepare(
        `INSERT INTO media (${columns.join(', ')}) VALUES (${columns.map((_, i) => `?${i + 1}`).join(', ')})`,
      )
      .bind(...Object.values(row))
      .run();
  }

  it('filename にディレクトリ区切りは入らない', async () => {
    const id = await insertPost('m1');
    await expect(insertMedia(id, { filename: 'a/b.png' })).rejects.toThrow();
    await expect(insertMedia(id, { filename: 'a\\b.png' })).rejects.toThrow();
    await expect(insertMedia(id, { filename: '..' })).rejects.toThrow();
    await expect(insertMedia(id, { filename: '' })).rejects.toThrow();
  });

  it('STRICT なので INTEGER 列に数値でない文字列は入らない', async () => {
    const id = await insertPost('m5');
    // width の CHECK は `width > 0` で、SQLite の型順序では 'abc' > 0 が真になる。
    // つまりここで弾いているのは CHECK ではなく STRICT の側。
    await expect(insertMedia(id, { width: 'abc' })).rejects.toThrow();
  });

  it('bytes は正の数', async () => {
    const id = await insertPost('m2');
    await expect(insertMedia(id, { bytes: 0 })).rejects.toThrow();
    await expect(insertMedia(id, { width: 0 })).rejects.toThrow();
  });

  it('同じ記事に同じファイル名は 1 つだけ', async () => {
    const id = await insertPost('m3');
    await insertMedia(id, { filename: 'sample.png' });
    await expect(insertMedia(id, { filename: 'sample.png' })).rejects.toThrow();
  });

  it('r2_key は重複しない', async () => {
    const id = await insertPost('m4');
    await insertMedia(id, { filename: 'a.png', r2_key: 'k' });
    await expect(insertMedia(id, { filename: 'b.png', r2_key: 'k' })).rejects.toThrow();
  });
});

describe('tags', () => {
  it('name と slug は重複しない', async () => {
    await db.prepare("INSERT INTO tags (name, slug) VALUES ('Dev', 'dev')").run();
    await expect(db.prepare("INSERT INTO tags (name, slug) VALUES ('Dev', 'x')").run()).rejects.toThrow();
    await expect(db.prepare("INSERT INTO tags (name, slug) VALUES ('y', 'dev')").run()).rejects.toThrow();
  });

  it('記事を消すと post_tags も消える', async () => {
    const id = await insertPost('t1');
    await db.prepare("INSERT INTO tags (name, slug) VALUES ('dev', 'dev')").run();
    await db.prepare('INSERT INTO post_tags (post_id, tag_id) SELECT ?1, id FROM tags').bind(id).run();
    await db.prepare('DELETE FROM posts WHERE id = ?1').bind(id).run();
    const row = await db.prepare('SELECT count(*) AS n FROM post_tags').first<{ n: number }>();
    expect(row?.n).toBe(0);
  });
});

describe('制約違反の判定', () => {
  it('UNIQUE 違反を D1 の実エラーから見分けられる', async () => {
    // 文字列で判定しているので、実際に D1 が投げるメッセージで確かめる。
    // ここが外れると createPost / addAlias の path-taken が素の例外として漏れる。
    await insertPostRaw({ public_id: 'same' });
    const error = await insertPostRaw({ public_id: 'same' }).catch((e: unknown) => e);
    expect(isUniqueViolation(error)).toBe(true);
    expect(isUniqueViolation(new Error('何か別の失敗'))).toBe(false);
  });
});

describe('Row 型と実テーブル', () => {
  // 列リストと Row 型のずれは型が止める。実テーブルとのずれは `.first<Row>()` が
  // ただのキャストなので、ここで実 D1 と突き合わせるしかない。
  async function columnsOfTable(table: string): Promise<string[]> {
    const { results } = await db
      .prepare(`SELECT name FROM pragma_table_info(?1)`)
      .bind(table)
      .all<{ name: string }>();
    return results.map((r) => r.name).sort();
  }

  it('POST_COLUMNS が posts の列と過不足なく一致する', async () => {
    expect(await columnsOfTable('posts')).toEqual([...POST_COLUMNS].sort());
  });

  it('MEDIA_COLUMNS が media の列と過不足なく一致する', async () => {
    expect(await columnsOfTable('media')).toEqual([...MEDIA_COLUMNS].sort());
  });

  it('TAG_COLUMNS が tags の列と過不足なく一致する', async () => {
    expect(await columnsOfTable('tags')).toEqual([...TAG_COLUMNS].sort());
  });
});

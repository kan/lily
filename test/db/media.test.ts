import { beforeEach, expect, it } from 'vitest';
import { createPost } from '../../src/core/db/posts.ts';
import {
  createMedia,
  deleteMedia,
  findByPostAndFilename,
  getMediaByPublicId,
  getOgpMedia,
  listMediaByPost,
  listMediaByPosts,
  setOgpMedia,
} from '../../src/core/db/media.ts';
import { db, paths, resetDb } from './helpers.ts';

beforeEach(resetDb);

async function createPostId(path: string): Promise<number> {
  const result = await createPost(db, paths, { title: path, bodyMd: 'x', path });
  if (!result.ok) throw new Error(`createPost に失敗した: ${result.error.code}`);
  return result.value.id;
}

function addMedia(postId: number, path: string, filename: string) {
  return createMedia(db, {
    postId,
    filename,
    r2Key: `posts/${path}/${filename}`,
    mime: 'image/png',
    bytes: 1,
  });
}

it('本文の相対参照は (post_id, filename) で引ける', async () => {
  const postId = await createPostId('a');
  const media = await createMedia(db, {
    postId,
    filename: 'sample.png',
    r2Key: 'posts/a/sample.png',
    mime: 'image/png',
    bytes: 123,
    width: 640,
    height: 480,
  });

  expect(await findByPostAndFilename(db, postId, 'sample.png')).toMatchObject({
    public_id: media.public_id,
    r2_key: 'posts/a/sample.png',
    width: 640,
  });
  expect(await findByPostAndFilename(db, postId, 'nope.png')).toBeNull();
  expect((await getMediaByPublicId(db, media.public_id))?.id).toBe(media.id);
});

it('記事ごとに一覧できる', async () => {
  const postId = await createPostId('a');
  for (const filename of ['b.png', 'a.png']) {
    await createMedia(db, {
      postId,
      filename,
      r2Key: `posts/a/${filename}`,
      mime: 'image/png',
      bytes: 1,
    });
  }
  expect((await listMediaByPost(db, postId)).map((m) => m.filename)).toEqual(['a.png', 'b.png']);
});

it('消すと R2 のキーを返す', async () => {
  const postId = await createPostId('a');
  const media = await createMedia(db, {
    postId,
    filename: 'sample.png',
    r2Key: 'posts/a/sample.png',
    mime: 'image/png',
    bytes: 1,
  });
  expect(await deleteMedia(db, media.id)).toBe('posts/a/sample.png');
  expect(await getMediaByPublicId(db, media.public_id)).toBeNull();
  expect(await deleteMedia(db, media.id)).toBeNull();
});

it('OGP は記事につき 1 枚で、選び直すと前のが外れる', async () => {
  const postId = await createPostId('a');
  const first = await addMedia(postId, 'a', 'one.png');
  const second = await addMedia(postId, 'a', 'two.png');

  expect(await getOgpMedia(db, postId)).toBeNull();

  await setOgpMedia(db, postId, first.id);
  expect((await getOgpMedia(db, postId))?.filename).toBe('one.png');

  // **外してから立てるのを 1 トランザクションで**やっていないと、部分ユニーク
  // 索引が「2 枚選ばれている」を弾いてここで落ちる。
  await setOgpMedia(db, postId, second.id);
  expect((await getOgpMedia(db, postId))?.filename).toBe('two.png');

  await setOgpMedia(db, postId, null);
  expect(await getOgpMedia(db, postId)).toBeNull();
});

it('他の記事の添付は OGP にならない（選択が外れるだけ）', async () => {
  const mine = await createPostId('a');
  const other = await createPostId('b');
  const own = await addMedia(mine, 'a', 'own.png');
  const theirs = await addMedia(other, 'b', 'one.png');
  await setOgpMedia(db, mine, own.id);

  await setOgpMedia(db, mine, theirs.id);
  // 立たない。**選択は外れる**（呼び出し側の誤りなので、知らない絵が選ばれた
  // ままになるより安全な方へ倒す）。
  expect(await getOgpMedia(db, mine)).toBeNull();
  expect(await getOgpMedia(db, other)).toBeNull();
});

it('OGP に選んだ添付を消しても、選択が残らない', async () => {
  // 記事側に media への参照を持たせていない理由がこれ (行ごと消える)。
  const postId = await createPostId('a');
  const media = await addMedia(postId, 'a', 'one.png');
  await setOgpMedia(db, postId, media.id);

  await deleteMedia(db, media.id);
  expect(await getOgpMedia(db, postId)).toBeNull();
});

it('id が 100 個を超えても引ける (D1 のバインドパラメータ上限)', async () => {
  const postId = await createPostId('a');
  await createMedia(db, {
    postId,
    filename: 'sample.png',
    r2Key: 'posts/a/sample.png',
    mime: 'image/png',
    bytes: 1,
  });

  const ids = [postId, ...Array.from({ length: 250 }, (_, i) => postId + i + 1)];
  expect((await listMediaByPosts(db, ids)).map((m) => m.filename)).toEqual(['sample.png']);
  expect(await listMediaByPosts(db, [])).toEqual([]);
});

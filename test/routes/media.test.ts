import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { createMedia } from '../../src/core/db/media.ts';
import { db, resetDb } from '../db/helpers.ts';
import { get, getRootWith, getWith, MOUNT, seedPost } from './helpers.ts';

beforeEach(resetDb);

/** 1x1 の PNG。Images に食わせられる本物の画像。 */
const PNG = Uint8Array.from(
  atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='),
  (c) => c.charCodeAt(0),
);

/** 実体つきの添付を作る。`bytes` は R2 に置く中身。 */
async function seedImage(
  mime = 'image/png',
  bytes: Uint8Array | string = PNG,
  filename = 'sample.png',
) {
  const post = await seedPost({ path: `p-${filename}` });
  const media = await createMedia(db, {
    postId: post.id,
    filename,
    r2Key: `posts/${filename}`,
    mime,
    bytes: 1,
  });
  await env.MEDIA.put(media.r2_key, bytes);
  return media;
}

/** 受け入れる形式を伝えて取りに行く。 */
async function fetchWith(path: string, accept: string): Promise<Response> {
  return await getWith(path, { headers: { Accept: accept } });
}

describe('添付', () => {
  async function seedMedia(filename = 'sample.png') {
    const post = await seedPost({ path: 'with-image' });
    const media = await createMedia(db, {
      postId: post.id,
      filename,
      r2Key: `posts/with-image/${filename}`,
      mime: 'image/png',
      bytes: 3,
    });
    await env.MEDIA.put(media.r2_key, 'png');
    return media;
  }

  it('URL は不変なので長期キャッシュする', async () => {
    const media = await seedMedia();
    const res = await get(`${MOUNT}/media/${media.public_id}/sample.png`);
    // 差し替えは行ごと作り直す = public_id が変わるので、URL は不変
    expect(res.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
    expect(res.headers.get('etag')).toBeTruthy();
  });

  it('直接開かれてもスクリプトが走らないようにする (SVG も配るので)', async () => {
    const media = await seedMedia();
    const res = await get(`${MOUNT}/media/${media.public_id}/sample.png`);
    expect(res.headers.get('content-security-policy')).toBe('sandbox');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
  });

  it('D1 の bytes ではなく実体の長さを返す', async () => {
    // bytes と R2 の実体がずれたときに嘘の Content-Length を返さない。
    const post = await seedPost({ path: 'p' });
    const media = await createMedia(db, {
      postId: post.id,
      filename: 'sample.png',
      r2Key: 'posts/p/sample.png',
      mime: 'image/png',
      bytes: 9999,
    });
    await env.MEDIA.put(media.r2_key, 'png');

    const res = await get(`${MOUNT}/media/${media.public_id}/sample.png`);
    expect(res.headers.get('content-length')).not.toBe('9999');
    expect(await res.text()).toBe('png');
  });

  it('ファイル名が違えば返さない (URL と中身を食い違わせない)', async () => {
    const media = await seedMedia();
    expect((await get(`${MOUNT}/media/${media.public_id}/other.png`)).status).toBe(404);
  });

  it('知らない id と、R2 に実体が無いものは 404', async () => {
    const post = await seedPost({ path: 'gone' });
    const orphan = await createMedia(db, {
      postId: post.id,
      filename: 'missing.png',
      r2Key: 'posts/gone/missing.png',
      mime: 'image/png',
      bytes: 1,
    });
    expect((await get(`${MOUNT}/media/nope/x.png`)).status).toBe(404);
    expect((await get(`${MOUNT}/media/${orphan.public_id}/missing.png`)).status).toBe(404);
  });
});

/**
 * Cloudflare Images は**任意の層**。有効でも無効でも URL は同じで、変換できない
 * ときは原本が出る。記事の画像が表示不能にならないことが、この節の要。
 */
describe('画像の最適化', () => {
  it('相手が読めるなら小さい形式にして返す', async () => {
    const media = await seedImage();
    const path = `${MOUNT}/media/${media.public_id}/sample.png`;

    const webp = await fetchWith(path, 'image/webp,image/*');
    expect(webp.headers.get('content-type')).toBe('image/webp');
    // 同じ URL が相手によって違う形式で返ることを明示する
    expect(webp.headers.get('vary')).toBe('Accept');

    const avif = await fetchWith(path, 'image/avif,image/webp,image/*');
    expect(avif.headers.get('content-type')).toBe('image/avif');
  });

  it('変換した方は共有キャッシュに置かせない', async () => {
    // Cloudflare のエッジは Accept-Encoding 以外の Vary を見ない。public のまま
    // だと最初に入った表現が居座り、AVIF を読めない相手にも AVIF が配られる。
    const media = await seedImage();
    const path = `${MOUNT}/media/${media.public_id}/sample.png`;

    const converted = await fetchWith(path, 'image/avif,image/webp');
    expect(converted.headers.get('cache-control')).toBe('private, max-age=86400');

    // 原本は誰でも読めるので、共有キャッシュに入ってよい
    const original = await fetchWith(path, 'image/*');
    expect(original.headers.get('cache-control')).toContain('public');
  });

  it('形式ごとに別の ETag を返す', async () => {
    // 同じ検証子だと、キャッシュが「変わっていない」と判断して頼んでいない
    // 形式を返しうる。
    const media = await seedImage();
    const path = `${MOUNT}/media/${media.public_id}/sample.png`;

    const etags = await Promise.all(
      ['image/avif,image/webp', 'image/webp', 'image/*'].map(async (accept) =>
        (await fetchWith(path, accept)).headers.get('etag'),
      ),
    );
    expect(new Set(etags).size).toBe(3);
  });

  it('読めない相手には原本を返す。ただし交渉していることは伝える', async () => {
    const media = await seedImage();
    const res = await fetchWith(`${MOUNT}/media/${media.public_id}/sample.png`, 'image/*');
    expect(res.headers.get('content-type')).toBe('image/png');
    // 付けたり付けなかったりすると、交渉していない応答として共有キャッシュに収まる
    expect(res.headers.get('vary')).toBe('Accept');
  });

  it('SVG は触らない (ベクタなので潰す意味がない)', async () => {
    const media = await seedImage('image/svg+xml', '<svg xmlns="http://www.w3.org/2000/svg"/>', 'a.svg');
    const res = await fetchWith(`${MOUNT}/media/${media.public_id}/a.svg`, 'image/avif,image/webp');
    expect(res.headers.get('content-type')).toBe('image/svg+xml');
    expect(res.headers.get('vary')).toBeNull();
  });

  it('変換に失敗しても原本を返す (画像が表示不能にならない)', async () => {
    // quota 到達も壊れたファイルもここに来る。**fallback は正式仕様。**
    const media = await seedImage('image/png', 'これは画像ではない');
    const res = await fetchWith(`${MOUNT}/media/${media.public_id}/sample.png`, 'image/avif,image/webp');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
    expect(await res.text()).toBe('これは画像ではない');
  });

  it('設定で切ってあれば、読める相手にも原本を返す (URL は同じまま)', async () => {
    // root mount のアプリは media.images を渡していない。**変換できる相手でも**
    // 原本が出ることを見る（Accept を送らないと、設定を見ていなくても通る）。
    const media = await seedImage();
    const res = await getRootWith(`/media/${media.public_id}/sample.png`, 'image/avif,image/webp');
    expect(res.headers.get('content-type')).toBe('image/png');
    expect(res.headers.get('vary')).toBeNull();
  });
});

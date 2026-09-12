import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getOgpMedia } from '../../src/core/db/media.ts';
import { db, resetDb } from '../db/helpers.ts';
import { pngHeader } from '../fixtures/png.ts';
import { api, apiJson, seedPost, setStubUser } from '../routes/helpers.ts';

/**
 * 記事ごとの OGP。**選べるのは自分の添付 1 枚だけ。**
 *
 * 反映先（記事ページの `og:image` と Bluesky のカード）はそれぞれの spec で見る。
 * ここでは選ぶ / 外す / 選べないものの扱いだけを固定する。
 */

beforeEach(resetDb);
afterEach(() => setStubUser(null));

/** 添付を 1 つ上げて、その MediaView を返す。 */
async function upload(publicId: string, filename: string, mime: string) {
  const form = new FormData();
  form.append('file', new File([pngHeader(600, 400)], filename, { type: mime }));
  const res = await api(`/api/posts/${publicId}/media`, { method: 'POST', body: form });
  expect(res.status, `${filename} を上げられない`).toBe(201);
  return (await res.json<{ media: { publicId: string; isOgp: boolean; canBeOgp: boolean } }>())
    .media;
}

function setOgp(publicId: string, mediaPublicId: string | null) {
  return apiJson('PUT', `/api/posts/${publicId}/ogp`, { mediaPublicId });
}

describe('選ぶ', () => {
  it('選ぶと 1 枚だけ立ち、選び直すと入れ替わる', async () => {
    const post = await seedPost();
    const one = await upload(post.public_id, 'one.png', 'image/png');
    const two = await upload(post.public_id, 'two.png', 'image/png');
    expect(one.isOgp).toBe(false);

    const first = await setOgp(post.public_id, one.publicId);
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    expect(ogpOf(first.body)).toBe('one.png');

    const second = await setOgp(post.public_id, two.publicId);
    expect(ogpOf(second.body)).toBe('two.png');
    expect((await getOgpMedia(db, post.id))?.filename).toBe('two.png');
  });

  it('null で外す', async () => {
    const post = await seedPost();
    const media = await upload(post.public_id, 'one.png', 'image/png');
    await setOgp(post.public_id, media.publicId);

    const { status, body } = await setOgp(post.public_id, null);
    expect(status).toBe(200);
    expect(ogpOf(body)).toBeUndefined();
    expect(await getOgpMedia(db, post.id)).toBeNull();
  });

  it('更新日を動かさない（読者から見える中身は変わらない）', async () => {
    // 動かすと Atom の <updated> と sitemap の lastmod が進み、絵を選び直した
    // だけで購読者のリーダーに記事が浮き上がる。
    const post = await seedPost();
    const media = await upload(post.public_id, 'one.png', 'image/png');
    const before = (await apiJson('GET', `/api/posts/${post.public_id}`)).body.post.updatedAt;

    await setOgp(post.public_id, media.publicId);

    const after = (await apiJson('GET', `/api/posts/${post.public_id}`)).body.post.updatedAt;
    expect(after).toBe(before);
  });
});

describe('選べないもの', () => {
  it('他の記事の添付は 404', async () => {
    const mine = await seedPost({ path: 'mine' });
    const other = await seedPost({ path: 'other' });
    const theirs = await upload(other.public_id, 'one.png', 'image/png');

    const { status, body } = await setOgp(mine.public_id, theirs.publicId);
    expect(status).toBe(404);
    expect(body.error).toBe('media-not-found');
    expect(await getOgpMedia(db, mine.id)).toBeNull();
  });

  it('無い添付も 404', async () => {
    const post = await seedPost();
    expect((await setOgp(post.public_id, 'missing')).status).toBe(404);
  });

  it('SVG は選べない（多くのクローラが OGP として読まない）', async () => {
    const post = await seedPost();
    const form = new FormData();
    form.append(
      'file',
      new File(['<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"></svg>'], 'icon.svg', {
        type: 'image/svg+xml',
      }),
    );
    const uploaded = await api(`/api/posts/${post.public_id}/media`, {
      method: 'POST',
      body: form,
    });
    expect(uploaded.status).toBe(201);
    const media = (await uploaded.json<{ media: { publicId: string; canBeOgp: boolean } }>()).media;
    // 画面はこの印を見てボタンを出さない。API も同じ判断で断る。
    expect(media.canBeOgp).toBe(false);

    const { status, body } = await setOgp(post.public_id, media.publicId);
    expect(status).toBe(400);
    expect(body.error).toBe('ogp-format-not-allowed');
  });

  it('無い記事は 404', async () => {
    expect((await setOgp('missing', null)).status).toBe(404);
  });
});

/** レスポンスの添付一覧から、OGP に立っているファイル名を取る。 */
function ogpOf(body: { post: { media: { filename: string; isOgp: boolean }[] } }): string | undefined {
  return body.post.media.find((item) => item.isOgp)?.filename;
}

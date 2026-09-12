import { env } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_THUMB_BYTES } from '../../src/core/bluesky.ts';
import { createMedia, setOgpMedia } from '../../src/core/db/media.ts';
import { getPostByPublicId } from '../../src/core/db/posts.ts';
import { db, resetDb } from '../db/helpers.ts';
import {
  AT_URI,
  resetXrpcCalls,
  sentRecord,
  stubBluesky,
  xrpcCalls,
} from '../fixtures/bluesky.ts';
import {
  apiJson,
  ROOT_LANG,
  ROOT_SITE,
  seedPost,
  setStubBluesky,
  setStubUser,
} from '../routes/helpers.ts';

/**
 * 告知の口。**上流は必ずスタブで止める**（`fixtures/bluesky.ts`）。
 *
 * ここで見たいのは XRPC の中身（それは `test/bluesky.test.ts`）ではなく、
 * 押せる条件・二重投稿の抑止・失敗したときに何が DB に残るか。
 */

beforeEach(async () => {
  await resetDb();
  setStubBluesky({ identifier: 'someone.example', appPassword: 'app-pw' });
  stubBluesky();
});

afterEach(() => {
  setStubUser(null);
  setStubBluesky(null);
  vi.unstubAllGlobals();
});

function announce(publicId: string) {
  return apiJson('POST', `/api/posts/${publicId}/bluesky`);
}

/** OGP に選んだ添付を 1 つ足す。**R2 の実体は呼び出し側が置く。** */
async function addOgp(postId: number, postPublicId: string, options: { bytes: number }) {
  const media = await createMedia(db, {
    postId,
    filename: 'card.png',
    r2Key: `posts/${postPublicId}/card.png`,
    mime: 'image/png',
    bytes: options.bytes,
  });
  await setOgpMedia(db, postId, media.id);
  return media;
}

describe('告知する', () => {
  it('AT-URI を記録し、開ける URL を返す', async () => {
    const post = await seedPost();
    const { status, body } = await announce(post.public_id);

    expect(status, JSON.stringify(body)).toBe(200);
    expect(body.post.blueskyUri).toBe(AT_URI);
    expect(body.post.blueskyUrl).toBe('https://bsky.app/profile/did:plc:abc/post/3kxyz');
    expect((await getPostByPublicId(db, post.public_id))?.bluesky_uri).toBe(AT_URI);
  });

  it('updated_at を動かさない（購読者のリーダーに記事を浮き上がらせない）', async () => {
    const post = await seedPost();
    const before = post.updated_at;
    await announce(post.public_id);
    expect((await getPostByPublicId(db, post.public_id))?.updated_at).toBe(before);
  });

  it('リンクカードには記事の URL と説明が入り、サムネは配信中の ogp.png', async () => {
    const post = await seedPost({ path: 'start-blog', description: 'ためしに書いた' });
    await announce(post.public_id);

    const record = sentRecord();
    expect(record.embed.external).toMatchObject({
      // root mount のテストアプリなので `/start-blog/`。
      uri: `${ROOT_SITE}/start-blog/`,
      title: 'はじめての記事',
      description: 'ためしに書いた',
    });
    // 実体は ASSETS バインディング（dist/ogp.png）から読む。**外向きの fetch では
    // 取りに行かない**（自分のゾーンへサブリクエストを出さない）。
    expect(record.embed.external.thumb).toBeDefined();
    expect(xrpcCalls().some((call) => call.url.includes('/ogp.png'))).toBe(false);

    // 言語はサイト設定から。core は既定値を持たない。
    expect(record.langs).toEqual([ROOT_LANG]);
  });

  it('記事が OGP を選んでいればその絵をサムネにする', async () => {
    // 記事ページの og:image と同じ絵をカードに出すため。
    const post = await seedPost();
    const media = await addOgp(post.id, post.public_id, { bytes: 4 });
    await env.MEDIA.put(media.r2_key, new Uint8Array([1, 2, 3, 4]));

    await announce(post.public_id);
    const upload = xrpcCalls().find((call) => call.url.endsWith('uploadBlob'));
    expect(upload, 'uploadBlob を呼んでいない').toBeDefined();
    expect(sentRecord().embed.external.thumb).toBeDefined();
    // 共通の絵 (dist/ogp.png は 1KB を超える) ではなく、選んだ 4 バイトの方。
    expect(upload!.byteLength).toBe(4);
  });

  it('選んだ絵が大きすぎたら共通の 1 枚に落とす', async () => {
    // 上限を超えたぶんは announce() が載せないので、そのままだと選んだ絵でも
    // 共通でもない「絵の無いカード」になる。bytes は DB にあるので取りに行く前に分かる。
    const post = await seedPost();
    const media = await addOgp(post.id, post.public_id, { bytes: MAX_THUMB_BYTES + 1 });

    await announce(post.public_id);
    const upload = xrpcCalls().find((call) => call.url.endsWith('uploadBlob'));
    expect(sentRecord().embed.external.thumb).toBeDefined();
    // R2 は見に行かない（大きさは DB で分かる）。載ったのは共通の ogp.png。
    expect(upload!.byteLength).toBeGreaterThan(1000);
    expect(await env.MEDIA.get(media.r2_key)).toBeNull();
  });

  it('選んだ絵の実体が消えていても告知は通る', async () => {
    const post = await seedPost();
    await addOgp(post.id, post.public_id, { bytes: 4 }); // R2 には置かない
    expect((await announce(post.public_id)).status).toBe(200);
    expect(sentRecord().embed.external.thumb).toBeDefined();
  });

  it('説明を書いていなければ本文の冒頭が入る', async () => {
    const post = await seedPost({ description: null, bodyMd: '最初の段落。\n\n次の段落。\n' });
    await announce(post.public_id);
    expect(sentRecord().embed.external.description).toBe('最初の段落。');
  });
});

describe('押せないとき', () => {
  it('下書きは告知できない（読者には 404 なのでカードが組めない）', async () => {
    const post = await seedPost({ draft: true });
    const { status, body } = await announce(post.public_id);

    expect(status).toBe(400);
    expect(body.error).toBe('post-not-published');
    expect(xrpcCalls()).toEqual([]);
  });

  it('2 回目は 409（二重投稿の抑止）', async () => {
    const post = await seedPost();
    expect((await announce(post.public_id)).status).toBe(200);

    resetXrpcCalls();
    const { status, body } = await announce(post.public_id);
    expect(status).toBe(409);
    expect(body.error).toBe('already-announced');
    expect(body.message).toBe(AT_URI);
    // **投げてから気付くのでは遅い。**
    expect(xrpcCalls()).toEqual([]);
  });

  it('資格情報が無ければ 400 で、上流も叩かない', async () => {
    setStubBluesky(null);
    const post = await seedPost();
    const { status, body } = await announce(post.public_id);

    expect(status).toBe(400);
    expect(body.error).toBe('bluesky-not-configured');
    expect(xrpcCalls()).toEqual([]);
  });

  it('無い記事は 404', async () => {
    expect((await announce('missing')).status).toBe(404);
  });
});

describe('上流が失敗したとき', () => {
  it('502 を返し、告知済みにはしない（直したら押し直せる）', async () => {
    stubBluesky({
      'com.atproto.server.createSession': () =>
        Response.json({ error: 'AuthenticationRequired' }, { status: 401 }),
    });
    const post = await seedPost();
    const { status, body } = await announce(post.public_id);

    expect(status).toBe(502);
    expect(body.error).toBe('bluesky-failed');
    expect(body.message).toContain('AuthenticationRequired');
    expect((await getPostByPublicId(db, post.public_id))?.bluesky_uri).toBeNull();
  });
});

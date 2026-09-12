import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  announce,
  BlueskyError,
  blueskyPostUrl,
  composePost,
  MAX_THUMB_BYTES,
  type BlueskyCredentials,
} from '../src/core/bluesky.ts';
import { AT_URI, sentRecord, stubBluesky, xrpcCalls, xrpcHeader } from './fixtures/bluesky.ts';

/**
 * Bluesky の告知。**上流は必ずスタブで止める**（`fixtures/bluesky.ts`）。
 *
 * 本物に投げると CI が回るたびにタイムラインへ流れるうえ、資格情報も要る。
 * 見たいのは「どの順で何を送るか」なので、fetch を差し替えれば足りる。
 */

const CREDENTIALS: BlueskyCredentials = { identifier: 'someone.example', appPassword: 'app-pw' };

const URL_OF_POST = 'https://fushihara.net/blog/start-blog/';

beforeEach(() => stubBluesky());

afterEach(() => vi.unstubAllGlobals());

describe('投げる順序', () => {
  it('session → blob → record の順で、JWT は後の 2 本に載る', async () => {
    const result = await announce(CREDENTIALS, {
      url: URL_OF_POST,
      title: 'はじめての記事',
      description: 'ためしに書いた',
      thumb: { bytes: new Uint8Array([1, 2, 3]).buffer, mime: 'image/png' },
    });

    const calls = xrpcCalls();
    expect(calls.map((c) => c.url)).toEqual([
      'https://bsky.social/xrpc/com.atproto.server.createSession',
      'https://bsky.social/xrpc/com.atproto.repo.uploadBlob',
      'https://bsky.social/xrpc/com.atproto.repo.createRecord',
    ]);
    // **createSession に Authorization は付けない**（まだ何も持っていない）。
    expect(xrpcHeader(calls[0]!, 'Authorization')).toBeUndefined();
    expect(xrpcHeader(calls[1]!, 'Authorization')).toBe('Bearer jwt-1');
    expect(xrpcHeader(calls[1]!, 'Content-Type')).toBe('image/png');
    expect(xrpcHeader(calls[2]!, 'Authorization')).toBe('Bearer jwt-1');

    expect(result).toEqual({ uri: AT_URI, cid: 'bafycid' });
  });

  it('App Password を送るのは session だけ', async () => {
    await announce(CREDENTIALS, { url: URL_OF_POST, title: 'x', description: '' });
    const calls = xrpcCalls();
    expect(JSON.parse(calls[0]!.body)).toEqual({
      identifier: 'someone.example',
      password: 'app-pw',
    });
    for (const call of calls.slice(1)) expect(call.body).not.toContain('app-pw');
  });

  it('自前の PDS を指定できる', async () => {
    // 末尾スラッシュを書かれても `//xrpc` にしない。
    await announce(
      { ...CREDENTIALS, service: 'https://pds.example.com/' },
      { url: URL_OF_POST, title: 'x', description: '' },
    );
    expect(xrpcCalls()[0]!.url).toBe(
      'https://pds.example.com/xrpc/com.atproto.server.createSession',
    );
  });
});

describe('投稿の中身', () => {
  it('リンクカードを自分で組む（API 投稿には OGP 取得が走らない）', async () => {
    await announce(CREDENTIALS, {
      url: URL_OF_POST,
      title: 'はじめての記事',
      description: 'ためしに書いた',
      langs: ['ja'],
      thumb: { bytes: new Uint8Array([1, 2, 3]).buffer, mime: 'image/png' },
    });

    const record = sentRecord();
    expect(record.$type).toBe('app.bsky.feed.post');
    expect(record.langs).toEqual(['ja']);
    expect(record.embed.$type).toBe('app.bsky.embed.external');
    expect(record.embed.external).toMatchObject({
      uri: URL_OF_POST,
      title: 'はじめての記事',
      description: 'ためしに書いた',
      thumb: { $type: 'blob', ref: { $link: 'bafy' } },
    });
  });

  it('言語を渡さなければ langs を付けない（core は言語を決めない）', async () => {
    // `'ja'` を core が既定にすると、別の言語の deployment が黙って日本語として
    // 流れる（サイトの言語は `SiteConfig.lang`）。
    await announce(CREDENTIALS, { url: URL_OF_POST, title: 'x', description: '' });
    expect('langs' in sentRecord()).toBe(false);
  });

  it('サムネが無ければ thumb を付けない（キーごと落とす）', async () => {
    await announce(CREDENTIALS, { url: URL_OF_POST, title: 'x', description: '' });
    expect(xrpcCalls().some((c) => c.url.endsWith('uploadBlob'))).toBe(false);
    expect('thumb' in sentRecord().embed.external).toBe(false);
  });

  it('サムネが大きすぎても告知は止めない', async () => {
    await announce(CREDENTIALS, {
      url: URL_OF_POST,
      title: 'x',
      description: '',
      thumb: { bytes: new ArrayBuffer(MAX_THUMB_BYTES + 1), mime: 'image/png' },
    });
    expect(xrpcCalls().some((c) => c.url.endsWith('uploadBlob'))).toBe(false);
    expect('thumb' in sentRecord().embed.external).toBe(false);
  });

  it('サムネの upload だけ失敗しても告知は通る', async () => {
    // カードの絵が出ないだけ。ここで投げ直すと「押しても告知できない」になる。
    stubBluesky({
      'com.atproto.repo.uploadBlob': () => new Response('too big', { status: 400 }),
    });
    const result = await announce(CREDENTIALS, {
      url: URL_OF_POST,
      title: 'x',
      description: '',
      thumb: { bytes: new Uint8Array([1]).buffer, mime: 'image/png' },
    });
    expect(result.uri).toContain('app.bsky.feed.post');
    expect('thumb' in sentRecord().embed.external).toBe(false);
  });
});

describe('本文と facet', () => {
  it('URL のバイト範囲を指す（日本語のタイトルでずれない）', () => {
    const { text, facets } = composePost('日本語のタイトル', URL_OF_POST);
    expect(text).toBe(`日本語のタイトル\n${URL_OF_POST}`);

    const [facet] = facets;
    const bytes = new TextEncoder().encode(text);
    // **文字数ではなくバイト位置。** 切り出したものが URL そのものになる。
    expect(new TextDecoder().decode(bytes.slice(facet!.index.byteStart, facet!.index.byteEnd))).toBe(
      URL_OF_POST,
    );
    expect(facet!.features[0]).toEqual({
      $type: 'app.bsky.richtext.facet#link',
      uri: URL_OF_POST,
    });
  });

  it('長すぎるタイトルは削る。URL は必ず残る', () => {
    const { text, facets } = composePost('あ'.repeat(400), URL_OF_POST);
    expect(graphemes(text)).toBeLessThanOrEqual(300);
    expect(text.endsWith(`…\n${URL_OF_POST}`)).toBe(true);

    const bytes = new TextEncoder().encode(text);
    const [facet] = facets;
    expect(new TextDecoder().decode(bytes.slice(facet!.index.byteStart, facet!.index.byteEnd))).toBe(
      URL_OF_POST,
    );
  });

  it('絵文字も 1 書記素として数え、途中で割らない', () => {
    // UTF-16 のコード単位で数えると、この絵文字 1 つが 11 文字に見えて余計に
    // 削られる。しかも `slice` で切ると ZWJ の途中で割れて別の絵文字が出る。
    const emoji = '👨‍👩‍👧‍👦';
    const { text } = composePost(emoji.repeat(400), URL_OF_POST);
    expect(graphemes(text)).toBeLessThanOrEqual(300);

    const title = text.slice(0, text.indexOf('\n'));
    const room = 300 - graphemes(URL_OF_POST) - 1;
    expect(title).toBe(`${emoji.repeat(room - 1)}…`);
  });
});

describe('失敗', () => {
  it('資格情報が違えば session の失敗として返る', async () => {
    stubBluesky({
      'com.atproto.server.createSession': () =>
        Response.json(
          { error: 'AuthenticationRequired', message: 'Invalid identifier or password' },
          { status: 401 },
        ),
    });

    const error = await announce(CREDENTIALS, {
      url: URL_OF_POST,
      title: 'x',
      description: '',
    }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(BlueskyError);
    expect((error as BlueskyError).step).toBe('session');
    // **理由を握り潰さない。** 押した人は管理者ひとりなので、パスワードの誤りと
    // PDS の障害が画面から見分けられる方がよい。
    expect((error as BlueskyError).message).toContain('Invalid identifier or password');
    // 失敗したら先へ進まない。
    expect(xrpcCalls()).toHaveLength(1);
  });

  it('投稿そのものが失敗したら post の失敗', async () => {
    stubBluesky({
      'com.atproto.repo.createRecord': () => new Response('upstream down', { status: 502 }),
    });
    const error = await announce(CREDENTIALS, {
      url: URL_OF_POST,
      title: 'x',
      description: '',
    }).catch((e: unknown) => e);

    expect((error as BlueskyError).step).toBe('post');
    expect((error as BlueskyError).message).toContain('502');
  });

  it('届かなくても BlueskyError にする', async () => {
    vi.stubGlobal('fetch', async () => {
      throw new TypeError('network error');
    });
    const error = await announce(CREDENTIALS, {
      url: URL_OF_POST,
      title: 'x',
      description: '',
    }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(BlueskyError);
    expect((error as BlueskyError).step).toBe('session');
  });
});

describe('AT-URI', () => {
  it('bsky.app で開ける URL にする', () => {
    expect(blueskyPostUrl(AT_URI)).toBe('https://bsky.app/profile/did:plc:abc/post/3kxyz');
  });

  it('知らない形なら null（画面はリンクを出さない）', () => {
    expect(blueskyPostUrl('at://did:plc:abc/app.bsky.feed.like/3kxyz')).toBeNull();
    expect(blueskyPostUrl('https://bsky.app/profile/x/post/y')).toBeNull();
    expect(blueskyPostUrl('')).toBeNull();
  });
});

function graphemes(text: string): number {
  return [...new Intl.Segmenter().segment(text)].length;
}

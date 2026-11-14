import { beforeEach, describe, expect, it } from 'vitest';
import { unpublishPost, updatePost } from '../../src/core/db/posts.ts';
import { db, resetDb } from '../db/helpers.ts';
import { get, MOUNT, seedPost, SITE } from './helpers.ts';

beforeEach(resetDb);

type SearchBody = {
  query: string;
  posts: { id: string; title: string; url: string; published_at: string; tags: string[] }[];
  next: string | null;
};

async function search(query: string): Promise<SearchBody> {
  const res = await get(`${MOUNT}/search.json${query}`);
  expect(res.status).toBe(200);
  return await res.json();
}

const titles = async (query: string): Promise<string[]> =>
  (await search(query)).posts.map((post) => post.title);

describe('search.json', () => {
  it('語を含む公開記事を、posts.json と同じ形で新しい順に返す', async () => {
    await seedPost({
      path: 'new',
      title: '新しい',
      bodyMd: '全文検索を入れた',
      tags: ['dev'],
      publishedAt: '2026-08-02T00:00:00.000Z',
    });
    await seedPost({ path: 'old', title: '古い', bodyMd: '全文検索の下調べ', publishedAt: '2026-08-01T00:00:00.000Z' });
    await seedPost({ path: 'other', title: '無関係', bodyMd: '別の話' });

    const res = await get(`${MOUNT}/search.json?q=${encodeURIComponent('全文検索')}`);
    expect(res.headers.get('Content-Type')).toContain('application/json');
    const body: SearchBody = await res.json();

    expect(body.query).toBe('全文検索');
    expect(body.posts.map((p) => p.title)).toEqual(['新しい', '古い']);
    expect(body.posts[0]?.url).toBe(`${SITE}${MOUNT}/new/`);
    expect(body.posts[0]?.published_at).toBe('2026-08-02T00:00:00.000Z');
    expect(body.posts[0]?.tags).toEqual(['dev']);
    expect(body.next).toBeNull();
  });

  it('下書きは出さない (本文が一致しても)', async () => {
    await seedPost({ path: 'draft', title: '下書き', bodyMd: '秘密の下書き', draft: true });
    expect(await titles(`?q=${encodeURIComponent('秘密の下書き')}`)).toEqual([]);
  });

  it('取り下げた記事は出なくなり、直した本文で引けるようになる', async () => {
    const post = await seedPost({ path: 'p', title: '記事', bodyMd: '最初の本文' });
    await updatePost(db, post.id, { body_md: '書き直した本文' });
    expect(await titles(`?q=${encodeURIComponent('最初の本文')}`)).toEqual([]);
    expect(await titles(`?q=${encodeURIComponent('書き直した')}`)).toEqual(['記事']);

    await unpublishPost(db, post.id);
    expect(await titles(`?q=${encodeURIComponent('書き直した')}`)).toEqual([]);
  });

  it('題と説明でも引ける', async () => {
    await seedPost({ path: 'a', title: 'Cloudflare の話', bodyMd: '本文' });
    await seedPost({ path: 'b', title: '別', description: 'Workers で動かす', bodyMd: '本文' });
    expect(await titles('?q=cloudflare')).toEqual(['Cloudflare の話']);
    expect(await titles('?q=Workers')).toEqual(['別']);
  });

  it('3 文字未満の語でも引ける (trigram の索引に当たらない語)', async () => {
    await seedPost({ path: 'a', title: '検索の話', bodyMd: '本文' });
    await seedPost({ path: 'b', title: 'Go を書く', bodyMd: '本文' });
    await seedPost({ path: 'c', title: '無関係', bodyMd: '本文' });
    expect(await titles(`?q=${encodeURIComponent('検索')}`)).toEqual(['検索の話']);
    expect(await titles('?q=go')).toEqual(['Go を書く']);
  });

  it('空白で区切った語はすべて含む記事だけ (長い語と短い語が混ざっても)', async () => {
    await seedPost({ path: 'a', title: '両方', bodyMd: 'Cloudflare で検索する', publishedAt: '2026-08-02T00:00:00.000Z' });
    await seedPost({ path: 'b', title: '片方', bodyMd: 'Cloudflare の話' });
    // 全角の空白でも区切る
    expect(await titles(`?q=${encodeURIComponent('cloudflare　検索')}`)).toEqual(['両方']);
  });

  it('FTS5 の構文として読まない (引用符・演算子・ワイルドカード)', async () => {
    // 題と本文には、下の語のどれも (2 文字の語が LIKE で当たる部分文字列としても) 含めない
    await seedPost({ path: 'a', title: 'say "hello"', bodyMd: '本文' });
    await seedPost({ path: 'b', title: '無関係', bodyMd: '本文' });
    expect(await titles(`?q=${encodeURIComponent('"hello"')}`)).toEqual(['say "hello"']);
    // 構文として読まれると、500 になるか全件に当たる
    for (const q of ['OR', 'AND', 'hel*', 'NOT 本文', 'a:b', '(x', '_%']) {
      const res = await get(`${MOUNT}/search.json?q=${encodeURIComponent(q)}`);
      expect(res.status, q).toBe(200);
      expect((await res.json<SearchBody>()).posts, q).toEqual([]);
    }
  });

  it('問い合わせを正規化しない (NFD で保存した本文に、同じ NFD の語で当たる)', async () => {
    // 保存の経路は本文を正規化しないので、問い合わせだけ NFC にすると当たらなくなる。
    const nfd = 'がぎぐ'.normalize('NFD');
    await seedPost({ path: 'a', title: '濁点', bodyMd: `macOS から貼った${nfd}` });
    expect(await titles(`?q=${encodeURIComponent(nfd)}`)).toEqual(['濁点']);
  });

  it('LIKE の % と _ は文字として扱う', async () => {
    await seedPost({ path: 'a', title: 'a_b', bodyMd: '本文' });
    await seedPost({ path: 'b', title: 'axb', bodyMd: '本文' });
    expect(await titles('?q=_')).toEqual(['a_b']);
  });

  it('続きがあるときだけ next に次のページの絶対 URL を入れる', async () => {
    for (let i = 0; i < 3; i++) {
      await seedPost({
        path: `p${i}`,
        title: `記事 ${i}`,
        bodyMd: '共通の語',
        publishedAt: `2026-08-01T00:00:0${i}.000Z`,
      });
    }
    const first = await search(`?q=${encodeURIComponent('共通の語')}&limit=2`);
    expect(first.posts.map((p) => p.title)).toEqual(['記事 2', '記事 1']);
    expect(first.next).toBe(
      `${SITE}${MOUNT}/search.json?q=${encodeURIComponent('共通の語')}&limit=2&offset=2`,
    );

    const second = await search(new URL(first.next!).search);
    expect(second.posts.map((p) => p.title)).toEqual(['記事 0']);
    expect(second.next).toBeNull();
  });

  it('limit は既定 10・上限 20 で、読めない offset は 0 に落とす', async () => {
    for (let i = 0; i < 25; i++) {
      await seedPost({
        path: `p${i}`,
        title: `記事 ${i}`,
        bodyMd: '共通の語',
        publishedAt: `2026-08-01T00:00:${String(i).padStart(2, '0')}.000Z`,
      });
    }
    const q = `?q=${encodeURIComponent('共通の語')}`;
    expect((await search(q)).posts).toHaveLength(10);
    expect((await search(`${q}&limit=999`)).posts).toHaveLength(20);
    expect((await search(`${q}&offset=-1`)).posts[0]?.title).toBe('記事 24');
    expect((await search(`${q}&offset=24`)).posts.map((p) => p.title)).toEqual(['記事 0']);
  });

  it('offset の上限 (1000) の先は案内せず、頼まれたら 400 で断る', async () => {
    // 丸めて返すと上限のページが何度でも返り、next をたどると終わらない。
    // 上限を越えるだけの記事を seedPost で作ると遅いので、生 SQL でまとめて入れる。
    await db.batch([
      db.prepare(
        `WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 1021)
         INSERT INTO posts (public_id, title, body_md, status, published_at, updated_at, created_at)
         SELECT 'bulk-' || i, '記事 ' || i, '共通の語', 'published',
                '2026-08-01T00:00:00.000Z', '2026-08-01T00:00:00.000Z', '2026-08-01T00:00:00.000Z'
           FROM n`,
      ),
      db.prepare(
        `INSERT INTO post_paths (path, post_id, is_canonical, created_at)
         SELECT public_id, id, 1, created_at FROM posts`,
      ),
    ]);
    const q = `?q=${encodeURIComponent('共通の語')}&limit=20`;

    // 980 + 20 = 1000 までは案内する
    expect((await search(`${q}&offset=980`)).next).toContain('offset=1000');
    // 1000 のページは返すが、その先 (1020) は上限を越えるので案内しない
    const last = await search(`${q}&offset=1000`);
    expect(last.posts).toHaveLength(20);
    expect(last.next).toBeNull();
    // 990 からだと次は 1010 で上限を越える。丸めて 1000 を指すと 10 件が重複する
    expect((await search(`${q}&offset=990`)).next).toBeNull();

    const res = await get(`${MOUNT}/search.json${q}&offset=1001`);
    expect(res.status).toBe(400);
    expect((await res.json<{ error: string }>()).error).toBe('offset-too-large');
  });

  it.each([
    ['q が無い', '', 'empty'],
    ['空白だけ', '?q=%20%E3%80%80', 'empty'],
    ['長すぎる', `?q=${'あ'.repeat(101)}`, 'too-long'],
    ['語が多すぎる', '?q=a+b+c+d+e+f', 'too-many-terms'],
  ])('問い合わせが読めなければ 400 (%s)', async (_name, query, code) => {
    const res = await get(`${MOUNT}/search.json${query}`);
    expect(res.status).toBe(400);
    expect((await res.json<{ error: string }>()).error).toBe(code);
  });

  it('長さの上限は文字数で数える (100 文字ちょうどは通る)', async () => {
    const res = await get(`${MOUNT}/search.json?q=${encodeURIComponent('😀'.repeat(100))}`);
    expect(res.status).toBe(200);
  });
});

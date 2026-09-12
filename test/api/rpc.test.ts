import { afterEach, beforeEach, expect, it } from 'vitest';
import { hc } from 'hono/client';
import type { LilyApi } from '../../src/core/api/index.ts';
import { resetDb } from '../db/helpers.ts';
import { getRootRequest, setStubUser } from '../routes/helpers.ts';

beforeEach(resetDb);
afterEach(() => setStubUser(null));

/**
 * 管理画面が使う形そのもの。**`hc` にアプリを直結して**、型と実装が噛み合って
 * いることをここで見る。
 *
 * route のパスがリテラルでなくなると (mount を焼き込むと) `client.posts` の形が
 * 崩れてコンパイルが通らなくなるので、これは型のテストでもある。
 */
const client = hc<LilyApi>('https://blog.example.com/api', {
  fetch: (input: RequestInfo | URL, init?: RequestInit) =>
    getRootRequest(new Request(input as RequestInfo, init)),
});

it('型付きのクライアントから一通り操作できる', async () => {
  setStubUser({ id: 'admin' });

  const created = await client.posts.$post({
    json: { title: 'RPC から作った', bodyMd: '## 見出し\n', path: 'from-rpc', tags: ['dev'] },
  });
  // **絞り込みが要ることそのものが検査。** レスポンスの型は成功・API のエラー・
  // zod の検証失敗の union なので、管理画面は必ず失敗を扱うことになる。
  if (!created.ok) throw new Error(`作成に失敗した: ${created.status}`);
  const { post } = await created.json();
  // 推論だけで通ること自体が検査。`post.canonicalPath` の型は handler から来る。
  expect(post.canonicalPath).toBe('from-rpc');
  expect(post.tags.map((tag) => tag.name)).toEqual(['dev']);

  const published = await client.posts[':publicId'].publish.$post({
    param: { publicId: post.publicId },
    json: {},
  });
  if (!published.ok) throw new Error('公開に失敗した');
  expect((await published.json()).post.status).toBe('published');

  const list = await client.posts.$get({ query: { status: 'published' } });
  if (!list.ok) throw new Error('一覧に失敗した');
  expect((await list.json()).posts.map((p) => p.publicId)).toEqual([post.publicId]);
});

it('レスポンスの型は handler から推論される (手で書いた型とずれない)', async () => {
  setStubUser({ id: 'admin' });
  const res = await client.me.$get();
  if (!res.ok) throw new Error('me に失敗した');
  const body = await res.json();

  // `user` が AuthUser であることは createApi の handler が決めている。
  const id: string = body.user.id;
  const email: string | undefined = body.user.email;
  expect(id).toBe('admin');
  expect(email).toBeUndefined();
});

it('検証に落ちたときも型の上で扱える', async () => {
  setStubUser({ id: 'admin' });
  const res = await client.posts.$post({ json: { title: '', bodyMd: '' } });
  expect(res.ok).toBe(false);
  expect(res.status).toBe(400);
});

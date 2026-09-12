import { env } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getMediaByPublicId } from '../../src/core/db/media.ts';
import { getPostByPublicId } from '../../src/core/db/posts.ts';
import { resolvePath } from '../../src/core/db/post-paths.ts';
import { db, resetDb } from '../db/helpers.ts';
import { api, apiJson, getRoot, json, setStubUser } from '../routes/helpers.ts';
import { pngHeader } from '../fixtures/png.ts';

beforeEach(resetDb);
afterEach(() => setStubUser(null));

async function createPost(body: Record<string, unknown> = {}) {
  const { status, body: created } = await apiJson('POST', '/api/posts', {
    title: 'はじめての記事',
    bodyMd: '## 見出し\n\n本文。\n',
    ...body,
  });
  expect(status, JSON.stringify(created)).toBe(201);
  return created.post;
}

describe('認証', () => {
  it('未認証では触れない', async () => {
    setStubUser(null);
    expect((await getRoot('/api/posts')).status).toBe(403);
  });
});

describe('作成と取得', () => {
  it('作ると下書きで、canonical は public_id', async () => {
    const post = await createPost();
    expect(post.status).toBe('draft');
    expect(post.canonicalPath).toBe(post.publicId);
    expect(post.url).toBe(`/${post.publicId}/`);
  });

  it('保存した時点で配信用の HTML も作る', async () => {
    // body_html は派生データだが、配信側が毎回描き直さずに済むよう保存のたびに作る。
    const post = await createPost();
    const row = await getPostByPublicId(db, post.publicId);
    expect(row?.body_html).toContain('<h2>見出し</h2>');
    expect(row?.renderer_version).not.toBeNull();
  });

  it('パスとタグを指定できる', async () => {
    const post = await createPost({ path: 'start-blog', tags: ['dev', '日記'] });
    expect(post.canonicalPath).toBe('start-blog');
    expect(post.tags.map((t: { name: string }) => t.name).sort()).toEqual(['dev', '日記']);
    // public_id でも引けるよう alias が入る
    expect(post.paths.map((p: { path: string }) => p.path).sort()).toEqual(
      [post.publicId, 'start-blog'].sort(),
    );
  });

  it('プレビューのトークンは外に出さない', async () => {
    const post = await createPost();
    expect(JSON.stringify(post)).not.toContain('preview_token_hash');
    expect(post.hasPreview).toBe(false);
  });

  it('一覧と個別取得', async () => {
    const post = await createPost({ path: 'a' });
    const list = await apiJson('GET', '/api/posts');
    expect(list.body.posts.map((p: { publicId: string }) => p.publicId)).toEqual([post.publicId]);

    const one = await apiJson('GET', `/api/posts/${post.publicId}`);
    expect(one.body.post.title).toBe('はじめての記事');
    expect((await apiJson('GET', '/api/posts/nope')).status).toBe(404);
  });

  it('一覧は総件数を返す (ページャに要る)', async () => {
    for (const path of ['a', 'b', 'c']) await createPost({ path, title: path });

    const page = await apiJson('GET', '/api/posts?limit=2&offset=0');
    expect(page.body).toMatchObject({ total: 3, limit: 2, offset: 0 });
    expect(page.body.posts).toHaveLength(2);

    const next = await apiJson('GET', '/api/posts?limit=2&offset=2');
    expect(next.body.posts).toHaveLength(1);
    // 同じ記事が 2 ページに出ない
    const seen = [...page.body.posts, ...next.body.posts].map((p: { publicId: string }) => p.publicId);
    expect(new Set(seen).size).toBe(3);
  });

  it('絞り込むと総件数もその分になる', async () => {
    const published = await createPost({ path: 'a' });
    await apiJson('POST', `/api/posts/${published.publicId}/publish`, {});
    await createPost({ path: 'b' });

    expect((await apiJson('GET', '/api/posts?status=published')).body.total).toBe(1);
    expect((await apiJson('GET', '/api/posts?status=draft')).body.total).toBe(1);
    expect((await apiJson('GET', '/api/posts')).body.total).toBe(2);
  });

  it('形が違う入力は 400', async () => {
    expect((await apiJson('POST', '/api/posts', { title: '' })).status).toBe(400);
    expect((await apiJson('POST', '/api/posts', {})).status).toBe(400);
    // **空白だけの題も空と同じ。** DB の CHECK は空文字しか弾かないので、
    // ここを通すと一覧に何も書いていない行が並ぶ。
    expect((await apiJson('POST', '/api/posts', { title: '   ' })).status).toBe(400);
    expect((await apiJson('POST', '/api/posts', { title: '　' })).status).toBe(400);
  });

  it('題の前後の空白は落として保存する', async () => {
    const created = await apiJson('POST', '/api/posts', { title: '  余白つきの題  ' });
    expect(created.status).toBe(201);
    expect(created.body.post.title).toBe('余白つきの題');
  });

  it('使われているパスは 409', async () => {
    await createPost({ path: 'taken' });
    const conflict = await apiJson('POST', '/api/posts', { title: 'x', path: 'TAKEN' });
    expect(conflict.status).toBe(409);
    expect(conflict.body.error).toBe('path-taken');
  });

  it('予約パスは 400', async () => {
    const reserved = await apiJson('POST', '/api/posts', { title: 'x', path: 'admin' });
    expect(reserved.status).toBe(400);
    expect(reserved.body.error).toBe('reserved-path');
  });
});

describe('一覧の絞り込み', () => {
  it('タグで絞ると、行も総件数もその分になる', async () => {
    const tagged = await createPost({ path: 'a', tags: ['dev'] });
    await createPost({ path: 'b', tags: ['日記'] });
    await createPost({ path: 'c' });

    const res = await apiJson('GET', '/api/posts?tag=dev');
    expect(res.body.posts.map((p: { publicId: string }) => p.publicId)).toEqual([tagged.publicId]);
    // **総件数も絞る。** 行だけ絞ると、ページャが「次がある」と言い続ける。
    expect(res.body.total).toBe(1);
  });

  it('一覧の行にタグを載せる (絞り込みの手がかりになる)', async () => {
    await createPost({ path: 'a', tags: ['dev', '日記'] });
    const res = await apiJson('GET', '/api/posts');
    expect(res.body.posts[0].tags).toEqual([
      { name: 'dev', slug: 'dev' },
      { name: '日記', slug: '日記' },
    ]);
  });

  it('キーワードはタイトル・説明・本文を見る', async () => {
    const byTitle = await createPost({ path: 'a', title: '合言葉の話' });
    const byDescription = await createPost({ path: 'b', title: 'b', description: '合言葉について' });
    const byBody = await createPost({ path: 'c', title: 'c', bodyMd: 'ここに合言葉がある' });
    await createPost({ path: 'd', title: 'd', bodyMd: '関係の無い話' });

    const res = await apiJson('GET', '/api/posts?q=' + encodeURIComponent('合言葉'));
    expect(res.body.total).toBe(3);
    expect(res.body.posts.map((p: { publicId: string }) => p.publicId).sort()).toEqual(
      [byTitle.publicId, byDescription.publicId, byBody.publicId].sort(),
    );
  });

  it('LIKE のワイルドカードを含む語でも、その語として探す', async () => {
    // **エスケープしないと `_` が「任意の 1 文字」になり、`a_b` が `axb` にも当たる。**
    const literal = await createPost({ path: 'a', title: 'a_b' });
    await createPost({ path: 'b', title: 'axb' });

    const res = await apiJson('GET', '/api/posts?q=a_b');
    expect(res.body.posts.map((p: { publicId: string }) => p.publicId)).toEqual([literal.publicId]);

    // `%` も同じ。単独で渡しても全件にはならない。
    await createPost({ path: 'c', title: '100%達成' });
    expect((await apiJson('GET', '/api/posts?q=' + encodeURIComponent('%'))).body.total).toBe(1);
  });

  it('空の絞り込みは絞り込み無しと同じ', async () => {
    // 画面の入力欄を空にすると `?q=` が付いて飛んでくる。空文字に一致する記事を
    // 探しに行かせない。
    await createPost({ path: 'a' });
    await createPost({ path: 'b' });
    expect((await apiJson('GET', '/api/posts?q=&tag=')).body.total).toBe(2);
    // 空白だけのときも同じ。
    expect((await apiJson('GET', '/api/posts?q=%20%20')).body.total).toBe(2);
  });

  it('絞り込みを重ねると AND になる', async () => {
    const both = await createPost({ path: 'a', title: '合言葉', tags: ['dev'] });
    await apiJson('POST', `/api/posts/${both.publicId}/publish`, {});
    await createPost({ path: 'b', title: '合言葉', tags: ['日記'] });
    const draft = await createPost({ path: 'c', title: '合言葉', tags: ['dev'] });

    const res = await apiJson('GET', '/api/posts?tag=dev&status=published&q=' + encodeURIComponent('合言葉'));
    expect(res.body.posts.map((p: { publicId: string }) => p.publicId)).toEqual([both.publicId]);
    expect(res.body.total).toBe(1);
    // 下書きは status で落ちている
    expect(res.body.posts.map((p: { publicId: string }) => p.publicId)).not.toContain(draft.publicId);
  });

  it('無いタグで絞ると 0 件 (エラーにはしない)', async () => {
    await createPost({ path: 'a', tags: ['dev'] });
    const res = await apiJson('GET', '/api/posts?tag=nope');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ total: 0 });
    expect(res.body.posts).toEqual([]);
  });
});

describe('副作用', () => {
  it('取得は書き込まない', async () => {
    // GET のたびに body_html を書き直すと、一覧→詳細を開くだけで D1 に書き込む。
    const post = await createPost();
    await db.prepare("UPDATE posts SET body_html = '<p>目印</p>'").run();

    await apiJson('GET', `/api/posts/${post.publicId}`);
    expect((await getPostByPublicId(db, post.publicId))?.body_html).toBe('<p>目印</p>');
  });

  it('パスを変えても描き直さない (本文は変わらないので)', async () => {
    const post = await createPost({ path: 'a' });
    await db.prepare("UPDATE posts SET body_html = '<p>目印</p>'").run();

    await apiJson('PUT', `/api/posts/${post.publicId}/path`, { path: 'b' });
    expect((await getPostByPublicId(db, post.publicId))?.body_html).toBe('<p>目印</p>');
  });

  it('タグが不正なら記事を作らない', async () => {
    // 作ってから弾くと、失敗を返したのに記事だけ残り、同じパスで作り直すと
    // 409 になって手詰まりになる。
    const failed = await apiJson('POST', '/api/posts', {
      title: 'x',
      path: 'wanted',
      tags: ['Dev', 'dev'],
    });
    expect(failed.status).toBe(409);
    expect((await apiJson('GET', '/api/posts')).body.posts).toEqual([]);

    // 同じパスでやり直せる
    const retry = await apiJson('POST', '/api/posts', { title: 'x', path: 'wanted' });
    expect(retry.status).toBe(201);
  });
});

describe('タグの補完', () => {
  it('既存のタグを、公開記事の件数つきで返す', async () => {
    const published = await createPost({ path: 'a', tags: ['dev', '日記'] });
    await apiJson('POST', `/api/posts/${published.publicId}/publish`, {});
    // 下書きにしか付いていないタグも候補には出す (件数は 0)
    await createPost({ path: 'b', tags: ['まだ下書き'] });

    const res = await apiJson('GET', '/api/tags');
    // slug も返す。一覧の絞り込みは name ではなく slug で行う。
    expect(res.body.tags).toEqual([
      { name: 'dev', slug: 'dev', count: 1 },
      { name: '日記', slug: '日記', count: 1 },
      { name: 'まだ下書き', slug: 'まだ下書き', count: 0 },
    ]);
  });
});

describe('貼り付けた URL のタイトル', () => {
  it('認証が要る', async () => {
    setStubUser(null);
    const res = await getRoot('/api/link-title');
    expect(res.status).toBe(403);
  });

  it('URL として読めないものは 400', async () => {
    expect((await apiJson('POST', '/api/link-title', { url: 'ただのメモ' })).status).toBe(400);
  });
});

describe('更新', () => {
  it('本文を書き換えると配信用の HTML も描き直す', async () => {
    const post = await createPost();
    await apiJson('PATCH', `/api/posts/${post.publicId}`, { bodyMd: '## 書き直した\n' });

    const row = await getPostByPublicId(db, post.publicId);
    expect(row?.body_html).toContain('<h2>書き直した</h2>');
    expect(row?.body_html).not.toContain('見出し</h2>');
  });

  it('タグを丸ごと置き換える', async () => {
    const post = await createPost({ tags: ['a', 'b'] });
    const updated = await apiJson('PATCH', `/api/posts/${post.publicId}`, { tags: ['b', 'c'] });
    expect(updated.body.post.tags.map((t: { name: string }) => t.name)).toEqual(['b', 'c']);
  });

  it('slug が衝突するタグは 409', async () => {
    const post = await createPost();
    const conflict = await apiJson('PATCH', `/api/posts/${post.publicId}`, { tags: ['Dev', 'dev'] });
    expect(conflict.status).toBe(409);
    expect(conflict.body.error).toBe('slug-taken');
  });
});

describe('公開日時', () => {
  it('下書きのうちから決めておける (公開のときにその日時になる)', async () => {
    const post = await createPost({ publishedAt: '2026-09-01T01:00:00.000Z' });
    expect(post.status).toBe('draft');
    expect(post.publishedAt).toBe('2026-09-01T01:00:00.000Z');

    const published = await apiJson('POST', `/api/posts/${post.publicId}/publish`, {});
    expect(published.body.post.publishedAt).toBe('2026-09-01T01:00:00.000Z');
  });

  it('公開したあとから変えられる', async () => {
    const post = await createPost({ path: 'a' });
    await apiJson('POST', `/api/posts/${post.publicId}/publish`, {});

    const updated = await apiJson('PATCH', `/api/posts/${post.publicId}`, {
      publishedAt: '2020-05-05T04:45:00.000Z',
    });
    expect(updated.body.post.publishedAt).toBe('2020-05-05T04:45:00.000Z');

    // 並びに効く: フィードの pubDate も変わる
    const rss = await (await getRoot('/rss.xml')).text();
    expect(rss).toContain('<pubDate>Tue, 05 May 2020 04:45:00 GMT</pubDate>');
  });

  it('publishedAt を送らなければ秒まで保たれる', async () => {
    // 管理画面の欄は分までしか持たないので、触っていないのに送り返すと秒が落ちる。
    // 並びは published_at 順なので、同じ分に公開した記事の順序が入れ替わる。
    const post = await createPost({ path: 'a', publishedAt: '2026-08-01T00:00:42.500Z' });
    const updated = await apiJson('PATCH', `/api/posts/${post.publicId}`, { title: '題だけ直す' });
    expect(updated.body.post.publishedAt).toBe('2026-08-01T00:00:42.500Z');
  });

  it('日時として読めないものは 400', async () => {
    const post = await createPost();
    expect(
      (await apiJson('PATCH', `/api/posts/${post.publicId}`, { publishedAt: 'きのう' })).status,
    ).toBe(400);
  });
});

describe('公開と取り下げ', () => {
  it('公開すると published_at が入り、取り下げても日付は残る', async () => {
    const post = await createPost({ path: 'a' });
    const published = await apiJson('POST', `/api/posts/${post.publicId}/publish`, {
      publishedAt: '2026-08-01T00:00:00.000Z',
    });
    expect(published.body.post.status).toBe('published');
    expect(published.body.post.publishedAt).toBe('2026-08-01T00:00:00.000Z');
    expect((await getRoot('/a/')).status).toBe(200);

    const draft = await apiJson('POST', `/api/posts/${post.publicId}/unpublish`);
    expect(draft.body.post.status).toBe('draft');
    expect(draft.body.post.publishedAt).toBe('2026-08-01T00:00:00.000Z');
    expect((await getRoot('/a/')).status).toBe(404);
  });

  it('日付を省いても公開できる', async () => {
    const post = await createPost();
    const published = await apiJson('POST', `/api/posts/${post.publicId}/publish`, {});
    expect(published.body.post.publishedAt).not.toBeNull();
  });
});

describe('パスの操作', () => {
  it('canonical を変えると旧パスは alias として残る', async () => {
    const post = await createPost({ path: 'old' });
    await apiJson('POST', `/api/posts/${post.publicId}/publish`, {});

    const changed = await apiJson('PUT', `/api/posts/${post.publicId}/path`, { path: 'new' });
    expect(changed.body.post.canonicalPath).toBe('new');

    // 共有された URL は生き続ける
    const redirect = await getRoot('/old/');
    expect(redirect.status).toBe(308);
    expect(redirect.headers.get('location')).toBe('/new/');
  });

  it('alias を足して消せる。canonical と public_id は消せない', async () => {
    const post = await createPost({ path: 'a' });
    await apiJson('POST', `/api/posts/${post.publicId}/paths`, { path: 'b' });
    expect(await resolvePath(db, 'b')).not.toBeNull();

    expect((await apiJson('DELETE', `/api/posts/${post.publicId}/paths`, { path: 'b' })).status).toBe(200);
    expect(await resolvePath(db, 'b')).toBeNull();

    expect((await apiJson('DELETE', `/api/posts/${post.publicId}/paths`, { path: 'a' })).body.error)
      .toBe('canonical-required');
    expect(
      (await apiJson('DELETE', `/api/posts/${post.publicId}/paths`, { path: post.publicId })).body.error,
    ).toBe('public-id-path');
  });

  it('他の記事のパスは取れない', async () => {
    await createPost({ path: 'a' });
    const other = await createPost({ path: 'b', title: 'ほか' });
    const conflict = await apiJson('PUT', `/api/posts/${other.publicId}/path`, { path: 'a' });
    expect(conflict.status).toBe(409);
  });
});

describe('下書きプレビュー', () => {
  it('発行した URL で下書きが読め、失効させると 404', async () => {
    const post = await createPost({ title: '下書きの記事' });
    const issued = await apiJson('POST', `/api/posts/${post.publicId}/preview`);
    // mount 相対で返す。絶対にすると、手元で発行したリンクが本番のホストを指す。
    expect(issued.body.path).toMatch(/^\/preview\//);

    const preview = await getRoot(issued.body.path);
    expect(preview.status).toBe(200);
    expect(await preview.text()).toContain('下書きの記事');

    expect((await apiJson('GET', `/api/posts/${post.publicId}`)).body.post.hasPreview).toBe(true);

    await apiJson('DELETE', `/api/posts/${post.publicId}/preview`);
    expect((await getRoot(issued.body.path)).status).toBe(404);
  });

  it('生のトークンを返すのは発行のときだけ', async () => {
    const post = await createPost();
    const issued = await apiJson('POST', `/api/posts/${post.publicId}/preview`);
    const token = issued.body.path.split('/').pop();

    const detail = await apiJson('GET', `/api/posts/${post.publicId}`);
    expect(JSON.stringify(detail.body)).not.toContain(token);
  });
});

describe('削除', () => {
  it('記事を消すと R2 の実体も消える', async () => {
    const post = await createPost();
    await api(`/api/posts/${post.publicId}/media`, { method: 'POST', body: filePayload() });

    const key = `posts/${post.publicId}/sample.png`;
    expect(await env.MEDIA.get(key)).not.toBeNull();

    expect((await apiJson('DELETE', `/api/posts/${post.publicId}`)).status).toBe(200);
    expect(await getPostByPublicId(db, post.publicId)).toBeNull();
    expect(await env.MEDIA.get(key)).toBeNull();
  });
});

function filePayload(name = 'sample.png', type = 'image/png', bytes = 'png'): FormData {
  const form = new FormData();
  form.append('file', new File([bytes], name, { type }));
  return form;
}

describe('添付', () => {
  it('上げると本文の相対参照が解決される', async () => {
    const post = await createPost({ bodyMd: '![図](./sample.png)\n' });
    const before = await getPostByPublicId(db, post.publicId);
    expect(before?.body_html).toContain('src="./sample.png"');

    const res = await api(`/api/posts/${post.publicId}/media`, { method: 'POST', body: filePayload() });
    expect(res.status).toBe(201);
    const uploaded = await json(res);
    expect(uploaded.media.url).toBe(`/media/${uploaded.media.publicId}/sample.png`);

    // 上げた時点で描き直すので、配信側は placeholder 済みの HTML を持つ
    const after = await getPostByPublicId(db, post.publicId);
    expect(after?.body_html).toContain('lily-media://');
    expect((await getRoot(uploaded.media.url)).status).toBe(200);
  });

  it('寸法を読んで <img> の width / height に出す', async () => {
    // **属性が無いと画像が届くまで高さが 0 で、本文が飛ぶ。**
    const post = await createPost({ bodyMd: '![図](./sample.png)\n' });
    const form = new FormData();
    form.append('file', new File([pngHeader(96, 48)], 'sample.png', { type: 'image/png' }));
    const res = await api(`/api/posts/${post.publicId}/media`, { method: 'POST', body: form });
    expect(res.status).toBe(201);

    const { media } = await json(res);
    expect(await getMediaByPublicId(db, media.publicId)).toMatchObject({ width: 96, height: 48 });

    const after = await getPostByPublicId(db, post.publicId);
    expect(after?.body_html).toContain('width="96" height="48" loading="lazy" decoding="async"');
  });

  it('寸法が読めない添付でも受け付ける (属性が出ないだけ)', async () => {
    const post = await createPost({ bodyMd: '![図](./sample.png)\n' });
    const res = await api(`/api/posts/${post.publicId}/media`, { method: 'POST', body: filePayload() });
    expect(res.status).toBe(201);

    const after = await getPostByPublicId(db, post.publicId);
    expect(after?.body_html).toContain('loading="lazy"');
    expect(after?.body_html).not.toContain('width=');
  });

  it('解決できない参照を警告として返す', async () => {
    const post = await createPost({ bodyMd: '![図](./missing.png)\n' });
    const res = await api(`/api/posts/${post.publicId}/media`, { method: 'POST', body: filePayload() });
    expect((await json(res)).unresolvedMedia).toEqual(['./missing.png']);
  });

  it('許していない形式は弾く', async () => {
    const post = await createPost();
    const res = await api(`/api/posts/${post.publicId}/media`, {
      method: 'POST',
      body: filePayload('evil.html', 'text/html', '<script>'),
    });
    expect(res.status).toBe(400);
    // **判断は拡張子。** 書庫に Content-Type は無いので、import 側は拡張子しか
    // 見られない。ここを Content-Type だけで通すと、上げられるのに取り込み直せない
    // 添付ができる (往復の検査は test/transfer/transfer.test.ts の「添付の形式」)。
    expect((await json(res)).error).toBe('extension-not-allowed');
  });

  it('記事のパスと同じ規則でファイル名を見る', async () => {
    const post = await createPost();
    for (const name of ['a/b.png', '..', 'con.png', 'foo.']) {
      const form = new FormData();
      form.append('file', new File(['png'], 'ok.png', { type: 'image/png' }));
      form.append('filename', name);
      const res = await api(`/api/posts/${post.publicId}/media`, { method: 'POST', body: form });
      expect(res.status, name).toBe(400);
    }
  });

  it('消すと R2 からも消え、本文も描き直す', async () => {
    const post = await createPost({ bodyMd: '![図](./sample.png)\n' });
    const res = await api(`/api/posts/${post.publicId}/media`, { method: 'POST', body: filePayload() });
    const { media } = await json(res);
    expect((await getPostByPublicId(db, post.publicId))?.body_html).toContain('lily-media://');

    const deleted = await apiJson('DELETE', `/api/media/${media.publicId}`);
    expect(deleted.status).toBe(200);
    expect(await env.MEDIA.get(`posts/${post.publicId}/sample.png`)).toBeNull();
    expect((await getRoot(media.url)).status).toBe(404);

    // 消えた画像を指す <img> が公開ページに残り続けないこと
    const row = await getPostByPublicId(db, post.publicId);
    expect(row?.body_html).not.toContain('lily-media://');
    expect(deleted.body.unresolvedMedia).toEqual(['./sample.png']);
  });

  it('同じ名前で 2 回上げても元の実体を壊さない', async () => {
    // R2 のキーは (記事, ファイル名) から決まるので、置いてから DB を見ると
    // 「失敗した」と言いながら元の画像が上書きされて消える。
    const post = await createPost();
    await api(`/api/posts/${post.publicId}/media`, {
      method: 'POST',
      body: filePayload('sample.png', 'image/png', 'もとの中身'),
    });

    const again = await api(`/api/posts/${post.publicId}/media`, {
      method: 'POST',
      body: filePayload('sample.png', 'image/png', 'あとの中身'),
    });
    expect(again.status).toBe(409);
    expect(await (await env.MEDIA.get(`posts/${post.publicId}/sample.png`))!.text()).toBe('もとの中身');
  });
});

/** renderer を更新した状況を作る (保存済みの HTML を古い形に差し替える)。 */
async function makeStale(): Promise<void> {
  await db.prepare("UPDATE posts SET body_html = '<p>古い</p>', renderer_version = '0'").run();
}

describe('再描画', () => {
  it('古い renderer で描かれた記事だけを作り直す', async () => {
    const post = await createPost({ bodyMd: '## もとの見出し\n' });
    await makeStale();

    const result = await apiJson('POST', '/api/rerender');
    expect(result.body).toMatchObject({ rendered: 1, remaining: 0 });

    const row = await getPostByPublicId(db, post.publicId);
    expect(row?.body_html).toContain('<h2>もとの見出し</h2>');
    expect(row?.renderer_version).not.toBe('0');

    // 2 回目は何もすることが無い
    expect((await apiJson('POST', '/api/rerender')).body).toMatchObject({ rendered: 0, remaining: 0 });
  });

  it('解決できない参照を記事ごとに返す', async () => {
    await createPost({ bodyMd: '![図](./missing.png)\n' });
    await makeStale();
    const result = await apiJson('POST', '/api/rerender');
    expect(result.body.warnings[0].unresolvedMedia).toEqual(['./missing.png']);
  });

  /**
   * 管理画面が知らせを出すのに読む口。**`GET` は 1 行も書かない** ――
   * 配信側での lazy 再描画を採らなかったのと同じ理由（`GET` が D1 に書くと、
   * 一覧から詳細を開くだけで書き込みが起きる）。
   */
  describe('残りの件数 (GET)', () => {
    it('今の renderer と、描き直しが要る件数を返す', async () => {
      await createPost({ bodyMd: 'ひとつめ\n' });
      await createPost({ bodyMd: 'ふたつめ\n', title: 'ふたつめ' });
      expect((await apiJson('GET', '/api/rerender')).body).toMatchObject({ remaining: 0 });

      await makeStale();
      const result = await apiJson('GET', '/api/rerender');
      expect(result.body.remaining).toBe(2);
      // 版そのものは core の持ち物。**古い版と違うこと**だけを見る
      // （上げるたびにテストを書き換えることにならないように）。
      expect(result.body.rendererVersion).not.toBe('0');
    });

    it('数えるだけで、描き直しも版の書き換えもしない', async () => {
      const post = await createPost({ bodyMd: '## 見出し\n' });
      await makeStale();

      await apiJson('GET', '/api/rerender');

      const row = await getPostByPublicId(db, post.publicId);
      expect(row?.body_html).toBe('<p>古い</p>');
      expect(row?.renderer_version).toBe('0');
      expect((await apiJson('GET', '/api/rerender')).body.remaining).toBe(1);
    });
  });
});

describe('プレビューの描画', () => {
  it('本文と一緒に、説明を空にしたときに出るものを返す', async () => {
    // 管理画面の説明欄はこれを placeholder に出す。**組み立てるのはサーバー**で、
    // 解析器を管理画面のバンドルへ運ばないため（配信側と同じ関数を通る）。
    const result = await apiJson('POST', '/api/render', {
      bodyMd: ['## 見出し', '', '本文の書き出し。', '', '次の段落。'].join('\n'),
    });
    expect(result.status).toBe(200);
    expect(result.body.html).toContain('<h2>見出し</h2>');
    expect(result.body.autoDescription).toBe('本文の書き出し。');
  });

  it('文章の無い本文では null（空の説明を見せない）', async () => {
    const result = await apiJson('POST', '/api/render', { bodyMd: '# 題だけ\n' });
    expect(result.body.autoDescription).toBeNull();
  });
});

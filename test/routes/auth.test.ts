import { afterEach, describe, expect, it } from 'vitest';
import { getRoot, getRootRequest, ROOT_SITE, setStubUser } from './helpers.ts';

afterEach(() => setStubUser(null));

describe('保護境界', () => {
  it('未認証の /api/* は JSON で 403 を返し、残さない', async () => {
    const res = await getRoot('/api/me');
    expect(res.status).toBe(403);
    expect(res.headers.get('content-type')).toContain('application/json');
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.json()).toEqual({ error: 'forbidden' });
  });

  it('未認証の /admin/* は 403 (中身がまだ無くても)', async () => {
    const res = await getRoot('/admin/');
    expect(res.status).toBe(403);
    expect(res.headers.get('content-type')).toContain('text/plain');
  });

  it('拒否した理由はレスポンスに載せない', async () => {
    // どこまで合っていたかを教えると、当てにいく手掛かりになる。
    const body = await (await getRoot('/api/me')).text();
    expect(body).not.toContain('スタブ');
    expect(body).not.toContain('reason');
  });

  it('認証が通れば誰として入っているかを返す', async () => {
    setStubUser({ id: 'user-1', email: 'kan@example.com' });
    const res = await getRoot('/api/me');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ user: { id: 'user-1', email: 'kan@example.com' } });
  });

  it('認証が通れば管理画面が出る', async () => {
    setStubUser({ id: 'user-1' });
    const res = await getRoot('/admin/');
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('<div id="app">');
  });

  it('管理画面は共有キャッシュに残さず、検索にも載せない', async () => {
    setStubUser({ id: 'user-1' });
    const res = await getRoot('/admin/');
    expect(res.headers.get('cache-control')).toContain('private');
    expect(res.headers.get('x-robots-tag')).toBe('noindex');
  });

  it('知らないパスは入口に寄せる (リロードで 404 にしない)', async () => {
    setStubUser({ id: 'user-1' });
    const res = await getRoot('/admin/posts/anything');
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('<div id="app">');
  });

  it('末尾スラッシュ無しは 308', async () => {
    setStubUser({ id: 'user-1' });
    const res = await getRoot('/admin');
    expect(res.status).toBe(308);
    expect(res.headers.get('location')).toBe('/admin/');
  });

  it('公開側は認証を要らない', async () => {
    expect((await getRoot('/')).status).toBe(200);
    expect((await getRoot('/rss.xml')).status).toBe(200);
  });
});

describe('CSRF', () => {
  /**
   * Cloudflare Access の CF_Authorization は Cookie なので、他所のサイトから
   * 送られたリクエストにも付いて回る。認証だけでは、ログイン中の管理者が
   * 細工したページを開くだけで書き込みが起きてしまう。
   */
  function post(path: string, headers: Record<string, string> = {}): Promise<Response> {
    setStubUser({ id: 'admin' });
    return getRootRequest(new Request(`${ROOT_SITE}${path}`, { method: 'POST', headers }));
  }

  it('body を読まない口も、別サイトからは叩けない', async () => {
    // ここが素通しだと、記事の取り下げやプレビュー URL の発行を仕込まれる。
    const evil = await post('/api/rerender', { Origin: 'https://evil.example.com' });
    expect(evil.status).toBe(403);
  });

  it('Origin が無いフォーム送信も弾く', async () => {
    expect((await post('/api/rerender')).status).toBe(403);
  });

  it('multipart も弾く (CORS の preflight が要らない形)', async () => {
    const form = new FormData();
    form.append('file', new File(['x'], 'a.png', { type: 'image/png' }));
    setStubUser({ id: 'admin' });
    const res = await getRootRequest(
      new Request(`${ROOT_SITE}/api/posts/x/media`, {
        method: 'POST',
        body: form,
        headers: { Origin: 'https://evil.example.com' },
      }),
    );
    expect(res.status).toBe(403);
  });

  it('同一オリジンからは通る', async () => {
    const res = await post('/api/rerender', { Origin: ROOT_SITE });
    expect(res.status).toBe(200);
  });

  it('読み取りは Origin が無くても通る', async () => {
    setStubUser({ id: 'admin' });
    expect((await getRoot('/api/me')).status).toBe(200);
  });
});

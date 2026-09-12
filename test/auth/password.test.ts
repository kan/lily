import { describe, expect, it } from 'vitest';
import type { AuthContext } from '../../src/core/auth/index.ts';
import { toBase64Url } from '../../src/core/ids.ts';
import { MIN_PASSWORD_LENGTH, passwordAuth } from '../../src/core/auth/password.ts';

/**
 * 標準の認証アダプタ。**保存するものが 1 つも無い**ので、見るのは
 * 「配った cookie だけが通る」ことと「設定が足りなければ何も通さない」こと。
 *
 * 待ち時間は 0 にしてある（本番の既定は 500ms。総当たりの速度を落とすためのもので、
 * 正しさには関係しない）。
 */
const PASSWORD = 'correct-horse-battery-staple';

const CONTEXT: AuthContext = {
  siteName: 'テストのブログ',
  adminUrl: '/blog/admin/',
  loginUrl: '/blog/admin/login',
  logoutUrl: '/blog/admin/logout',
  cookiePath: '/blog/',
};

const SITE = 'https://example.test';

const adapter = passwordAuth({ password: PASSWORD, failureDelayMs: 0 });

function url(path: string, origin = SITE): string {
  return `${origin}${path}`;
}

function loginRequest(password: string, origin = SITE): Request {
  return new Request(url(CONTEXT.loginUrl, origin), {
    method: 'POST',
    body: new URLSearchParams({ password }),
  });
}

function withCookie(path: string, cookie: string): Request {
  return new Request(url(path), { headers: { Cookie: cookie } });
}

/** Set-Cookie から `name=value` の 1 対だけ取り出す。 */
function cookiePair(response: Response): string {
  const header = response.headers.get('Set-Cookie') ?? '';
  return header.split(';')[0] ?? '';
}

async function loggedInCookie(target = adapter): Promise<string> {
  const response = await target.handle!(loginRequest(PASSWORD), CONTEXT);
  return cookiePair(response!);
}

describe('passwordAuth のログイン', () => {
  it('正しいパスワードなら管理画面へ送り、セッションの cookie を配る', async () => {
    const response = (await adapter.handle!(loginRequest(PASSWORD), CONTEXT))!;
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe(CONTEXT.adminUrl);

    const cookie = response.headers.get('set-cookie') ?? '';
    expect(cookie).toContain('lily_session=');
    // **JS から読めない。** 公開ページの目印 (`lily_admin`) と違い、これは鍵。
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain(`Path=${CONTEXT.cookiePath}`);
    expect(cookie).toContain('SameSite=Lax');
    expect(cookie).toContain('Secure');
  });

  it('http では Secure を付けない (付けると手元で一度もログインできない)', async () => {
    const response = (await adapter.handle!(
      loginRequest(PASSWORD, 'http://localhost:8787'),
      CONTEXT,
    ))!;
    expect(response.headers.get('set-cookie')).not.toContain('Secure');
  });

  it('間違ったパスワードは 401 で、cookie を配らない', async () => {
    const response = (await adapter.handle!(loginRequest('まちがい'), CONTEXT))!;
    expect(response.status).toBe(401);
    expect(response.headers.get('set-cookie')).toBeNull();
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.text()).toContain('パスワードが違います');
  });

  it('body が読めなくても例外にしない', async () => {
    const request = new Request(url(CONTEXT.loginUrl), { method: 'POST', body: 'これは form ではない' });
    const response = (await adapter.handle!(request, CONTEXT))!;
    expect(response.status).toBe(401);
  });

  it('ログイン画面は認証を要らない (GET でそのまま出る)', async () => {
    const response = (await adapter.handle!(new Request(url(CONTEXT.loginUrl)), CONTEXT))!;
    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).toContain('<form method="post"');
    expect(body).toContain(CONTEXT.siteName);
    // 認証の手前の画面。検索にも共有キャッシュにも載せない。
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('x-robots-tag')).toBe('noindex');
  });

  it('既に入れている人がログイン画面を開いたら管理画面へ送る', async () => {
    const response = (await adapter.handle!(
      withCookie(CONTEXT.loginUrl, await loggedInCookie()),
      CONTEXT,
    ))!;
    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe(CONTEXT.adminUrl);
  });

  /**
   * **どの 2 本を渡すかを決めるのは core**（`routes/require-auth.ts`）。ここに来る
   * のはログインかログアウトの口だけなので、アダプタは受け持たないパスを自分で
   * 弾かない。「渡らない」ことは `test/routes/password.test.ts` が見る。
   */
  it('受けないメソッドは通常の経路へ返す', async () => {
    const put = new Request(url(CONTEXT.loginUrl), { method: 'PUT' });
    expect(await adapter.handle!(put, CONTEXT)).toBeNull();
  });
});

describe('passwordAuth のセッション', () => {
  it('配った cookie は通る', async () => {
    const result = await adapter.authenticate(withCookie('/blog/api/me', await loggedInCookie()));
    expect(result.ok).toBe(true);
  });

  it('cookie が無ければ通らない', async () => {
    expect((await adapter.authenticate(new Request(url('/blog/api/me')))).ok).toBe(false);
  });

  it('署名を書き換えると通らない', async () => {
    const cookie = await loggedInCookie();
    // 末尾 1 文字だけ変える。**同じ長さのまま**なので、長さの比較では落ちない。
    const tampered = cookie.slice(0, -1) + (cookie.endsWith('A') ? 'B' : 'A');
    expect((await adapter.authenticate(withCookie('/blog/api/me', tampered))).ok).toBe(false);
  });

  it('期限を伸ばすと通らない (期限も署名の中に入っている)', async () => {
    const cookie = await loggedInCookie();
    const [name, value] = cookie.split('=') as [string, string];
    const [version, expires, signature] = value.split('.') as [string, string, string];
    const longer = `${name}=${version}.${Number(expires) + 60 * 60}.${signature}`;
    expect((await adapter.authenticate(withCookie('/blog/api/me', longer))).ok).toBe(false);
  });

  it('期限が切れていれば、署名が合っていても通らない', async () => {
    // 署名は正しく作る (期限だけが理由で落ちることを見る)。
    const expires = Math.floor(Date.now() / 1000) - 1;
    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(PASSWORD),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    );
    const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`v1.${expires}`));
    const cookie = `lily_session=v1.${expires}.${toBase64Url(new Uint8Array(mac))}`;
    expect((await adapter.authenticate(withCookie('/blog/api/me', cookie))).ok).toBe(false);
  });

  it('パスワードを変えると、配ってあった cookie がまとめて無効になる', async () => {
    const cookie = await loggedInCookie();
    const next = passwordAuth({ password: `${PASSWORD}-2`, failureDelayMs: 0 });
    expect((await next.authenticate(withCookie('/blog/api/me', cookie))).ok).toBe(false);
  });

  it('ログアウトは cookie を消して、ログイン画面へ送る', async () => {
    const request = new Request(url(CONTEXT.logoutUrl), { method: 'POST' });
    const response = (await adapter.handle!(request, CONTEXT))!;
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe(CONTEXT.loginUrl);
    const cookie = response.headers.get('set-cookie') ?? '';
    expect(cookie).toContain('lily_session=;');
    expect(cookie).toContain('Max-Age=0');
    // 消すときも属性を揃える。Path が違うと消えない。
    expect(cookie).toContain(`Path=${CONTEXT.cookiePath}`);
  });

  it('GET のログアウトは受けない (画像や prefetch で落とされる)', async () => {
    expect(await adapter.handle!(new Request(url(CONTEXT.logoutUrl)), CONTEXT)).toBeNull();
  });
});

/*
 * 拒否のしかた（画面遷移をログインへ送るか）は **core の持ち物**なので、
 * `test/routes/password.test.ts` が見る。アダプタは「ログインの口を持っている」
 * ことを `handle` の有無で示すだけ。
 */

describe('passwordAuth の設定が足りないとき', () => {
  const TOO_SHORT = 'a'.repeat(MIN_PASSWORD_LENGTH - 1);
  const short = passwordAuth({ password: TOO_SHORT, failureDelayMs: 0 });
  const empty = passwordAuth({ password: '', failureDelayMs: 0 });

  async function screen(adapter = short): Promise<string> {
    const response = (await adapter.handle!(new Request(url(CONTEXT.loginUrl)), CONTEXT))!;
    return await response.text();
  }

  it('短いパスワードでは何も通さない', async () => {
    const response = await short.handle!(loginRequest(TOO_SHORT), CONTEXT);
    expect(response!.status).toBe(503);
    expect(response!.headers.get('set-cookie')).toBeNull();
  });

  it('未設定なら入力欄を出さず、何をすればよいか出す', async () => {
    const body = await screen(empty);
    expect(body).not.toContain('<form');
    expect(body).toContain('設定されていません');
  });

  /**
   * **「未設定」と混ぜてはいけない。** 混ぜると、短い secret を入れた運用者の画面に
   * 「設定してください」と出続け、同じものを入れ直すループに入る（設定したものが
   * 拒否されていることが画面から読み取れない）。
   */
  it('短すぎるときは、未設定とは違う文を出す', async () => {
    const body = await screen();
    expect(body).not.toContain('<form');
    expect(body).toContain('短すぎる');
    expect(body).toContain(String(MIN_PASSWORD_LENGTH));
    expect(body).not.toContain('設定されていません');
  });

  /** core は deployment が何という名前で secret を持っているか知らない。 */
  it('secret の名前は、渡されたときだけ出す', async () => {
    expect(await screen(empty)).not.toContain('ADMIN_PASSWORD');
    const named = passwordAuth({ password: '', secretName: 'BLOG_PASSWORD', failureDelayMs: 0 });
    expect(await screen(named)).toContain('BLOG_PASSWORD');
  });

  it('未設定のまま cookie を偽装しても通らない', async () => {
    // 空のパスワードで署名した cookie を作れても、設定が無ければ入口で落ちる。
    const cookie = 'lily_session=v1.9999999999.anything';
    expect((await empty.authenticate(withCookie('/blog/api/me', cookie))).ok).toBe(false);
  });
});

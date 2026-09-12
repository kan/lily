import { describe, expect, it } from 'vitest';
import { passwordAuth } from '../../src/core/auth/password.ts';
import { fetchOn, getRoot, getRootWith, mountedAppWith, MOUNT, SITE } from './helpers.ts';

/**
 * 標準の認証アダプタを**アプリに載せた状態**で見る。アダプタ単体の振る舞いは
 * `test/auth/password.test.ts` にあり、ここで見るのは配線だけ。
 *
 * - ログインの口が認証の**手前**にあること（無いと、ログインするのにログインが要る）
 * - 受け持たないアダプタ（Access / スタブ）では、同じパスが保護されたままなこと
 */
const PASSWORD = 'correct-horse-battery-staple';

const app = mountedAppWith(() => passwordAuth({ password: PASSWORD, failureDelayMs: 0 }));

const LOGIN = `${MOUNT}/admin/login`;
const LOGOUT = `${MOUNT}/admin/logout`;

function fetchApp(path: string, init?: RequestInit): Promise<Response> {
  return fetchOn(app, new Request(`${SITE}${path}`, init));
}

/** ブラウザの画面遷移。**Accept で見分ける**ので、そこだけ本物に合わせる。 */
function navigate(path: string, cookie?: string): Promise<Response> {
  return fetchApp(path, {
    headers: { Accept: 'text/html,application/xhtml+xml', ...(cookie ? { Cookie: cookie } : {}) },
  });
}

/** 素の form の POST。ブラウザは同一オリジンでも Origin を付ける。 */
function submit(path: string, body?: Record<string, string>, cookie?: string): Promise<Response> {
  return fetchApp(path, {
    method: 'POST',
    headers: { Origin: SITE, ...(cookie ? { Cookie: cookie } : {}) },
    ...(body ? { body: new URLSearchParams(body) } : {}),
  });
}

async function login(): Promise<string> {
  const response = await submit(LOGIN, { password: PASSWORD });
  expect(response.status).toBe(303);
  return (response.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
}

describe('パスワードのアダプタを載せたアプリ', () => {
  it('ログイン画面は認証の手前にある', async () => {
    const response = await navigate(LOGIN);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/html');
    expect(await response.text()).toContain('<form method="post"');
  });

  it('未認証の画面遷移はログインへ送る', async () => {
    const response = await navigate(`${MOUNT}/admin/`);
    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe(LOGIN);
  });

  it('未認証の API は JSON の 403 のまま', async () => {
    const response = await fetchApp(`${MOUNT}/api/me`);
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: 'forbidden' });
  });

  /**
   * **境界で決める。** アダプタに `Accept` から推測させると、管理画面から
   * `/api/*` へリンクを 1 本足した日に、`src/admin/session.ts` の読み込み直しでは
   * なくログイン画面への遷移になる（そして JSON を待っていた側は 200 の HTML を
   * 読む）。
   */
  it('API は HTML を要求されてもリダイレクトしない', async () => {
    const response = await navigate(`${MOUNT}/api/me`);
    expect(response.status).toBe(403);
    expect(response.headers.get('location')).toBeNull();
  });

  /**
   * **アダプタへ渡すのはログインとログアウトの 2 本だけ。** 全部渡すと、
   * 管理画面のアセット 1 本ごとにアダプタの判定が走る（そして受け持たない
   * パスを自分で弾く仕事が、全アダプタの実装者に増える）。
   */
  it('ログインの口以外はアダプタへ渡らず、SPA が出る', async () => {
    const cookie = await login();
    const response = await navigate(`${MOUNT}/admin/posts`, cookie);
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('<div id="app">');
  });

  it('ログインすると管理画面が開き、ログアウトの口が管理画面へ届く', async () => {
    const cookie = await login();
    const response = await navigate(`${MOUNT}/admin/`, cookie);
    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).toContain('<div id="app">');
    expect(body).toContain(`content="${LOGOUT}"`);
  });

  it('ログアウトすると、セッションも公開ページの目印も消える', async () => {
    const cookie = await login();
    const response = await submit(LOGOUT, undefined, cookie);
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe(LOGIN);

    const cookies = response.headers.getSetCookie();
    expect(cookies.some((c) => c.startsWith('lily_session=;') && c.includes('Max-Age=0'))).toBe(true);
    expect(cookies.some((c) => c.startsWith('lily_admin=;') && c.includes('Max-Age=0'))).toBe(true);

    // 消えた cookie では管理画面に戻れない。
    expect((await navigate(`${MOUNT}/admin/`)).status).toBe(302);
  });

  it('他所のサイトからのログインは CSRF で弾く', async () => {
    const response = await fetchApp(LOGIN, {
      method: 'POST',
      headers: { Origin: 'https://evil.example.com' },
      body: new URLSearchParams({ password: PASSWORD }),
    });
    expect(response.status).toBe(403);
    expect(response.headers.get('set-cookie')).toBeNull();
  });

  /**
   * **`config.auth` は利用側が書く関数**で、安いとも副作用が無いとも決まっていない
   * （fushihara.net の `selectAuth` は「選んだ方を 1 度だけログへ出す」フラグを
   * 持っている）。1 要求で何度も呼ぶと、その種の回避策への依存が強くなる。
   */
  it('アダプタは 1 要求につき 1 度しか組まない', async () => {
    let built = 0;
    const counting = mountedAppWith(() => {
      built += 1;
      return passwordAuth({ password: PASSWORD, failureDelayMs: 0 });
    });
    // cookie は署名だけで決まるので、同じパスワードの別アプリでもそのまま通る。
    const cookie = await login();
    const response = await fetchOn(
      counting,
      new Request(`${SITE}${MOUNT}/admin/`, { headers: { Accept: 'text/html', Cookie: cookie } }),
    );
    expect(response.status).toBe(200);
    // 保護境界（ログインの口 + 認証）と、ログアウトのボタンを出すかの判定。
    expect(built).toBe(1);
  });

  it('ログインの口を持たないアダプタでは、同じパスが保護されたまま', async () => {
    // スタブのアダプタ（= Access と同じく `handle` を持たない）のアプリ。
    // ここが 200 になると、Access の deployment に穴が開いたことになる。
    const response = await getRoot('/admin/login');
    expect(response.status).toBe(403);
  });

  /**
   * **送る先が無いなら送らない。** Access の deployment でリダイレクトすると、
   * 管理画面を開けない人が lily の作る 404 を延々と見ることになる。
   */
  it('ログインの口を持たないアダプタでは、画面遷移も 403 のまま', async () => {
    const response = await getRootWith('/admin/', 'text/html');
    expect(response.status).toBe(403);
    expect(response.headers.get('location')).toBeNull();
  });
});

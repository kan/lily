/**
 * パスワード 1 つで守る、標準の認証アダプタ。**OSS の標準構成の既定。**
 *
 * **保存するものが 1 つも無い。** パスワードは Worker の secret にあり、ログインが
 * 通ると HMAC で署名した cookie を配る。D1 のテーブルも migration も要らず、
 * secret を差し替えれば配ったセッションはまとめて無効になる（鍵がパスワード
 * そのものなので、署名を作り直せなくなる）。
 *
 * この形にした理由（issue #6）:
 *
 * - **Workers Free の CPU は 1 リクエスト 10ms。** D1 に password hash を持つと、
 *   OWASP 推奨の PBKDF2 600,000 回はそこに収まらない。標準構成が Free で動かない
 *   か、ハッシュを弱めるかの二択になる。secret と突き合わせるだけなら KDF は
 *   要らない ——**伸長して守るべき hash が DB に無い**（漏れる先が無い）
 * - Deploy to Cloudflare のボタンは 2025-07 から secret を入力させられるので、
 *   デプロイの画面でそのまま設定できる。初回セットアップ画面が要らず、
 *   「users が空のあいだは誰でも管理者になれる」窓も開かない
 *
 * **弱いところ**は 2 つあり、どちらも承知のうえで選んでいる。
 *
 * - パスワードは 1 つで、変えるには secret を差し替える（wrangler か dashboard）。
 *   複数人・画面からのパスワード変更が要る deployment は自分で `AuthAdapter` を
 *   書く。**2 つ目の要求が実際に出てきたら**、そのとき D1 のアダプタを足す
 * - 総当たりに対しては**失敗時の待ちしか無い**。だから短いパスワードを受け付けず
 *   （`MIN_PASSWORD_LENGTH`）、待ちを入れて 1 接続あたりの試行速度を落とす。
 *   待つのは CPU ではないので、Free の 10ms には影響しない
 */
import { sha256, toBase64Url } from '../ids.ts';
import {
  readCookie,
  serializeCookie,
  type AuthAdapter,
  type AuthContext,
  type AuthResult,
} from './index.ts';
import { renderLoginPage } from './login-page.ts';

/** 文字列をバイト列にする道具。状態を持たないので使い回す。 */
const ENCODER = new TextEncoder();

/** セッションの cookie。**HttpOnly**（公開ページの目印 `lily_admin` とは別物）。 */
const COOKIE = 'lily_session';

/** 署名の形式。**中身の意味を変えたら上げる**（古い cookie が黙って通らなくなる）。 */
const VERSION = 'v1';

/**
 * 受け付ける最短のパスワード。
 *
 * 総当たりを止めるものが待ちしか無いので、ここが実質の壁になる。**短ければ
 * 拒否ではなく「未設定」として扱う**（運用者が画面で気付ける）。
 */
export const MIN_PASSWORD_LENGTH = 12;

/** セッションの寿命。**延長しない**（切れたら入れ直す）。 */
const DEFAULT_MAX_AGE = 60 * 60 * 24 * 30;

/** 失敗したときに待つ時間。CPU は使わないので Free でも通る。 */
const DEFAULT_FAILURE_DELAY = 500;

export type PasswordAuthOptions = {
  /** 管理画面のパスワード。**Worker の secret から渡す**（コードに書かない）。 */
  readonly password: string;
  /**
   * そのパスワードを渡している secret の名前（`'ADMIN_PASSWORD'` など）。
   *
   * **設定が足りないときの案内にしか使わない。** 渡さなければ名前を出さない
   * ——**core は deployment が何という名前で secret を持っているか知らない**ので、
   * 決め打つと別名で渡している人に嘘の案内をすることになる。
   */
  readonly secretName?: string;
  /** セッションの寿命（秒）。既定は 30 日。 */
  readonly maxAge?: number;
  /** ログインに失敗したときに待つミリ秒。既定は 500。テストは 0 にする。 */
  readonly failureDelayMs?: number;
};

export function passwordAuth(options: PasswordAuthOptions): AuthAdapter {
  const password = options.password;
  const maxAge = options.maxAge ?? DEFAULT_MAX_AGE;
  const failureDelayMs = options.failureDelayMs ?? DEFAULT_FAILURE_DELAY;
  /**
   * **設定が足りなければ、何があっても通さない。** 短いパスワードで
   * 「守られているつもり」になるのが一番危ない（`cloudflareAccess` と同じ扱い）。
   *
   * ただし**「未設定」と「短すぎる」は最後まで分けて運ぶ。** 畳むと、短い secret を
   * 入れた運用者の画面に「設定してください」と出て、同じものを入れ直す無限ループに入る。
   */
  const unusable: 'unset' | 'tooShort' | null =
    password.length === 0 ? 'unset' : password.length < MIN_PASSWORD_LENGTH ? 'tooShort' : null;

  const authenticate = async (request: Request): Promise<AuthResult> => {
    if (unusable) {
      return {
        ok: false,
        reason:
          unusable === 'unset'
            ? 'パスワードが未設定'
            : `パスワードが ${MIN_PASSWORD_LENGTH} 文字未満`,
      };
    }
    const cookie = readCookie(request, COOKIE);
    if (!cookie) return { ok: false, reason: `${COOKIE} が無い` };
    return await verifySession(password, cookie);
  };

  /**
   * ログイン画面。設定が足りていれば入力欄、足りなければ**何が足りないか**を出す。
   *
   * 足りないことはログにも出す。画面を見ているのが運用者とは限らず、`reason` は
   * `requireAuth` を通った要求でしか出ないため（ログイン画面は認証の手前にある）。
   */
  const loginScreen = (context: AuthContext, status: number, message?: string): Response => {
    if (unusable) {
      console.warn(
        `auth: password のパスワードが使えない (${
          unusable === 'unset' ? '未設定' : `${MIN_PASSWORD_LENGTH} 文字未満`
        })`,
      );
    }
    const body = renderLoginPage({
      siteName: context.siteName,
      action: context.loginUrl,
      minLength: MIN_PASSWORD_LENGTH,
      message,
      unusable: unusable ?? undefined,
      secretName: options.secretName,
    });
    return new Response(body, {
      status,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        // 認証の手前の画面。**共有キャッシュにも履歴にも残さない。**
        'Cache-Control': 'no-store',
        'X-Robots-Tag': 'noindex',
      },
    });
  };

  return {
    name: 'password',
    authenticate,

    /**
     * **来るのは core が持つ 2 本のパスだけ**（`routes/require-auth.ts` が絞る）。
     * ここで見分けるのはどちらかと、メソッドだけ。
     */
    async handle(request: Request, context: AuthContext): Promise<Response | null> {
      const url = new URL(request.url);

      if (url.pathname === context.logoutUrl) {
        // **GET では受けない。** 画像や prefetch でログアウトさせられる。
        if (request.method !== 'POST') return null;
        return redirect(context.loginUrl, 303, clearCookie(context, url));
      }

      if (request.method === 'GET' || request.method === 'HEAD') {
        // 既に入れている人にログイン画面を出さない（押す物が無い画面になる）。
        if ((await authenticate(request)).ok) return redirect(context.adminUrl, 302);
        return loginScreen(context, 200);
      }

      if (request.method !== 'POST') return null;

      if (unusable) return loginScreen(context, 503);

      const given = await formPassword(request);
      if (given !== null && (await sameSecret(given, password))) {
        return redirect(context.adminUrl, 303, await sessionCookie(context, url, password, maxAge));
      }

      await delay(failureDelayMs);
      return loginScreen(context, 401, 'パスワードが違います。');
    },
  };
}

function redirect(location: string, status: 302 | 303, cookie?: string): Response {
  const headers = new Headers({ Location: location, 'Cache-Control': 'no-store' });
  if (cookie) headers.append('Set-Cookie', cookie);
  return new Response(null, { status, headers });
}

/**
 * 送られてきたパスワード。**`multipart/form-data` も受ける**（`formData()` が
 * 両方読む）。読めない body は「入力なし」として扱い、例外にしない。
 */
async function formPassword(request: Request): Promise<string | null> {
  try {
    const value = (await request.formData()).get('password');
    return typeof value === 'string' && value !== '' ? value : null;
  } catch {
    return null;
  }
}

/**
 * セッションの cookie。**`HttpOnly`**（これは鍵で、公開ページの目印とは違う）。
 * 消すときも同じ関数を通す —— 属性が揃っていないと消えない。
 */
async function sessionCookie(
  context: AuthContext,
  url: URL,
  password: string,
  maxAge: number,
): Promise<string> {
  return cookie(context, url, await newSession(password, maxAge), maxAge);
}

function clearCookie(context: AuthContext, url: URL): string {
  return cookie(context, url, '', 0);
}

function cookie(context: AuthContext, url: URL, value: string, maxAge: number): string {
  return serializeCookie(COOKIE, value, {
    path: context.cookiePath,
    maxAge,
    httpOnly: true,
    requestUrl: url.href,
  });
}

/** `v1.<失効する秒>.<署名>`。**中身は期限だけ**で、秘密は 1 つも入っていない。 */
async function newSession(password: string, maxAge: number): Promise<string> {
  const expires = Math.floor(Date.now() / 1000) + maxAge;
  const body = `${VERSION}.${expires}`;
  return `${body}.${await sign(password, body)}`;
}

async function verifySession(password: string, value: string): Promise<AuthResult> {
  const parts = value.split('.');
  if (parts.length !== 3 || parts[0] !== VERSION) return { ok: false, reason: '形式が違う' };
  const [, expires, signature] = parts as [string, string, string];
  const at = Number(expires);
  if (!Number.isSafeInteger(at) || at <= 0) return { ok: false, reason: '期限が読めない' };
  // **署名を確かめる前に期限で切る。** 期限は署名の中に入っているので、
  // 切れた cookie の署名が合っていても通してはいけない。
  if (at * 1000 <= Date.now()) return { ok: false, reason: 'セッションが切れている' };
  const expected = await sign(password, `${VERSION}.${expires}`);
  if (!equalStrings(signature, expected)) return { ok: false, reason: '署名が合わない' };
  // **利用者は 1 人しかいない。** cookie に載っているのは期限だけで、誰かを
  // 区別する情報は最初から無い（`/api/me` に出るのもこの固定値）。
  return { ok: true, user: { id: 'admin', name: '管理者' } };
}

/**
 * 鍵はパスワードそのもの。**secret を差し替えれば全セッションが無効になる**
 * のがこの形の眼目で、別に SESSION_SECRET を置くとその性質が消える
 * （パスワードを変えても、盗まれた cookie が生き続ける）。
 *
 * `importKey` は isolate をまたいで残らないので、直前の 1 本だけ覚えておく。
 */
let cachedKey: { password: string; key: Promise<CryptoKey> } | null = null;

function hmacKey(password: string): Promise<CryptoKey> {
  if (cachedKey?.password !== password) {
    cachedKey = {
      password,
      key: crypto.subtle.importKey(
        'raw',
        ENCODER.encode(password),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign'],
      ),
    };
  }
  return cachedKey.key;
}

async function sign(password: string, body: string): Promise<string> {
  const key = await hmacKey(password);
  const mac = await crypto.subtle.sign('HMAC', key, ENCODER.encode(body));
  return toBase64Url(new Uint8Array(mac));
}

/**
 * パスワードの突き合わせ。**両方を SHA-256 に落としてから比べる。**
 *
 * 生の文字列を比べると、長さと「何文字目まで合っていたか」が時間に出る。
 * digest なら長さは常に 32 バイトで、一致しない限り中身は無関係な値になる。
 */
async function sameSecret(given: string, expected: string): Promise<boolean> {
  const [a, b] = await Promise.all([sha256(given), sha256(expected)]);
  return equalStrings(toBase64Url(a), toBase64Url(b));
}

/**
 * 秘密が絡む文字列の突き合わせ。長さが違えば即座に false でよい（比べるのは
 * 署名か digest で、長さは固定・秘密を含まない）。同じ長さのあいだは最後まで見る。
 */
function equalStrings(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function delay(ms: number): Promise<void> {
  return ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve();
}

/**
 * 認証の差し替え点。**core は認証の方式を 1 つも知らない。**
 *
 * fushihara.net は Cloudflare Access アダプタ (`auth/access.ts`) を使うが、
 * Deploy to Cloudflare は Access を自動プロビジョニングできないので、OSS の
 * 標準構成では別のアダプタが既定になる。だから core に Access を焼き付けない。
 */

export type AuthUser = {
  /** 一意な識別子。Access なら JWT の `sub`。 */
  readonly id: string;
  readonly email?: string;
  readonly name?: string;
};

export type AuthResult =
  | { readonly ok: true; readonly user: AuthUser }
  /**
   * 失敗の理由。**そのままレスポンスに載せない。** 攻撃者に「どこまで合っていたか」
   * を教えることになるので、ログや開発用に留める。
   */
  | { readonly ok: false; readonly reason: string };

/**
 * アダプタが自分の口を出すのに要る、**core しか知らない値**。
 *
 * URL を組むのは `core/paths.ts` の仕事なので、アダプタに mount を渡して
 * 組ませない（渡すと URL の組み立てが 2 箇所になる）。組むのは `createLily()` で
 * **1 度だけ**、保護境界（`routes/api.ts`）と管理画面の配信（`routes/admin.ts`）が
 * 同じ物を受け取る。
 */
export type AuthContext = {
  /** 画面に出すサイト名。 */
  readonly siteName: string;
  /** 管理画面の入口。**ログインが通ったら戻る先。** */
  readonly adminUrl: string;
  /** ログイン画面の URL。**このパスに来た要求だけ**が `handle()` に渡る。 */
  readonly loginUrl: string;
  /** ログアウトの口。同じく `handle()` に渡る 2 本のうちの 1 本。 */
  readonly logoutUrl: string;
  /** cookie に付ける `Path`。mount root（root mount なら `/`）。 */
  readonly cookiePath: string;
};

export interface AuthAdapter {
  /** アダプタの名前。ログと診断用。 */
  readonly name: string;
  authenticate(request: Request): Promise<AuthResult>;
  /**
   * 画面からログインできる方式だけが実装する。core は `context.loginUrl` と
   * `context.logoutUrl` に来た要求を**認証の手前で**ここへ渡す（内側に置くと、
   * ログイン画面に入るのにログインが要る）。受け持たないときは `null` を返すと
   * 通常の経路へ進む。
   *
   * **これがあること自体が「この方式は画面からログイン・ログアウトできる」という
   * 宣言。** そこから core が 3 つを決める:
   *
   * - 未認証のブラウザの画面遷移を、403 ではなくログイン画面へ送るか
   * - 管理画面にログアウトのボタンを出すか
   * - `<mount>/admin/login` と `/logout` をアダプタへ渡すか
   *
   * **3 つを別々のメンバーにしない。** 「口はあるがボタンは出さない」のような
   * 食い違いが型の上で作れてしまい、どれも画面には出ないので気付けない。
   */
  handle?(request: Request, context: AuthContext): Promise<Response | null>;
}

/** リクエストから Cookie を 1 つ取り出す。アダプタから使う小物。 */
export function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get('Cookie');
  if (!header) return null;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    if (part.slice(0, index).trim() === name) return part.slice(index + 1).trim();
  }
  return null;
}

export type CookieOptions = {
  /** 送る範囲。mount root（`AuthContext.cookiePath`）。 */
  readonly path: string;
  /** 寿命（秒）。**0 なら消す。** */
  readonly maxAge: number;
  /** JS から読ませないか。鍵なら true、公開ページが読む目印なら false。 */
  readonly httpOnly?: boolean;
  /** リクエストの URL。**https のときだけ `Secure` を付ける**ために見る。 */
  readonly requestUrl: string;
};

/**
 * `Set-Cookie` の値を組む。`readCookie()` と対で、**cookie の形を決める場所を
 * 1 つにする**ためのもの。
 *
 * `SameSite=Lax` は固定。他所のサイトからの遷移で送られないようにするためで、
 * lily が配る cookie（セッションと管理画面の目印）はどちらもそれでよい。
 * `Secure` を http で付けないのは、ローカルと E2E が http だから（本番は必ず https）。
 *
 * **付けるときと消すときで属性を揃えること。** `Path` が違うと消えないので、
 * 消す側も同じ関数を通す。
 */
export function serializeCookie(name: string, value: string, options: CookieOptions): string {
  const secure = new URL(options.requestUrl).protocol === 'https:' ? '; Secure' : '';
  const httpOnly = options.httpOnly ? '; HttpOnly' : '';
  return `${name}=${value}; Path=${options.path}; Max-Age=${options.maxAge}${httpOnly}; SameSite=Lax${secure}`;
}

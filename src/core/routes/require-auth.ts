/**
 * 認証のミドルウェア。**保護境界は 2 つあり、拒否のしかたが違う。**
 *
 * `/api/*` は JSON の 403 を返し続ける（リダイレクトすると、管理画面がログイン
 * 画面の HTML を JSON として読むことになる）。`/admin/*` はブラウザの画面遷移を
 * ログインへ送る —— **ただしログインの口を持つアダプタのときだけ**。
 */
import type { Context, Env, MiddlewareHandler } from 'hono';
import { clearAdminHint } from '../admin-hint.ts';
import type { AuthAdapter, AuthContext, AuthUser } from '../auth/index.ts';
import type { LilyBindings } from '../config.ts';

/**
 * このミドルウェアが要求する最低限の形。`api.ts` の `AppEnv` がこれを満たす。
 *
 * `canLogout` は管理画面の配信（`routes/admin.ts`）へ渡す 1 bit。**アダプタ
 * そのものを渡さない** —— 配信側が欲しいのは「ログアウトのボタンを出すか」だけで、
 * そのために HTML を配る役が認証の設定型を知る理由が無い。
 */
type AuthedEnv<Bindings extends LilyBindings> = Env & {
  Bindings: Bindings;
  Variables: { user: AuthUser; canLogout?: boolean };
};

/**
 * `<mount>/api/*` の保護。
 *
 * `adapterFor` は `env` からアダプタを作る。deployment 固有の設定（Access の
 * チーム名や AUD、パスワードの secret）を持ち回すのに、これ以外の経路を作らない。
 */
export function requireAuth<Bindings extends LilyBindings>(
  adapterFor: (env: Bindings) => AuthAdapter,
  onFailure: () => Response,
): MiddlewareHandler<AuthedEnv<Bindings>> {
  return async (c, next) => {
    const denied = await authenticate(adapterFor(c.env), c, onFailure);
    if (denied) return denied;
    await next();
  };
}

export type AdminGuard<Bindings extends LilyBindings> = {
  readonly adapterFor: (env: Bindings) => AuthAdapter;
  readonly context: AuthContext;
  readonly onFailure: () => Response;
  /** cookie の `Path` に使う mount root。目印を消すのに要る。 */
  readonly mount: string;
};

/**
 * `<mount>/admin/*` の保護。**ログインの口 → 認証 → 拒否のしかた**を 1 本で持つ。
 *
 * 分けないのは、3 つとも同じアダプタ 1 つから決まるから（`config.auth` は利用側が
 * 書く関数で、1 要求に何度も呼んでよいとは決まっていない）。順序が 1 つの関数の中に
 * 並ぶので、「口が認証の手前にある」ことも読んで分かる。
 */
export function protectAdmin<Bindings extends LilyBindings>(
  guard: AdminGuard<Bindings>,
): MiddlewareHandler<AuthedEnv<Bindings>> {
  const { context } = guard;
  return async (c, next) => {
    const adapter = guard.adapterFor(c.env);
    const path = c.req.path;

    // **口に来た要求だけをアダプタへ渡す。** どの 2 本かを知っているのは core
    // (`fixed.ts` の `AUTH_ROUTE`) なので、全アダプタに同じ判定を書かせない。
    // 管理画面のアセット 1 本ごとに `handle()` を呼ばずに済むという意味もある。
    if (path === context.loginUrl || path === context.logoutUrl) {
      const response = await adapter.handle?.(c.req.raw, context);
      if (response) {
        // ログアウトを通ったら、公開ページの目印も一緒に消す。目印は権限を
        // 持たないが、共有の端末に「Admin」のリンクが残り続ける理由が無い。
        if (path === context.logoutUrl) {
          response.headers.append('Set-Cookie', clearAdminHint(c.req.url, guard.mount));
        }
        return response;
      }
    }

    const denied = await authenticate(adapter, c, () => challenge(adapter, c, guard));
    if (denied) return denied;
    // ログアウトのボタンを出すかは、ここで出た答えを 1 bit だけ配信側へ渡す。
    c.set('canLogout', adapter.handle !== undefined);
    await next();
  };
}

/**
 * 認証して `user` を載せる。**通れば null**、拒否ならその応答。
 *
 * **失敗の理由はレスポンスに載せない。** 「どこまで合っていたか」を教えることに
 * なるため、ログにだけ出す。
 */
async function authenticate<Bindings extends LilyBindings>(
  adapter: AuthAdapter,
  c: Context<AuthedEnv<Bindings>>,
  onFailure: () => Response,
): Promise<Response | null> {
  const result = await adapter.authenticate(c.req.raw);
  if (!result.ok) {
    console.warn(`auth: ${adapter.name} が拒否した (${c.req.path}): ${result.reason}`);
    return onFailure();
  }
  c.set('user', result.user);
  return null;
}

/**
 * 管理画面の側の拒否。**ブラウザの画面遷移だけをログインへ送る。**
 *
 * **判断は core が持つ。** 材料（メソッド・`Accept`・ログイン画面の URL）はどれも
 * core の持ち物で、アダプタ固有のものが 1 つも無い。アダプタに書かせると、2 つ目の
 * アダプタを書いた人が写し損ねたときに `session.ts` の読み込み直しが黙って壊れる。
 */
function challenge<Bindings extends LilyBindings>(
  adapter: AuthAdapter,
  c: Context<AuthedEnv<Bindings>>,
  guard: AdminGuard<Bindings>,
): Response {
  const request = c.req.raw;
  const navigation =
    (request.method === 'GET' || request.method === 'HEAD') &&
    (request.headers.get('Accept') ?? '').includes('text/html');
  // 送る先が無いアダプタ（Access / localhostOnly）では 403 のまま。
  if (!adapter.handle || !navigation) return guard.onFailure();
  return new Response(null, {
    status: 302,
    headers: { Location: guard.context.loginUrl, 'Cache-Control': 'no-store' },
  });
}

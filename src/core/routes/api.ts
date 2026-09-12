/**
 * 管理 API と管理画面の**保護境界**。
 *
 * `<mount>/api/*` と `<mount>/admin/*` はここを通らないと届かない。API の中身は
 * `core/api/` にあり、**mount を知らない形**でマウントされる (Hono RPC の型が
 * リテラルのまま残るので、管理画面は `hc<LilyApi>('<mount>/api')` だけで済む)。
 */
import { Hono } from 'hono';
import { csrf } from 'hono/csrf';
import { createApi, type ApiEnv } from '../api/index.ts';
import type { AuthContext } from '../auth/index.ts';
import type { LilyBindings, LilyConfig } from '../config.ts';
import { createPaths } from '../paths.ts';
import { ROUTE } from './fixed.ts';
import { protectAdmin, requireAuth } from './require-auth.ts';

export type AppEnv<Bindings extends LilyBindings> = {
  Bindings: Bindings;
  /**
   * `canLogout` は管理画面の側の境界が置く 1 bit。**管理画面の配信
   * （`routes/admin.ts`）がボタンを出すかの判定に読む。**
   */
  Variables: ApiEnv['Variables'] & { canLogout?: boolean };
};

export function apiRoutes<Bindings extends LilyBindings>(
  config: LilyConfig<Bindings>,
  authContext: AuthContext,
): Hono<AppEnv<Bindings>> {
  const app = new Hono<AppEnv<Bindings>>();
  const mount = createPaths(config).urls.mountPath;

  /**
   * **認証だけでは足りない。**
   *
   * Cloudflare Access の `CF_Authorization` は Cookie なので、他所のサイトから
   * 送られたリクエストにも付いて回る。JSON を受け取る口は Content-Type が
   * `application/json` でないと通らない (= preflight が要る) ので偶然守られて
   * いるが、body を読まない口 (`unpublish` / `preview` / `rerender`) と
   * multipart の口 (`media`) は素のフォームから叩ける。ログイン中の管理者が
   * 細工したページを開くだけで、記事の取り下げやプレビュー URL の発行が起きる。
   *
   * `csrf()` は Origin を見て別サイトからの書き込みを弾く。
   */
  const protect = [csrf(), requireAuth(config.auth, jsonForbidden)] as const;

  // **中身より先に掛ける。** 未実装のパスも 403 で返るので、route を足したときに
  // 保護を忘れる余地が無い。
  app.use(`${mount}/${ROUTE.api}/*`, ...protect);

  /**
   * 告知の資格情報を context に載せる。**ここで env から取り出す。**
   *
   * `createApi()` が受け取る `PageConfig` はバインディングでジェネリックに
   * していない（`api/index.ts` の `ApiEnv`）ので、`BLUESKY_*` のような
   * deployment 固有の env を読む関数はハンドラから直接呼べない。認証と同じく、
   * env を知っているこの層で解決して渡す。
   */
  app.use(`${mount}/${ROUTE.api}/*`, async (c, next) => {
    c.set('bluesky', config.bluesky?.(c.env) ?? null);
    await next();
  });
  /**
   * 管理画面の側。**ログインの口が認証の手前に入る。**
   *
   * `csrf()` はその前に置く（ログインの POST も素のフォームなので、他所の
   * サイトから投げられる形は同じ）。ログインの口を持たないアダプタでは
   * `<mount>/admin/login` も保護されたままなので、Access の deployment では
   * 今までと 1 バイトも変わらない。
   */
  app.use(
    `${mount}/${ROUTE.admin}/*`,
    csrf(),
    protectAdmin({ adapterFor: config.auth, context: authContext, onFailure: textForbidden, mount }),
  );

  app.route(`${mount}/${ROUTE.api}`, createApi(config));

  return app;
}

const jsonForbidden = (): Response =>
  Response.json({ error: 'forbidden' }, { status: 403, headers: { 'Cache-Control': 'no-store' } });

const textForbidden = (): Response =>
  new Response('Forbidden', {
    status: 403,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
  });

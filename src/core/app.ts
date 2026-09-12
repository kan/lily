/**
 * lily の入口。設定を渡すと Hono アプリが返る。
 *
 * **公開側のルータは最後に登録する。** `<mount>/*` の catch-all を持っているので、
 * 先に置くと `rss.xml` や `media/…` を飲み込んでしまう。
 */
import { Hono } from 'hono';
import type { AuthContext } from './auth/index.ts';
import type { LilyBindings, LilyConfig, PageConfig } from './config.ts';
import { createPaths } from './paths.ts';
import { adminRoutes } from './routes/admin.ts';
import { apiRoutes, type AppEnv } from './routes/api.ts';
import { feedRoutes } from './routes/feeds.ts';
import { AUTH_ROUTE } from './routes/fixed.ts';
import { mediaRoutes } from './routes/media.ts';
import { createNotFound } from './routes/not-found.ts';
import { publicRoutes } from './routes/public.ts';

export function createLily<Bindings extends LilyBindings>(
  config: LilyConfig<Bindings>,
): Hono<AppEnv<Bindings>> {
  const app = new Hono<AppEnv<Bindings>>();
  const authContext = createAuthContext(config);
  // **保護境界を最初に置く。** api / admin へのミドルウェアが、後から来る
  // どのルータよりも先に走る。
  app.route('/', apiRoutes(config, authContext));
  // 管理画面の配信は保護のうしろ。api より後に置くのは、api の use が
  // <mount>/admin/* にも掛かっているのを先に走らせるため。
  app.route('/', adminRoutes(config, authContext));
  app.route('/', feedRoutes(config));
  app.route('/', mediaRoutes(config));
  app.route('/', publicRoutes(config));
  // サブアプリの notFound は親に引き継がれないので、ここでも設定する。
  app.notFound(createNotFound(config));
  return app;
}

/**
 * 認証アダプタに渡す値。**ここで 1 度だけ組む。**
 *
 * ログインとログアウトの口を出すのは保護境界（`routes/api.ts`）、その URL を
 * 管理画面へ差し込むのは配信側（`routes/admin.ts`）なので、2 箇所が同じ物を
 * 見る必要がある。別々に組むと、パスを変えた日にボタンだけが古い URL を指す。
 */
function createAuthContext(config: PageConfig): AuthContext {
  const urls = createPaths(config).urls;
  return {
    siteName: config.site.name,
    adminUrl: urls.admin(),
    loginUrl: urls.admin(AUTH_ROUTE.login),
    logoutUrl: urls.admin(AUTH_ROUTE.logout),
    cookiePath: `${urls.mountPath}/`,
  };
}

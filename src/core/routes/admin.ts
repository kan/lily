/**
 * 管理画面の配信。中身は `src/admin/` の Vue で、ビルド成果物を静的アセットと
 * して置いてある。
 *
 * **保護は `routes/api.ts` が先に掛けている。** ここに届く時点で認証済み。
 */
import { Hono } from 'hono';
import { LOGOUT_META, SITE_META, type AdminSiteMeta } from '../admin-contract.ts';
import { setAdminHint } from '../admin-hint.ts';
import type { AuthContext } from '../auth/index.ts';
import type { LilyBindings, PageConfig } from '../config.ts';
import { createPaths, siteOrigin } from '../paths.ts';
import { ROUTE } from './fixed.ts';

/**
 * 認証の向こう側なので、共有キャッシュに残さない。ブラウザには ETag で
 * 確かめさせる (アセット名にハッシュが入っているので実際にはほぼ 304)。
 */
const PRIVATE = 'private, max-age=0, must-revalidate';

/** vite が出す成果物の置き場所 (`build.outDir` の中)。 */
const ASSET_DIR = 'assets';

/**
 * **配信側が認証について知るのはこの 1 bit だけ。** 置くのは保護境界
 * （`routes/api.ts` → `protectAdmin`）で、必ず先に走る（`app.ts` の登録順）。
 * 無ければボタンを出さない ―― 安全側の既定と一致する。
 */
type AdminEnv = {
  Bindings: LilyBindings;
  Variables: { canLogout?: boolean };
};

export function adminRoutes(config: PageConfig, authContext: AuthContext): Hono<AdminEnv> {
  const app = new Hono<AdminEnv>();
  const mount = createPaths(config).urls.mountPath;
  const base = `${mount}/${ROUTE.admin}`;

  // 入口 HTML に差し込む値。設定はデプロイのときにしか変わらないので 1 度だけ組む。
  //
  // **サイト設定をそのまま渡す。** 項目を選び直すと、`SiteConfig` に足したものが
  // 設定画面に届かない。origin だけは URL を組む側と同じ正規化を通す。
  const siteMeta: AdminSiteMeta = { ...config.site, url: siteOrigin(config.site.url) };
  const siteMetaJson = JSON.stringify(siteMeta);
  // 「どのブログの管理画面か」が分かる題にする。管理画面を複数開いたときに
  // タブが全部 `lily` だと見分けが付かない。
  const title = `${config.site.name} - lily`;

  /**
   * **差し込むのは配信時。** ビルド時に焼かないのは、管理画面の成果物を deployment に
   * 依存させないため (`src/admin/api.ts` の `MOUNT` と同じ理由で、`/blog` と
   * `/blog-next` に同じものを配れる)。焼くと mount ごとにビルドが要る。
   *
   * ログアウトの口があるかは deployment ごとに決まる（アダプタは `env` から
   * 作られる）ので、**取り得る形は 2 つだけ。** 2 本組んでおいて選ぶ。
   */
  const rewriterFor = (logoutUrl: string): HTMLRewriter =>
    new HTMLRewriter()
      .on('title', {
        element(element) {
          // setInnerContent は既定でテキストとして扱う (エスケープはこちらでしない)。
          element.setInnerContent(title);
        },
      })
      .on(`meta[name="${SITE_META}"]`, {
        element(element) {
          // 属性値のエスケープも rewriter の仕事。JSON を手で埋め込まない。
          element.setAttribute('content', siteMetaJson);
        },
      })
      .on(`meta[name="${LOGOUT_META}"]`, {
        element(element) {
          element.setAttribute('content', logoutUrl);
        },
      });

  const withLogout = rewriterFor(authContext.logoutUrl);
  const withoutLogout = rewriterFor('');

  app.get(base, (c) => c.redirect(`${base}/`, 308));

  app.get(`${base}/*`, async (c) => {
    // 静的アセットの URL はディレクトリ直下からの相対なので、mount を落として渡す。
    const rest = c.req.path.slice(base.length + 1);
    const asset = await c.env.ASSETS.fetch(new URL(`/admin/${rest || 'index.html'}`, c.req.url));

    // 見つからないパスは SPA の入口に寄せる。画面の切り替えはハッシュで行うので
    // 普通は来ないが、リロードやブックマークで直接叩かれたときに 404 にしない。
    //
    // **ビルド成果物は寄せない。** デプロイをまたいで開いていたタブが古い
    // ハッシュ付きの JS を取りに来たとき、HTML を 200 で返すと MIME の不一致で
    // 白い画面になる（404 なら原因が分かる）。
    const response =
      asset.status === 404 && !rest.startsWith(`${ASSET_DIR}/`)
        ? await c.env.ASSETS.fetch(new URL('/admin/index.html', c.req.url))
        : asset;

    const headers = new Headers(response.headers);
    headers.set('Cache-Control', PRIVATE);
    headers.set('X-Robots-Tag', 'noindex');

    // **HTML のときだけ書き換える。** JS や CSS を HTMLRewriter に流すと、中身の
    // `<` が要素の始まりとして解釈されて壊れる。
    //
    // ヘッダは Response を組む**前**に決めきること。`new Response()` は渡された
    // Headers を写すので、あとから append しても出て行くものは変わらない。
    const html = isHtml(headers);
    // 入口 HTML にだけ目印を付ける。アセットのたびに送っても増えるものは無い。
    if (html) headers.append('Set-Cookie', setAdminHint(c.req.url, mount));

    const output = new Response(response.body, { status: response.status, headers });
    if (!html) return output;

    // ログアウトのボタンを出すかは保護境界が決めている (Access のようにセッションを
    // Worker の外が握っている方式では押す物が無い)。**ここは 1 bit を読むだけ。**
    return (c.get('canLogout') ? withLogout : withoutLogout).transform(output);
  });

  return app;
}

function isHtml(headers: Headers): boolean {
  return (headers.get('Content-Type') ?? '').toLowerCase().startsWith('text/html');
}

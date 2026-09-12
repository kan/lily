/**
 * このブログの設定。**サイト固有のものはここだけ。**
 *
 * lily（`@kanf/lily`）は CMS 本体で、サイトの名前も URL も知らない。ここで渡した
 * ものが公開ページ・フィード・OGP・管理画面に出る。
 */
import { createLily, localhostOnly, passwordAuth } from '@kanf/lily';
import { defaultTheme } from '@kanf/lily/theme';

/** 管理画面のパスワード。**12 文字未満は受け付けない。** */
const PASSWORD_SECRET = 'ADMIN_PASSWORD';

/**
 * Worker の secret。**`wrangler.jsonc` には書かない**ものなので、`wrangler types`
 * が出す `Env` には（`.dev.vars` を置くまで）現れない。ここで形を決めておく。
 */
type Secrets = {
  readonly ADMIN_PASSWORD?: string;
  readonly BLUESKY_IDENTIFIER?: string;
  readonly BLUESKY_APP_PASSWORD?: string;
};

export const lily = createLily<Env & Secrets>({
  site: {
    // デプロイ後に自分のドメイン（または `*.workers.dev` の URL）へ変える。
    // **絶対 URL の起点**なので、ここが違うとフィードと canonical が狂う。
    url: 'https://example.com',
    name: 'My blog',
    description: 'A blog running on lily',
    author: 'Someone',
    // 配信する中身の言語とタイムゾーン。**既定値は無い**（lily が勝手に決めると、
    // 別の言語・別の地域のブログが黙って日本語・JST として配られる）。
    lang: 'en',
    timeZone: 'UTC',
    // OGP の絵。**絶対 URL。** 置き場は `public/` でもよそのドメインでもよい。
    ogImage: { url: 'https://example.com/ogp.png', width: 1200, height: 630 },
  },

  // ルートに置く。`/blog` の下に出したいなら '/blog'（URL を組むのは lily の仕事で、
  // テーマもテストもここから引く）。
  mountPath: '/',

  // 標準テーマ。自前の見た目にしたいときは `node_modules/@kanf/lily` の `theme` を
  // 写して書き換える（4 つの関数とスタイルシート 1 本）。
  theme: defaultTheme,

  // mount root 直下に配る静的ファイル（`public/` に置いたもの）。
  // **ここに挙げた名前は記事のパスとして予約される。**
  assets: [],

  /**
   * 管理画面と管理 API の守り。
   *
   * **secret が無いのは手元だけ。** `.dev.vars` に書かなければ `localhostOnly` に
   * 落ち、これは host が `localhost` / `127.0.0.1` のときしか通らない。
   * **本番で secret を入れ忘れても開かない**（どちらのアダプタも通さない）。
   */
  auth: (env) =>
    env.ADMIN_PASSWORD
      ? passwordAuth({ password: env.ADMIN_PASSWORD, secretName: PASSWORD_SECRET })
      : localhostOnly(),

  // Bluesky への告知（任意）。両方揃ったときだけ使う。揃っていなければ管理画面の
  // 告知ボタンが「未設定」と言うだけで、他の機能は何も変わらない。
  bluesky: (env) =>
    env.BLUESKY_IDENTIFIER && env.BLUESKY_APP_PASSWORD
      ? { identifier: env.BLUESKY_IDENTIFIER, appPassword: env.BLUESKY_APP_PASSWORD }
      : null,
});

# lily

D1 を正とする、Cloudflare Workers 向けの小さな CMS。npm パッケージ `@kanf/lily`。

**Worker + D1 + R2 だけで動く。** 記事投稿・Markdown・画像アップロード・画像表示・
portable な export がこの 3 つで成立する（Cloudflare Images は「あれば画像配信が
良くなる」追加の層で、無い前提を保っている）。

[`fushihara.net/blog`](https://github.com/kan/fushihara.net/tree/main/blog) が唯一の
利用側で、**参照実装を兼ねている。** 設定の書き方・自前テーマ・E2E の回し方は
あちらを見るのが早い。

**「なぜそうなっているか」は [`DESIGN.md`](./DESIGN.md)。** 描画・リンクカード・
管理 API・管理画面・告知・移行の経緯・本番の配線・テストの方針はあちらにある
（**パッケージには入らない**）。決定に至る経緯は
[issue #5](https://github.com/kan/fushihara.net/issues/5)（設計）と
[issue #6](https://github.com/kan/fushihara.net/issues/6)（切り出し）。

## 使う

```ts
// src/config.ts
import { createLily, localhostOnly, passwordAuth } from '@kanf/lily';
import { defaultTheme } from '@kanf/lily/theme';

export const lily = createLily<Env>({
  site: {
    url: 'https://example.com',
    name: 'ブログ',
    description: '説明',
    author: 'だれか',
    lang: 'ja',
    timeZone: 'Asia/Tokyo',
    ogImage: { url: 'https://example.com/ogp.png', width: 1200, height: 630 },
  },
  mountPath: '/',
  theme: defaultTheme,
  // secret が無いのは手元だけ（`.dev.vars` に書かなければ localhost に落ちる）。
  // **本番で secret を入れ忘れても開かない**：どちらのアダプタも通さない。
  auth: (env) => (env.ADMIN_PASSWORD ? passwordAuth({ password: env.ADMIN_PASSWORD }) : localhostOnly()),
});
```

利用側の `wrangler.jsonc` に要るのは 3 点。

```jsonc
{
  // スキーマの正は lily。**コピーしない**（ディレクトリを直接指せる）
  "d1_databases": [{
    "binding": "DB", "database_name": "...", "database_id": "...",
    "migrations_dir": "./node_modules/@kanf/lily/migrations"
  }],
  "r2_buckets": [{ "binding": "MEDIA", "bucket_name": "..." }],
  // 管理画面と静的アセットの置き場。lily の dist/admin をここへ合流させる
  "assets": { "binding": "ASSETS", "directory": "./dist", "run_worker_first": true },
  // テーマの CSS は文字列としてバンドルされる。**fallthrough を付けること**
  // （付けないと wrangler の既定ルールがまるごと無効になる）
  "rules": [{ "type": "Text", "globs": ["**/*.css"], "fallthrough": true }]
}
```

管理画面は**ビルド済みで同梱**しているので、利用側に Vue のツールチェインは要らない。
`node_modules/@kanf/lily/dist/admin` を配信ディレクトリへコピーするだけ
（`blog/scripts/build.mjs` がその実装）。

## 公開 API

`src/index.ts` に載っているものだけ。`src/core/` の中を直接読まないこと。

| 入口 | 何 |
|---|---|
| `@kanf/lily` | `createLily` / 設定とテーマの型 / 認証アダプタ / `runBackup` / `createPaths` / `createDateFormat` / 管理リンクの契約 / zip |
| `@kanf/lily/theme` | 標準テーマ（`defaultTheme`）。CSS を 1 本抱えるので分けてある |
| `@kanf/lily/paths` | URL 生成と記事パスの規則。**Workers の型を使わない**ので Node から読める |
| `@kanf/lily/zip` | portable な書庫の読み書き。同上（E2E のフィクスチャ投入に使う） |
| `@kanf/lily/test-support` | 利用側の Vitest に migrations を流し込む。**`cloudflare:test` を読む**ので本番のコードからは触らない |

**配るのは `tsc` がビルドした `.js` + `.d.ts`**（`dist/lib`。`src/` は入らない）。
ソースのまま配ると**利用側の tsconfig が lily のソースにも適用される**ので、
lily より厳しい設定（`exactOptionalPropertyTypes` など）の人のところで
コンパイルエラーになる（`skipLibCheck` は `.d.ts` にしか効かない）。

## 今できていること

- D1 のスキーマとマイグレーション（`STRICT` / `CHECK` / index）
- `src/core/db/` の query layer（記事・パス・添付・タグ）
- `src/core/paths.ts`（`mountPath` と URL 生成、`normalizePostPath`、予約パス）
- `src/core/render/`（CommonMark + GFM、Shiki、相対参照 → placeholder）
- 公開側の SSR（一覧・記事・タグ・404・alias 308・下書きプレビュー）と CSS の移植
- フィード（RSS 維持 + Atom 追加）、sitemap、favicon / ogp の配信
- 添付の配信（R2 が原本、Cloudflare Images は任意の最適化層）と、
  `<img>` の `width` / `height` / `loading` / `decoding`
- `AuthAdapter` と 3 つのアダプタ（パスワード / Cloudflare Access / localhost）、
  ログイン画面、`<mount>/api/*` と `<mount>/admin/*` の保護境界
- 管理 API（記事の CRUD・公開/取り下げ・パス変更・プレビュー URL・添付・再描画）
- 再描画の案内（lily を更新して出力が変わったら、管理画面の一覧が残り件数を出す）
- portable な import / export（Markdown 一式の zip。往復で identity と URL が保たれる）
- `posts.json`（本体サイトの Blog 付箋が読む口）
- E2E（`e2e/`。フィクスチャは import で入れる）
- Vue の管理画面（一覧・編集・プレビュー・画像 D&D・パス変更・プレビュー URL・
  公開日時・タグ補完・ページング・タグ / キーワードでの絞り込み・設定の確認・
  セッション切れからの復帰）
- 説明（description）の自動生成。手で書いていなければ本文の冒頭を配信時に出す
- 毎日の控え取り（Cron Trigger → portable な zip を別の R2 バケットへ 30 世代）
- 公開ページの管理リンク（管理画面を開いたことがある端末にだけ出る）
- Bluesky への告知（管理画面のボタン。二重投稿は `bluesky_uri` で防ぐ）
- OGP の絵（ブログ専用の 1 枚 + 記事ごとに添付から選べる上書き）

**2026-08-29 に `fushihara.net/blog` を Astro から引き継ぎ、2026-09-08 に
`@kanf/lily` として切り出し、2026-09-12 にこのリポジトリへ出した。** 経緯と
踏んだ穴は
[`SWITCHOVER.md`](https://github.com/kan/fushihara.net/blob/main/blog/SWITCHOVER.md)
と [issue #6](https://github.com/kan/fushihara.net/issues/6)。

## コマンド

```bash
npm install
npm test          # Vitest。実 workerd + 実 D1 で動く
npm run typecheck # wrangler types → tsc (src / 管理画面 の 2 プロジェクト)
npm run build     # 配るものを 2 つとも作る（下記）
npm run db:migrate:local  # テスト用のローカル D1 にマイグレーションを当てる
```

**`npm run build` は 2 本立て。** どちらもパッケージに同梱するもの。

| | 何を | 誰が |
|---|---|---|
| `build:admin` | 管理画面（Vue）を `dist/admin` へ | vite |
| `build:lib` | CMS 本体を `dist/lib` へ（`.js` + `.d.ts` + 標準テーマの `.css`） | `tsc -p tsconfig.build.json` + `scripts/copy-lib-assets.mjs` |

**`exports` が指すのは `dist/lib`** なので、`file:` で参照している利用側から見ると
**`src/` を直しただけでは 1 バイトも届かない。** 往復するあいだは
`npm run build:lib:watch` を併走させる（`tsc` の watch は `.css` を見ないので、
`style.css` を直したときだけ `npm run build:lib` を回す）。

**ビルドしていないと `vitest` が動かない**（テスト用の `wrangler.jsonc` の
`assets.directory` が `dist/` を指すため。`npm test` は `pretest` で自動的に走る）。
`pretest` が作るのは `dist/admin` とテスト用の静的アセットだけで、**`dist/lib` は
作らない** ―― lily 自身のテストは `src/` を直接読むため。
`pretest` は管理画面のビルドに加えて `scripts/test-assets.mjs` を回し、
テスト用の静的アセット（favicon / ogp）を `dist/` に作る。**あれはパッケージに
入らない** —— 何を配るかは利用側が `PageConfig.assets` で決めるので、lily は
絵を 1 枚も持たない。

`wrangler.jsonc` はテストのためだけのもので、**この Worker をデプロイすることはない。**
lily は npm パッケージであって deployment ではない。

E2E は利用側が持つ（[`blog/e2e/`](https://github.com/kan/fushihara.net/tree/main/blog/e2e)）。
公開 URL とフィードが変わっていないことは、あちらのブラウザ越しの検証で判定する。

## 構成

```
migrations/   D1 のマイグレーション（plain SQL）。スキーマの正はここだけ
src/
  index.ts    公開 API。ここに載っていないものは利用側から読まない
  core/       CMS の本体（サイト固有を何も知らない）
    db/       Row 型とクエリ。SQL はここから出さない
    paths.ts  mountPath と URL 生成、normalizePostPath / normalizeSegment
    slug.ts   タグ名 → slug（最後は normalizeSegment を通す）
    api/      管理 API。mount を知らない形で <mount>/api にマウントされる
    auth/     AuthAdapter の型と 3 つのアダプタ（password が標準構成の既定、
              Cloudflare Access、localhostOnly）とログイン画面
    feed/     RSS 2.0 と Atom。どちらも全文
    media/    画像の最適化（任意）、受け付ける形式の表、寸法をヘッダから読む
    render/   Markdown → HTML。保存する側と配信する側で 2 段に分ける
    transfer/ portable な import / export。frontmatter・zip・往復の規則
    routes/   fixed.ts が core の route 名の正本。public.ts が人向け、
              feeds.ts が機械向け（と静的アセット）、media.ts が添付、
              api.ts が保護境界（require-auth.ts が中身）
    admin-hint.ts 公開ページに管理リンクを出す目印の cookie。付ける側と消す側
    theme.ts  テーマが実装する型。core は配信するページの HTML を持たない
              （例外は auth/login-page.ts のログイン画面 1 枚）
    date.ts   日付整形の部品。core は使わず、テーマと管理画面が設定の
              timeZone を渡して使う
  theme/      標準テーマ。サイト固有の値を 1 つも持たない Theme 実装
  admin/      Vue の管理画面。別ビルド（vite）で dist/admin に出る
scripts/      **どれもパッケージに入らない。** test-assets.mjs（テスト用の絵）、
              clean-lib.mjs / copy-lib-assets.mjs（dist/lib の掃除と .css の運搬）、
              check-fresh.mjs（dist/lib が src より古くないか。利用側が呼ぶ）
test/         Vitest（利用側を 1 つも知らない状態で通ること）
.github/      CI（push / PR で typecheck + emit + test）、publish（タグ v*）、dependabot
tsconfig.json        型検査（src + test）。tsconfig.admin.json が管理画面
tsconfig.build.json  配る形の emit（dist/lib）。extends で上を継ぐ
```

## 設計で外せない 3 点

後から変えるとデータ移行や URL 互換に直接響くので、ここだけは先に決めてある。

1. **記事の identity と URL を分離する。** identity は不変の `public_id`（uuid v4）で、
   URL は `post_paths`。URL は後から変えられて、旧 URL は alias として残る
2. **Markdown は deployment を知らない。** 本文に `/blog/...` を埋め込まない。
   画像は `./sample.png` の相対参照のまま保存し、公開 URL は描画時に解決する
3. **`mountPath` は第一級の設定。** `/blog` にも root にもマウントできる。
   URL を組むのは `core/paths.ts` だけ

## テーマ（`core/theme.ts` と `src/theme/`）

`core` は**配信するページの** HTML を 1 バイトも持たない。ページを組むのは `Theme`
を実装した側で、core が渡すのは**ページに出すデータだけ**（`PageContext` と各 View 型）。

例外は**ログイン画面** 1 枚だけ（`core/auth/login-page.ts`）。あれは見た目ではなく
認証の経路そのもので、テーマに持たせると自前のテーマを書いた deployment が全部
実装しない限り管理画面へ入れなくなる（管理画面の中身も同じ理由で core が配っている）。

実装は 2 つある。

| どれ | 何 |
|---|---|
| `src/theme/`（ここ） | **標準テーマ。** サイト固有の値を 1 つも持たない |
| `blog/src/site/` | fushihara.net のブログとしてのテーマ。参照実装であり、写して直す例 |

**2 本目があることに意味がある。** テーマが 1 つしか無いあいだは、core が本当に
テーマから独立しているかを確かめる方法がない。実際、切り出す前は core のテストが
fushihara.net のテーマを読んでいた（「core に `/blog` が焼き付いていない」ことを
見るためのアプリが、である）。今は `test/` から利用側が 1 つも見えない。

標準テーマが守っていること（`test/theme/default.test.ts` が見張る）:

- 名前・説明・著者・言語・タイムゾーン・OGP の絵・タブのアイコンはすべて
  `SiteConfig` から出る
- mount を知らない。URL は `context.urls` が組む
- **静的アセットのファイル名を知らない。** 何を配るかは `PageConfig.assets` 次第
  なので、`<link rel="icon">` は `SiteConfig.favicon`（絶対 URL）があるときだけ
  出す。**`ogImage` と同じ形**で、core は絵の配信にも URL の組み立てにも関与しない
- **外部へリクエストを出さない**（webfont を読まない）。npm で配るテーマが
  利用側の CSP とプライバシー方針を勝手に決めない
- 画面に出る文言は `src/theme/text.ts` だけ。**翻訳の仕組みは持たない**
  （別の言語で出したい deployment はテーマを写す。`Theme` は 4 関数と
  スタイルシート 1 本なので、写すのが一番安い）

日付は `core/date.ts` に `SiteConfig.timeZone` を渡して組み、読み手向けの表記は
`SiteConfig.lang` で `Intl` に任せる。`<time datetime>` は ISO 8601 のままなので、
機械が読む側は表示形式に左右されない。

## 認証

`<mount>/api/*` と `<mount>/admin/*` は `AuthAdapter` を通らないと届かない。
**中身が無いうちから掛けてある**ので、route を足したときに保護を忘れる余地がない。

**core は認証の方式を 1 つも知らない。** アダプタは 3 つ同梱していて、どれを使うかは
利用側が `auth: (env) => ...` で決める（`env` を受け取るのは、チーム名やパスワードの
ような deployment 固有の値をリポジトリに焼き付けないため）。

| アダプタ | 何 | 要るもの |
|---|---|---|
| `passwordAuth` | **標準構成の既定。** パスワード 1 つ | secret を 1 本 |
| `cloudflareAccess` | Access が付ける JWT を検証する | Zero Trust の設定 |
| `localhostOnly` | ローカル開発の抜け道。**本番では構造上通らない** | 何も |

- 拒否した理由はレスポンスに載せない。どこまで合っていたかは、当てにいく手掛かりになる
- **認証だけでは足りない。** セッションはどちらの方式でも Cookie なので、他所の
  サイトから送られたリクエストにも付いて回る。body を読まない口（`unpublish` /
  `rerender`）と multipart の口（`media`）は素のフォームから叩けるので、`csrf()` で
  Origin を見る

### `passwordAuth`（標準構成の既定）

パスワードを Worker の secret に置き、ログインが通ると HMAC で署名した cookie を配る。
**保存するものが 1 つも無い**（D1 のテーブルも migration も要らない）。

```ts
auth: (env) => (env.ADMIN_PASSWORD ? passwordAuth({ password: env.ADMIN_PASSWORD }) : localhostOnly()),
```

```bash
npx wrangler secret put ADMIN_PASSWORD
```

Deploy to Cloudflare のボタンからデプロイするなら、`.dev.vars.example` に
`ADMIN_PASSWORD=` の行を置いておけば**デプロイの画面で入力欄になる**
（2025-07 から secret に対応した）。

- **D1 に password hash を持たない。** Workers Free の CPU は 1 リクエスト 10ms で、
  OWASP 推奨の PBKDF2 600,000 回はそこに収まらない。「標準構成が Free で動かない」か
  「ハッシュを弱める」の二択になる。secret と突き合わせるだけなら KDF は要らない
  ——**伸長して守るべき hash が DB に無い**
- **初回セットアップ画面を作らない。** 「users が空のあいだは誰でも管理者になれる」
  窓が開くため。secret はデプロイの時点で入っている
- パスワードの突き合わせは**両方を SHA-256 に落としてから**行う（長さと
  「何文字目まで合っていたか」を時間に出さない）
- **セッションの鍵はパスワードそのもの。** secret を差し替えれば配ってあった
  cookie はまとめて無効になる。別に `SESSION_SECRET` を置くとこの性質が消える
  （パスワードを変えても盗まれた cookie が生き続ける）
- cookie は `HttpOnly` / `SameSite=Lax` / `Path=<mount>/`、`Secure` は https のときだけ
  （ローカルと E2E は http で、付けると手元で一度もログインできない）。寿命は既定
  30 日で、**延長しない**
- 総当たりに対しては**失敗時の待ちしか無い**（既定 500ms。CPU を使わないので Free
  でも通る）。だから 12 文字未満のパスワードは受け付けない
  （**短いパスワードで「守られているつもり」になるのを避ける**）
- **「未設定」と「短すぎる」は最後まで分けて運ぶ。** 畳むと、短い secret を入れた
  運用者の画面に「設定してください」と出続け、同じものを入れ直すループに入る。
  secret の名前を画面に出すのは `secretName` を渡したときだけ ——**core は
  deployment がその値を何という名前で持っているか知らない**
- ログイン画面は `<mount>/admin/login`、ログアウトは `<mount>/admin/logout`
  （POST のみ。GET だと画像や prefetch で落とされる）。**どちらも認証の手前**に
  置かれる（`routes/require-auth.ts` の `protectAdmin`）
- ログアウトは公開ページの目印（`lily_admin`）も一緒に消す。共有の端末に「Admin」の
  リンクが残り続ける理由が無い（付ける側と消す側は `core/admin-hint.ts` に並べてある。
  属性がずれると消えず、そのとき画面にもテストにも異常が出ない）
- **画面からパスワードを変えられない**（変えるには secret を差し替える）。複数人・
  パスワード変更画面が要るなら自前の `AuthAdapter` を書く。**2 つ目の要求が実際に
  出てきたら**、そのとき D1 のアダプタを足す

### アダプタに足すのは `handle` 1 つだけ

「画面からログインできる方式かどうか」は 1 つの事実なので、`AuthAdapter` の
optional なメンバーも 1 つにしてある。**`handle` があること自体が宣言**で、そこから
core が 3 つを決める。

| core が決めること | 根拠 |
|---|---|
| `<mount>/admin/login` と `/logout` をアダプタへ渡すか | `handle` の有無 |
| 未認証のブラウザの画面遷移を、403 ではなくログインへ送るか | 同上 |
| 管理画面にログアウトのボタンを出すか | 同上（`<meta name="lily:logout">` へ差し込む） |

- **3 つを別々のメンバーにしない。** 「口はあるがボタンは出さない」のような食い違いを
  型の上で作れてしまい、どれも画面には出ないので気付けない
- **拒否のしかたを決めるのも core**（`protectAdmin` の `challenge`）。ブラウザの
  画面遷移だけをログインへ送り、`/api/*` は 403 のままにする（リダイレクトすると、
  管理画面がログイン HTML を JSON として読む）。判断の材料（メソッド・`Accept`・
  ログイン画面の URL）はどれも core の持ち物で、アダプタ固有のものが 1 つも無い ——
  アダプタ側に書かせると、2 つ目のアダプタを書いた人が写し損ねた日に
  `src/admin/session.ts` の読み込み直しが黙って壊れる
- **アダプタへ渡すのは 2 本のパスに来た要求だけ。** 全部渡すと、管理画面のアセット
  1 本ごとにアダプタの判定が走り、「受け持たないパスは自分で弾く」仕事が全アダプタの
  実装者に増える
### `cloudflareAccess`

- Access は Worker の手前でリクエストを止めるので、**ここでの検証は二重の守り**。
  Access を経由しない経路（route の設定漏れ・別ドメインからの直接アクセス）で
  管理画面が開かないようにするためのもの
- チーム名と AUD は `wrangler.jsonc` の `vars`。秘密ではないが deployment ごとに
  違うのでコードに焼き付けない。**両方揃ったときだけ** Access を使い、片方でも
  欠けていれば `localhostOnly` に落ちる（＝本番では開かない）。片方だけ設定して
  「Access で守られているつもり」になるのが一番危ないので、判定は `authMode()`
  1 箇所に置き、**選んだ方を起動時に 1 度だけログへ出す**
- **JWT が切れたあとの API は 403 を返し続ける。** 画面から直す手立ては
  トップレベルのナビゲーションで Access に通り直すことだけなので、管理画面が
  401 / 403 を見たら読み込み直す（`src/admin/session.ts`）。詳細は「管理画面」の
  「セッションが切れたとき」
- **セッションの長さは Access 側の設定**（Zero Trust → Access → Applications →
  当該アプリの Session Duration）で、リポジトリからは変えられない。`wrangler.jsonc`
  の `vars` にあるのはチーム名と AUD だけ
- **管理画面にログアウトのボタンは出ない。** セッションを握っているのが Worker の
  外（Access）なので、押しても何も起きないボタンになる。`handle` を持たない
  ＝ログインの口が無い、から自動的にそうなる（未認証の画面遷移が 403 のままなのも
  同じ理由。送る先が無い）

### `localhostOnly`

手元で管理画面を一度も開けなくならないための抜け道。**本番では構造上通らない。**
判定はリクエストの host だけで、`localhost` / `127.0.0.1` 以外は必ず拒否する。
Cloudflare は host でルーティングするので、実ドメインや `*.workers.dev` に来た
要求がこの条件を満たすことはない。

## 画像の最適化

Cloudflare Images は**任意の層**。「後から有効にすると配信が良くなる追加機能」
として扱い、次の 3 つを守る。

- **配信 URL は Images の有無に関わらず同じ。** Images 固有の URL を Markdown にも
  `body_html` にも保存しない（ON/OFF・プラン差・quota 到達・将来の乗り換えの
  いずれでも、記事データを書き換えずに済む）
- **失敗したら原本を返す。** 未設定・利用不可・quota 到達・変換失敗のどれでも、
  記事の画像が表示不能にならない。**fallback は正式仕様**であって手抜きではない
- SVG は触らない（ベクタ）。GIF も触らない（動くものを潰さない）

相手の `Accept` を見て AVIF / WebP を選ぶ。**Cloudflare のエッジは
`Accept-Encoding` 以外の `Vary` を無視する**ので、変換して返すときは共有
キャッシュに載せない:

| 返すもの | `Cache-Control` | `ETag` |
|---|---|---|
| 原本（変換しない / 変換に失敗した） | `public, max-age=31536000, immutable` | R2 の `httpEtag` |
| 変換したもの | `private, max-age=86400` | `httpEtag` に `-webp` / `-avif` を足したもの |

`Vary: Accept` は**交渉した全ての応答**に付ける（原本を返した回も含む。
付け忘れると、変換なしで返った応答を「この URL は交渉しない」と誤解される）。
`ETag` を形式ごとに分けるのは、同じ URL から中身の違う応答が出るため。
分けないと `If-None-Match` に対して**別形式の 304** を返してしまう。

`private` なので Cloudflare のキャッシュには載らず、毎回 Images を通る。
**アクセスが増えて問題になったら `caches.default` に形式込みのキーで載せる**
（それまでは入れない）。

## portable な import / export

**入れられる形と出せる形が同じ。** 今の `blog/content/posts/` のレイアウトそのもの。

```
posts/<canonical-path>/index.md    frontmatter + 本文（相対参照のまま）
posts/<canonical-path>/sample.png  添付
```

D1 の dump（運用復旧用）とは別物。あちらは D1 / R2 という構成に依存するが、
こちらは Markdown と画像なので、**lily を捨てても記事が残る。**

口は `GET <mount>/api/export`（zip を返す）と `POST <mount>/api/import`
（multipart の `file`）。どちらも管理 API なので `AuthAdapter` の内側にある。

### frontmatter

| キー | export | import | 中身 |
|---|---|---|---|
| `title` | 必ず書く | 必須 | |
| `date` | 公開済みなら書く | 公開済みなら必須 | 公開日時。UTC ISO8601 |
| `updated` | 必ず書く | 省略可 | `updated_at` |
| `description` | あれば書く | 省略可 | |
| `tags` | あれば書く | 省略可 | 名前の配列 |
| `draft` | 下書きなら書く | 省略可 | 既定は公開済み |
| `public_id` | **必ず書く** | 省略可（採番する） | 不変の identity |
| `paths` | 必ず書く | 省略可 | canonical + alias |
| `media` | あれば書く | 省略可 | ファイル名 → 添付の `public_id` |
| `ogp` | 選んでいれば書く | 省略可 | OGP に使う添付の**ファイル名** |

- **`public_id` を落とさない。** 落とすと再 import で記事の identity が変わり、
  URL も購読者側の同一性も壊れる。`media` を持っているのも同じ理由で、
  無いと `<mount>/media/<public_id>/…` が往復で変わる
- **`public_id` は記事のパスと同じ規則で検査する** (`normalizePostPath`)。
  素通しすると `public_id: admin` が `post_paths` に入って route を食う
  （createPost は identity 行を無検査で INSERT するので、止めるのはここだけ）
- **canonical はディレクトリ名が正**、`paths` は「その記事が持つ全パス」。
  ディレクトリを rename すると旧 canonical が alias として残る
  （`changeCanonicalPath` と同じ挙動）
- `created_at` と `bluesky_uri` は**持たない**。前者は表示に使わないので
  `date` → `updated` の順で当て、後者は D1 の dump 側の担当
  （portable な Markdown に lily 固有の状態を混ぜない）
- **`ogp` は持つ。** 告知済みかどうか（`bluesky_uri`）と違って、どの絵をその記事の
  顔にするかは**記事に付随する情報**で、別の生成器でも意味を持つ。指すのは
  `public_id` ではなく**ファイル名**なので、`media` を省いた形でも書ける
- `public_id` / `paths` / `media` を省いた形（＝ Astro 版の frontmatter そのもの）が
  そのまま読める。**移行はこの経路**

### YAML は自前で読み書きする

汎用の YAML パーサを入れていない。この形式が lily の契約そのもので、書く側も
こちらなので、往復で形が変わらないことを自分で保証できるため。読み書きできるのは
スカラ・引用符付き・ブロック / フローの並び・1 段のマッピングだけで、**対応して
いない記法は黙って別物として解釈せず拒否する**（`src/core/transfer/frontmatter.ts`
の doc comment が対応表）。汎用の YAML が要るようになったら、差し替えるのは
このファイル 1 つ。

書く側は「このパーサが読み戻せるか」だけでは引用を決めない。**標準の YAML パーサが
真偽値や数値として読んでしまう文字列も引用する**（`#tag` / `true` / `0.5` /
引用符で始まる値）。export した Markdown は他の道具にも読まれうる。

### zip は書くとき無圧縮、読むとき deflate も

書く側を stored に固定しているのは、**同じ中身なら必ず同じバイト列になる**から。
圧縮の出力は実装に依存するので、往復の検証を「同じ書庫になるか」で書けなくなる。
記事は小さく添付は既に圧縮済みの画像なので、代償はほとんど無い。

そのために日時もデータ由来にしてある（記事は `updated_at`、添付は `created_at`）。
**実行時刻を入れてはいけない。** なお MS-DOS の日時は 2 秒刻みなので、
「2 回 export して比べる」だけでは実行時刻が混ざっていても通ってしまう
（`test/transfer/transfer.test.ts` はローカルヘッダの日時を直接見ている）。

読む側で deflate も受けるのは、**手元で普通に zip した書庫を取り込めるように**
するため。CRC は毎回検算する（壊れた書庫を黙って取り込むと、記事が欠けたことに
後から気付けない）。zip64 は未対応。

### 取り込みの規則

- **記事ごとに独立して取り込み、失敗した記事だけを返す。** 1 本の frontmatter が
  壊れていたせいで書庫まるごと入らない形にはしない（移行の途中で必ず起きるうえ、
  どれが悪いのか分からなくなる）
- **既にある `public_id` は上書きしない。** 上書きの意味は「本文だけ」「パスも」
  「消えた添付も」で変わり、取り違えると記事が壊れる。復旧（空の DB へ入れ直す）と
  移行にはこれで足りるので、必要になってから決める
- **タグは記事を作る前に解決する**（管理 API と同じ理由）
- **添付を入れてから描く。** 逆にすると `./sample.png` が解決できず、貼ってある
  はずの画像が公開ページから消える
- 書庫に Content-Type は無いので、**添付の形式は拡張子で決める**（管理 API が
  受け付ける範囲と同じ）。それ以外は警告にして記事は取り込む
- `index.md` が無いディレクトリは記事ではない。記事の下のさらに下にあるファイルも
  添付にできない（`media.filename` に `/` を入れられないため）
- **書庫から来た `public_id` は記事のパスと同じ規則で見る。** 記事のものは予約語が
  route を食うから、添付のものは空文字が `<mount>/media//<filename>` という
  どこにも当たらない URL になるから（`media.public_id` には `NOT NULL UNIQUE` しか無い）
- **frontmatter の `__proto__` は入口で断る。** 素のオブジェクトに代入しても
  キーが生えないので、通すと「知らないキーは拒否する」の網を黙ってすり抜ける

### 増えたときに効く上限

書庫は**丸ごとメモリに載る**。import は 50MB までにしてあるが、Workers の 128MB と
subrequest の上限（添付 1 つにつき R2 が 1 回）に当たる日が先に来る。記事が数百を
超えたら、範囲を指定して分けて出す形が要る。

## バックアップ

**毎日 1 回、記事と添付を portable な zip にして別の R2 バケットへ置く。**
Worker 自身の Cron Trigger（`wrangler.jsonc` の `triggers.crons`、UTC 18:30 = JST 3:30）
から `src/index.ts` の `scheduled` が走り、中身は `core/backup.ts`。

- **中身は `<mount>/api/export` と同じ書庫。** D1 の dump（`wrangler d1 export`）は
  D1 という構成に依存するが、こちらは Markdown と画像なので **lily を捨てても
  記事が残る**。控えの経路に別実装を挟まないので、往復の検証（`test/transfer/`）が
  そのまま控えにも効く
- **置き場所は別バケット**（`fushihara-net-lily-backup`）。添付と同じバケットに
  prefix を分けて入れると、バケットごとの誤削除やライフサイクル規則の事故で
  本体と控えが同時に消える。控えの意味は「別の場所に置くこと」
- **保持は 30 世代。日数で切らない。** 「n 日より古いものを消す」にすると、cron が
  止まっているあいだに全部が古くなり、**残っている控えを全部消す**。数で切れば
  最後に取れたものは必ず残る
- 名前は `archives/lily-<UTC の ISO8601 から記号を落としたもの>.zip`。辞書順が時刻順に
  なるので、世代の判定に日付の解析が要らない（R2 の `list` は key の昇順）
- 何が入っているかは `customMetadata`（`posts` / `media` / `warnings`）に載せる。
  書庫を開かずに R2 の一覧から読める
- **Access の外側から動く。** 管理 API は Access の内側にあり、サービストークンの
  JWT は `sub` が空文字なので `auth/access.ts` が拒否する（「記事の入れ方」）。
  機械が通れる口を開けるより、Worker 自身から D1 と R2 を直に読む方が穴が 1 つ少ない
- **`waitUntil` に逃がさず await する。** 逃がすとハンドラは成功したことになり、
  失敗をログまで見に行かないと気付けない

**最初の 1 回が走ったかは翌朝に確かめる。** Workers の cron は手で発火させられないので、
`npx wrangler r2 object list fushihara-net-lily-backup --remote --prefix archives/` で
書庫が増えているかを見る（ログは `npx wrangler tail` か dashboard の Observability）。
手元で配線だけ試すなら `npx wrangler dev -c ./wrangler.jsonc --test-scheduled` の
`/__scheduled` を叩く（ローカルの D1 / R2 に対して走る）。

**この書庫が持たないもの**: `bluesky_uri` と `created_at`（portable な形式が持たない。
「portable な import / export」の節）。D1 を失って書庫だけから戻すと、**告知済みかどうかが
消える**ので、`bluesky_uri` が担っている二重投稿の抑止が効かなくなる。そこまで含めて
戻したいときは D1 の dump が要る（下記。こちらは手動）。

```bash
# 控えを手元へ。**`--remote` が要る。** r2 object 系はローカルの模擬ストレージが既定で、
# 付け忘れると本物のバケットを見に行かず「キーが無い」とだけ言われる
# （`r2 bucket list` は remote が既定という非対称がある。実際に踏みかけた）
npx wrangler r2 object get fushihara-net-lily-backup/archives/lily-<stamp>.zip \
  --remote --file /tmp/restore.zip

# 運用復旧用の D1 dump（bluesky_uri と created_at を含む）
npx wrangler d1 export DB -c ./wrangler.jsonc --remote --output <file>
```

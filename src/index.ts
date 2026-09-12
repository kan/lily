/**
 * lily の公開 API。**利用側が触ってよいのはここから出るものだけ。**
 *
 * `src/core/` の中の相対パスを直接 import されると、どのファイルを動かしても
 * 誰かが壊れる。逆にここに載っているものは、動かすときに利用側のことを考える。
 *
 * 標準テーマは `@kanf/lily/theme` に分けてある。テーマは CSS を 1 本抱えるので、
 * 自前のテーマを書く deployment に持ち込ませないため。
 *
 * **配るのは `tsc` がビルドした `.js` + `.d.ts`**（`dist/lib`。`src/` は入らない）。
 * ソースのまま配ると**利用側の tsconfig が lily のソースにも適用される**ので、
 * lily より厳しい設定の人のところでコンパイルエラーになる（`skipLibCheck` は
 * `.d.ts` にしか効かない）。
 */

/** 入口。設定を渡すと Hono アプリが返る。 */
export { createLily } from './core/app.ts';

export type {
  LilyBindings,
  LilyConfig,
  MediaConfig,
  PageConfig,
  SiteConfig,
} from './core/config.ts';

/**
 * テーマが実装する型。**core は配信するページの HTML を 1 バイトも持たない**ので、
 * 見た目はこのインターフェースを満たす側が全部決める（例外はログイン画面 1 枚）。
 */
export type {
  ImageView,
  PageContext,
  Pagination,
  PostSummaryView,
  PostView,
  TagView,
  Theme,
} from './core/theme.ts';

/**
 * 認証。既定のアダプタ 3 つと、自前で書くための型。
 *
 * 標準構成の既定は `passwordAuth`（secret のパスワード 1 つ。D1 も migration も
 * 要らない）。`cloudflareAccess` は Access を自分で用意した deployment 向け、
 * `localhostOnly` はローカル開発用で、**本番では構造上通らない**。
 */
export type { AuthAdapter, AuthContext, AuthResult, AuthUser } from './core/auth/index.ts';
export { readCookie } from './core/auth/index.ts';
export { cloudflareAccess, type AccessOptions } from './core/auth/access.ts';
export { localhostOnly } from './core/auth/localhost.ts';
export {
  passwordAuth,
  MIN_PASSWORD_LENGTH,
  type PasswordAuthOptions,
} from './core/auth/password.ts';

/** Bluesky への告知。資格情報は deployment が env から取り出して渡す。 */
export type { BlueskyCredentials } from './core/bluesky.ts';

/** 毎日の控え。`scheduled` ハンドラから呼ぶ。 */
export { runBackup, type BackupOptions, type BackupResult } from './core/backup.ts';

/**
 * URL の組み立てと記事パスの規則。**テーマは `PageContext.urls` を使えばよい**が、
 * 設定を組む段（`SiteConfig.ogImage` の絶対 URL など）では `urls` がまだ無いので、
 * ここから作る。
 */
export {
  createPaths,
  normalizeMountPath,
  normalizeSegment,
  siteOrigin,
  type PathError,
  type PathErrorCode,
  type Paths,
  type PathsConfig,
  type PostPaths,
  type Urls,
} from './core/paths.ts';

/** 日付整形。テーマが `SiteConfig.timeZone` を渡して使う。 */
export { createDateFormat, type DateFormat } from './core/date.ts';

/**
 * 管理画面へのリンクの契約。テーマはこの class でリンクを出し、この
 * スクリプトを差し込む（cookie を読んで `hidden` を外すのは core の持ち物）。
 */
export { ADMIN_LINK_CLASS, ADMIN_LINK_SCRIPT } from './core/admin-contract.ts';

/**
 * portable な書庫。**記事を lily の外へ持ち出せることが要件**なので、
 * 読み書きの primitive は公開する（`CONTRACT.md`）。
 */
export {
  bytesBody,
  createZip,
  readZip,
  ZipError,
  type ZipEntry,
  type ZipFile,
} from './core/transfer/zip.ts';

/**
 * lily の設定。**サイト固有のものはここに集める。**
 *
 * `core/` はこの型しか知らない。サイト名・ドメイン・配色・パンくず・認証方式は
 * すべて呼び出し側 (`src/config.ts` と `src/site/`) が決める。
 */
import type { AuthAdapter } from './auth/index.ts';
import type { BlueskyCredentials } from './bluesky.ts';
import type { ImageView, Theme } from './theme.ts';

export type SiteConfig = {
  /** 配信する origin。フィードと canonical の絶対 URL はここが起点。 */
  readonly url: string;
  /** 読み手向けのサイト名。`<title>` / OGP / フィードに出る。 */
  readonly name: string;
  readonly description: string;
  readonly author: string;
  /**
   * 配信する中身の言語（BCP 47）。`<html lang>` と Bluesky の告知に出る。
   *
   * **core に既定値を置かない。** `'ja'` を core が知っていると、別の言語の
   * deployment が黙って日本語として配られる（Bluesky の言語での絞り込みにも効く）。
   */
  readonly lang: string;
  /**
   * 日付を切り出すタイムゾーン（IANA 名。`'Asia/Tokyo'`）。
   *
   * **core は日付を整形しない。** これを読むのは管理画面（`src/admin/date.ts`）と、
   * 読むことを選んだテーマだけ。**強制はできない**ので、テーマが別のタイムゾーンで
   * 組めば「編集画面で入れた日時」と「記事に出る日付」はずれる。
   *
   * fushihara.net のテーマは本体サイトと共用の `shared/date.ts`（JST 固定）で
   * 組むので、`src/site/meta.ts` の値がそれと一致している必要がある
   * （`test/date.test.ts` が突き合わせる）。
   *
   * **`lang` と同じく既定値を置かない。** 実行環境の TZ に落とすと、
   * 同じ記事の日付が Worker とブラウザで変わる。
   */
  readonly timeZone: string;
  /**
   * サイト共通の OGP の絵。**記事が自分の絵を選んでいないときにテーマが出す 1 枚。**
   *
   * **core は絵の配信に関与しない。** URL を持つだけなので、置き場は静的アセット
   * でも R2 でも別ドメインの CDN でもよく、mount 配下に置く必要もない。
   * `og:image` は絶対 URL でないとクローラが解決できないので、ここも絶対 URL。
   *
   * 寸法は**分かっているときだけ**入れる（テーマは null なら `og:image:width` を
   * 出さない）。
   */
  readonly ogImage: ImageView;
  /**
   * タブに出すアイコンの URL。**無ければテーマは `<link rel="icon">` を出さない。**
   *
   * `ogImage` と同じ考え方で、**core は絵の配信に関与しない**（`assets` で配っても、
   * よそのドメインに置いてもよい）。テーマが `PageConfig.assets` のファイル名を
   * 知る必要が無いのがこの形の眼目。
   *
   * **1 本だけ。** ico と svg と apple-touch-icon を出し分けたい deployment は、
   * それ自体がその サイトの見た目の都合なのでテーマを写して書く
   * （fushihara.net の `src/site/layout.ts` がそうしている）。
   */
  readonly favicon?: string;
};

/**
 * ページを組むのに要る設定。公開側のルータ・フィード・添付はこれしか見ない
 * (認証を知らずに済むように分けてある)。
 */
export type PageConfig = {
  readonly site: SiteConfig;
  /** マウント位置。OSS の標準構成では `'/'`。 */
  readonly mountPath: string;
  readonly theme: Theme;
  readonly media?: MediaConfig;
  /**
   * mount root 直下に配る静的アセットのファイル名 (`favicon.ico` など)。
   * 実体は `ASSETS` バインディングの root 直下から読む。
   *
   * **ここに載せた名前は記事のパスとして予約される。** 配るのに予約しないと、
   * その名前で作った記事が静的アセットの影に入って開けなくなる。逆に配らない
   * ものを載せると、理由の無い予約語が増える。
   */
  readonly assets?: readonly string[];
  /**
   * `site.ogImage` の実体がある**アセットの名前**（`assets` に挙げたものの 1 つ）。
   * **Bluesky の告知カードのサムネにだけ使う**（`og:image` は URL を出すだけなので、
   * ここが無くても公開ページは揃う）。
   *
   * URL ではなく名前で受けるのは、**同一ゾーンの URL を Worker から fetch できない**
   * ため。サブリクエストは自分の route を再実行せず origin へ向かうので、
   * `https://fushihara.net/blog/ogp.png` を素で取ると 522 になる（本体側で
   * 踏んでいる）。`ASSETS` バインディングから読むのは配信側 (`routes/feeds.ts`)
   * と同じ経路で、**mount の付かない root 直下**を見る。
   *
   * 省略すると絵の無いカードになる。**告知そのものは止めない。** 絵が R2 や
   * よそのドメインにある deployment が出てきたら、そのとき実体を渡す口を足す
   * （2 つ目が無いうちに一般化しても当たらない）。
   */
  readonly ogImageAsset?: string;
};

export type MediaConfig = {
  /**
   * Cloudflare Images で配信時に変換するか。**無くても添付は R2 の原本で配れる。**
   * `IMAGES` バインディングが無いときは、true でも原本のまま。
   */
  readonly images?: boolean;
};

/**
 * `createLily()` に渡す設定。
 *
 * `auth` を**関数**にしているのは、チーム名や AUD のような deployment 固有の値を
 * リポジトリに焼き付けず、`env` から取れるようにするため (env はリクエストの
 * ときにしか無いので、モジュール読み込み時にアダプタを作れない)。
 */
export type LilyConfig<Bindings extends LilyBindings = LilyBindings> = PageConfig & {
  readonly auth: (env: Bindings) => AuthAdapter;
  /**
   * Bluesky の資格情報。**無ければ告知の口が「未設定」を返す**（機能ごと
   * 落ちるのではなく、押せないことが管理画面から分かる）。
   *
   * `auth` と同じく関数なのは、App Password が Worker の secret にしか無く、
   * env はリクエストのときにしか手に入らないため。
   */
  readonly bluesky?: (env: Bindings) => BlueskyCredentials | null;
};

/**
 * core が要求するバインディング。
 *
 * `Env`（`wrangler types` の生成物）ではなくこの構造で受けるのは、core が
 * サイト側の設定ファイルを知らずに済むようにするため。
 */
export type LilyBindings = {
  readonly DB: D1Database;
  readonly MEDIA: R2Bucket;
  /** 管理画面のビルド成果物と、`PageConfig.assets` に挙げた静的アセット。 */
  readonly ASSETS: Fetcher;
  /** 画像の最適化。**無い前提を保つ**（Deploy to Cloudflare が用意しない）。 */
  readonly IMAGES?: ImagesBinding;
};

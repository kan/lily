/**
 * mountPath と URL 生成。**URL を組む場所はここだけ。**
 *
 * `https://fushihara.net/blog/` と `https://blog.example.com/` (root mount) の
 * 両方を同じコアで扱うので、core に '/blog' を焼き付けない。文字列連結を
 * 各所に散らさないぶん、root mount の検証はユニットテストで済む。
 */
import { err, ok, type Result } from './result.ts';
import { FIXED_ROUTES, ROUTE } from './routes/fixed.ts';

/** パス全体の長さ上限。export 先のファイルシステムに書ける範囲に収める。 */
const MAX_PATH_LENGTH = 200;
/** 1 セグメントの長さ上限。 */
const MAX_SEGMENT_LENGTH = 80;

/** Windows の予約デバイス名。`CON.txt` のように拡張子が付いても予約される。 */
const WINDOWS_RESERVED = new Set([
  'CON', 'PRN', 'AUX', 'NUL',
  'COM1', 'COM2', 'COM3', 'COM4', 'COM5', 'COM6', 'COM7', 'COM8', 'COM9',
  'LPT1', 'LPT2', 'LPT3', 'LPT4', 'LPT5', 'LPT6', 'LPT7', 'LPT8', 'LPT9',
]);

/** ファイル名にも URL にも使えない文字。`/` はセグメント区切りとして別に扱う。 */
const FORBIDDEN_CHARS = /[\\<>:"|?*]/;
const CONTROL_CHARS = /[\u0000-\u001F\u007F]/;

export type PathErrorCode =
  | 'empty'
  | 'malformed-percent-encoding'
  | 'percent-not-allowed'
  | 'control-character'
  | 'empty-segment'
  | 'dot-segment'
  | 'forbidden-character'
  | 'windows-reserved-name'
  | 'trailing-dot-or-space'
  | 'too-long'
  | 'segment-too-long'
  | 'reserved-path';

export type PathError = { readonly code: PathErrorCode; readonly segment?: string };

/**
 * 記事のパスを正規化する。**管理画面・API・import・export・予約パス判定は
 * すべてこれを通す。**
 *
 * `path` は公開 URL であると同時に portable export のディレクトリ名になるので、
 * ファイルシステムに書ける形であることまでここで決める。
 *
 * **予約判定だけが deployment 依存**（配る静的アセットの名前が設定から来る）
 * なので、外に出すのは `createPaths()` が閉じ込めたほうだけ。ここを直接
 * export すると、予約語を知らないまま記事パスを書ける経路ができる。
 */
function normalizePostPath(
  input: string,
  isReservedSegment: (segment: string) => boolean,
): Result<string, PathError> {
  // percent encoding は保存しない。1 回だけデコードしてから検査し、その後も `%` が
  // 残っていたら拒否する (`%252F` のような二重エンコードで `/` を紛れ込ませる経路を塞ぐ)。
  let decoded: string;
  try {
    decoded = decodeURIComponent(input);
  } catch {
    return err({ code: 'malformed-percent-encoding' });
  }
  if (decoded.includes('%')) return err({ code: 'percent-not-allowed' });

  // 前後のスラッシュは入力ミスとして取り除く。連続スラッシュは黙って畳むと
  // 予測しにくいので、下の空セグメント検査で拒否する。
  const trimmed = decoded.normalize('NFC').replace(/^\//, '').replace(/\/$/, '');
  if (trimmed === '') return err({ code: 'empty' });
  if (trimmed.length > MAX_PATH_LENGTH) return err({ code: 'too-long' });

  const segments: string[] = [];
  for (const raw of trimmed.split('/')) {
    const segment = normalizeSegment(raw);
    if (!segment.ok) return segment;
    segments.push(segment.value);
  }

  // 予約判定は第 1 セグメントだけ。route が持っていくのはそこなので。
  const first = segments[0] as string;
  if (isReservedSegment(first)) return err({ code: 'reserved-path', segment: first });

  return ok(segments.join('/'));
}

/**
 * パスの 1 セグメント分の検査。**「URL セグメントとして安全か」の規則はここだけ。**
 *
 * `normalizePostPath` がセグメントごとに呼び、タグの slug (`core/slug.ts`) も
 * 最後にこれを通す。規則を 2 本持つと、記事パスは弾かれて slug は通る、という
 * 食い違いが黙って生まれる。
 */
export function normalizeSegment(input: string): Result<string, PathError> {
  const segment = input.normalize('NFC');
  if (segment === '') return err({ code: 'empty-segment' });
  if (CONTROL_CHARS.test(segment)) return err({ code: 'control-character', segment });
  if (segment === '.' || segment === '..') return err({ code: 'dot-segment', segment });
  if (segment.length > MAX_SEGMENT_LENGTH) return err({ code: 'segment-too-long', segment });
  if (segment.includes('/')) return err({ code: 'forbidden-character', segment });
  if (FORBIDDEN_CHARS.test(segment)) return err({ code: 'forbidden-character', segment });
  // Windows は末尾のドットと空白を落とすので、往復で別物になる。
  if (/[.\s]$/.test(segment)) return err({ code: 'trailing-dot-or-space', segment });
  const base = segment.split('.')[0] ?? segment;
  if (WINDOWS_RESERVED.has(base.toUpperCase())) {
    return err({ code: 'windows-reserved-name', segment });
  }
  return ok(segment);
}

/**
 * mountPath を正規化する。root mount は空文字、それ以外は先頭スラッシュ付き・
 * 末尾スラッシュ無し (`'' | '/blog'`)。
 */
export function normalizeMountPath(input: string): string {
  const segments = input.split('/').filter((s) => s !== '');
  return segments.length === 0 ? '' : `/${segments.join('/')}`;
}

/** 保存されているパスは decode 済みなので、URL に組むときにセグメント単位でエンコードする。 */
function encodePath(path: string): string {
  return path.split('/').map(encodeURIComponent).join('/');
}

/**
 * サイトの origin。**末尾スラッシュを落とす。**
 *
 * 設定に `https://example.com/` と書かれても `//blog` にならないようにする。
 * 表示のために origin を出すところ (管理画面の設定) も必ずこれを通す。
 */
export function siteOrigin(siteUrl: string): string {
  return siteUrl.replace(/\/+$/, '');
}

/**
 * 管理画面 (SPA) の画面を指すハッシュ。**組む側と解く側がここを見る。**
 *
 * 公開ページから編集画面へ直行するリンク (`src/site/layout.ts`) と、ハッシュを
 * 解いて画面を決めるルータ (`src/admin/router.ts`) が同じ形を知っている必要がある。
 * 食い違っても一覧が開くだけで気付けないので、形はここだけに置く。
 */
export const ADMIN_HASH = { postPrefix: '/posts/' } as const;

export function adminPostHash(publicId: string): string {
  return `#${ADMIN_HASH.postPrefix}${encodeURIComponent(publicId)}`;
}

export type UrlOptions = { readonly absolute?: boolean };

/**
 * 一覧の URL。**1 ページ目にはページ番号を付けない。**
 * `/blog/` と `/blog/page/1/` が両方あると、同じ中身が 2 つの URL で出る。
 */
export type PageOptions = UrlOptions & { readonly page?: number };

/**
 * URL と予約語を決めるのに要る設定。**`PageConfig` がそのまま渡せる形**にして
 * あるので、ルータは `createPaths(config)` と書ける。
 *
 * `core/config.ts` の型を import しないのは、あちらが `theme.ts` 経由でここを
 * import しているため（型だけの循環でも読む側が追いにくい）。構造で受ければ
 * `PageConfig` も、テストの素のオブジェクトも同じように渡せる。
 */
export type PathsConfig = {
  /** サイトの絶対 URL (`https://fushihara.net`)。末尾スラッシュは無視する。 */
  readonly site: { readonly url: string };
  /** マウント位置。OSS の標準構成では `'/'`。 */
  readonly mountPath: string;
  /**
   * mount root 直下に配る静的アセットのファイル名 (`favicon.ico` など)。
   * **記事のパスとして予約される。**
   */
  readonly assets?: readonly string[];
};

export type MediaRef = { readonly public_id: string; readonly filename: string };
export type TagRef = { readonly slug: string };
/** ROUTE のキーなので、フィードの URL 名は ROUTE 側にしか無い。 */
export type FeedKind = 'rss' | 'atom';

/**
 * URL 生成器。`createUrls()` の戻り値を持ち回して使う。
 *
 * 記事の URL は `post_paths` にしか無いので、引数は canonical path そのもの
 * (`PostRow` は自分のパスを知らない)。
 */
export interface Urls {
  readonly mountPath: string;
  index(options?: PageOptions): string;
  post(canonicalPath: string, options?: UrlOptions): string;
  tag(tag: TagRef, options?: PageOptions): string;
  media(media: MediaRef, options?: UrlOptions): string;
  feed(kind: FeedKind, options?: UrlOptions): string;
  preview(token: string, options?: UrlOptions): string;
  admin(sub?: string, options?: UrlOptions): string;
  /** 管理画面でこの記事を開く URL。**ハッシュの形は `ADMIN_HASH` が持つ。** */
  adminPost(publicId: string, options?: UrlOptions): string;
  postsJson(options?: UrlOptions): string;
  sitemap(options?: UrlOptions): string;
  /** サイトマップの中身。index から指す 1 本。 */
  sitemapUrls(options?: UrlOptions): string;
  /** テーマが配る 1 本のスタイルシート。 */
  stylesheet(options?: UrlOptions): string;
  /** mount root 直下に置く静的アセット (`PathsConfig.assets` の 1 つ)。 */
  asset(filename: string, options?: UrlOptions): string;
}

/**
 * 記事パスの規則。**予約語はこの deployment のもの**（route + 配る静的アセット）。
 *
 * URL 生成を要らない層 (`core/db/` と `core/transfer/`) はこちらだけを受け取る。
 */
export type PostPaths = {
  normalizePostPath(input: string): Result<string, PathError>;
  /**
   * 第 1 セグメントが予約されているか。
   *
   * `_` 始まりも予約する。将来 `_astro` のような内部用のプレフィックスを
   * 足したくなったときに、既存記事の URL と衝突しないようにするため。
   *
   * **判定は大小文字を無視する。** パスの一意性 (`post_paths_path_ci`) も解決
   * (`resolvePath` の `lower()`) も ci なので、ここだけ厳密にすると `Admin` が
   * 記事パスとして通ったうえで `/AdMiN` がその記事に解決されてしまう。
   */
  isReservedSegment(segment: string): boolean;
};

/**
 * この deployment の URL と予約語。**両方を 1 つの factory から出す。**
 *
 * route の名前 (`fixed.ts`) と配る静的アセット (`config.assets`) の
 * どちらも「URL を組む側」と「記事パスを弾く側」の両方から見られる。別々に
 * 作ると、片方だけ直して「URL は生成できるが予約されていない」が黙って成立する。
 */
export type Paths = PostPaths & {
  readonly urls: Urls;
  /** mount root 直下に配る静的アセット。ルータはこの順で route を張る。 */
  readonly assets: readonly string[];
};

export function createPaths(config: PathsConfig): Paths {
  const assets = config.assets ?? [];
  // route は元から小文字だが、アセット名は設定から来るので畳んでおく。
  const reserved = new Set<string>(
    [...FIXED_ROUTES, ...assets].map((name) => name.toLowerCase()),
  );
  const isReservedSegment = (segment: string): boolean =>
    segment.startsWith('_') || reserved.has(segment.toLowerCase());

  return {
    urls: createUrls(config),
    assets,
    isReservedSegment,
    normalizePostPath: (input) => normalizePostPath(input, isReservedSegment),
  };
}

function createUrls(config: PathsConfig): Urls {
  const mountPath = normalizeMountPath(config.mountPath);
  const origin = siteOrigin(config.site.url);

  const build = (relative: string, options?: UrlOptions): string => {
    const path = `${mountPath}${relative}`;
    return options?.absolute ? `${origin}${path}` : path;
  };

  /** 2 ページ目以降だけ `/page/<n>` を足す。 */
  const paged = (base: string, page: number | undefined): string =>
    page === undefined || page <= 1 ? `${base}/` : `${base}/${ROUTE.page}/${page}/`;

  return {
    mountPath,
    index: (o) => build(paged('', o?.page), o),
    post: (canonicalPath, o) => build(`/${encodePath(canonicalPath)}/`, o),
    tag: (tag, o) => build(paged(`/${ROUTE.tags}/${encodeURIComponent(tag.slug)}`, o?.page), o),
    media: (media, o) =>
      build(
        `/${ROUTE.media}/${encodeURIComponent(media.public_id)}/${encodeURIComponent(media.filename)}`,
        o,
      ),
    feed: (kind, o) => build(`/${ROUTE[kind]}`, o),
    preview: (token, o) => build(`/${ROUTE.preview}/${encodeURIComponent(token)}`, o),
    admin: (sub, o) => build(sub === undefined ? `/${ROUTE.admin}/` : `/${ROUTE.admin}/${sub}`, o),
    adminPost: (publicId, o) => build(`/${ROUTE.admin}/${adminPostHash(publicId)}`, o),
    postsJson: (o) => build(`/${ROUTE.postsJson}`, o),
    sitemap: (o) => build(`/${ROUTE.sitemap}`, o),
    sitemapUrls: (o) => build(`/${ROUTE.sitemapUrls}`, o),
    stylesheet: (o) => build(`/${ROUTE.styles}`, o),
    asset: (filename, o) => build(`/${encodeURIComponent(filename)}`, o),
  };
}

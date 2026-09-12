/**
 * Row 型。**SQL の列と 1:1**で、query layer の内部表現でもある。
 *
 * D1 の `.first<T>()` はただのキャストで、SQL と型の一致を検証しない。だから
 * 対応関係をこの 1 箇所に閉じ込め、キャストは query layer の内側だけに置く。
 * migration を変えたときに直す場所がここに限定される。
 *
 * 列名を snake_case のまま外へ出しているのは、変換層をもう 1 枚挟むほどの
 * 規模がまだ無いから。表示用の view model が要るようになったら site/ 側で作る。
 */

export type PostStatus = 'draft' | 'published';

export type PostRow = {
  id: number;
  public_id: string;
  title: string;
  description: string | null;
  body_md: string;
  body_html: string | null;
  renderer_version: string | null;
  status: PostStatus;
  /** UTC ISO8601 (末尾 Z)。表示は Asia/Tokyo に整形する。 */
  published_at: string | null;
  updated_at: string;
  created_at: string;
  preview_token_hash: string | null;
  bluesky_uri: string | null;
};

/** 一覧やフィードのように URL を組む必要がある場面で canonical path を添えたもの。 */
export type PostWithPathRow = PostRow & { canonical_path: string };

/** パス解決の結果。requested と canonical が違えば 308 の材料になる。 */
export type ResolvedPathRow = PostRow & {
  matched_path: string;
  matched_is_canonical: 0 | 1;
  canonical_path: string;
};

export type PostPathRow = {
  path: string;
  post_id: number;
  is_canonical: 0 | 1;
  created_at: string;
};

export type MediaRow = {
  id: number;
  public_id: string;
  post_id: number | null;
  filename: string;
  r2_key: string;
  mime: string;
  bytes: number;
  width: number | null;
  height: number | null;
  /** この記事の OGP に使う 1 枚か。**記事につき 1 枚**（部分ユニーク索引）。 */
  is_ogp: 0 | 1;
  created_at: string;
};

export type TagRow = {
  id: number;
  name: string;
  slug: string;
};

/** タグ一覧ページで使う、公開記事だけを数えた件数付きのタグ。 */
export type TagWithCountRow = TagRow & { post_count: number };

/** `post_tags` を後から突き合わせるための行。N+1 を避けるまとめ取得で使う。 */
export type PostTagRow = TagRow & { post_id: number };

/**
 * SELECT する列を Row 型から導出する。
 *
 * `Record<keyof Row, true>` にしてあるので、**Row 型と過不足があると
 * コンパイルが通らない**。`.first<Row>()` はただのキャストなので、SELECT 句と
 * Row 型のずれは実行時まで気付けない。そこを型で止める。
 * (実テーブルとのずれは `test/db/schema.test.ts` が実 D1 で突き合わせる。)
 *
 * JOIN で列名が衝突するので `*` は使わない。
 */
function columnsOf<Row>(set: Record<keyof Row, true>): (keyof Row & string)[] {
  return Object.keys(set) as (keyof Row & string)[];
}

export const POST_COLUMNS = columnsOf<PostRow>({
  id: true,
  public_id: true,
  title: true,
  description: true,
  body_md: true,
  body_html: true,
  renderer_version: true,
  status: true,
  published_at: true,
  updated_at: true,
  created_at: true,
  preview_token_hash: true,
  bluesky_uri: true,
});

export const MEDIA_COLUMNS = columnsOf<MediaRow>({
  id: true,
  public_id: true,
  post_id: true,
  filename: true,
  r2_key: true,
  mime: true,
  bytes: true,
  width: true,
  height: true,
  is_ogp: true,
  created_at: true,
});

export const TAG_COLUMNS = columnsOf<TagRow>({ id: true, name: true, slug: true });

/** 列を alias 付きで並べる (`p.id, p.public_id, ...`)。 */
export function qualify(columns: readonly string[], alias: string): string {
  return columns.map((c) => `${alias}.${c}`).join(', ');
}

export function postColumns(alias: string): string {
  return qualify(POST_COLUMNS, alias);
}

import { env } from 'cloudflare:test';
import { createPaths, type Paths } from '../../src/core/paths.ts';

export const db = env.DB;

/**
 * 記事パスの規則。**アセットを 1 つ以上挙げた状態で見る。**
 *
 * 書き込みの口はどれも `PostPaths` を要求するので、テストごとに素のオブジェクトを
 * 作ると「予約語を知らない規則」で通ってしまい、`admin` や `favicon.ico` を弾いて
 * いるかの検証にならない。
 *
 * ここは DB 層のテストが使うものなので、アプリを組む `routes/helpers.ts` とは
 * 別に持つ（あちらを読むと、DB だけ見たいテストが workerd のアプリごと引き込む）。
 * **予約語の一覧はどちらも同じ考え方**で、食い違っても困らない（DB 層は
 * 渡されたものしか見ない）。
 */
export const paths: Paths = createPaths({
  site: { url: 'https://example.test' },
  mountPath: '/blog',
  assets: ['favicon.ico', 'favicon.svg', 'apple-touch-icon.png', 'ogp.png'],
});

/**
 * 表を空にする。isolatedStorage に頼らず、どのテストも同じ前提から始める
 * (並び順のテストは他のテストが残した行があると意味を失う)。
 */
export async function resetDb(): Promise<void> {
  await db.batch([
    db.prepare('DELETE FROM post_tags'),
    db.prepare('DELETE FROM tags'),
    db.prepare('DELETE FROM media'),
    db.prepare('DELETE FROM post_paths'),
    db.prepare('DELETE FROM posts'),
  ]);
}

/** 制約のテストで使う、最低限の列だけを埋めた INSERT。 */
export function insertPostRaw(values: Record<string, unknown>): Promise<unknown> {
  const row = {
    public_id: crypto.randomUUID(),
    title: 'タイトル',
    body_md: '本文',
    updated_at: '2026-08-27T00:00:00.000Z',
    created_at: '2026-08-27T00:00:00.000Z',
    ...values,
  };
  const columns = Object.keys(row);
  const placeholders = columns.map((_, i) => `?${i + 1}`).join(', ');
  return db
    .prepare(`INSERT INTO posts (${columns.join(', ')}) VALUES (${placeholders})`)
    .bind(...Object.values(row))
    .run();
}

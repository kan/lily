/**
 * 保存してある HTML と、その場で描画する HTML の使い分け。
 *
 * `body_html` は派生データ (キャッシュ) なので、あればそれを使う。
 * 無いときだけ `body_md` から描画する。どちらの経路も同じ renderer を通る。
 */
import { listMediaByPost } from './db/media.ts';
import { setRenderedHtml } from './db/posts.ts';
import type { PostRow } from './db/types.ts';
import { RENDERER_VERSION, renderMarkdown, type RenderMedia } from './render/index.ts';

/**
 * `loadMedia` は **`body_html` が無いときだけ**呼ばれる。添付の取得は
 * 描画にしか要らないので、保存済みの HTML があるときに問い合わせを増やさない。
 */
export async function storedOrRenderedHtml(
  post: Pick<PostRow, 'body_html' | 'body_md'>,
  loadMedia: () => Promise<readonly RenderMedia[]>,
): Promise<string> {
  if (post.body_html !== null) return post.body_html;
  return (await renderMarkdown(post.body_md, { media: await loadMedia() })).html;
}

/**
 * 記事を描画して `body_html` に保存する。
 *
 * 保存のたびと、renderer を更新したときの一括再生成の**両方が同じ道を通る**。
 * 別々に書くと、片方だけ renderer_version を付け忘れる。
 *
 * 戻り値は解決できなかった `./…` の参照。管理画面で「画像を貼り忘れている」と
 * 出すためのもので、保存自体は止めない。
 */
export async function renderAndStore(
  db: D1Database,
  post: Pick<PostRow, 'id' | 'body_md'>,
): Promise<readonly string[]> {
  const media = await listMediaByPost(db, post.id);
  const rendered = await renderMarkdown(post.body_md, { media });
  await setRenderedHtml(db, post.id, rendered.html, RENDERER_VERSION);
  return rendered.unresolvedMedia;
}

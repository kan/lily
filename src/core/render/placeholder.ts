/**
 * 本文の相対参照 (`./sample.png`) を、**deployment を知らない形**で保存するための
 * placeholder。
 *
 *   body_md ──renderMarkdown()──▶ body_html (placeholder のまま保存)
 *                                     └──resolveMediaUrls()──▶ 配信する HTML
 *
 * この分離があるので、`mountPath` を変えても `body_html` の再生成が要らない。
 * `/blog-next` と `/blog` が同じ D1 を見て、同時に正しい URL を出せる。
 *
 * 独自スキームなのは、記事に書いた生 HTML やコードブロックの中身と紛れないため。
 */
import type { MediaRef, UrlOptions, Urls } from '../paths.ts';
import { mapOpenTags } from './html.ts';

const SCHEME = 'lily-media';

/** `lily-media://<public_id>/<filename>`。filename はエンコードして 1 セグメントに収める。 */
export function mediaPlaceholder(media: MediaRef): string {
  return `${SCHEME}://${encodeURIComponent(media.public_id)}/${encodeURIComponent(media.filename)}`;
}

const PLACEHOLDER = new RegExp(`${SCHEME}://([^/"'\\s]+)/([^"'\\s]*)`, 'g');

/**
 * placeholder を実際の配信 URL に差し替える。
 *
 * フィードは同じ関数を `absolute` で通す (`content:encoded` の URL は絶対、という
 * 現行の契約を維持するため)。書き換えるのは開始タグの中だけなので、本文に
 * placeholder と同じ文字列を書いても壊れない。
 */
export function resolveMediaUrls(html: string, urls: Urls, options?: UrlOptions): string {
  return mapOpenTags(html, (tag) =>
    tag.replace(PLACEHOLDER, (whole, publicId: string, filename: string) => {
      const media = decodePair(publicId, filename);
      return media === null ? whole : urls.media(media, options);
    }),
  );
}

function decodePair(publicId: string, filename: string): MediaRef | null {
  try {
    return { public_id: decodeURIComponent(publicId), filename: decodeURIComponent(filename) };
  } catch {
    // 壊れた placeholder は書き換えずに残す (壊すより素通しの方が実害が小さい)
    return null;
  }
}

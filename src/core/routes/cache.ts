/**
 * 配信するときのキャッシュ方針。
 *
 * エッジには 60 秒載せ、ブラウザには毎回確認させる。記事を更新しても他の colo の
 * `caches.default` は消せないので、短い TTL で吸収する
 * (purge API は使わない。60 秒の遅れで困るのは書いた本人だけ)。
 */
export const SHORT_EDGE = 'public, max-age=0, must-revalidate, s-maxage=60';

/** デプロイのときしか変わらないもの (スタイルシート・静的アセット)。 */
export const LONG_EDGE = 'public, max-age=0, must-revalidate, s-maxage=3600';

/**
 * 公開ページの Markdown 版（`Accept: text/markdown`）。**共有キャッシュには置かせない。**
 *
 * HTML と同じ URL から返すので、`Vary: Accept` を見ないキャッシュ（Cloudflare のエッジは
 * `Accept-Encoding` 以外の `Vary` を見ない。`routes/media.ts`）に載ると、次にブラウザで
 * 開いた人へ Markdown が配られる。共有キャッシュに入るのは常に HTML（誰でも読める既定の
 * 形）だけにする。画像の内容交渉と同じ形。
 */
export const MARKDOWN = 'private, max-age=0, must-revalidate';

/** 下書きプレビューは残さない。 */
export const NO_STORE = 'no-store';

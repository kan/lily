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

/** 下書きプレビューは残さない。 */
export const NO_STORE = 'no-store';

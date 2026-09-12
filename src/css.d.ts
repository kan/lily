/**
 * CSS は `wrangler.jsonc` の `rules` で Text として取り込む。バンドル時に
 * 文字列になり、Worker がそのまま配信する。
 */
declare module '*.css' {
  const content: string;
  export default content;
}

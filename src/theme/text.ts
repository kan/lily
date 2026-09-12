/**
 * 標準テーマが出す文言。**画面に出る英語はここだけ。**
 *
 * `SiteConfig.lang` は配信する**記事**の言語であって、テーマの UI の言語では
 * ない。両者は普通ずれる（日本語のブログを英語圏の読者が読むこともある）ので、
 * lang からこの表を選ぶことはしない。
 *
 * **翻訳の仕組みは持たない。** 別の言語で出したい deployment は、このテーマを
 * 写して自分のものにする（テーマは `core/theme.ts` の 4 関数を満たすだけなので、
 * 写して直すのが一番安い。fushihara.net の `src/site/` がそうしている）。
 * 差し替えの需要が実際に 2 つ出てきたら、そのとき表を差し込む口を足す。
 */
export const TEXT = {
  rss: 'RSS',
  admin: 'Admin',
  editThisPost: 'Edit this post',
  /** JS が動かない環境で出るラベル。**どちらへ切り替わるかを言わない。** */
  toggleTheme: 'Toggle theme',
  switchToLight: 'Switch to light theme',
  switchToDark: 'Switch to dark theme',
  noPosts: 'No posts yet.',
  noPostsInTag: 'No posts with this tag yet.',
  draft: 'draft',
  updatedPrefix: 'Updated ',
  newer: '← Newer',
  older: 'Older →',
  notFoundTitle: 'Not found',
  notFoundBody: 'That page does not exist.',
  backToIndex: 'Back to all posts',
  /** 一覧の 2 ページ目以降。題に入れて検索結果で見分けが付くようにする。 */
  page: (n: number): string => `Page ${n}`,
  tagPage: (tag: string): string => `Posts tagged “${tag}”`,
} as const;

/**
 * ルーティング定義。**core が持つ route の名前はここを正にする。**
 *
 * 手で並べると route を足したときに更新を忘れる。ルータはこの定義から
 * マウントし、`core/paths.ts` はここからセグメント名を読んで URL を組み、
 * 記事のパス (canonical / alias) はここに載っているものを第 1 セグメントに
 * 使えない。3 者が同じ 1 箇所を見るので、片方だけ直して
 * 「URL は生成できるが予約されていない」が黙って成立することがない。
 *
 * **予約語のもう半分は deployment が持つ** (`PathsConfig.assets`)。両方を
 * 合わせて予約するのは `createPaths()` の仕事で、ここには入れない。
 *
 * mountPath が '/' でも '/blog' でも、判定は mount root 相対で同じ。
 */
export const ROUTE = {
  admin: 'admin',
  api: 'api',
  media: 'media',
  preview: 'preview',
  tags: 'tags',
  // 一覧の 2 ページ目以降 (`/page/2/`)。1 ページ目は付けない。
  page: 'page',
  styles: 'styles.css',
  rss: 'rss.xml',
  atom: 'atom.xml',
  sitemap: 'sitemap-index.xml',
  // 現行の URL をそのまま維持する。Astro の @astrojs/sitemap が index と
  // 中身を 2 ファイルに分けて出していたので、こちらも同じ 2 本を配る。
  sitemapUrls: 'sitemap-0.xml',
  postsJson: 'posts.json',
  notFound: '404',
} as const;

export const FIXED_ROUTES: readonly string[] = Object.values(ROUTE);

/**
 * 認証アダプタが受け持つ口。**`<mount>/admin/` の下**にあるので、記事のパスとは
 * ぶつからない（`admin` が既に予約語）。
 *
 * 名前を core が決めるのは、ここへ来た要求を認証の手前でアダプタへ渡すのが
 * core の仕事だから（`routes/require-auth.ts` の `authEndpoints`）。アダプタが
 * 自分でパスを決めると、core はそこへ要求を届けられない。
 */
export const AUTH_ROUTE = {
  login: 'login',
  logout: 'logout',
} as const;

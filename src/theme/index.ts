/**
 * lily の標準テーマ。**`createLily({ theme: defaultTheme })` で使える。**
 *
 * `core/theme.ts` の `Theme` を満たす 2 本目の実装で、サイト固有の値を 1 つも
 * 持たない（名前・説明・著者・言語・タイムゾーン・OGP の絵はすべて
 * `SiteConfig` から出る）。**core が本当にテーマから独立しているかは、
 * 2 本目を書いて初めて確かめられる。**
 *
 * 見た目を変えたい deployment は、これを**写して**自分のテーマにするのが早い
 * （`Theme` は 4 関数とスタイルシート 1 本なので、継承の仕組みは要らない）。
 * fushihara.net の `src/site/` がその例。
 */
import type { Theme } from '../core/theme.ts';
import { indexPage, notFoundPage, postPage, tagPage } from './pages.ts';
import style from './style.css';

export const defaultTheme: Theme = {
  stylesheet: style,
  index: indexPage,
  post: postPage,
  tag: tagPage,
  notFound: notFoundPage,
};

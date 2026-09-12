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
 *
 * **言葉だけを変えたいなら写さなくてよい** —— `createDefaultTheme({ text })` が
 * 文言を差し替える口で、lily が表を持っていない言語（フランス語など）もこれで出せる。
 */
import type { SiteConfig } from '../core/config.ts';
import type { Theme } from '../core/theme.ts';
import { indexPage, notFoundPage, postPage, tagPage } from './pages.ts';
import { textForSite, type Text } from './text.ts';
import style from './style.css';

export type { Text } from './text.ts';

export type DefaultThemeOptions = {
  /**
   * 差し替える文言。**選ばれた表の上に重ねる**ので、変えたいものだけ書けばよい。
   *
   * どの表が選ばれるかは `SiteConfig.uiLang`（無ければ `lang`）次第で、lily が
   * 表を持っていない言語は英語の表になる。**その言語で出したいときは、ここに
   * 全部の文言を渡す。**
   */
  readonly text?: Partial<Text>;
};

/**
 * 文言を差し替えた標準テーマ。**差し替えないなら `defaultTheme` でよい。**
 *
 * 表を選ぶのは配信のたび（設定は起動時に固定だが、テーマは `PageContext` からしか
 * サイトを知らない）。重ねるのは浅い単位で、関数の文言（`page` / `tagPage`）も
 * まるごと置き換えになる。
 */
export function createDefaultTheme(options: DefaultThemeOptions = {}): Theme {
  const text = (site: SiteConfig): Text => ({ ...textForSite(site), ...options.text });

  return {
    stylesheet: style,
    index: (context, posts, pagination) => indexPage(context, posts, pagination, text(context.site)),
    post: (context, post) => postPage(context, post, text(context.site)),
    tag: (context, tag, posts, pagination) =>
      tagPage(context, tag, posts, pagination, text(context.site)),
    notFound: (context) => notFoundPage(context, text(context.site)),
  };
}

export const defaultTheme: Theme = createDefaultTheme();

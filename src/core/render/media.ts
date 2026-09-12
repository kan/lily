/**
 * 本文の相対参照 (`./sample.png`) を placeholder に置き換える rehype プラグイン。
 *
 * 突き合わせの規則は `resolve` の 1 本だけ。Markdown の画像記法 (要素) でも、
 * 記事に直接書いた生 HTML (raw ノード) でも同じ扱いにする。**コードブロックや
 * inline code は text ノードなので触らない。**
 */
import { visit } from 'unist-util-visit';
import type { Element, Root } from 'hast';
import type { MediaRef } from '../paths.ts';
import { mapOpenTags, rewriteUrlAttributes, URL_ATTRIBUTES } from './html.ts';
import { mediaPlaceholder } from './placeholder.ts';

/**
 * 描画に渡す添付。`MediaRef`（URL を組むのに要る identity）に、`<img>` へ書く
 * 寸法を足したもの。`MediaRow` がそのまま入る形にしてあるので、query layer の
 * 戻り値を渡し替えずに使える。読めなかった寸法は `null` のまま来る。
 */
export type RenderMedia = MediaRef & {
  readonly width?: number | null;
  readonly height?: number | null;
};

export type MediaPluginOptions = {
  /** この記事に紐づく添付。`filename` で突き合わせる。 */
  readonly media: readonly RenderMedia[];
  /** 解決できなかった `./…` の参照。管理画面の警告に使う。 */
  readonly onUnresolved: (reference: string) => void;
};

export function rehypeMedia(options: MediaPluginOptions) {
  const byFilename = new Map(options.media.map((m) => [m.filename, m]));

  /** 突き合わせられたら添付、そうでなければ null。 */
  const resolve = (value: string): RenderMedia | null => {
    const filename = relativeFilename(value);
    if (filename === null) return null;

    const media = byFilename.get(filename);
    if (media) return media;
    // `./` で書いたのに添付が無い＝画像を貼り忘れている可能性が高い。
    // 素の `foo.md` は記事間リンクのことが多いので黙って通す。
    if (value.startsWith('./')) options.onUnresolved(value);
    return null;
  };

  /** 置き換えるなら placeholder、そうでなければ null。 */
  const toPlaceholder = (value: string): string | null => {
    const media = resolve(value);
    return media === null ? null : mediaPlaceholder(media);
  };

  return (tree: Root): void => {
    visit(tree, (node) => {
      if (node.type === 'element') {
        const element = node as Element;
        for (const attribute of URL_ATTRIBUTES) {
          const value = element.properties[attribute];
          if (typeof value !== 'string') continue;
          const media = resolve(value);
          if (media === null) continue;
          element.properties[attribute] = mediaPlaceholder(media);
          if (element.tagName === 'img' && attribute === 'src') describeImage(element, media);
        }
        return;
      }
      if (node.type === 'raw') {
        // 生 HTML はパースせず文字列のまま運んでいるので、ここだけ文字列で扱う。
        // 書き換えるのは開始タグの中だけ (`mapOpenTags`)。
        const raw = node as { value: string };
        raw.value = mapOpenTags(raw.value, (tag) => rewriteUrlAttributes(tag, toPlaceholder));
      }
    });
  };
}

/**
 * `<img>` に寸法と読み込み方を足す。**Astro 版が出していた属性の引き継ぎ。**
 *
 * `width` / `height` が無いと、画像が届くまで高さが 0 のままになってレイアウトが
 * 飛ぶ。寸法は画像そのものの性質なので、`mountPath` を知らない `body_html` に
 * 書いてよい (URL だけが配信時に解決される)。
 *
 * **書くのは Markdown の画像記法から出た `<img>` だけ。** 記事に直接書いた生 HTML は
 * raw ノードのまま運ばれ、この関数まで来ない（属性は著者のもの）。**著者の指定を
 * 守っているのはその分かれ道であって、下の `hasSize` ではない。**
 *
 * - `width` と `height` は**揃っているときだけ**足す。Markdown の画像記法には
 *   寸法を書く構文が無いので今は必ず素通りするが、片方だけある要素へもう片方を
 *   入れると比率が潰れるので、条件はここに残す
 * - 寸法が読めない添付 (AVIF や `viewBox` の無い SVG) でも `loading` / `decoding` は付く
 */
function describeImage(element: Element, media: RenderMedia): void {
  const properties = element.properties;
  const hasSize = properties.width !== undefined || properties.height !== undefined;
  if (!hasSize && media.width != null && media.height != null) {
    properties.width = media.width;
    properties.height = media.height;
  }
  properties.loading ??= 'lazy';
  properties.decoding ??= 'async';
}

/**
 * 同じディレクトリのファイル名なら返す。
 *
 * `media.filename` は `/` を含めない (DB の CHECK) ので、突き合わせられるのは
 * 記事と同じ階層のものだけ。import / export のレイアウトもそうなっている。
 */
function relativeFilename(value: string): string | null {
  if (value === '' || value.startsWith('#') || value.startsWith('?')) return null;
  // mailto: / data: / https: などのスキーム付きは対象外
  if (/^[a-z][a-z0-9+.-]*:/i.test(value)) return null;

  const bare = value.startsWith('./') ? value.slice(2) : value;
  if (bare === '' || bare.includes('/')) return null;

  try {
    return decodeURIComponent(bare);
  } catch {
    return bare;
  }
}

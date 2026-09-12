/**
 * 画像の最適化。**任意の層。**
 *
 * Cloudflare Images は「後から有効にすると配信が良くなる追加機能」で、無くても
 * 添付は R2 の原本で配れる。だから次の 3 つを守る。
 *
 *   1. **配信 URL は有無に関わらず同じ。** Images 固有の URL を Markdown にも
 *      body_html にも保存しない（ON/OFF・プラン差・quota 到達・将来の乗り換えの
 *      いずれでも、記事データを書き換えずに済む）
 *   2. **失敗したら原本を返す。** 未設定・利用不可・quota 到達・変換失敗の
 *      どれでも、記事の画像が表示不能にならない
 *   3. 判断はこのファイルに閉じる。呼び出し側は「変換できたら使う」だけ
 */

export type ImageFormat = 'image/avif' | 'image/webp';

/**
 * 変換して意味のある形式。
 *
 * SVG はベクタなので触らない。GIF は動くものがあり、静止画に潰すと壊れる。
 * AVIF は既に最適なので、そのまま返す。
 */
const CONVERTIBLE = new Set(['image/png', 'image/jpeg', 'image/webp']);

/**
 * 相手が読める形式のうち、いちばん小さくなるものを選ぶ。
 * 選べなければ null（原本を返す）。
 */
/** 変換の対象になりうる形式か。内容交渉をするかどうかの判断に使う。 */
export function isNegotiable(mime: string): boolean {
  return CONVERTIBLE.has(mime);
}

export function pickFormat(accept: string | null, mime: string): ImageFormat | null {
  if (!isNegotiable(mime)) return null;
  const wanted = accept ?? '';

  if (wanted.includes('image/avif')) return 'image/avif';
  // webp からの webp は意味がない
  if (wanted.includes('image/webp') && mime !== 'image/webp') return 'image/webp';
  return null;
}

/**
 * 変換する。**できなければ null**（呼び出し側が原本を返す）。
 *
 * 原本のストリームは変換に使い切るので、失敗したときのために呼び出し側で
 * 別の経路を用意しておくこと。
 */
export async function optimize(
  images: ImagesBinding,
  body: ReadableStream<Uint8Array>,
  format: ImageFormat,
): Promise<Response | null> {
  try {
    const result = await images.input(body).output({ format });
    return result.response();
  } catch {
    // quota 到達も変換失敗もここに来る。理由で分けない（どちらも原本で凌ぐ）。
    return null;
  }
}

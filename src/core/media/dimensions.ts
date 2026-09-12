/**
 * 添付の寸法をヘッダから読む。**`<img>` の `width` / `height` を出すため**のもの
 * （属性が無いと画像の読み込みでレイアウトシフトが起きる）。読んだ値をどう使うかは
 * `core/render/media.ts` の `describeImage`。
 *
 * **読めなければ `null` を返す。** そのときは属性を出さないだけで、配信は成り立つ。
 * 壊れたファイルからそれらしい数字を作るより、無いほうが実害が小さい。
 *
 * | 形式 | どこを読むか |
 * |---|---|
 * | PNG  | IHDR の width / height (+ `eXIf` チャンク) |
 * | JPEG | 最初の SOF マーカー (+ APP1 の Exif) |
 * | GIF  | 論理画面記述子 |
 * | WebP | VP8X の canvas / VP8 のフレームタグ / VP8L のビット列 (+ `EXIF` チャンク) |
 * | SVG  | `width` / `height` 属性 (px)、無ければ `viewBox` |
 * | AVIF | **読まない** (下記) |
 *
 * **EXIF の orientation を見る。** 5〜8 は縦横を入れ替えて描かれる (ブラウザの
 * `image-orientation` は既定で `from-image`)。格納値をそのまま書くと、スマホで撮った
 * 縦写真に横長の枠を予約してから縦長で描き直すことになり、**防ぎたかったレイアウト
 * シフトが却って大きくなる。** EXIF を持てる 3 形式すべてで見る。
 *
 * AVIF (ISOBMFF) は寸法が `ispe` プロパティにあるが、**どの `ispe` が本体のものかは
 * `pitm` と `ipma` を辿らないと決まらない**。サムネイルやアルファの補助画像にも
 * `ispe` が付くので、最初の 1 つを採ると別の画像の寸法を書きかねない。実物の AVIF で
 * 検証できる手段が手元に無いので、手で組んだバイト列だけを根拠に入れることはしない。
 * (AVIF の添付は `width` / `height` の無い `<img>` になる。以前と同じ状態。)
 */

export type Dimensions = { readonly width: number; readonly height: number };

/**
 * 常識的な上限。壊れたヘッダから読んだ数十億という値を `<img>` に書かないための蓋。
 * 実在の画像がここに触ることはない。
 */
const MAX_EDGE = 100_000;

/** SVG のルート要素を探す範囲。先頭に XML 宣言や DOCTYPE があっても届く。 */
const SVG_HEAD_BYTES = 64 * 1024;

/**
 * 形式は呼び出し側 (拡張子) が決める。各パーサは自分のシグネチャを検査するので、
 * 名前と中身が食い違うファイルは `null` になる。
 */
export function imageDimensions(bytes: Uint8Array, mime: string): Dimensions | null {
  switch (mime) {
    case 'image/png':
      return png(bytes);
    case 'image/jpeg':
      return jpeg(bytes);
    case 'image/gif':
      return gif(bytes);
    case 'image/webp':
      return webp(bytes);
    case 'image/svg+xml':
      return svg(bytes);
    default:
      return null;
  }
}

/** 正の整数で、上限に収まるものだけを通す。 */
function dimensions(width: number, height: number): Dimensions | null {
  if (!Number.isInteger(width) || !Number.isInteger(height)) return null;
  if (width <= 0 || height <= 0) return null;
  if (width > MAX_EDGE || height > MAX_EDGE) return null;
  return { width, height };
}

function startsWith(bytes: Uint8Array, signature: readonly number[]): boolean {
  if (bytes.length < signature.length) return false;
  return signature.every((byte, i) => bytes[i] === byte);
}

function u16be(bytes: Uint8Array, at: number): number {
  return ((bytes[at] as number) << 8) | (bytes[at + 1] as number);
}

function u16le(bytes: Uint8Array, at: number): number {
  return (bytes[at] as number) | ((bytes[at + 1] as number) << 8);
}

function u24le(bytes: Uint8Array, at: number): number {
  return (
    (bytes[at] as number) | ((bytes[at + 1] as number) << 8) | ((bytes[at + 2] as number) << 16)
  );
}

function u32be(bytes: Uint8Array, at: number): number {
  // `<<` は 32bit 符号付きなので、最上位ビットが立つと負になる。乗算で組む。
  return (
    (bytes[at] as number) * 0x1000000 +
    (((bytes[at + 1] as number) << 16) | ((bytes[at + 2] as number) << 8) | (bytes[at + 3] as number))
  );
}

function u32le(bytes: Uint8Array, at: number): number {
  return (
    (bytes[at] as number) +
    (bytes[at + 1] as number) * 0x100 +
    (bytes[at + 2] as number) * 0x10000 +
    (bytes[at + 3] as number) * 0x1000000
  );
}

function fourcc(bytes: Uint8Array, at: number): string {
  return String.fromCharCode(...bytes.subarray(at, at + 4));
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** IHDR は必ず最初のチャンクで、位置が固定されている。 */
function png(bytes: Uint8Array): Dimensions | null {
  if (bytes.length < 24 || !startsWith(bytes, PNG_SIGNATURE)) return null;
  if (fourcc(bytes, 12) !== 'IHDR') return null;
  return oriented(u32be(bytes, 16), u32be(bytes, 20), pngOrientation(bytes));
}

/** `eXIf` チャンクの中身は TIFF ブロックそのもの (`Exif\0\0` は付かない)。 */
function pngOrientation(bytes: Uint8Array): number | null {
  // 長さ(4) 種類(4) 中身 CRC(4) の並び。IEND まで、あるいは読めなくなるまで。
  for (let at = 8; at + 8 <= bytes.length; ) {
    const length = u32be(bytes, at);
    const type = fourcc(bytes, at + 4);
    const start = at + 8;
    if (length > bytes.length - start) return null;
    if (type === 'eXIf') return exifOrientation(bytes.subarray(start, start + length));
    if (type === 'IEND') return null;
    at = start + length + 4;
  }
  return null;
}

/** GIF87a / GIF89a のどちらも論理画面記述子の位置は同じ。 */
function gif(bytes: Uint8Array): Dimensions | null {
  if (bytes.length < 10) return null;
  const header = fourcc(bytes, 0) + String.fromCharCode(bytes[4] as number, bytes[5] as number);
  if (header !== 'GIF87a' && header !== 'GIF89a') return null;
  return dimensions(u16le(bytes, 6), u16le(bytes, 8));
}

/**
 * 中身を持たないマーカー。長さフィールドが続かないので、読み飛ばし方が違う。
 * RST0-7 (D0-D7) / SOI (D8) / EOI (D9) / TEM (01)。
 */
function isStandaloneMarker(marker: number): boolean {
  return (marker >= 0xd0 && marker <= 0xd9) || marker === 0x01;
}

/**
 * フレームの開始 (SOF0-SOF15)。**C4 (DHT) / C8 (JPG) / CC (DAC) はフレームではない。**
 * この 3 つを弾かないと、ハフマン表の長さを寸法として読むことになる。
 */
function isFrameMarker(marker: number): boolean {
  if (marker < 0xc0 || marker > 0xcf) return false;
  return marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
}

function jpeg(bytes: Uint8Array): Dimensions | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;

  // APP1 は SOF より前に来る。同じ走査で拾っておく。
  let orientation: number | null = null;
  let at = 2;
  while (at + 1 < bytes.length) {
    // マーカーの前に 0xFF が並ぶことがある (詰め物)。
    if (bytes[at] !== 0xff) return null;
    let marker = bytes[at + 1] as number;
    while (marker === 0xff && at + 2 < bytes.length) {
      at += 1;
      marker = bytes[at + 1] as number;
    }
    at += 2;

    if (isStandaloneMarker(marker)) continue;
    if (at + 1 >= bytes.length) return null;
    const length = u16be(bytes, at);
    // 長さは自分自身の 2 バイトを含む。それ未満は壊れている。
    if (length < 2) return null;

    if (isFrameMarker(marker)) {
      // セグメント: 長さ(2) 精度(1) 高さ(2) 幅(2)
      if (at + 7 >= bytes.length) return null;
      return oriented(u16be(bytes, at + 5), u16be(bytes, at + 3), orientation);
    }
    if (marker === 0xe1 && orientation === null) {
      orientation = exifOrientation(exifPayload(bytes.subarray(at + 2, at + length)));
    }
    // SOS (DA) の先は圧縮データ。ここまでに SOF が無ければ諦める。
    if (marker === 0xda) return null;
    at += length;
  }
  return null;
}

/**
 * RIFF コンテナの最初のチャンクだけを見る。VP8X があるときは必ず先頭に来るので、
 * canvas の寸法 (アニメーションや ICC を含む全体の大きさ) がそこで分かる。
 */
function webp(bytes: Uint8Array): Dimensions | null {
  if (bytes.length < 20) return null;
  if (fourcc(bytes, 0) !== 'RIFF' || fourcc(bytes, 8) !== 'WEBP') return null;

  let size: Dimensions | null = null;
  let orientation: number | null = null;

  // チャンクは 種類(4) 長さ(4) 中身 の並びで、長さが奇数なら 1 バイト詰められる。
  // 寸法は最初のチャンクで分かるが、EXIF はその後ろに来るので最後まで歩く。
  for (let at = 12; at + 8 <= bytes.length; ) {
    const chunk = fourcc(bytes, at);
    const length = u32le(bytes, at + 4);
    const payload = at + 8;
    if (length > bytes.length - payload) break;

    if (size === null) size = chunkDimensions(bytes, chunk, payload, length);
    if (chunk === 'EXIF' && orientation === null) {
      orientation = exifOrientation(exifPayload(bytes.subarray(payload, payload + length)));
    }
    at = payload + length + (length % 2);
  }

  return size === null ? null : oriented(size.width, size.height, orientation);
}

function chunkDimensions(
  bytes: Uint8Array,
  chunk: string,
  payload: number,
  length: number,
): Dimensions | null {
  if (chunk === 'VP8X' && length >= 10) {
    // フラグ(1) 予約(3) canvas 幅-1 (3 LE) canvas 高さ-1 (3 LE)
    return dimensions(u24le(bytes, payload + 4) + 1, u24le(bytes, payload + 7) + 1);
  }
  if (chunk === 'VP8 ' && length >= 10) {
    // フレームタグ(3) の後ろに同期コード 9D 01 2A が来る。無ければ非可逆ではない。
    if (bytes[payload + 3] !== 0x9d || bytes[payload + 4] !== 0x01 || bytes[payload + 5] !== 0x2a) {
      return null;
    }
    // 上位 2 ビットは拡大率。寸法は下位 14 ビット。
    return dimensions(u16le(bytes, payload + 6) & 0x3fff, u16le(bytes, payload + 8) & 0x3fff);
  }
  if (chunk === 'VP8L' && length >= 5) {
    if (bytes[payload] !== 0x2f) return null;
    // 続く 32 ビットの下位から、幅-1 が 14 ビット、高さ-1 が 14 ビット。
    const bits = u32le(bytes, payload + 1);
    return dimensions((bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1);
  }
  return null;
}

/**
 * EXIF の orientation を反映した寸法。**5〜8 は縦横が入れ替わって描かれる。**
 *
 * ここを通さないと、回転情報を持つ写真に転置した枠を予約することになる。
 */
function oriented(width: number, height: number, orientation: number | null): Dimensions | null {
  const transposed = orientation !== null && orientation >= 5 && orientation <= 8;
  return transposed ? dimensions(height, width) : dimensions(width, height);
}

/** JPEG の APP1 と、一部の書き手の WebP は `Exif\0\0` を前置きする。 */
function exifPayload(segment: Uint8Array): Uint8Array {
  const prefix = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00];
  return startsWith(segment, prefix) ? segment.subarray(prefix.length) : segment;
}

/**
 * TIFF ブロックの IFD0 から orientation (tag 0x0112) を読む。
 *
 * **見るのは IFD0 だけ。** orientation は仕様上そこにあり、サムネイル用の IFD1 に
 * ある値は本体の向きではない。読めなければ null (回転していない扱い)。
 */
function exifOrientation(tiff: Uint8Array): number | null {
  if (tiff.length < 8) return null;
  const order = fourcc(tiff, 0).slice(0, 2);
  const little = order === 'II';
  if (!little && order !== 'MM') return null;

  const u16 = (at: number) => (little ? u16le(tiff, at) : u16be(tiff, at));
  const u32 = (at: number) => (little ? u32le(tiff, at) : u32be(tiff, at));
  if (u16(2) !== 42) return null;

  const ifd = u32(4);
  if (ifd + 2 > tiff.length) return null;
  const count = u16(ifd);
  for (let i = 0; i < count; i++) {
    // 1 件 12 バイト: tag(2) 型(2) 個数(4) 値または offset(4)
    const entry = ifd + 2 + i * 12;
    if (entry + 12 > tiff.length) return null;
    // 型 3 (SHORT) 以外は orientation ではない。値は先頭 2 バイトに埋まっている。
    if (u16(entry) === 0x0112 && u16(entry + 2) === 3) return u16(entry + 8);
  }
  return null;
}

/**
 * ルート要素の属性から読む。**`width` / `height` が px で書いてあればそれ**、
 * 無ければ `viewBox` の 3 番目と 4 番目。
 *
 * `%` のような相対指定は寸法ではないので採らない (`viewBox` に落ちる)。
 */
function svg(bytes: Uint8Array): Dimensions | null {
  // 途中で切った UTF-8 の断片が末尾に来るので fatal は立てない (ルート要素は先頭にある)。
  const text = new TextDecoder().decode(bytes.subarray(0, SVG_HEAD_BYTES));
  const tag = ROOT_SVG_TAG.exec(text)?.[0];
  if (tag === undefined) return null;

  const width = absoluteLength(attribute(tag, 'width'));
  const height = absoluteLength(attribute(tag, 'height'));
  if (width !== null && height !== null) return dimensions(width, height);

  const box = attribute(tag, 'viewBox');
  if (box === null) return null;
  const numbers = box.trim().split(/[\s,]+/);
  if (numbers.length !== 4) return null;
  const boxWidth = Number(numbers[2]);
  const boxHeight = Number(numbers[3]);
  if (!Number.isFinite(boxWidth) || !Number.isFinite(boxHeight)) return null;
  return dimensions(Math.round(boxWidth), Math.round(boxHeight));
}

/**
 * `<svg …>` の開始タグ。引用符の中をひとまとまりで食べるので、属性値に `>` が
 * あってもそこで切れない (`core/render/html.ts` の `OPEN_TAG` と同じ考え方。
 * あちらは生成物だけを見るので二重引用符で足りるが、記事に置かれた SVG は
 * 一重引用符で書かれうる)。先読みは `<svgfoo>` を拾わないため。
 */
const ROOT_SVG_TAG = /<svg(?=[\s/>])(?:"[^"]*"|'[^']*'|[^>"'])*>/i;

function attribute(tag: string, name: string): string | null {
  const found = new RegExp(`\\s${name}\\s*=\\s*("[^"]*"|'[^']*'|[^\\s"'>]+)`, 'i').exec(tag);
  if (found === null) return null;
  const raw = found[1] as string;
  const first = raw[0];
  return (first === '"' || first === "'") && raw.endsWith(first) ? raw.slice(1, -1) : raw;
}

/** 単位なしか `px` のときだけ数値を返す。`50%` や `2em` は寸法として使えない。 */
function absoluteLength(value: string | null): number | null {
  if (value === null) return null;
  const found = /^\s*([0-9]*\.?[0-9]+)(?:px)?\s*$/i.exec(value);
  if (found === null) return null;
  const number = Number(found[1]);
  return Number.isFinite(number) ? Math.round(number) : null;
}

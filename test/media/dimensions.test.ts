import { describe, expect, it } from 'vitest';
import { imageDimensions } from '../../src/core/media/dimensions.ts';
import { pngHeader as png } from '../fixtures/png.ts';

/**
 * ヘッダを手で組んで読ませる。**実ファイルを置かない**のは、どのバイトを根拠に
 * しているかがテストに出るのが要点だから (実ファイルだと「通った」以上のことが
 * 分からない)。実物との突き合わせは e2e のフィクスチャ (96x48 の PNG) が兼ねる。
 */

function gif(width: number, height: number, header = 'GIF89a'): Uint8Array {
  const bytes = new Uint8Array(10);
  bytes.set([...header].map((c) => c.charCodeAt(0)));
  const view = new DataView(bytes.buffer);
  view.setUint16(6, width, true);
  view.setUint16(8, height, true);
  return bytes;
}

/** 長さは自分自身の 2 バイトを含む。 */
function segment(marker: number, payload: number[]): number[] {
  const length = payload.length + 2;
  return [0xff, marker, length >> 8, length & 0xff, ...payload];
}

/** SOF は 精度(1) 高さ(2) 幅(2) 成分数(1) の順。 */
function sof(width: number, height: number, marker = 0xc0): number[] {
  return segment(marker, [8, height >> 8, height & 0xff, width >> 8, width & 0xff, 3]);
}

function jpeg(...body: number[]): Uint8Array {
  return new Uint8Array([0xff, 0xd8, ...body]);
}

const ascii = (text: string) => [...text].map((c) => c.charCodeAt(0));

function u32leBytes(value: number): number[] {
  return [value & 0xff, (value >> 8) & 0xff, (value >> 16) & 0xff, (value >>> 24) & 0xff];
}

function u32beBytes(value: number): number[] {
  return [(value >>> 24) & 0xff, (value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff];
}

/** RIFF のチャンクは長さが奇数なら 1 バイト詰められる。 */
function webp(...chunks: [string, number[]][]): Uint8Array {
  const body = chunks.flatMap(([name, payload]) => [
    ...ascii(name),
    ...u32leBytes(payload.length),
    ...payload,
    ...(payload.length % 2 === 1 ? [0] : []),
  ]);
  return new Uint8Array([...ascii('RIFF'), ...u32leBytes(4 + body.length), ...ascii('WEBP'), ...body]);
}

/**
 * orientation だけを持つ TIFF ブロック。**これが 5〜8 だと、格納されている
 * 縦横が入れ替わって描かれる。**
 */
function exif(orientation: number, little = true): number[] {
  const u16 = (v: number) => (little ? [v & 0xff, (v >> 8) & 0xff] : [(v >> 8) & 0xff, v & 0xff]);
  const u32 = (v: number) => (little ? u32leBytes(v) : u32beBytes(v));
  return [
    ...(little ? ascii('II') : ascii('MM')),
    ...u16(42),
    ...u32(8), // IFD0 の位置
    ...u16(1), // 件数
    // tag(2) 型(2) 個数(4) 値(4)。SHORT は先頭 2 バイトに埋まる。
    ...u16(0x0112), ...u16(3), ...u32(1), ...u16(orientation), 0, 0,
    ...u32(0), // 次の IFD は無い
  ];
}

/** PNG のチャンク。CRC は読まないので 0 で埋める。 */
function pngChunk(type: string, payload: number[]): number[] {
  return [...u32beBytes(payload.length), ...ascii(type), ...payload, 0, 0, 0, 0];
}

function u24le(value: number): number[] {
  return [value & 0xff, (value >> 8) & 0xff, (value >> 16) & 0xff];
}

function svg(markup: string): Uint8Array {
  return new TextEncoder().encode(markup);
}

describe('PNG', () => {
  it('IHDR から読む', () => {
    expect(imageDimensions(png(96, 48), 'image/png')).toEqual({ width: 96, height: 48 });
  });

  it('最上位ビットが立つ幅でも負にならない (上限で弾く)', () => {
    // 符号付き 32bit として読むと負になる値。桁を落として通してはいけない。
    expect(imageDimensions(png(0x80000000, 10), 'image/png')).toBeNull();
  });

  it('シグネチャや IHDR が違えば読まない', () => {
    expect(imageDimensions(png(10, 10, 'IDAT'), 'image/png')).toBeNull();
    expect(imageDimensions(gif(10, 10), 'image/png')).toBeNull();
    expect(imageDimensions(png(10, 10).subarray(0, 20), 'image/png')).toBeNull();
  });

  it('0 は寸法として使えない', () => {
    expect(imageDimensions(png(0, 10), 'image/png')).toBeNull();
  });
});

describe('GIF', () => {
  it('87a と 89a のどちらも読む', () => {
    expect(imageDimensions(gif(300, 200), 'image/gif')).toEqual({ width: 300, height: 200 });
    expect(imageDimensions(gif(1, 1, 'GIF87a'), 'image/gif')).toEqual({ width: 1, height: 1 });
  });

  it('知らないバージョンは読まない', () => {
    expect(imageDimensions(gif(10, 10, 'GIF88a'), 'image/gif')).toBeNull();
  });
});

describe('JPEG', () => {
  it('SOF0 から読む (高さが先)', () => {
    expect(imageDimensions(jpeg(...sof(640, 480)), 'image/jpeg')).toEqual({
      width: 640,
      height: 480,
    });
  });

  it('前に並ぶセグメントを読み飛ばす', () => {
    const app0 = segment(0xe0, [0x4a, 0x46, 0x49, 0x46, 0x00, 1, 1, 0, 0, 1, 0, 1, 0, 0]);
    const dqt = segment(0xdb, new Array(65).fill(0));
    expect(imageDimensions(jpeg(...app0, ...dqt, ...sof(8, 4)), 'image/jpeg')).toEqual({
      width: 8,
      height: 4,
    });
  });

  it('DHT (C4) を SOF と取り違えない', () => {
    // C0-CF の範囲にあるがフレームではない。読むとハフマン表の中身が寸法になる。
    const dht = segment(0xc4, [0x00, ...new Array(16).fill(1), ...new Array(16).fill(7)]);
    expect(imageDimensions(jpeg(...dht, ...sof(320, 240)), 'image/jpeg')).toEqual({
      width: 320,
      height: 240,
    });
  });

  it('プログレッシブ (SOF2) も読む', () => {
    expect(imageDimensions(jpeg(...sof(11, 22, 0xc2)), 'image/jpeg')).toEqual({
      width: 11,
      height: 22,
    });
  });

  it('マーカーの前の詰め物 (0xFF の連続) を飛ばす', () => {
    expect(imageDimensions(jpeg(0xff, 0xff, ...sof(5, 6)), 'image/jpeg')).toEqual({
      width: 5,
      height: 6,
    });
  });

  it('SOF に届く前に圧縮データが始まったら諦める', () => {
    const sos = segment(0xda, [1, 0, 0, 0, 0x3f, 0]);
    expect(imageDimensions(jpeg(...sos, ...sof(5, 6)), 'image/jpeg')).toBeNull();
  });

  it('SOI が無ければ読まない', () => {
    expect(imageDimensions(new Uint8Array([0xff, 0xe0, 0, 2]), 'image/jpeg')).toBeNull();
  });
});

describe('WebP', () => {
  it('VP8X の canvas を読む (格納値は 1 引いてある)', () => {
    const payload = [0x10, 0, 0, 0, ...u24le(1919), ...u24le(1079)];
    expect(imageDimensions(webp(['VP8X', payload]), 'image/webp')).toEqual({
      width: 1920,
      height: 1080,
    });
  });

  it('VP8 (非可逆) は同期コードの後ろ、下位 14 ビットを読む', () => {
    // 上位 2 ビットは拡大率。混ぜると 4 倍の寸法になる。
    const scaled = (value: number) => [value & 0xff, ((value >> 8) & 0x3f) | 0xc0];
    const payload = [0, 0, 0, 0x9d, 0x01, 0x2a, ...scaled(200), ...scaled(100)];
    expect(imageDimensions(webp(['VP8 ', payload]), 'image/webp')).toEqual({
      width: 200,
      height: 100,
    });
  });

  it('VP8L (可逆) はビット列から読む', () => {
    const bits = (300 - 1) | ((150 - 1) << 14);
    const payload = [
      0x2f,
      bits & 0xff, (bits >> 8) & 0xff, (bits >> 16) & 0xff, (bits >> 24) & 0xff,
    ];
    expect(imageDimensions(webp(['VP8L', payload]), 'image/webp')).toEqual({
      width: 300,
      height: 150,
    });
  });

  it('RIFF でも WEBP でもなければ読まない', () => {
    const broken = webp(['VP8L', [0x2f, 0, 0, 0, 0]]);
    broken.set([0x58], 8); // 'WEBP' を壊す
    expect(imageDimensions(broken, 'image/webp')).toBeNull();
  });

  it('同期コードが無い VP8 は読まない', () => {
    const payload = [0, 0, 0, 0, 0, 0, 10, 0, 10, 0];
    expect(imageDimensions(webp(['VP8 ', payload]), 'image/webp')).toBeNull();
  });
});

describe('SVG', () => {
  it('width / height が px で書いてあればそれを使う', () => {
    expect(
      imageDimensions(svg('<svg width="64" height="32" viewBox="0 0 8 4"></svg>'), 'image/svg+xml'),
    ).toEqual({ width: 64, height: 32 });
    expect(
      imageDimensions(svg('<svg width="64px" height="32px"></svg>'), 'image/svg+xml'),
    ).toEqual({ width: 64, height: 32 });
  });

  it('相対指定は寸法にならないので viewBox に落ちる', () => {
    expect(
      imageDimensions(svg('<svg width="100%" height="100%" viewBox="0 0 24 12"/>'), 'image/svg+xml'),
    ).toEqual({ width: 24, height: 12 });
  });

  it('viewBox はカンマ区切りでも読める', () => {
    expect(imageDimensions(svg('<svg viewBox="0,0,10,20"></svg>'), 'image/svg+xml')).toEqual({
      width: 10,
      height: 20,
    });
  });

  it('XML 宣言や DOCTYPE が先にあっても届く', () => {
    const markup = '<?xml version="1.0"?>\n<!-- 図 -->\n<svg viewBox="0 0 7 3"></svg>';
    expect(imageDimensions(svg(markup), 'image/svg+xml')).toEqual({ width: 7, height: 3 });
  });

  it('属性値の中の > でタグが切れない', () => {
    const markup = '<svg data-note="a > b" viewBox="0 0 5 5"></svg>';
    expect(imageDimensions(svg(markup), 'image/svg+xml')).toEqual({ width: 5, height: 5 });
  });

  it('手掛かりが無ければ読まない', () => {
    expect(imageDimensions(svg('<svg></svg>'), 'image/svg+xml')).toBeNull();
    expect(imageDimensions(svg('<html><body></body></html>'), 'image/svg+xml')).toBeNull();
    expect(imageDimensions(svg('<svg viewBox="0 0 10"></svg>'), 'image/svg+xml')).toBeNull();
  });
});

describe('EXIF の orientation', () => {
  /**
   * ブラウザの `image-orientation` は既定で `from-image` なので、5〜8 は縦横を
   * 入れ替えて描かれる。**格納値をそのまま書くと、スマホの縦写真に横長の枠を
   * 予約してから縦長で描き直すことになり、防ぎたかったレイアウトシフトが却って
   * 大きくなる。** 実物との突き合わせは e2e のフィクスチャ (orientation 6 の JPEG)。
   */
  const jpegWith = (orientation: number, little = true) =>
    jpeg(...segment(0xe1, [...ascii('Exif'), 0, 0, ...exif(orientation, little)]), ...sof(96, 48));

  const pngWith = (orientation: number) =>
    new Uint8Array([...png(96, 48), ...pngChunk('eXIf', exif(orientation)), ...pngChunk('IEND', [])]);

  const webpWith = (payload: number[]) =>
    webp(['VP8X', [0x08, 0, 0, 0, ...u24le(95), ...u24le(47)]], ['EXIF', payload]);

  it.each([1, 2, 3, 4])('%i は向きが変わらないので、そのまま', (orientation) => {
    expect(imageDimensions(jpegWith(orientation), 'image/jpeg')).toEqual({ width: 96, height: 48 });
    expect(imageDimensions(pngWith(orientation), 'image/png')).toEqual({ width: 96, height: 48 });
  });

  it.each([5, 6, 7, 8])('%i は縦横が入れ替わる', (orientation) => {
    expect(imageDimensions(jpegWith(orientation), 'image/jpeg')).toEqual({ width: 48, height: 96 });
    expect(imageDimensions(pngWith(orientation), 'image/png')).toEqual({ width: 48, height: 96 });
  });

  it('ビッグエンディアン (MM) の TIFF も読む', () => {
    expect(imageDimensions(jpegWith(6, false), 'image/jpeg')).toEqual({ width: 48, height: 96 });
  });

  it('WebP は EXIF チャンクを見る (Exif\\0\\0 の前置きは有無どちらも)', () => {
    expect(imageDimensions(webpWith(exif(6)), 'image/webp')).toEqual({ width: 48, height: 96 });
    expect(imageDimensions(webpWith([...ascii('Exif'), 0, 0, ...exif(6)]), 'image/webp')).toEqual({
      width: 48,
      height: 96,
    });
  });

  it('EXIF が無ければ回転していない扱い', () => {
    expect(imageDimensions(jpeg(...sof(96, 48)), 'image/jpeg')).toEqual({ width: 96, height: 48 });
    expect(imageDimensions(webpWith([1, 2, 3]), 'image/webp')).toEqual({ width: 96, height: 48 });
  });
});

describe('読まない形式', () => {
  it('AVIF は寸法を返さない (primary item を解決しないと確定しないため)', () => {
    // 中身が何であれ null。属性が出ないだけで配信は成り立つ。
    expect(imageDimensions(png(10, 10), 'image/avif')).toBeNull();
  });

  it('知らない MIME も null', () => {
    expect(imageDimensions(png(10, 10), 'application/octet-stream')).toBeNull();
  });

  it('空でも落ちない', () => {
    for (const mime of ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/svg+xml']) {
      expect(imageDimensions(new Uint8Array(0), mime), mime).toBeNull();
    }
  });
});

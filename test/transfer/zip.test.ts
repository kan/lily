import { describe, expect, it } from 'vitest';
import { createZip, readZip, ZipError, type ZipEntry } from '../../src/core/transfer/zip.ts';

const utf8 = new TextEncoder();

function bytes(text: string): Uint8Array {
  return utf8.encode(text);
}

async function roundTrip(entries: ZipEntry[]) {
  return await readZip(createZip(entries));
}

describe('書いて読む', () => {
  it('パスと中身が保たれる', async () => {
    const files = await roundTrip([
      { path: 'posts/start-blog/index.md', data: bytes('# はじめ\n') },
      { path: 'posts/日本語/画像 1.png', data: Uint8Array.from([0, 1, 2, 255]) },
    ]);
    expect(files.map((f) => f.path)).toEqual([
      'posts/start-blog/index.md',
      'posts/日本語/画像 1.png',
    ]);
    expect(new TextDecoder().decode(files[0]?.data)).toBe('# はじめ\n');
    expect([...(files[1]?.data ?? [])]).toEqual([0, 1, 2, 255]);
  });

  it('空のファイルも往復する', async () => {
    const files = await roundTrip([{ path: 'a.txt', data: new Uint8Array(0) }]);
    expect(files[0]?.data.length).toBe(0);
  });

  it('項目が無くても壊れない', async () => {
    expect(await roundTrip([])).toEqual([]);
  });
});

describe('決定的であること', () => {
  // 往復の検証を「同じ書庫になるか」で書けるようにするための性質。
  it('同じ中身からは同じバイト列が出る', () => {
    const make = () =>
      createZip([{ path: 'a.txt', data: bytes('あ'), modified: new Date('2026-08-24T00:00:00Z') }]);
    expect([...make()]).toEqual([...make()]);
  });

  it('日時を渡さないと実行時刻ではなく zip の下限が入る', () => {
    // MS-DOS の日時は 2 秒刻みなので、「少し待って比べる」では実行時刻が
    // 混ざっていても気付けない。ヘッダを直接見る。
    const view = new DataView(createZip([{ path: 'a.txt', data: bytes('あ') }]).buffer);
    expect(view.getUint16(10, true)).toBe(0); // 00:00:00
    expect(view.getUint16(12, true)).toBe((1 << 5) | 1); // 1980-01-01
  });

  it('日時が変わるとバイト列も変わる (書庫に載っている)', () => {
    const at = (iso: string) => createZip([{ path: 'a.txt', data: bytes('あ'), modified: new Date(iso) }]);
    expect([...at('2026-08-24T00:00:00Z')]).not.toEqual([...at('2026-08-25T00:00:00Z')]);
  });
});

describe('壊れた書庫', () => {
  it('zip でなければ読まない', async () => {
    await expect(readZip(bytes('これは zip ではない'))).rejects.toBeInstanceOf(ZipError);
  });

  it('CRC が合わなければ読まない', async () => {
    const archive = createZip([{ path: 'a.txt', data: bytes('あいうえお') }]);
    // 本体のバイトを 1 つ書き換える。ヘッダの大きさは変わらないので CRC だけが食い違う。
    const at = archive.indexOf(bytes('あ')[0] as number);
    archive[at] = (archive[at] as number) ^ 0xff;
    await expect(readZip(archive)).rejects.toThrow(/CRC/);
  });
});

describe('他の道具が作った書庫', () => {
  /** deflate で 1 ファイルだけ入った zip を組み立てる (普通の zip コマンドが作る形)。 */
  async function deflatedZip(path: string, text: string): Promise<Uint8Array> {
    const data = bytes(text);
    const stream = new Response(data).body?.pipeThrough(new CompressionStream('deflate-raw'));
    const compressed = new Uint8Array(await new Response(stream).arrayBuffer());

    // stored の書庫を土台にして、圧縮方式と大きさだけ差し替える。
    const stored = createZip([{ path, data }]);
    const name = bytes(path);
    const local = 30 + name.length;
    const centralStart = local + data.length;

    const out = new Uint8Array(local + compressed.length + (stored.length - centralStart));
    out.set(stored.subarray(0, local), 0);
    out.set(compressed, local);
    out.set(stored.subarray(centralStart), local + compressed.length);

    const view = new DataView(out.buffer);
    view.setUint16(8, 8, true); // ローカル: 圧縮方式 = deflate
    view.setUint32(18, compressed.length, true); // ローカル: 圧縮後の大きさ
    const central = local + compressed.length;
    view.setUint16(central + 10, 8, true);
    view.setUint32(central + 20, compressed.length, true);
    // EOCD の中央ディレクトリ位置も詰めた分だけずらす
    const eocd = out.length - 22;
    view.setUint32(eocd + 16, central, true);
    return out;
  }

  it('deflate で圧縮されていても読める (手元で zip したものを取り込めるように)', async () => {
    const files = await readZip(await deflatedZip('posts/a/index.md', '本文'.repeat(50)));
    expect(new TextDecoder().decode(files[0]?.data)).toBe('本文'.repeat(50));
  });

  it('壊れた deflate は ZipError にする (入力の誤りなので 400 に落としたい)', async () => {
    const archive = await deflatedZip('posts/a/index.md', '本文'.repeat(50));
    // **先頭のブロックヘッダを潰す。** 途中のバイトを潰しても展開自体は通って
    // しまい、CRC の検算で ZipError になるだけなので、この経路の検査にならない。
    const at = 30 + 'posts/a/index.md'.length;
    archive[at] = 0xff;

    await expect(readZip(archive)).rejects.toBeInstanceOf(ZipError);
    await expect(readZip(archive)).rejects.toThrow(/展開できない/);
  });

  it('申告より大きく膨らむ項目は途中で打ち切る', async () => {
    // 申告を信じて全部展開してから検算すると、嘘をつかれたときに memory が先に尽きる。
    const archive = await deflatedZip('posts/a/index.md', 'あ'.repeat(10000));
    // 中央ディレクトリとローカルヘッダの「展開後の大きさ」だけを小さく書き換える。
    const view = new DataView(archive.buffer);
    view.setUint32(22, 10, true);
    const central = archive.length - 22 - (46 + 'posts/a/index.md'.length);
    view.setUint32(central + 24, 10, true);

    await expect(readZip(archive)).rejects.toThrow(/申告より大きい/);
  });
});

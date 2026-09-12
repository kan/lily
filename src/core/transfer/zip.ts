/**
 * portable export / import のアーカイブ。**書くのは無圧縮 (stored) の zip だけ、
 * 読むのは stored と deflate の両方。**
 *
 * 書く側を stored に固定しているのは、**同じ中身なら必ず同じバイト列になる**から。
 * 圧縮の出力は実装とバージョンに依存するので、往復の検証が「同じ zip になるか」
 * では書けなくなる。記事は小さく、添付は既に圧縮済みの画像なので、無圧縮の代償は
 * ほとんど無い。
 *
 * 読む側で deflate も受けるのは、**手元で普通に zip した書庫を import できる
 * ようにする**ため (移行はそちらの経路の方が自然)。
 *
 * zip64 には対応しない。4GB / 65535 件を超えるものは書くときに投げ、読むときは
 * 中央ディレクトリが見つからないものとして扱う。個人ブログの記事と挿し絵で
 * そこに届くことはなく、届く日が来たら形式ごと考え直す方が安い。
 */

const LOCAL_SIGNATURE = 0x04034b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const EOCD_SIGNATURE = 0x06054b50;

const LOCAL_HEADER_SIZE = 30;
const CENTRAL_HEADER_SIZE = 46;
const EOCD_SIZE = 22;

/** ファイル名を UTF-8 として読ませる汎用フラグ (bit 11)。 */
const UTF8_FLAG = 0x0800;

const STORED = 0;
const DEFLATED = 8;

const MAX_UINT16 = 0xffff;
const MAX_UINT32 = 0xffffffff;

/**
 * バイト列を body にする。**`new Response(bytes)` と書かない。**
 *
 * core は Workers の lib でも DOM の lib でも型検査される (管理画面が `LilyApi` の
 * 型を辿って core を読むので、`tsconfig.admin.json` 側にも入る)。DOM の `BodyInit`
 * は `ArrayBufferView<ArrayBuffer>` に固定されていて、Workers の API が返す素の
 * `Uint8Array` (`Uint8Array<ArrayBufferLike>`) を受けない。`ReadableStream` なら
 * どちらの `BodyInit` にも収まるうえ、詰め直しも起きない。
 */
export function bytesBody(bytes: Uint8Array): ReadableStream<Uint8Array<ArrayBuffer>> {
  // Workers に SharedArrayBuffer は無いので、実体は必ず ArrayBuffer に載っている。
  // 詰め直せば型だけで済ませられるが、書庫まるごとの複製になるので取らない。
  const view = bytes as Uint8Array<ArrayBuffer>;
  return new ReadableStream({
    start(controller) {
      controller.enqueue(view);
      controller.close();
    },
  });
}

export type ZipEntry = {
  /** 書庫の中のパス。区切りは `/`。 */
  readonly path: string;
  readonly data: Uint8Array;
  /**
   * 書庫に書く更新日時。**省略すると 1980-01-01 (zip の下限)。**
   * 実行時刻を既定にすると、同じ中身から違うバイト列が出てしまう。
   */
  readonly modified?: Date;
};

export class ZipError extends Error {}

export function createZip(entries: readonly ZipEntry[]): Uint8Array {
  if (entries.length > MAX_UINT16) {
    throw new ZipError(`書庫に入れられるのは ${MAX_UINT16} 件まで (${entries.length} 件)`);
  }

  const encoder = new TextEncoder();
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = encoder.encode(entry.path);
    if (name.length > MAX_UINT16) throw new ZipError(`パスが長すぎる: ${entry.path}`);

    const crc = crc32(entry.data);
    const { time, date } = toDosDateTime(entry.modified);

    const local = new Uint8Array(LOCAL_HEADER_SIZE + name.length);
    const localView = new DataView(local.buffer);
    localView.setUint32(0, LOCAL_SIGNATURE, true);
    localView.setUint16(4, 20, true); // 展開に要るバージョン (2.0)
    localView.setUint16(6, UTF8_FLAG, true);
    localView.setUint16(8, STORED, true);
    localView.setUint16(10, time, true);
    localView.setUint16(12, date, true);
    localView.setUint32(14, crc, true);
    localView.setUint32(18, entry.data.length, true);
    localView.setUint32(22, entry.data.length, true);
    localView.setUint16(26, name.length, true);
    localView.setUint16(28, 0, true); // extra field なし
    local.set(name, LOCAL_HEADER_SIZE);

    const central = new Uint8Array(CENTRAL_HEADER_SIZE + name.length);
    const centralView = new DataView(central.buffer);
    centralView.setUint32(0, CENTRAL_SIGNATURE, true);
    centralView.setUint16(4, 20, true); // 作成したバージョン
    centralView.setUint16(6, 20, true);
    centralView.setUint16(8, UTF8_FLAG, true);
    centralView.setUint16(10, STORED, true);
    centralView.setUint16(12, time, true);
    centralView.setUint16(14, date, true);
    centralView.setUint32(16, crc, true);
    centralView.setUint32(20, entry.data.length, true);
    centralView.setUint32(24, entry.data.length, true);
    centralView.setUint16(28, name.length, true);
    centralView.setUint16(30, 0, true); // extra field なし
    centralView.setUint16(32, 0, true); // コメントなし
    centralView.setUint16(34, 0, true); // ディスク番号
    centralView.setUint16(36, 0, true); // 内部属性
    centralView.setUint32(38, 0, true); // 外部属性
    centralView.setUint32(42, offset, true);
    central.set(name, CENTRAL_HEADER_SIZE);

    locals.push(local, entry.data);
    centrals.push(central);
    offset += local.length + entry.data.length;
    if (offset > MAX_ARCHIVE_BYTES) {
      throw new ZipError(
        `書庫が大きすぎる (${MAX_ARCHIVE_BYTES} バイトまで)。範囲を分けて出すこと`,
      );
    }
    if (offset > MAX_UINT32) throw new ZipError('書庫が 4GB を超える (zip64 は未対応)');
  }

  const centralSize = centrals.reduce((sum, part) => sum + part.length, 0);
  const eocd = new Uint8Array(EOCD_SIZE);
  const eocdView = new DataView(eocd.buffer);
  eocdView.setUint32(0, EOCD_SIGNATURE, true);
  eocdView.setUint16(4, 0, true);
  eocdView.setUint16(6, 0, true);
  eocdView.setUint16(8, entries.length, true);
  eocdView.setUint16(10, entries.length, true);
  eocdView.setUint32(12, centralSize, true);
  eocdView.setUint32(16, offset, true);
  eocdView.setUint16(20, 0, true); // コメントなし

  return concat([...locals, ...centrals, eocd]);
}

export type ZipFile = {
  readonly path: string;
  readonly data: Uint8Array;
};

/**
 * 展開後の合計の上限。**圧縮された書庫の大きさでは memory を守れない。**
 * deflate は 1000:1 近くまで縮むので、受け取る側で 50MB に絞っても、展開すると
 * 数十 GB になりうる (Workers は 128MB)。
 */
const MAX_UNCOMPRESSED_BYTES = 64 * 1024 * 1024;

/**
 * 書き出せる書庫の上限。**`createZip` は全部をメモリに載せる**ので、Workers の
 * 128MB に当たる前に止める。OOM で isolate ごと落ちると、何が起きたのか分からない
 * まま「バックアップが取れない」状態になる。
 *
 * ここに届いたら、範囲を指定して分けて出す形が要る。
 */
const MAX_ARCHIVE_BYTES = 64 * 1024 * 1024;

/**
 * 書庫を読む。**ディレクトリの項目は落とす。**
 *
 * 中央ディレクトリを正にしているので、追記されて古い項目が残っている書庫でも
 * 「今そこにある」ものだけが返る。CRC は毎回検算する (壊れた書庫を黙って
 * 取り込むと、記事が欠けたことに後から気付けない)。
 *
 * 展開後の大きさは**二重に縛る**。中央ディレクトリの申告を先に合計して弾き、
 * 申告が嘘だったときのために展開しながらも数える。申告だけを信じると、
 * 「1KB」と書いた項目が数 GB に膨らんで Worker ごと落ちる。
 */
export async function readZip(bytes: Uint8Array): Promise<ZipFile[]> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const eocd = findEocd(bytes, view);

  const count = view.getUint16(eocd + 10, true);
  let cursor = view.getUint32(eocd + 16, true);
  const decoder = new TextDecoder();
  const files: ZipFile[] = [];
  let remaining = MAX_UNCOMPRESSED_BYTES;

  for (let i = 0; i < count; i++) {
    if (cursor + CENTRAL_HEADER_SIZE > bytes.length) {
      throw new ZipError('中央ディレクトリが途中で切れている');
    }
    if (view.getUint32(cursor, true) !== CENTRAL_SIGNATURE) {
      throw new ZipError('中央ディレクトリの並びが壊れている');
    }

    const method = view.getUint16(cursor + 10, true);
    const crc = view.getUint32(cursor + 16, true);
    const compressedSize = view.getUint32(cursor + 20, true);
    const uncompressedSize = view.getUint32(cursor + 24, true);
    const nameLength = view.getUint16(cursor + 28, true);
    const extraLength = view.getUint16(cursor + 30, true);
    const commentLength = view.getUint16(cursor + 32, true);
    const localOffset = view.getUint32(cursor + 42, true);
    const path = decoder.decode(bytes.subarray(cursor + CENTRAL_HEADER_SIZE, cursor + CENTRAL_HEADER_SIZE + nameLength));
    cursor += CENTRAL_HEADER_SIZE + nameLength + extraLength + commentLength;

    // ディレクトリの項目。中身は無いので読み飛ばす。
    if (path.endsWith('/')) continue;

    if (localOffset + LOCAL_HEADER_SIZE > bytes.length) {
      throw new ZipError(`ローカルヘッダが範囲外: ${path}`);
    }
    if (view.getUint32(localOffset, true) !== LOCAL_SIGNATURE) {
      throw new ZipError(`ローカルヘッダが壊れている: ${path}`);
    }
    // 名前と extra の長さはローカルヘッダ側を見る (中央と違うことがある)。
    const localNameLength = view.getUint16(localOffset + 26, true);
    const localExtraLength = view.getUint16(localOffset + 28, true);
    const start = localOffset + LOCAL_HEADER_SIZE + localNameLength + localExtraLength;
    const end = start + compressedSize;
    if (end > bytes.length) throw new ZipError(`データが範囲外: ${path}`);

    // 申告の時点で予算を超えるものは、1 バイトも展開せずに落とす。
    if (uncompressedSize > remaining) throw new ZipError(`展開後が大きすぎる: ${path}`);

    const raw = bytes.subarray(start, end);
    const data =
      method === STORED ? raw.slice() : await inflate(raw, method, path, uncompressedSize);
    if (data.length !== uncompressedSize) {
      throw new ZipError(`展開後の大きさが合わない: ${path}`);
    }
    remaining -= data.length;
    if (crc32(data) !== crc) throw new ZipError(`CRC が合わない: ${path}`);

    files.push({ path, data });
  }

  return files;
}

/**
 * 生の deflate を展開する。**申告された大きさを超えた時点で打ち切る。**
 *
 * `new Response(stream).arrayBuffer()` は全部を溜めてしまうので、申告が嘘の
 * 書庫を渡されると検算に辿り着く前に memory が尽きる。読みながら数える。
 */
async function inflate(
  raw: Uint8Array,
  method: number,
  path: string,
  limit: number,
): Promise<Uint8Array> {
  if (method !== DEFLATED) {
    throw new ZipError(`対応していない圧縮方式 (${method}): ${path}`);
  }
  // zip の deflate は zlib ヘッダを持たない生の deflate。
  const reader = bytesBody(raw).pipeThrough(new DecompressionStream('deflate-raw')).getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    // **壊れた deflate は TypeError で飛んでくる。** そのまま上げると、書庫が
    // 壊れているだけなのに 500 になる (他の壊れ方はすべて ZipError で 400)。
    let chunk;
    try {
      chunk = await reader.read();
    } catch (error) {
      throw new ZipError(`展開できない: ${path} (${error instanceof Error ? error.message : error})`);
    }
    if (chunk.done) break;
    total += chunk.value.length;
    if (total > limit) {
      await reader.cancel();
      throw new ZipError(`展開後が申告より大きい: ${path}`);
    }
    chunks.push(chunk.value);
  }
  return concat(chunks);
}

/**
 * EOCD を末尾から探す。コメントは書かないが、他の道具が作った書庫には付きうるので
 * 上限 (65535 + EOCD 自身) まで遡る。
 */
function findEocd(bytes: Uint8Array, view: DataView): number {
  const limit = Math.max(0, bytes.length - (EOCD_SIZE + MAX_UINT16));
  for (let i = bytes.length - EOCD_SIZE; i >= limit; i--) {
    if (view.getUint32(i, true) === EOCD_SIGNATURE) return i;
  }
  throw new ZipError('zip として読めない (中央ディレクトリが見つからない)');
}

/** zip の下限。日時を渡さなかった項目はここに揃える。 */
const DOS_EPOCH = { time: 0, date: (1 << 5) | 1 } as const;

/** MS-DOS の日時。2 秒刻みで、1980 年より前は表せない。 */
function toDosDateTime(modified: Date | undefined): { time: number; date: number } {
  if (!modified || Number.isNaN(modified.getTime())) return DOS_EPOCH;
  const year = modified.getUTCFullYear();
  if (year < 1980 || year > 2107) return DOS_EPOCH;
  return {
    time:
      (modified.getUTCHours() << 11) |
      (modified.getUTCMinutes() << 5) |
      (modified.getUTCSeconds() >> 1),
    date: ((year - 1980) << 9) | ((modified.getUTCMonth() + 1) << 5) | modified.getUTCDate(),
  };
}

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

let crcTable: Uint32Array | null = null;

function crc32(bytes: Uint8Array): number {
  if (crcTable === null) {
    crcTable = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let value = i;
      for (let bit = 0; bit < 8; bit++) {
        value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
      }
      crcTable[i] = value >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc = (crc >>> 8) ^ (crcTable[(crc ^ byte) & 0xff] as number);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

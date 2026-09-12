/**
 * IHDR だけの PNG。**寸法を読ませるためのもの**で、画像としては開けない
 * (`imageDimensions` が見るのはここだけなので、それで足りる)。
 *
 * 実ファイルを置かないのは、テストに「どの寸法を期待しているか」が出るから。
 * 実物との突き合わせは e2e のフィクスチャ (96x48 の PNG) が兼ねる。
 */
export function pngHeader(width: number, height: number, chunk = 'IHDR'): Uint8Array {
  // シグネチャ(8) + 長さ(4) 種類(4) 中身(13) CRC(4)。**チャンクを丸ごと組む**ので、
  // 後ろに別のチャンク (eXIf など) を継ぎ足しても並びが崩れない。CRC は読まないので 0。
  const bytes = new Uint8Array(33);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const view = new DataView(bytes.buffer);
  view.setUint32(8, 13);
  bytes.set([...chunk].map((c) => c.charCodeAt(0)), 12);
  view.setUint32(16, width);
  view.setUint32(20, height);
  bytes.set([8, 2, 0, 0, 0], 24); // ビット深度 / 色の種類 / 圧縮 / フィルタ / インタレース
  return bytes;
}

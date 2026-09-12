/**
 * テスト用の静的アセットを `dist/` に作る。**パッケージには入らない**
 * (`package.json` の `files` は `dist/admin` しか含めない)。
 *
 * lily は絵を 1 枚も持たない —— 何を配るかは利用側が `PageConfig.assets` で
 * 決める。テストが見たいのは「設定に挙げた名前が配られること」と、告知カードの
 * サムネの分岐（選んだ添付 / 共通の 1 枚）だけで、**中身は 1 バイトも読まれない。**
 * だから実物ではなく、その場で作った最小限のものを置く（git にバイナリを置かずに
 * 済むぶん、差分も読める）。
 *
 * 形は `test/fixtures/png.ts` と同じ「ヘッダだけの PNG」。**画像としては開けない。**
 * 開く必要が出たら実物を置くことになるが、そのときは e2e の領分
 * （利用側が自分の絵を配って、ブラウザに実際に描かせる）。
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pngHeader } from '../test/fixtures/png.ts';

const dist = join(dirname(dirname(fileURLToPath(import.meta.url))), 'dist');

/**
 * サイズを指定して作る。**`ogp.png` だけ 1KB を超える必要がある** ――
 * `test/api/bluesky.test.ts` が「共通の絵（大きい）」と「選んだ添付（4 バイト）」を
 * 大きさで見分けているため。後ろは 0 埋めで、読まれない。
 */
function png(width, height, size = 0) {
  const header = pngHeader(width, height);
  if (size <= header.length) return header;
  const bytes = new Uint8Array(size);
  bytes.set(header);
  return bytes;
}

await mkdir(dist, { recursive: true });

await writeFile(join(dist, 'ogp.png'), png(1200, 630, 1200));
await writeFile(join(dist, 'apple-touch-icon.png'), png(180, 180));
// `.ico` は PNG ではないが、ここでも中身は読まれない（配信されるかだけを見る）。
await writeFile(join(dist, 'favicon.ico'), png(32, 32));
await writeFile(
  join(dist, 'favicon.svg'),
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><rect width="16" height="16" /></svg>\n',
);

console.log(`テスト用の静的アセットを ${dist} に置いた`);

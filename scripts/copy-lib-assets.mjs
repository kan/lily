/**
 * `tsc` が運ばないものを `dist/lib` へ運ぶ。**いまは標準テーマの CSS 1 本だけ。**
 *
 * 標準テーマは `import style from './style.css'` で書いてあり、その import は
 * emit された `.js` にそのまま残る（利用側の wrangler が `rules` の Text で
 * 文字列にする）。`tsc` は `.css` を出力へコピーしないので、隣に置く手が要る。
 *
 * **拾い方をハードコードしない。** `src/` 以下の `.css` を全部運ぶので、
 * テーマを増やしたり CSS を分けたりしたときにここを直さずに済む
 * （`src/admin` は vite の持ち物なので除く）。
 */
import { cp, mkdir, readdir } from 'node:fs/promises';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const src = join(root, 'src');
const out = join(root, 'dist', 'lib');

const entries = await readdir(src, { withFileTypes: true, recursive: true });
const sources = entries
  .filter((entry) => entry.isFile() && entry.name.endsWith('.css'))
  .map((entry) => relative(src, join(entry.parentPath, entry.name)))
  // 管理画面は別ビルド (vite → dist/admin)。ここから運ぶと二重になる。
  .filter((path) => !path.startsWith(`admin${sep}`));

if (sources.length === 0) {
  // 1 本も無いのは「テーマを消した」か「`src/` の置き場所が変わった」のどちらか。
  // 黙って 0 件で終わると、CSS の無いパッケージがそのまま publish される。
  throw new Error(`${src} に .css が 1 つも無い。src/ の中身を確かめること`);
}

await Promise.all(
  sources.map(async (path) => {
    const target = join(out, path);
    await mkdir(dirname(target), { recursive: true });
    await cp(join(src, path), target);
  }),
);

console.log(`dist/lib へ運んだ: ${sources.join(', ')}`);

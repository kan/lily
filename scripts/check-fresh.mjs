/**
 * **`dist/lib` の中身が `src/` より新しいか。** 古ければ理由を、揃っていれば
 * `null` を返す。
 *
 * `exports` が `dist/lib` を指すので、`file:` で参照している利用側から見ると、
 * lily の `.ts` を直してもビルドし直すまでは 1 バイトも届かない ―― **古い成果物に
 * 対して型検査もテストも通り、変更が検証されない。** `dist/admin` で同じことを
 * 踏んでいる（中断した vite build の残骸がそのまま配られた）。
 *
 * **利用側ではなく lily がこれを持つ。** 「`src/` の何が `dist/` のどこに出るか」は
 * `tsconfig.build.json`（`rootDir` / `outDir` / `exclude`）と
 * `copy-lib-assets.mjs`（運ぶ拡張子）と `vite.config.ts`（管理画面）が決めていて、
 * どれも lily の持ち物。利用側に写すと、運ぶものを増やした日にあちらだけ古くなる。
 *
 * **`src/core` を直したときの `dist/admin` までは見ない。** 管理画面は core の値も
 * 読むので厳密には古くなるが、そこまで見ると `build:lib:watch`（`dist/lib` しか
 * 出し直さない）を回しているあいだじゅう落ちる。拾えるのは「管理画面を直して
 * ビルドし直していない」までで、それが実際に踏んだ形。
 *
 * **パッケージには入らない**（`files` は `dist/lib` / `dist/admin` / `migrations`
 * だけ）。npm から入れた木には比べる相手の `src/` も無いので、そもそも出番がない。
 */
import { readdir, stat } from 'node:fs/promises';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const src = join(root, 'src');
const out = join(root, 'dist', 'lib');
const adminSrc = join(src, 'admin');
const adminOut = join(root, 'dist', 'admin');

/** @returns {Promise<string | null>} 古ければその理由、揃っていれば null。 */
export async function staleReason() {
  const entries = await readdir(src, { withFileTypes: true, recursive: true });

  const pairs = entries
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name))
    // **管理画面は 1 対 1 で比べられない**（vite が名前にハッシュを入れて
    // まとめる）ので、`src/admin/` 以下はまとめて `dist/admin/index.html` と
    // 突き合わせる。あれは毎回のビルドで書き直される。
    .map((source) => ({
      source,
      built: source.startsWith(adminSrc + sep) ? join(adminOut, 'index.html') : builtFrom(source),
    }))
    .filter((pair) => pair.built !== null);

  // **`stat` は並列、判定は順番どおり。** ファイルごとに await すると 90 回分の
  // 往復が直列に積もるが、`Promise.all` の中で落とすと**どのファイルの名前が
  // 理由に出るかが実行ごとに変わる。**
  //
  // 同じパスは 1 回しか見ない。管理画面のソースは全部が同じ
  // `dist/admin/index.html` を指すので、素直に並べると同じ `stat` を 20 回近く
  // 投げることになる。
  const mtimes = await mtimeMap(pairs.flatMap(({ source, built }) => [source, built]));

  for (const { source, built } of pairs) {
    const builtAt = mtimes.get(built);
    if (builtAt === null) return `ビルド成果物が無い (${built})`;
    if (mtimes.get(source) > builtAt) return `${built} が ${source} より古い`;
  }
  return null;
}

/** パス → mtime（無ければ `null`）。**同じパスは 1 回しか `stat` しない。** */
async function mtimeMap(paths) {
  const unique = [...new Set(paths)];
  const times = await Promise.all(
    unique.map((path) =>
      stat(path).then(
        (info) => info.mtimeMs,
        () => null,
      ),
    ),
  );
  return new Map(unique.map((path, i) => [path, times[i]]));
}

/**
 * `src/` のファイルに対応する `dist/lib/` の成果物。**対応が無ければ `null`。**
 *
 * `.ts` は `tsc` が `.js` にして出し、`.css` は `copy-lib-assets.mjs` がそのまま
 * 運ぶ。`.d.ts` は emit されない（型だけなので、古くなりようがない）。
 * `src/admin` はここへ来ない（呼ぶ側が `dist/admin/index.html` と突き合わせる）。
 *
 * **比べるのは 1 対 1。**「`src` の最新」と「`dist` の最古」を比べる形にすると、
 * `build:lib:watch` が推奨手順のまま落ちる ―― `tsc --watch` は直したファイルだけを
 * 出し直すので、残りの成果物は初回ビルドの時刻に留まる。同じ理由で、消したソースの
 * 孤児（誰も触らないので mtime が固定される）にも引っかからない。
 */
function builtFrom(source) {
  const path = relative(src, source);
  if (path.endsWith('.d.ts')) return null;
  if (path.endsWith('.ts')) return join(out, `${path.slice(0, -3)}.js`);
  if (path.endsWith('.css')) return join(out, path);
  // 知らない種類が増えたときは黙って見逃さない（運ぶ手が要るかもしれない）。
  throw new Error(
    `鮮度を比べる先が分からないファイルが ${src} にある (${source})。` +
      'dist/lib へ出るものなら、この対応表に足すこと。',
  );
}

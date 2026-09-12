#!/usr/bin/env node
/**
 * 配信する静的アセットを 1 つのディレクトリにまとめる。
 *
 *   lily-assets <出力先> [コピー元...]
 *   lily-assets dist public
 *
 * `wrangler.jsonc` の `assets.directory` はプロジェクトに 1 つしか持てないので、
 * **利用側の静的ファイルと lily が同梱する管理画面をここで合流させる。**
 *
 * **これを lily が配るのは、場所を知っているのが lily だからである。** 管理画面の
 * ビルド成果物は `dist/admin`、ビルドできているかの判定は `index.html` の有無、
 * ローカルの木へ向けているときの鮮度は `scripts/check-fresh.mjs` —— どれも
 * lily の都合で、利用側に写させると lily が形を変えた日にそちらが黙って古くなる。
 *
 * **管理画面はビルドしない。** lily がパッケージに `dist/admin` を入れて配るので、
 * 利用側に Vue のツールチェインは要らない。
 */
import { cp, mkdir, rm, stat } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const lily = dirname(dirname(fileURLToPath(import.meta.url))); // `<パッケージ>/bin/` の 1 つ上。

const [out, ...sources] = process.argv.slice(2);
if (out === undefined) fail('usage: lily-assets <out-dir> [source-dir...]');

const outDir = resolve(process.cwd(), out);
// **消す前に場所を確かめる。** 下でディレクトリごと消すので、作業ディレクトリの
// 外や作業ディレクトリそのものを渡されたら止める（`lily-assets .` の打ち間違い）。
const inside = relative(process.cwd(), outDir);
if (inside === '' || inside.startsWith('..')) {
  fail(`the output directory is not inside the working directory: ${outDir}`);
}

await checkAdmin();

// 前回の成果物を捨ててから作る。**上書きだけだと古いものが残る** —— 管理画面の
// アセットはファイル名にハッシュが入るので、lily を上げるたびに使われない
// バンドルが積もり、そのままデプロイで上がっていく。
await rm(outDir, { recursive: true, force: true });
await mkdir(outDir, { recursive: true });

for (const source of sources) {
  const from = resolve(process.cwd(), source);
  if (!(await isDirectory(from))) {
    // **止めない。** 配る静的ファイルを 1 つも持たない deployment は普通にある
    // （lily は絵を 1 枚も持たないので、何を配るかは利用側が決める）。
    console.info(`lily-assets: no ${source} directory, skipped`);
    continue;
  }
  // **渡された順に重ねる。** 同じ名前があれば後のものが勝つ。
  await cp(from, outDir, { recursive: true });
}

await cp(join(lily, 'dist', 'admin'), join(outDir, 'admin'), { recursive: true });

console.info(`lily-assets: wrote ${outDir} (lily: ${lily})`);

/**
 * 管理画面が配れる状態か。**素通しさせない。**
 *
 * ここを通らないと、失敗するのは後ろ（`wrangler` の bundle か `<mount>/admin/`）で、
 * どちらも原因が読めない形で出る。
 */
async function checkAdmin() {
  // **`index.html` まで見る。** ディレクトリの有無だけだと、中断した vite build や
  // 古い成果物が残っているときに通ってしまい、空の管理画面がそのまま配られる。
  const entry = join(lily, 'dist', 'admin', 'index.html');
  if (!(await exists(entry))) {
    fail(
      `the admin UI build is missing (${entry}). If @kanf/lily points at a local tree ` +
        '(file: or npm link), run `npm install && npm run build` there first. ' +
        'If it comes from npm as usual, run `npm ci` again.',
    );
  }

  // **`dist/lib` が `src/` より古くないこと。** 判定は lily の中にある
  // （何がどこに出るかはビルド設定が決めることで、写すと古くなる）。
  // `scripts/` はパッケージに入らないので、これがあるのはローカルの木へ
  // 向けているあいだだけ。npm から入れた木には比べる相手の `src/` も無い。
  const checker = join(lily, 'scripts', 'check-fresh.mjs');
  if (!(await exists(checker))) return;
  let reason;
  try {
    const { staleReason } = await import(pathToFileURL(checker).href);
    reason = await staleReason();
  } catch (error) {
    // **素のスタックトレースを出さない。** この検査は lily 側の都合で落ちることが
    // あり（知らない拡張子を `src/` に足した等）、そのとき利用側に読めるのは
    // 「lily のビルドを確かめられなかった」まで。
    fail(`could not check whether dist/lib is up to date (${message(error)})`);
  }
  // 理由は lily 側が日本語で組む（これが出るのは lily の木を触っている人だけ）。
  if (reason !== null) fail(`${reason}。あちらで \`npm run build:lib\` を回すこと。`);
}

async function statOrNull(path) {
  try {
    return await stat(path);
  } catch {
    return null;
  }
}

async function exists(path) {
  return (await statOrNull(path)) !== null;
}

async function isDirectory(path) {
  return (await statOrNull(path))?.isDirectory() ?? false;
}

function message(error) {
  return error instanceof Error ? error.message : String(error);
}

function fail(reason) {
  console.error(`lily-assets: ${reason}`);
  process.exit(1);
}

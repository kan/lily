/**
 * 雛形の `.gitignore` を、**パッケージに入る名前で**隣に置く。
 *
 * **npm は `.gitignore` をパッケージに入れない**（`files` に挙げても落とされる）。
 * 落ちたことに気付かないと、`lily init` が作った木には無視の設定が無く、
 * **`node_modules/` も `dist/` も、手元の secret（`.dev.vars`）も commit される。**
 *
 * repo の側は `.gitignore` のままでないと困る（Deploy to Cloudflare のボタンは
 * GitHub の `template/` をそのまま新しい repo にする）ので、**配るとき用の複製**を
 * 作る。書き出す側（`bin/lily.mjs`）が `.gitignore` に戻す。
 *
 * `prepack` から走る。**生成物なので git には入れない。**
 */
import { copyFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const template = join(root, 'template');

await copyFile(join(template, '.gitignore'), join(template, 'gitignore'));

console.log('template/gitignore を作った (パッケージに入る名前)');

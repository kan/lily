/**
 * 前のビルドの `dist/lib` を捨てる。**`tsc` は出力先を掃除しない。**
 *
 * `src/core/foo.ts` を消したり改名したりすると `dist/lib/core/foo.js` が孤児として
 * 残り、**以後どのビルドもそれに触らない。** そのまま `files` に載って npm へ
 * 同梱されるし、利用側が「まだあるもの」として import できてしまう。
 *
 * `dist/admin` は消さない（別ビルドの持ち物で、vite が `emptyOutDir` で面倒を見る）。
 */
import { rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const out = join(dirname(dirname(fileURLToPath(import.meta.url))), 'dist', 'lib');
await rm(out, { recursive: true, force: true });
console.log(`${out} を捨てた`);

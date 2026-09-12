/**
 * `bin/` の 2 つが共有する小物。**コマンドではない**ので `package.json` の `bin` に
 * 載っていないが、`files` は `bin` ごと配るので一緒に入る。
 *
 * 置いてあるのは「落ち方」と「自分の居場所」だけ。どちらも**間違えると黙って
 * 通ってしまう**たぐいの処理なので、2 つに写して片方だけ直る形にしない。
 */
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';

/** `<パッケージ>/bin/<file>` から、パッケージの根を出す。 */
export function packageRoot(moduleUrl) {
  return dirname(dirname(fileURLToPath(moduleUrl)));
}

/** 投げられたものを 1 行にする。**素のスタックトレースを出さないため。** */
export function message(error) {
  return error instanceof Error ? error.message : String(error);
}

/**
 * 理由を言って落ちる関数を作る。**コマンド名を頭に付ける** —— 利用側の
 * `npm run build` の出力に混ざるので、どこから出た行なのかが分からないと困る。
 */
export function failWith(command) {
  return (reason) => {
    console.error(`${command}: ${reason}`);
    process.exit(1);
  };
}

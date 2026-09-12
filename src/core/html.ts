/**
 * hono の `html` を文字列にする。
 *
 * **`html` は差し込みに Promise が 1 つでも混ざると Promise を返す。** 素の
 * `String()` に掛けると、そのとき配るのは `[object Promise]` —— 画面には壊れた
 * HTML が出るだけで、どこから来たのかは分からない。
 *
 * core が組む HTML（ログイン画面とリンクカード）はどれも同期なので、Promise が
 * 来たらそこで落とす。**黙って壊れたものを配らない**のが眼目で、`as` で型だけ
 * 合わせるのとはそこが違う。
 */
import type { html } from 'hono/html';

type Html = ReturnType<typeof html>;

export function renderHtml(value: Html): string {
  if (value instanceof Promise) {
    throw new TypeError('html`` に Promise が差し込まれた（core が組む HTML は同期）');
  }
  // **`typeof` では判定できない。** hono が返すのは文字列の primitive ではなく、
  // 目印（`isEscaped`）を付けた String オブジェクトなので `typeof` は 'object'。
  return String(value);
}

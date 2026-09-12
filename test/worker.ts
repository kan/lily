/**
 * `wrangler.jsonc` の `main`。**中身は使わない。**
 *
 * vitest のプール (`@cloudflare/vitest-plugin`) は workerd を起こすのに
 * エントリを 1 つ要求するが、テストは `createLily()` でアプリをその場で組むので、
 * ここが呼ばれることはない。lily は npm パッケージであって deployment ではない。
 */
export default {
  fetch(): Response {
    return new Response('lily test worker', { status: 500 });
  },
} satisfies ExportedHandler;

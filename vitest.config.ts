import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';

// テストは実際の workerd 上で動かす。D1 の CHECK / STRICT / 部分ユニーク索引が
// 効いていることまで見たいので、SQLite を別実装で代用しない。
//
// migrations/ を読んでバインディング経由でテスト側へ渡し、setup で各テストの
// D1 に適用する。スキーマの正は migrations/*.sql の 1 箇所だけ。
const migrations = await readD1Migrations('./migrations');

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './wrangler.jsonc' },
      // 名前の正は `src/test-support.ts` の `TEST_MIGRATIONS_BINDING`。
      // **設定は Node で動く**ので、`cloudflare:test` を import するあちらを
      // ここから読めない（文字列は 2 箇所にあるが、ずれたら受け取る側が落ちる）。
      miniflare: { bindings: { TEST_MIGRATIONS: migrations } },
    }),
  ],
  test: {
    include: ['test/**/*.test.ts'],
    setupFiles: ['./test/apply-migrations.ts'],
    // **既定の 5 秒では足りない。** ここのテストは実 workerd の上で実 D1 /
    // 実 R2 / 実 Images を叩くので、1 件あたりの往復が実測で数十 ms あり、
    // 下ごしらえに数十件の記事を作るものは素で 5 秒に届く (ページングと
    // フィードの上限、画像の形式交渉が実機で落ちた)。件数を減らすと上限を
    // 確かめられなくなり、まとめて作ろうとすると D1 が競合してかえって遅くなる。
    // 止まったものを検知する網としては 30 秒でも十分に細かい。
    testTimeout: 30_000,
  },
});

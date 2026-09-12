import { applyTestMigrations } from '../src/test-support.ts';

// 利用側と同じ口を通す。ここだけ別実装にすると、`test-support` が壊れたことに
// 利用側のテストが落ちるまで気付けない。
await applyTestMigrations();

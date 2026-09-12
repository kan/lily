/**
 * lint の設定。**型検査（`tsc`）が見ないものだけを見る。**
 *
 * `tsconfig.json` は既に `strict` / `noUnusedLocals` / `noUnusedParameters` /
 * `noUncheckedIndexedAccess` を掛けている。ここで重ねても増えるのはノイズだけなので、
 * 足すのは**型情報を使う規則**（await 漏れ・floating した Promise・`any` の伝播・
 * 意味の無い型アサーション）と、Vue の template のように `tsc` の外にあるものに限る。
 *
 * **型情報を引くのは Worker 側（`src/` と `test/`）だけ。** 管理画面は `.vue` を
 * 読む必要があり、あれは `tsconfig.admin.json` の `include` に載らない
 * （型を見るのは `vue-tsc`）。無理に型情報を引くと `import App from './App.vue'` が
 * 「解決できない型」になり、そこから出る `no-unsafe-*` がすべて偽陽性になる。
 * 管理画面は構文の規則だけで見る。
 */
import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import vue from 'eslint-plugin-vue';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/** `_` で始まる引数は「受け取るが使わない」の明示。契約で決まった署名に要る。 */
const noUnusedVars = [
  'error',
  { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' },
];

export default defineConfig(
  globalIgnores([
    'dist/**',
    '.wrangler/**',
    // どちらも wrangler の生成物（git 管理外）。
    'worker-configuration.d.ts',
    'build-types.d.ts',
  ]),

  // ビルドと開発の道具。Node で走る素の JS。
  {
    files: ['**/*.mjs', 'eslint.config.js'],
    extends: [js.configs.recommended],
    languageOptions: { globals: globals.nodeBuiltin },
  },

  // Worker 側。**型情報を使う。**
  {
    files: ['**/*.ts'],
    ignores: ['src/admin/**', 'vite.config.ts', 'template/**'],
    extends: [js.configs.recommended, tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.json'],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // `verbatimModuleSyntax` の下では、型を値として import したかが emit に出る。
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': noUnusedVars,

      // **戻り値が Promise だと契約で決まっている実装**（`AuthAdapter.authenticate`
      // など）は、中身が同期でも async で書く。外すと呼び出し側の型が変わる。
      '@typescript-eslint/require-await': 'off',

      // **制御文字を弾くのが仕事の正規表現がある**（記事パスの正規化、frontmatter の
      // 検査）。書いてあること自体が意図。
      'no-control-regex': 'off',

      // 日本語の文書に全角スペースが入るのは普通で、CJK の範囲を書く正規表現は
      // U+3000（全角スペース）から始まる。**コードの中だけ見る。**
      'no-irregular-whitespace': [
        'error',
        { skipComments: true, skipTemplates: true, skipRegExps: true },
      ],
    },
  },

  // テスト。**`any` の伝播だけ見ない。**
  //
  // `await res.json()` は `any` で、それに assert するのがテストの仕事。型を付けて
  // 回ると「本体の型が正しいか」ではなく「テストに書いた型が正しいか」を見ることに
  // なり、本体の型が変わっても気付けない。実害のある規則（floating した Promise・
  // 意味の無いアサーション）は付けたまま。
  {
    files: ['test/**/*.ts'],
    rules: {
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
    },
  },

  // 管理画面（`.ts` と `.vue`）とそのビルド設定、それと利用側のテンプレート。
  // **構文の規則だけ。** テンプレートは自分の `tsconfig.json` と `Env`（`wrangler
  // types` の生成物）を持つ別プロジェクトなので、lily の型情報からは見えない。
  {
    files: ['src/admin/**/*.{ts,vue}', 'vite.config.ts', 'template/**/*.ts'],
    // **`flat/essential` まで。** その上（`flat/recommended`）の大半は整形の規則
    // （属性を 1 行に何個まで、など）で、このリポジトリはフォーマッタを入れていない。
    // 機械が決めた形を人手で揃える仕事にしかならない。
    extends: [js.configs.recommended, tseslint.configs.recommended, vue.configs['flat/essential']],
    languageOptions: {
      parserOptions: { parser: tseslint.parser },
      globals: globals.browser,
    },
    rules: {
      '@typescript-eslint/no-unused-vars': noUnusedVars,
      // 管理画面のコンポーネントは全部自前で、HTML の要素名と衝突しない
      // （`<Icon>` のような 1 語を許す）。
      'vue/multi-word-component-names': 'off',
    },
  },
);

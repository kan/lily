# lily の作業メモ

**lily は npm パッケージ（`@kanf/lily`）であって deployment ではない。** リポジトリ直下の
`wrangler.jsonc` はテスト（vitest が workerd を起こす）と `wrangler types` のためだけの
もので、この Worker をデプロイすることはない。

## ドキュメントの分担

| ファイル | 言語 | 誰向け |
|---|---|---|
| `README.md` | 英語 | 使う人の入口。npm のパッケージページになる。**約 190 行に保つ** —— 何であるか・始め方（init とボタン）・機能・手元にできるもの・`docs/` への目次・変わらない 3 点 |
| `docs/*.md` | 英語 | 使う人の参照。設定 / 認証 / テーマ / 画像 / portable と控え / 既存 Worker への追加。**npm には入らない**が、README の相対リンクは npm のページで GitHub の URL に書き換わる（`package.json` の `repository` を使う。実際のページで確認済み） |
| `CONTRIBUTING.md` | 英語 | 中を直す人。コマンド・構成・踏みやすい穴・テスト・CI / リリース |
| `DESIGN.md` | 日本語 | 「なぜそうなっているか」の記録。パッケージには入らない |
| `CLAUDE.md`（これ） | 日本語 | 作業時の前提。README / CONTRIBUTING に載せるほどではない文脈 |

- **README を日本語に戻さない。** 英語にしたのは読み手を広げるため（issue #6）。
  日本語で残すのは `DESIGN.md` と、このファイル
- **README に fushihara.net 固有のものを書かない。** バケット名・`blog/src/site/`・
  あちらの E2E への依存は README から外してある（下記「利用側」）
- 英語版と日本語版の README を二重に持たない（`README.ja.md` は作らないと決めた）

## 文章の作法

`DESIGN.md` と README は「なぜそうしたか」「何を踏んだか」を書く形で揃っている。
**主張を薄めて無難な紹介文にしない。** 断定と理由をセットで書き、強調は要点にだけ使う。

## コマンド

```bash
npm test          # vitest。実 workerd + 実 D1（pretest が dist/admin を作る）
npm run typecheck # wrangler types → tsc（src と管理画面の 2 プロジェクト）
npm run lint      # eslint。型情報を使うので wrangler types が先に走る
npm run build     # build:admin（vite → dist/admin）+ build:lib（tsc → dist/lib）
npm run db:migrate:local
```

**lint は型検査と別の観点。** `tsconfig` が既に `strict` 系を掛けているので、eslint が
見るのは**型情報を使う規則**（await 漏れ・floating した Promise・`any` の伝播）と Vue の
template だけ。**フォーマッタは入れていない**ので、整形の規則も入れない（`.vue` は
`flat/essential` まで）。何を外したかと理由は `eslint.config.js` に書いてある。
規則を足したり外したりするときは、**理由をその場に書く。**

## コミット前の手順

**コードの変更を含むコミットの前に、次を順に実行する。**

1. `/code-review` —— 実害のあるバグを洗う
2. `/simplify` —— 重複・冗長・設計の深さを見て直す
3. `npm run lint && npm run typecheck && npm test`
4. ユーザーの承認を得てからコミットする

**順番に実行すること。** `/simplify` は修正を適用するので、`/code-review` と並行させると
衝突する。**ドキュメントだけの変更ならスキップしてよい。**

指摘に対応したら、**意図的に実装を壊して該当テストだけが落ちることを確認する。**
「通ったはずのテストが実は何も検証していなかった」は、利用側（fushihara.net）で
何度も起きている。

`/code-review` と `/simplify` のサブエージェントが結果を返さないことがある。その場合は
待たずに、同じ観点を自分で見て直す。

## テストの作法

- 実 workerd + 実 D1（`@cloudflare/vitest-plugin`）。モックではない
- **D1 の制約（`STRICT` / `CHECK` / `UNIQUE`）は生 SQL で叩いて確かめる。** query layer
  越しに見ても、制約が効いているかの検証にならない（`test/db/schema.test.ts`）
- **テストだけ別実装を持たない。** キーや URL の導出は本体から import する。写すと、
  決め方を変えた日にテストが「何も検証していない」側へ黙って倒れる
- **古い成果物に対して通るテストを疑う。** `dist/lib` の鮮度は `scripts/check-fresh.mjs`
  が見る（利用側が呼ぶ）

## 依存の版を止めてあるところ

理由は `.github/dependabot.yml` にある。**上げようとしない。**

- **typescript は 7.0.x を入れない。** TS 7.0 はネイティブ（Go）実装で
  `typescript/lib/tsc` を公開せず、それを require する `vue-tsc`（Volar）が
  `ERR_PACKAGE_PATH_NOT_EXPORTED` で落ちる。7.1 の PR は受け取る（可否は CI が判定する）
- **vitest は 5.x を入れない。** `@cloudflare/vitest-plugin` の peer（`vitest@^4.1.0`）と
  衝突して `npm ci` が ERESOLVE で落ちる。テストはあのプールで動いているので、
  plugin を捨てる選択肢は無い

## リポジトリの設定（GitHub 側。repo には無い）

issue #8 で入れたもの。**設定はコードに無い**ので、ここに何を ON にしたかだけ残す
（wema / roji と同じ形 + ruleset と CodeQL）。

- Dependabot の alert と security update、private vulnerability reporting、
  secret scanning と push protection。secret scanning の追加オプション
  （non-provider patterns / validity checks）は OFF
- ruleset `protect-main`: 既定ブランチの削除と force push だけを禁じる。
  **PR は強制しない**（このリポジトリは PR 運用ではなく main へ直接 push）
- code scanning は CodeQL の既定セットアップ（`actions` と `javascript-typescript`）
- Actions の `GITHUB_TOKEN` は既定 read。書き込みが要るワークフローは自分で宣言する
  （`publish.yml` の `id-token: write`）
- 報告の窓口と、何を守ると言っているか / 言っていないかは `SECURITY.md`

## 踏みやすい穴

- **`exports` が指すのは `dist/lib`。** `file:` で参照している利用側から見ると、
  `src/` を直しただけでは 1 バイトも届かない。往復するなら `npm run build:lib:watch` を
  併走させる。**`tsc --watch` は `.css` を見ない**ので、標準テーマの `style.css` を
  直したときだけ `npm run build:lib` を回す
- **ビルドしていないと vitest が動かない**（テスト用 `wrangler.jsonc` の
  `assets.directory` が `dist/` を指す）。`pretest` が作るのは `dist/admin` と
  テスト用の静的アセットだけで、**`dist/lib` は作らない**（テストは `src/` を直接読む）
- **`src/index.ts` が境界。** ここに載っていないものは利用側から読まれない前提で動かせる。
  載っているものを変えるときは、利用側のことを考える
- **利用側に写させない。** 管理画面の場所も、ビルドできているかの判定も、`dist/lib` の
  鮮度も lily の都合なので、`bin/lily-assets.mjs`（パッケージに入る）が持つ。
  利用側の `package.json` に書くのは `"build": "lily-assets dist public"` だけ
- **`template/` は利用側の最小構成**で、**パッケージにも入る**（`npx @kanf/lily init`
  がここから書き出すため。ロックだけ `files` の否定パターンで外してある）。lily を
  直したら、ここがまだ通るかを見る。確かめ方は `npm pack` → 別のディレクトリで
  `npm install <tgz>` → `npm run build && npm run typecheck && npx wrangler deploy --dry-run`
  - **init が埋める場所は `bin/lily.mjs` が名指ししている**（`replaceOnce`）。
    雛形の `config.ts` / `wrangler.jsonc` / `package.json` のその行を触ったら、
    あちらも直す。見つからなければ落ちるので、黙って既定値のまま出ることはない
  - **`npx lily init` は使えない。** npm に別人の `lily` がいる。案内するのは
    `npx @kanf/lily init`（npx はスコープを外した名前と同じ bin を選ぶ）
  - **Deploy to Cloudflare のボタンが指しているのはここ**
    （`.../lily/tree/main/template`）。Cloudflare はこのディレクトリを新しい repo の
    root として扱うので、**中だけで完結していること**（外のファイルを参照しない）
  - **`template/package-lock.json` は commit する**（ボタンの `npm ci` が要る）。
    lily を publish したら `cd template && npm install @kanf/lily@latest --package-lock-only`。
    **範囲も動かす** —— `^0.3.0` は `0.4.0` を受けないので、`npm update` だけだと
    ボタンから入る人が minor 1 つ古い lily で始まる（`init` は自分の版に書き換える
    ので、そちらは影響を受けない）
- **`migrations/` がスキーマの正。** 利用側は `node_modules/@kanf/lily/migrations` を
  `migrations_dir` で直接指す。リリースに入った migration は他人が本番の D1 に流すものに
  なるので、**追加のみで書く。** 利用側のデプロイは「マイグレーションが先、`wrangler deploy`
  が後」なので、列や表を落とすと古いコードが新しいスキーマに当たる時間ができる
  （落とすときは 2 回のリリースに分ける）
- **文言の置き場は 3 つだけ。** 標準テーマは `src/theme/text.ts`、ログイン画面は
  `src/core/auth/login-page.ts`、管理画面は `src/admin/i18n.ts`。**言語の決め方は
  `src/core/locale.ts` が 1 箇所で持つ**（公開側は設定、管理画面はブラウザ + 手動切替）。
  表は言語ごとに同じ型なので、片方だけ足すとコンパイルが通らない
- **route 名の正は `src/core/routes/fixed.ts`。** ルータ・URL 生成・予約語の 3 者が
  ここを見る。手で並べ直さない
- `wrangler.jsonc` の `rules` に `fallthrough` を付ける（付けないと既定ルールが全部消える）
- `wrangler r2 object` 系はローカルの模擬ストレージが既定。本物を見るには `--remote`

## 外せない 3 点

1. **記事の identity と URL を分離する。** identity は不変の `public_id`、URL は `post_paths`。
   旧 URL は alias として残る
2. **Markdown は deployment を知らない。** 本文に `/blog/...` を埋め込まず、画像は
   `./sample.png` の相対参照のまま保存して、公開 URL は描画時に解決する
3. **`mountPath` は第一級の設定。** URL を組むのは `core/paths.ts` だけ

## 利用側と参照実装

唯一の利用側は
[`fushihara.net/blog`](https://github.com/kan/fushihara.net/tree/main/blog)。設定の書き方・
自前テーマ・E2E はあちらにある。ただし **Cloudflare Access・Bluesky 告知・自前テーマ・
共有アセットを持っていて最小構成ではない**ので、README の説明の根拠にしない
（Deploy to Cloudflare のテンプレートは issue #3、`npx lily init` は #7）。

**テーマの実装が 2 本あることに意味がある。** `src/theme/`（標準）と向こうの `src/site/`。
テーマが 1 つしか無いあいだは、core が本当にテーマから独立しているかを確かめる方法がない。
実際、切り出す前は core のテストが fushihara.net のテーマを読んでいた（「core に `/blog`
が焼き付いていない」ことを見るためのテストが、である）。

**`test/` から利用側が 1 つも見えない状態を保つ。** E2E は利用側が持っていて、公開 URL と
フィードが変わっていないことはあちらが判定する。lily を入れ替えてもあれが通ることが、
外向きの契約を守れている証拠になる。

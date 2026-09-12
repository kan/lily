# lily の作業メモ

**lily は npm パッケージ（`@kanf/lily`）であって deployment ではない。** リポジトリ直下の
`wrangler.jsonc` はテスト（vitest が workerd を起こす）と `wrangler types` のためだけの
もので、この Worker をデプロイすることはない。

## ドキュメントの分担

| ファイル | 言語 | 誰向け |
|---|---|---|
| `README.md` | 英語 | 使う人。npm のパッケージページになる。機能・入れ方・設定・公開 API・テーマ・認証・画像・portable・控え |
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
npm run build     # build:admin（vite → dist/admin）+ build:lib（tsc → dist/lib）
npm run db:migrate:local
```

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
- **`migrations/` がスキーマの正。** 利用側は `node_modules/@kanf/lily/migrations` を
  `migrations_dir` で直接指す。リリースに入った migration は他人が流すものになる
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

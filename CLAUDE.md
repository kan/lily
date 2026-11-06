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

1. **変更の規模に応じてレビューを回す**

   | 規模 | 目安 | 手順 |
   |---|---|---|
   | 大規模 | 新しいモジュールや機構の追加、複数ファイルにまたがる構造の変更 | `/simplify` → `/code-review medium` |
   | 中規模 | 既存の構造の中でのロジックの追加や変更 | `/code-review medium` のみ |
   | 小規模 | 数行の修正、定数や文言の変更、分岐が増えない修正 | スキップ可 |

   - **`/code-review` には effort を必ず `medium` と明示する。** 省くと最後に指定した
     レベルが引き継がれ、検査の深さが過去の使い方で変わるため
   - **`--fix` を付けない。** 指摘は 1 件ずつ採否を決めて自分で反映し、採らなかった
     指摘は理由を添えてユーザーに報告する
2. `npm run lint && npm run typecheck && npm test`
3. **利用者に届く変更は、同じコミットで `CHANGELOG.md` の `## [Unreleased]` に書く。**
   この節がそのままリリースノートになる（「リリース手順」）。リリースの時に
   まとめて書かない。英語で、利用者に向けて書く（commit の羅列にしない）
4. ユーザーの承認を得てからコミットする

**`/simplify` と `/code-review` は必ず直列で実行する。並列で起動しない。**
`/simplify` の書き換えが終わってから `/code-review` を起動する。`/code-review` を後に
するのは、書き換えが済んだ最終形のコードをバグの観点で見るため。並列に動かすと、
書き換え前のコードを見ることになり、`/simplify` が入れた不具合も見逃す。
**ドキュメントだけの変更なら 1 と 2 はスキップしてよい**（3 と 4 は省かない）。

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
  PR を ruleset では強制していないが、**運用は PR**（下の「PR 運用」）
- **「Allow GitHub Actions to create and approve pull requests」は ON。** tagpr が
  GITHUB_TOKEN でリリース PR を作るのに要る（GitHub App は作っていない）
- code scanning は CodeQL の既定セットアップ（`actions` と `javascript-typescript`）
- Actions の `GITHUB_TOKEN` は既定 read。書き込みが要るワークフローは自分で宣言する
  （`publish.yml` の `id-token: write`、`tagpr.yml` のジョブごとの権限）
- 報告の窓口と、何を守ると言っているか / 言っていないかは `SECURITY.md`

## action の固定

**action の固定は `.github/workflows/actions.lock`（`gh actions-lock` が作る）に任せる。**
PR と main への push で、`verify-lockfile.yml` が lockfile と `uses:` の食い違いを見る。
形は kan/tagpr-scripts#7 で各 repo に揃えたもの。

- `uses:` は完全な版のタグ（`@v7.0.1`）で書き、**SHA は書かない。** 付け替えられた
  タグも、lockfile が記録した commit で動く
- `uses:` を足したり変えたりしたら `gh actions-lock` を再実行し、**lockfile も同じ
  コミットに入れる。lockfile は手で編集しない。** 食い違ったコミットは
  `verify-lockfile.yml` が落とす。実行時には Actions がジョブを起動しない
- Dependabot は Actions の更新 PR で lockfile の該当行も作り直す
- 検査が入れる拡張の版（`verify-lockfile.yml` の `--pin`）は、Dependabot と lockfile の
  どちらも追わない。lockfile の形式が上がって `--verify` が落ちたら、手元の
  `gh actions-lock` と同じ版に手で上げる
- 別の repo の reusable workflow を呼ぶ行（`jobs.<id>.uses`）は lockfile では固定され
  ない。commit の SHA で書く。今あるのは `tagpr.yml` が kan/tagpr-scripts の共通の
  workflow を呼ぶ行だけで、SHA は subtree と揃える（「リリース PR（tagpr）の仕組み」）。
  その中の action（tagpr など）は tagpr-scripts の `actions.lock` が固定する

## PR 運用

**変更はブランチを切って PR にし、マージして main に入れる**（tagpr へ移った
2026-11 から。それまでは main へ直接 push していた）。**main へ直接 push しない。**
ruleset では強制していないので、守るのは手順の側。

- ブランチの push と PR の作成は、ユーザーの承認を得てから行う
- マージは squash。**例外は `scripts/tagpr/` の subtree を取り込む PR で、マージコミットに
  する**（「リリース PR（tagpr）の仕組み」）
- CHANGELOG はその PR の中で書く（「コミット前の手順」の 3）
- **次のリリースを minor にする PR には `enhancement` ラベルを付ける。** tagpr が
  マージ済みの PR のラベルを見て、リリース PR に `tagpr:minor` を付ける（`.tagpr` の
  `minorLabels`）。付いていなければ patch
- dependabot の PR も同じくマージで入れる。依存の更新は利用者に届かないものが
  多いので、CHANGELOG に書くかは中身で決める（脆弱性の修正や、`template/` の
  依存のように利用者の手元に入るものは書く）。ただし**リリース後に template の
  lily だけを上げる PR は書かない**（その版のことはその版の節に書いてある。
  「リリース手順」の 4）

## リリース手順

**リリースは tagpr のリリース PR をマージして始める**（0.5.2 の次の版から）。
版上げ（`package.json` / `package-lock.json`）、`CHANGELOG.md` の見出し、タグは
リリース PR とワークフローが行う。**`npm version` を手で回さない。タグも手で
打たない**（打ち直すときを除く。下の「やり直し」）。

1. **リリース PR を確かめる**

   ```bash
   gh pr list --label tagpr --state open --json number,title,headRefName
   gh run list --workflow tagpr.yml --branch main -L 3
   ```

   - **最新の tagpr の run が success であること。** 失敗した run はリリース PR を
     draft にする（次に成功した run が ready に戻す）。失敗していたら
     `scripts/tagpr/release-prepare.mjs` の出力を読む。多いのは `## [Unreleased]` が
     空のとき。CHANGELOG を書く PR をマージすると作り直される。
     「already has `## [X.Y.Z]`」で落ちていたら、前のリリース PR のタグが打たれて
     いない（下の 3）
   - **版（PR のタイトル）が正しいこと。** 既定は patch。`enhancement` の PR が
     入っていれば minor になる。手で変えるときはリリース PR にラベルを付けて
     作り直す

     ```bash
     gh pr edit <番号> --add-label tagpr:minor
     gh workflow run tagpr.yml --ref main
     ```

   - Files changed が `package.json` / `package-lock.json`（版の行だけ）と
     `CHANGELOG.md`（見出しとリンク定義）だけであること
   - **ラベルを付け外ししたら、作り直してからマージする。** タグの版はマージの
     時点の `package.json` で決まり（tagpr は `versionFile` をマージ時に読む）、
     `package.json` と CHANGELOG の見出しは最後に作り直した時点の版のまま。
     作り直さずにマージすると、**ラベルの版ではなく前の版がそのまま出る**
     （どこも食い違わないので、何も止まらない）
   - リリース PR の CI は承認待ち（`action_required`）で止まることがある
     （GITHUB_TOKEN が作った PR のため）。そのときは今の head の run を承認する
     （`gh api -X POST repos/kan/lily/actions/runs/<id>/approve`）

2. **CHANGELOG の節を確かめる**

   **この節がそのまま GitHub のリリースノートになる。** 前回のタグからの変更と
   突き合わせ、利用者に届く変更が載っているかを見る。直すときはリリース PR の
   ブランチではなく、**main の `## [Unreleased]` を直す PR を入れる**（ブランチは
   tagpr が作り直すたびに main から作られる）。

   ```bash
   git fetch origin
   git show origin/<ブランチ>:CHANGELOG.md | sed -n '1,60p'
   git log --oneline <前回のタグ>..origin/main
   ```

   見出しの日付は、tagpr が最後にリリース PR を作り直した日（日本時間）。
   マージする日と違えば `gh workflow run tagpr.yml --ref main` で作り直す。

3. **リリース PR をマージする**

   ```bash
   gh pr merge <番号> --squash --delete-branch
   git switch main && git pull --ff-only
   gh run list --workflow tagpr.yml --commit "$(git rev-parse HEAD)" -L 1
   gh run list --workflow publish.yml -L 1
   ```

   マージの push で走る tagpr の run がマージコミットにタグを打ち（annotated に
   打ち直す）、同じ run が `publish.yml` をそのタグで起動する。**タグが打たれるまで main へ
   何もマージしない。** tagpr の run は前の run が終わるまで待ち、待っている run は
   新しい push の run に置き換えられる（cancelled になる）。置き換えられたら、
   マージコミットの run を `gh run rerun <run-id>` で再実行するとタグが打たれる。
   置き換えた側の run は「already has `## [X.Y.Z]`」で赤になる（版だけ上がった
   リリース PR が draft で残ることがある。draft を手で外さず、マージもしない。
   タグを打つ run は ready に戻さないので、その後に通った push の run が作り直して戻す）。

   リリースの直後は `## [Unreleased]` が空なので、次に CHANGELOG を書くまで
   main への push ごとに tagpr の run が失敗する。これは想定どおりで、その間の
   リリース PR はマージしない。

4. **確認と後始末**
   - `publish.yml` の run が通り、npm（`npm view @kanf/lily version`）と
     GitHub Release に新しい版があること。Release の本文が CHANGELOG の節であること
   - **template の lock を上げる PR を入れる。** コマンドと範囲の理由は「踏みやすい穴」の
     `template/package-lock.json` の項。リリース PR に入れられないのは、準備の時点では
     その版が npm に無いため。
     CHANGELOG には書かない（このマージで走る tagpr の run は上のとおり失敗する）

**やり直し**

- `publish.yml` が npm へ出す前に落ちたら、直してから
  `gh workflow run publish.yml --ref vX.Y.Z` で起動し直す
- **やり直す前に `npm view @kanf/lily@X.Y.Z version` で npm に出たかを見る。**
  `publish` ジョブが赤でも、npm には届いていることがある（応答の前に切れたとき）
- npm へは出て Release の作成（`release` ジョブ）だけが落ちたら、
  `gh run rerun <run-id> --failed` で落ちたジョブだけをやり直す。**run 全体を
  再実行しない**（`publish` ジョブも走り、同じ版は publish できずに落ちる）。
  `publish` が赤なのに npm に出ていたときや、artifact の保持期間（7 日）を
  過ぎていたら、
  `node scripts/tagpr/release-notes.mjs vX.Y.Z > notes.md` から
  `gh release create vX.Y.Z --title vX.Y.Z --verify-tag --notes-file notes.md` を手で回す
- **`publish.yml` はタグの指すコミットで動く。** npm へ出る前に落ちた原因が
  コードや CHANGELOG にあるなら、直した PR をマージしてタグを打ち直す
  （`git push origin :refs/tags/vX.Y.Z && git tag -d vX.Y.Z` で消し、直した
  マージコミットに **annotated で**打って push する。
  `git tag -a -m "Release vX.Y.Z" vX.Y.Z <コミット>`。`push: tags` で起動する）。CHANGELOG は
  main ではもう `## [X.Y.Z] - 日付` になっている節を直す。**タグを消している間に
  main へ入ると、その tagpr の run は「already has `## [X.Y.Z]`」で赤になり、
  版だけ上がったリリース PR が残ることがある。** そのリリース PR はマージせず、
  タグを打ち直した後に閉じる。打ち直しが済むまで他の PR はマージしない
  （まだ踏んでいない手順なので、初回はリリース PR の状態を見ながら進める）
- **npm へ出た版は打ち直せない**（同じ版は二度と publish できない）。次の版で直す

### リリース PR（tagpr）の仕組み

- **main に push があるたびに `tagpr.yml` がリリース PR を作り直す。** ブランチは
  `tagpr-from-v<前回の版>`。マージすると、次の run がマージコミットにタグを打つ。
  設定は `.tagpr`
- **`tagpr.yml` は kan/tagpr-scripts の共通の workflow を呼ぶだけ**（kan/tagpr-scripts#6）。
  tagpr のジョブ、落ちた run での draft、タグを annotated に打ち直すこと、
  `publish.yml` の起動はそちらにある。動きと落ちたときの扱いは、tagpr-scripts の README の
  「The tagpr workflow」
- **版は `package.json` で持つ**（`versionFile`）。**tagpr は `package-lock.json` を
  書き換えない**（版のファイルとして扱わない一覧に入っている）ので、
  `scripts/tagpr/release-prepare.mjs`（`postVersionCommand`）が揃える
- **`release-prepare.mjs` は `## [Unreleased]` を `## [X.Y.Z] - 日付` にし、その上に
  空の `## [Unreleased]` を置き直し、末尾のリンク定義の先頭にその版のリンクを足す。**
  検査をすべて済ませてから書き、落ちるときは何も書き換えない。落ちるのは
  `## [Unreleased]` が無いか空か重複しているとき、`## [X.Y.Z]` が既にあるとき
  （タグが打たれていない）、`package.json` の版や `repository` が合わないとき。
  失敗しても tagpr は版だけ上げたリリース PR を作る。その PR は共通の workflow が draft に
  するが、**run が赤ならマージしない**
- **tagpr のジョブでは依存のコードを走らせない。** リポジトリへ push できる
  トークンを持つため。`npm ci` をせず、`scripts/tagpr/` は Node の組み込み
  だけで書く。tagpr の action は tagpr-scripts の `actions.lock` が固定する（「action の固定」）
- **CHANGELOG と GitHub の Release は tagpr に作らせない**（`changelog = false` /
  `release = false`）。tagpr の CHANGELOG は PR のタイトルを並べるだけ。Release は
  `publish.yml` が npm publish の**後**に作る（publish に失敗した版の Release を
  残さない）
- **CHANGELOG の読み方（節の見出し、コードフェンス、末尾のリンク定義）は
  `scripts/tagpr/changelog.mjs` の 1 か所に置く。** `release-prepare.mjs` と
  `release-notes.mjs` はそれを import する。2 か所に書くと、リリース PR は通るのに
  `publish.yml` の検査で落ちる
- **`scripts/tagpr/` は [kan/tagpr-scripts](https://github.com/kan/tagpr-scripts) の
  git subtree**（wema / wema-kake と共有）。**ここでは編集しない。** upstream を直して
  から取り込む

  ```bash
  git subtree pull -S --prefix=scripts/tagpr https://github.com/kan/tagpr-scripts.git main --squash
  ```

  - **`-S` を付ける。** subtree は `commit-tree` でコミットを作るので、`commit.gpgsign`
    が効かず未署名になる
  - **同じ PR で、`tagpr.yml` の `uses: kan/tagpr-scripts/...@<SHA>` を取り込んだ
    tagpr-scripts の commit に上げる。** squash のコミットのメッセージにある
    `git-subtree-split` の SHA（lily の squash やマージのコミットの SHA ではない）
  - **この PR だけはマージコミットで入れる**（`gh pr merge <番号> --merge`）。
    subtree は前回の取り込みを自分のコミットから探すので、squash すると次の pull が
    壊れる
  - 取り込む PR は CHANGELOG に書かない（利用者に届かない）
- **`publish.yml` は `workflow_dispatch` でタグを ref にして起動する**（共通の workflow
  の `release` ジョブ）。GITHUB_TOKEN で push したタグでは `push: tags` が起動しないが、
  `workflow_dispatch` は例外として起動できる。`workflow_call` で同じ run から呼ぶ形に
  しないこと。run の主体が `tagpr.yml`、ref が `refs/heads/main` になり、npm の
  Trusted Publisher（`publish.yml` を登録してある）と provenance がそれを名乗る
- **`tagpr.yml` の呼ぶジョブには、権限を 4 つとも書く**（`actions: write` を含む）。
  共通の workflow が使える上限で、`actions: write` は中の `release` ジョブだけが使う
- **`tagpr.yml` に `concurrency` を付けない。** run を並べるのは共通の workflow の
  tagpr のジョブ（`cancel-in-progress: false`）。呼ぶ側にも付けると deadlock として止まる

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
    lily を publish したら `cd template && npm install @kanf/lily@latest --package-lock-only`
    （「リリース手順」の 4）。
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

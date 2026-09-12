# lily の設計の記録

**「なぜそうなっているか」を置く場所。** 使い方と公開 API は
[`README.md`](./README.md)（英語）、直すときの手順は
[`CONTRIBUTING.md`](./CONTRIBUTING.md)（英語）にある。

分けてあるのは、**README がそのまま npm のパッケージページになる**ため。
初めて触る人が読むものと、直すときに読むものを 1 本に混ぜると、前者が後者に
埋もれる（分ける前は 86KB あった）。**この記録はパッケージに入らない**
（`package.json` の `files` に挙げていない）ので、**日本語のまま置いてある** ——
README と違って「知らない人が最初に読むもの」ではない。

決定に至る経緯そのものは
[issue #5](https://github.com/kan/fushihara.net/issues/5)（設計）と
[issue #6](https://github.com/kan/fushihara.net/issues/6)（切り出し）、
Astro からの乗り換えで踏んだ穴は
[`SWITCHOVER.md`](https://github.com/kan/fushihara.net/blob/main/blog/SWITCHOVER.md)、
**守るべき外向きの契約**は
[`CONTRACT.md`](https://github.com/kan/fushihara.net/blob/main/blog/CONTRACT.md)。

## 配り方（`dist/lib` と publish）

**2026-09-12 に `kan/fushihara.net` の `lily/` からこのリポジトリへ出した。**
[issue #6](https://github.com/kan/fushihara.net/issues/6) の最後の段階で、
そこまでの経緯はあちらのコメントに時系列で残っている。

利用側（[`fushihara.net/blog`](https://github.com/kan/fushihara.net/tree/main/blog)）は
lily を**パッケージ解決だけで**参照していた（`require.resolve` と
`node_modules/@kanf/lily/...`）ので、移すのに要ったのは `file:../lily` を
`^0.1.0` に変える 1 行と、向こうの CI からビルド順序を消すことだけ。

- **配る形。** `tsconfig.build.json` が `dist/lib` へ emit し、`scripts/copy-lib-assets.mjs`
  が `tsc` の運ばない `.css` を隣へ置く。`exports` は `dist/lib` を指す
- ライセンスは **ISC**（[`LICENSE`](./LICENSE)）。MIT を短くした OSI 承認のもので、
  npm 自身が使っている
- publish は**タグ（`v*`）で CI から**（`.github/workflows/publish.yml`）。
  Trusted Publishing（OIDC）なので token を secret に置かない

### `.ts` 拡張子の import について

lily のソースは相対 import に `.ts` を付ける（250 箇所近い）。emit では
**`rewriteRelativeImportExtensions: true`** が `.js` へ書き換えるが、これが効くのは
`.js` だけで、**`.d.ts` には `.ts` のまま残る**（TS 6.0 で実測）。

**これは直さなくてよい。** TypeScript は `.d.ts` の中の import を「解決済みの出力」
として扱うので、`.ts` で終わっていても TS5097 を出さない。`skipLibCheck` を切り、
`allowImportingTsExtensions` を持たない利用側で確かめた。**`.d.ts` を機械で
書き換える後処理を足さないこと。**

### emit の型は型検査の型と別（`build-types.d.ts`）

型検査が読む `worker-configuration.d.ts` には
`mainModule: typeof import("./test/worker")` が入っている。**これが
`test/worker.ts` を emit の対象に引きずり込む** ―― program に入った `.ts` は
`include` にも `exclude` にも関係なく全部出るので、`rootDir` の外にあるあれは
`dist/` ではなく**ソースの隣に `test/worker.js` と `test/worker.d.ts` として湧く**
（エラーも警告も出ない。`git status` で気付いた）。

そこで emit だけ `wrangler types --include-env false` で出した**ランタイム型だけ**の
ファイルを読む。lily は `Cloudflare.Env` を 1 箇所も使わない ―― route の `Env` は
どれもファイル内の `type Env = { Bindings: LilyBindings }` で、`test-support.ts` が
唯一 `env.DB` を触っていたのも、**deployment ごとに違う生成物を当てにしていた**
だけなので `env` から名前で取り出す形に直した（lily の `wrangler.jsonc` に DB が
あることは、これを呼ぶ人のところに DB があることを 1 つも意味しない）。

### 決めてあること

- **履歴は引き継がない。** `lily/` は `lily/` → `blog/`（改名）→ `lily/`（切り出し）と
  2 回動いているので、履歴ごと持つには `git filter-repo` でパスの読み替えが要る。
  そこまでの価値は無いと判断した。経緯は
  [issue #5](https://github.com/kan/fushihara.net/issues/5) /
  [#6](https://github.com/kan/fushihara.net/issues/6) と
  [`blog/SWITCHOVER.md`](https://github.com/kan/fushihara.net/blob/main/blog/SWITCHOVER.md)
  に残る
- **開発中は `exports` を切り替えられない。** npm は `publishConfig` の `exports` を
  書き換えない（あれは pnpm の機能）ので、「開発は `src`、配布は `dist`」はできない。
  利用側で試しながら lily を直すときは `npm run build:lib:watch` を併走させる
- **`file:` の利用側は古い `dist/lib` に当たりうる。** `scripts/check-fresh.mjs` が
  `src/x.ts` ↔ `dist/lib/x.js` を 1 対 1 で突き合わせ、古ければ理由を返す
  （`blog/scripts/build.mjs` がそれを呼んで止まる）。**判定を利用側に置かない**のは、
  「`src/` の何が `dist/lib` のどこに出るか」が lily のビルド設定の持ち物だから

### `file:` で往復するとき

別リポジトリになっても、lily を直しながら利用側で試したい場面は残る。そのときは
利用側の依存を一時的に `file:../lily` へ差し替える（`npm link` でも同じ）。
**`scripts/check-fresh.mjs` はそのときだけ効く** ―― npm から入れた木には
`scripts/` も `src/` も入らないので、比べる相手がいない。

## 描画（`core/render/`）

```
body_md ──renderMarkdown()──▶ body_html（保存。mount を知らない）
                                 └──resolveMediaUrls()──▶ 配信する HTML
```

保存する HTML には `lily-media://<public_id>/<filename>` という placeholder が
入っていて、実際の URL は配信時に組む。**この分離があるので `mountPath` を
変えても `body_html` の再生成が要らない**（並走していたころ、`/blog-next` と
`/blog` が同じ D1 を見て同時に正しい URL を出せた）。

- **`rehype-raw` は使わない。** HTML を parse5 で読み直すので、表の中の改行が
  foster parenting で表の外へ追い出される（`</pre>` と `<table>` の間に空行が
  14 行並ぶ）。生 HTML は raw ノードのまま最後まで運ぶ
- **Shiki は `defaultColor: false` を維持する。** 色を直接書かせず
  `--shiki-light` / `--shiki-dark` だけを出させて CSS の `light-dark()` に渡す。
  `'light'` にすると `!important` が要るようになる
- 載せる言語は `render/highlighter.ts` の `LANGS`。**バンドルに入る**ので、
  書かない言語は入れない（Worker 全体は gzip 約 410 KiB で、その大半がこれ）。
  測るときは `npx wrangler deploy -c ./wrangler.jsonc --dry-run` の Total Upload
- Astro は `pre.astro-code` を出していたが、Shiki 素のクラス名は `pre.shiki`。
  CSS を移植するときに読み替えること

### `<img>` の属性

Markdown の画像記法から出た `<img>` には `width` / `height` / `loading="lazy"` /
`decoding="async"` を付ける。**`width` / `height` が無いと、画像が届くまで高さが
0 のままで本文が飛ぶ**（Astro 版からの唯一の機能的な後退だった）。

寸法は**画像そのものの性質で deployment に依存しない**ので、保存する `body_html`
に焼き込んでよい（配信時に解決されるのは URL だけ）。読むのは
**アップロードと import の時点**で、`core/media/dimensions.ts` がヘッダから取る。

- **EXIF の orientation を見る。** 5〜8 は縦横を入れ替えて描かれる（ブラウザの
  `image-orientation` は既定で `from-image`）。格納値をそのまま書くと、スマホで撮った
  縦写真に**横長の枠を予約してから縦長で描き直す**ことになり、防ぎたかったレイアウト
  シフトが却って大きくなる。EXIF を持てる 3 形式（JPEG の APP1 / PNG の `eXIf` /
  WebP の `EXIF` チャンク）すべてで見る
- **書くのは Markdown の画像記法から出た `<img>` だけ。** 記事に直接書いた生 HTML は
  属性を著者が決めているので、URL の解決以外は触らない
- `width` と `height` は**揃っているときだけ**足す。片方だけ書かれているところへ
  もう片方を入れると、著者の指定と違う比率に潰れる
- **寸法が読めなくても添付は受け付ける**（属性が出ないだけ）。AVIF は読まない。
  寸法は `ispe` にあるが、どれが本体のものかは `pitm` と `ipma` を辿らないと
  決まらず（サムネイルやアルファの補助画像にも付く）、実物で検証する手段が
  手元に無いため
- **`viewBox` しか無い SVG はその比を寸法として使う。** `<img>` に置いた
  viewBox-only の SVG は固有サイズを持たないので、属性が無いと既定の 300px 幅に
  伸びる。`viewBox="0 0 24 24"` のアイコンは 24px で出るようになる。これは
  Astro（sharp）が書いていた値と同じ
- **属性を出すと `<img>` は読み込み前から箱を持つ。** E2E で「描画された」と
  「読み込めた」を同じもので見ていると通り抜ける（`naturalWidth` は
  `expect.poll` で待つ）
- **既存の添付には遡らない。** 寸法は `createMedia()` の INSERT でしか入らないので、
  この変更より前に上げた添付は `width` / `height` が NULL のまま。`/api/rerender` は
  `body_html` を作り直すだけで埋めない。埋めたければ**入れ直すか再 import する**
  （まだ配信していないので、実害があるのは手元の D1 だけ）

## リンクカード

貼った URL を、題・説明・サムネの付いたブロックにして本文へ入れる
（`core/link-card.ts`）。**既定は今までどおりテキストリンク**で、貼った直後に出る
「カードにする」を押したときだけ替わる。

**なぜこの形なのか**（生 HTML である理由・サムネを添付として取り込む理由・取りに
行く関門を 1 本に絞る理由）は `core/link-card.ts` と `core/link-preview.ts` の
先頭コメントにある。ここには**外から見える形と、押したときに何が起きるか**だけを書く。

本文に入るのは生 HTML で、renderer は raw ノードをそのまま運ぶだけなので
**`RENDERER_VERSION` を上げる必要が無い**。

```html
<a class="link-card" href="https://example.com/x">
  <img class="link-card-thumb" src="./card-example-com-0a1b2c3d.png" alt="" width="1200" height="630" loading="lazy" decoding="async">
  <span class="link-card-text">
    <span class="link-card-title">相手の題</span>
    <span class="link-card-desc">相手の説明</span>
    <span class="link-card-site">example.com</span>
  </span>
</a>
```

サムネは記事の添付になる。**ファイル名はカードの種類とページの URL から決まる**
（`card-<host>-<8 桁>.<ext>`）ので、同じリンクを貼り直しても添付は増えない
（種類も混ぜる理由は `core/link-card.ts` の `storeThumbnail`）。拡張子は相手の
`Content-Type` から決め、**ラスタだけ**受け付ける。

口は `POST /api/posts/:publicId/link-card`。**記事に紐づくのはサムネを添付に
するから**で、未保存の記事では断る（画像のアップロードと同じ）。

| 相手の状態 | 返るもの | 管理画面 |
|---|---|---|
| 題が取れた | カードの HTML と、取り込んだ添付 | 本文の `[題](url)` を丸ごと置き換える |
| 題は取れたが絵が無い / 取れない | 画像なしのカード | 同上 |
| 題がまったく取れない | **502（`link-unreachable`）** | テキストリンクのままにする |

差し込むときは**前後に空行を空ける**（`blockPadding`）。段落の途中に貼ったリンクを
そのまま替えると、HTML ブロックが段落を中断できず**インライン要素として出る**。

リーダーにはこのブログの CSS が無いので、**素のままでも上から絵・題・説明・出典と
読める順**にしてある。`blog.css` 側で順序を入れ替えないこと。

### GitHub のリポジトリ

`github.com/<owner>/<repo>` を貼ったときだけ、OGP ではなく GitHub の API から組む
（`core/link-github.ts`）。**特別扱いするのはリポジトリだけ**で、issue や PR、
ファイルへのリンク、`github.com/<owner>` は汎用のカードのまま（貼った人が指した
ものと違うものを出さないため）。

```html
<a class="link-card link-card-github" href="https://github.com/kan/wema">
  <img class="link-card-thumb" src="./card-github-com-1a2b3c4d.png" alt="" width="200" height="200" loading="lazy" decoding="async">
  <span class="link-card-text">
    <span class="link-card-title">kan/wema</span>
    <span class="link-card-desc">Web上に付箋を絵馬のように貼るライブラリ</span>
    <span class="link-card-meta">★ 12 · Fork 1 · TypeScript</span>
    <span class="link-card-site">GitHub</span>
  </span>
</a>
```

- **リンク先とサムネの名前は API が返した `html_url` から決まる。** `?tab=…` の
  付いた URL を貼っても、素の URL を貼ったときと同じ 1 つの添付に落ちる。改名された
  リポジトリは新しい名前に張り替わる
- サムネは owner のアバター（正方形）。`link-card-github` が付いた分だけ
  `blog.css` が枠の形を変える
- **統計は取った時点で固まる。** 星が増えても後から数え直さない
- **API が枯れていたら汎用の OGP カードに落ちる**（理由と、資格情報を持たせて
  いない判断は `core/link-github.ts` の先頭）

## 1 箇所に閉じてあるもの

同じ規則が 2 箇所にあると、片方だけ直した日に黙って食い違う。次は意図的に
1 箇所へ寄せてある。

| 何 | どこ |
|---|---|
| core が持つ route のセグメント名 | `core/routes/fixed.ts` の `ROUTE` |
| URL を組む場所・記事パスの予約判定 | `core/paths.ts`（`createPaths`） |
| 配る静的アセットの名前（予約語の残り半分） | `PageConfig.assets`（`src/site/meta.ts` の `ASSET`） |
| 「URL セグメントとして安全か」 | `core/paths.ts` の `normalizeSegment` |
| 「公開記事とは何か」 | `core/db/posts.ts` の `PUBLISHED_WHERE` |
| SELECT する列 | `core/db/types.ts`（Row 型から導出） |
| 「記事は常に public_id で引ける」 | `core/db/post-paths.ts` |
| 生成済み HTML の後処理を開始タグに限る | `core/render/html.ts` の `mapOpenTags` |
| 画像記法の組み立て・リンクの URL 欄の判定 | `core/render/markdown.ts` |
| 説明を本文から作る規則 | `core/summary.ts` |
| 添付の R2 キーの決め方 | `core/db/media.ts` の `mediaR2Key` |
| 添付として受け付ける形式（判断の材料ごと） | `core/media/formats.ts` |
| 添付の寸法をヘッダから読む規則 | `core/media/dimensions.ts` |
| portable な形式（frontmatter のキーと並び） | `core/transfer/format.ts` |
| その形式の YAML をどこまで読むか | `core/transfer/frontmatter.ts` |
| 日時の JST 変換（fushihara.net の公開ページ） | `shared/date.ts` |
| 日時の変換（標準テーマと管理画面。`SiteConfig.timeZone`） | `core/date.ts` |
| 見た目・文言・OGP（差し替え点） | `core/theme.ts` の `Theme` を `site/` が実装 |
| キャッシュ方針 | `core/routes/cache.ts` |
| 保存済み HTML と描画の使い分け | `core/delivery.ts` |
| 開始タグの中の `src` / `href` の書き換え | `core/render/html.ts` の `rewriteUrlAttributes` |
| D1 のバインドパラメータ上限（100）への対処 | `core/db/chunk.ts` |
| 管理画面と配信側の契約（meta の名前・目印の cookie・リンクを出すスクリプトと class） | `core/admin-contract.ts` |
| 管理画面のハッシュ URL の形 | `core/paths.ts` の `ADMIN_HASH` |
| 告知の投稿の組み立て（本文・facet・リンクカード） | `core/bluesky.ts` |
| 「この記事の OGP はどれか」 | `core/db/media.ts` の `getOgpMedia` / `setOgpMedia` |
| OGP に選べる形式 | `core/media/formats.ts` の `OGP_MIMES` |
| 配信する中身の言語（`<html lang>` と告知の `langs`） | `SiteConfig.lang`（`src/site/meta.ts`） |
| AT-URI → bsky.app で開ける URL | `core/bluesky.ts` の `blueskyPostUrl` |
| サイト共通の OGP（絶対 URL と寸法） | `SiteConfig.ogImage`（サムネに読む実体は `PageConfig.ogImageAsset`） |
| 外へ取りに行く関門（宛先・リダイレクト・時間・読む量・URL の正当性） | `core/link-preview.ts` の `fetchExternal` / `readCapped` / `httpUrl` |
| 一覧の絞り込み条件（行と件数で同じもの） | `core/db/posts.ts` の `postFilter` |
| 控えの置き場所と世代の切り方 | `core/backup.ts` |

## 説明（description）

一覧・OGP・RSS / Atom・`posts.json` に出る短い説明。**手で書いていなければ本文の
冒頭から作る**（`core/summary.ts`）。

- **DB には保存しない。** 配信のたびに `body_md` から組み直すので、本文を直せば
  そのまま追従する。保存すると、本文を書き換えた記事の説明だけが古いまま残る
- 出す側は全部 `postDescription()` を通す（view model・フィード・`posts.json`）。
  1 つでも素の `description` を読むと、そこだけ空になる
- 取るのは**最初の段落 1 つだけ**。段落をまたいで繋ぐと、元の文章に無い並びの文が
  OGP に出る。書き出しが説明にならない記事は手で書けばよい（手書きが常に勝つ）
- **読むのは renderer と同じパーサ**（remark + remark-gfm を `parse` まで）。
  記法を正規表現で読み直すと書き方ごとに取りこぼしが出て、同じ本文から出る OGP と
  記事本文が食い違う（setext 見出しの下線が説明に漏れ、`- - -` が `-` という説明に
  なった）。mdast まで読めば「段落とは何か」はパーサが決める。HTML を作る段
  （remark-rehype と Shiki）は通さないので、増える仕事は解析だけ
- **管理画面はこれを import しない。** 説明欄の placeholder に出す控えは
  `POST /api/render` が本文の HTML と一緒に返す。解析器をブラウザのバンドルへ
  運ばずに済み、打鍵ごとではなくプレビューと同じ 300ms の間引きに乗る
- 行を繋ぐとき、日本語のあいだには空白を入れない（CommonMark の softbreak は
  空白扱いだが、折り返して書いた日本語に空白が挟まると語の途中が割れて見える）。
  箇条書きの項目だけは別で、繋げると隣の項目と 1 つの文に見えるので必ず空ける

## フィード

- **`content:encoded` は CDATA ではなく実体参照で書く。** 本体サイトの
  `/api/blog` が正規表現で RSS を読んでいて、CDATA を吐いた瞬間に壊れる。
  本体を `posts.json` へ移すまでは変えないこと
- 本文の URL はすべて**絶対**にする。リーダーは記事の URL を起点に相対 URL を
  解決してくれない
- 色は要素に直接書く。リーダーはこのブログの CSS を読まないので、Shiki の
  `--shiki-*` はライト側の値に展開する
- **RSS の `guid` は記事の URL のまま。** `urn:uuid:` に変えると、既存の
  購読者全員に全記事が「新着」として配り直される。Atom は新設なので
  `urn:uuid:<public_id>` を使える（パスを変えても同じ記事として扱われる）

## 管理 API

リクエストの検証は zod を `zValidator` で **1 度だけ**書き、レスポンスの型は
handler から推論させる（Hono RPC）。手で書いた型と実装がずれる余地を作らない。

```ts
import { hc } from 'hono/client';
import type { LilyApi } from './core/api/index.ts';

const client = hc<LilyApi>('/blog/api');
const res = await client.posts.$post({ json: { title: '…' } });
if (!res.ok) { /* 400 / 404 / 409 / 502 */ }
const { post } = await res.json();  // 型は handler から
```

- **route のパスは mount を知らない。** `<mount>/api` にマウントされるので、
  リテラルのまま型に残り、`hc` が `client.posts` の形を作れる
- **エラーのステータスは `400 | 404 | 409 | 502` に絞る。** 広い型にすると
  `if (res.ok)` の絞り込みが効かなくなる（502 は上流の失敗。Bluesky への告知と
  リンクカードが返す）
- **本文が変わる操作のときだけ `body_html` を描き直す。** 配信側が毎回描き直さずに
  済む。`GET` は書き込まない（一覧→詳細を開くだけで D1 に書くことになる）。
  添付を消したときも描き直す（消えた画像を指す `<img>` を公開ページに残さない）
- **`POST /api/rerender` は今の renderer で描かれていない記事だけ**を、1 回
  あたり 50 件まで処理して `remaining` を返す。Workers の subrequest には上限が
  あるので、黙って打ち切ると「成功したのに古いままの記事」が残る
- **同じパスの `GET` が「あと何件か」を返す**（`{ rendererVersion, remaining }`）。
  route 名を増やさずに済む。詳しくは下の「再描画の案内」
- 添付は **DB に行を入れてから R2 に置く。** `r2_key` は（記事, ファイル名）から
  決まるので、逆順にすると 2 回目の upload が既存の実体を上書きしてから 409 を
  返すことになる（「失敗した」と言いながら元の画像は消えている）
- タグは**記事を作る前に検証する。** 作ってから弾くと、失敗を返したのに記事だけ
  残り、同じパスで作り直すと 409 になって手詰まりになる
- プレビューの**生のトークンを返すのは発行のときだけ**。DB に入るのは SHA-256 の
  ハッシュで、記事の詳細には `hasPreview` しか出ない
- 添付は**拡張子で形式を決める**。ファイル名は記事のパスと同じ `normalizeSegment` を
  通す（export でそのままディレクトリに書き出すため）。ブラウザの `Content-Type`
  だけで通すと、**上げられるのに取り込み直せない添付**ができる（書庫に
  Content-Type は無いので、import 側は拡張子しか見られない）
- `POST /api/link-title` と `POST /api/posts/:publicId/link-card` は**外から来た
  URL をそのまま fetch する口**。http/https だけ・IP リテラルとローカル向けの名前を
  弾く・**リダイレクトを自分で追って飛び先も毎回検査する**・5 秒で打ち切る・
  先頭 64KB だけ読む、で狭めてある（`redirect: 'follow'` に任せると最初の 1 回しか
  検査されず、公開 URL から内側へ飛ばされる）。**関門は `fetchExternal()` の 1 本**で、
  カードが OG 画像を取りに行くときも、GitHub の API を叩くときも同じところを通る
  （「リンクカード」の節）

## 管理画面

`<mount>/admin/`。Vue の SPA で、Worker とは別のビルド（`vite build`）。

- **`base: './'` と、mount をパスから割り出す。** 同じ成果物が `/blog` でも
  別の mount でも動く（deployment の設定をビルドに焼き付けない）
- **プレビューは `POST /api/render`。** 公開ページと同じ renderer を通すので、
  書きながら見ているものと出るものが食い違わない。管理画面に Markdown の
  パーサを 2 本目として持ち込まずに済む
- 画像は D&D か貼り付けで上がり、本文に入るのは `./<filename>` の相対参照。
  配信 URL は描画時に解決する
- **新規の記事に画像を入れると、その場で下書きとして保存する**（`ensureSaved`）。
  添付は記事に紐づく（R2 のキーが記事とファイル名から決まる）ので、記事が無い
  あいだは受け取れない。「先に保存してください」と突き放すと、書き始めてすぐ
  画像を貼りたい場面で必ず引っかかる
  - **題だけは省略できない。** 記事のタイトルは空にできないので（`createPostSchema`
    と DB の `CHECK`。**空白だけの題も弾く** —— DB の `length(title) > 0` は空文字
    しか止めないので、`"　"` が通ると一覧に何も書いていない行が並ぶ）。代わりに
    「無題」を作ると、持ち主の分からない下書きが一覧に並ぶ
  - **作成は同時に 1 つだけ**（`create()` が進行中の約束を覚える）。添付の入口は
    ドロップ・貼り付け・カードにする・保存と 4 つあり、2 枚を続けて落とすと
    両方が「記事が無い」を見て、同じ題の下書きが 2 件でき、先に上げた画像は
    誰も開かない方に付く
  - **作った直後は編集中の欄に触らない**（`adopt()`。`fill()` はその上に組む）。
    往復のあいだも人は打ち続けているので、送った時点の応答で埋め直すと
    その間の打鍵が黙って消える
  - **route ではなく画面の中に id を持つ**（`postId`）。route を動かすと `App.vue`
    の `key` が変わって編集画面が作り直され、**差し込んでいる途中の本文と
    カーソルが飛ぶ**。URL だけ `replaceRoute()` で追随させるので、再読み込みや
    セッション切れからの復帰では同じ記事が開く（`blog/e2e/admin.spec.ts` の
    「新規のまま画像を入れると〜」が本文の中身で見張っている）
  - 退避のキーも書くときの `postId` から組む。`new` のまま書くと、読み込み直した先
    （その記事の画面）が自分の控えを見つけられない
- `hc` の戻り値は成功・API のエラー・zod の検証失敗の union なので、
  **絞り込みをまたぐ汎用ヘルパーを作らない**（型が消える）
- クライアントの base は**絶対 URL**。`$url()` が URL を組むのに要る
  （相対だと画像のアップロードが `Invalid URL` で落ちる）
- **日時の入力はネイティブの `datetime-local` / `date` を使わない。** 日本語の
  Chrome では曜日の欄が付いた形（`2026/08/28(金) 00:25`）で描かれ、そこが空の
  まま出る。環境によって出方が変わるものを画面に置くと、崩れても手が出せない
- **アップロードのあとに記事を読み直さない。** textarea の value を代入し直すと
  カーソルが末尾へ飛び、画像がそこに入る（増えたのは添付だけなので 1 件足す）
- **公開日時は触ったときだけ送る。** 欄は分までしか持たないので、読み込んだ値を
  そのまま送り返すと秒が落ちる。一覧とフィードの並びは `published_at DESC` なので、
  無関係な編集で同じ分に公開した記事の順序が入れ替わる
- **タグの候補は選んだあとも閉じない。** 候補は `mousedown.prevent` で拾っていて
  blur が起きないので、閉じると 2 つ目を選ぶのに一度どこかへ外して戻る必要が出る
  （`focus()` は既に当たっている入力欄には focus イベントを出さない）
- **リンクの URL 欄に貼った URL は展開しない。** 貼り付けた URL は普段
  `[題](url)` に包むが、`[題](` の続きに貼ると `[題]([url](url))` になる。
  どこが URL 欄かの判定（`inLinkUrl`）は記法の知識なので core 側に置いてある
- **SPA の fallback から `assets/` を外してある。** ハッシュ付きのバンドルが
  無いときに `index.html` を 200 で返すと、古いタブが JS の代わりに HTML を
  受け取って構文エラーで固まる（404 なら再読み込みで直る）
- **ログアウトは設定画面に置く。** `fetch` ではなく素の form の POST なので、
  押すとページごとログイン画面へ移る（cookie を消すのはサーバー側の仕事で、
  画面に持ち帰るものが無い）。ボタンが出るかは認証方式で決まる
  （アダプタの `handle` の有無 → `<meta name="lily:logout">` → `admin/auth.ts`）

### セッションが切れたとき

セッションには期限がある（Access の JWT も、`passwordAuth` の cookie も）。切れた
あとの呼び出しは 403 で返り、画面には「forbidden」とだけ出る。**押し直しても
直らない**ので、`src/admin/session.ts` が 1 箇所で受けて読み込み直す。

読み込み直した先で何が出るかは方式で違うが、**管理画面はどちらも知らなくてよい**。
Access ならログインの画面へ飛ばされ、`passwordAuth` なら core が
`<mount>/admin/login` へ送る（`challenge`。画面遷移だけをリダイレクトし、API の
呼び出しは 403 のままにしてあるのは、この読み込み直しの経路を壊さないため）。

- **読み込み直す前に書きかけを sessionStorage へ退避し、戻ってきたら復元する。**
  保存前の本文はそこにしか無い（記事の正は D1 で、これは事故のときだけ使う控え）
- **直前にも読み込み直していたら何もしない。** リロードで直らない拒否（AUD の
  設定違い等）だと、そのまま無限に読み込み直すことになる。そのときは 403 の
  エラーがそのまま画面に出る
- **開いていた画面も退避する。** Access のログインを経由すると `#` はサーバーへ
  送られないので、戻ってきた URL は `<mount>/admin/` になる（`router.ts` の
  `openingHash()` が寄せ直す）
- 画像のアップロードは `hc` を通らない multipart だが、**同じ `apiFetch` を使う**。
  片方だけ素の `fetch` だと、そこで切れたときに気付けない

### サイト設定は配信時に差し込む

題（`<title>`）と見出しは `lily` ではなく**サイト名**にしてある。管理画面を
複数開いたときに、タブが全部 `lily` だと見分けが付かないため。

差し込むのは `core/routes/admin.ts` で、入口 HTML を HTMLRewriter に通して
`<title>` を `<サイト名> - lily` にし、`<meta name="lily:site">` の `content` に
設定を JSON で入れる。読む側は `src/admin/site.ts`。

- **ビルド時に焼かない。** `base: './'` と mount の割り出しと同じ理由で、同じ
  成果物をどこにマウントしても使えるようにするため。焼くと mount ごと・サイト
  ごとにビルドが要る
- **載せるのは `SiteConfig` そのもの。** 項目を選び直すと、設定に足したものが
  設定画面に届かず、しかも型は通るので「設定画面にだけ出ない」で終わる
- **mount は運ばない。** 管理画面は自分がどこに配られたかを `src/admin/api.ts` の
  `MOUNT` で割り出していて、API のベース URL もそれで組んでいる
- meta の名前と目印の cookie は `core/admin-contract.ts` に置く。**管理画面は
  vite で別にバンドルされる**ので、route のモジュールから値を import すると
  hono ごとブラウザ側へ運ぶことになる（型だけなら消えるが、値は残る）
- 受け皿の `<meta>` は `src/admin/index.html` に空で置いてある。属性値の
  エスケープは HTMLRewriter に任せる（JSON を手で埋め込まない）
- **HTML のときだけ通す。** JS を HTMLRewriter に流すと、中身の `<` が要素の
  始まりとして解釈されて壊れる
- 差し込みが無ければ `src/admin/site.ts` の既定値に落ちる。設定が読めないだけで
  編集できなくなる理由は無い。**フォールバックが正常系なので、名前が食い違っても
  画面はそれらしく出る**（テストが meta の中身を突き合わせている）

`#/settings` の画面は**この値を表示するだけ**で、変更はできない。D1 に置いて
画面から変えられるようにする案もあったが、年に数回しか動かない値を DB へ移すと
git の履歴・レビュー・ロールバックの外に出る。今どうなっているかを確かめられれば
足りる、という判断（変えるときはソースを書き換えてデプロイする）。

### 一覧の絞り込み

`status` / `tag`（slug）/ `q`（キーワード）。`q` はタイトル・説明・本文を見る。

- **行と件数に同じ絞り込みを渡す。** `listAllPosts` と `countPosts` は別のクエリ
  なので、条件の組み立ては `postFilter()` 1 箇所に置いてある。片方だけ絞ると
  総件数が食い違い、ページャが「次がある」と言い続ける
- **LIKE の `%` と `_` をエスケープする**（`ESCAPE '\'`）。しないと `_` が
  「任意の 1 文字」として効き、`a_b` で検索したときに `axb` にも当たる
- 空文字は絞り込み無しと同じ扱い。画面の入力欄を空にすると `?q=` が飛んでくる
- 全文検索（FTS5）は使わない。D1 でも動くが、STRICT テーブルへのトリガ同期が要り、
  import / export の往復にも絡む。この規模（数百本）では LIKE の全走査で足りる
- 検索語は打ち終えてから送る（250ms）。1 文字ごとに投げると、日本語の変換中に
  中間の読みで検索してしまう
- **追い越した古い結果は捨てる。** 検索は本文への LIKE 全走査なので短い語ほど遅く、
  「早」の結果が「早朝」の結果より後に返ると、入力欄と一覧が食い違ったまま固まる
- 絞り込みは 1 つの reactive オブジェクトに入れる。別々の ref にすると、項目を
  足すたびに 5 箇所（クエリ・絞り込み中か・解除・ページ戻し・読み直し）へ同じ
  名前を書くことになり、どれか 1 つを落とすと黙って抜ける
- 空文字を「絞り込み無し」と読むのは API 側（`core/api/schema.ts` の `filterWord`）
  だけ。画面側でも同じ判断をすると、規則が 2 箇所になる

### 再描画の案内

lily を更新して出力が変わったとき、利用側は
`POST <mount>/api/rerender` を回す必要がある。**配信側は `body_html` があれば
それを返すので、古い HTML のままでも画面には何も出ない。** 一覧に知らせを置いた
のはそのため。

- `GET <mount>/api/rerender` が `{ rendererVersion, remaining }` を返し、
  `remaining > 0` のときだけ「この renderer で描かれていない記事が N 件ある /
  まとめて描き直す」を出す。押したら `POST` を 0 になるまで繰り返す
- **`GET` と `POST` を同じパスに置いた。** `GET` が「あと何件か」、`POST` が
  「進める」。route 名が増えない
- **残っているのに `rendered` が 0 なら止める。** 描画で毎回落ちる記事があると
  `remaining` が減らないので、回し続けるとブラウザが永久に API を叩く
- **解決できない画像参照は捨てずに出す**（`POST` の `warnings`）。まとめて描き直す
  操作では、記事を 1 本ずつ開かない限り気付く機会がここしか無い
- **件数が読めなかったら黙って 0 にする。** これは付随的な知らせで、記事を読み書き
  する邪魔をしてはいけない。出せないなら「知らせが出ない」だけにする
- **`renderer_version` に索引を足した**（`migrations/0003_…`）。数える方は
  一覧を開くたびに飛ぶので、索引が無いと `body_md` / `body_html` を抱えた posts の
  本体を毎回読むことになる。効くのは数える方だけで、`listPostsNeedingRender`
  （`ORDER BY id` + `LIMIT`）は索引を足しても `SCAN` のまま（実測）

**採らなかったもの**:

- **配信側での lazy 再描画。**「`GET` は D1 に書かない」を壊す（一覧から詳細を
  開くだけで書き込みが起きる）
- **cron での自動再描画。** 静かに全記事を書き換える経路になるうえ、cron を
  張っていない deployment には効かない。2 つ目の deployment が実際に困ってから

### 公開ページの管理リンク

管理画面を開いたことがある端末にだけ、公開ページのナビへ「管理」（記事ページでは
「この記事を編集」）が出る。

**判定はブラウザ側でする。** 公開ページは `s-maxage` で共有キャッシュに載るので、
ログイン中だけ HTML を変えると、その HTML が匿名の読者にも配られる（逆に匿名版が
載っていると管理者にリンクが出ない）。

- リンクの実体は**最初から HTML にあり、`hidden` で隠してあるだけ**。配る HTML は
  全員同じで、外すのは数行のスクリプト
- **スクリプトと class は `core/admin-contract.ts` が持つ**（`ADMIN_LINK_SCRIPT` /
  `ADMIN_LINK_CLASS`）。見た目の話ではなく cookie をどう読むかという契約なので、
  テーマごとに書き直す理由がない（実際 `src/site/` と `src/theme/` で 1 バイトも
  違わなかった）。テーマがするのはリンクを出すことと、スクリプトを差し込むことだけ
- 目印は `core/routes/admin.ts` が入口 HTML に付ける cookie。**権限は何も持たない**
  （偽造しても、出るのは Access のログインへ行くリンクだけ）
- **目印は名前と値を 1 つの単位で持つ**（`core/admin-contract.ts` の `ADMIN_HINT`）。
  読む側は cookie の 1 項目とこれを丸ごと比べるので、名前だけを共有すると、値を
  変えた日に比較が黙って false になる
- Access の `CF_Authorization` を直接見ないのは、あれが HttpOnly で JS から
  読めないため
- 目印が Access のセッションより長生きすることはある。そのとき押すとログイン画面に
  行くだけ
- **テーマに渡すのは完成した URL**（`PostView.adminUrl`）。identity を渡して
  テーマに組ませると、差し替えたテーマが「管理画面のハッシュの形」を知らないと
  同じ機能を作れない
- 編集 URL のハッシュの形は `core/paths.ts` の `ADMIN_HASH` が持ち、組む側
  （`urls.adminPost()`）と解く側（`src/admin/router.ts`）が同じものを見る。
  **食い違うと一覧が開くだけで気付けない**ので、E2E がリンクを実際に押して
  編集画面が出ることまで見る

## OGP の絵

**ブログ専用の 1 枚が既定で、記事は添付から 1 枚選んで上書きできる。**

```
blog/public/ogp.png            ブログ共通（「ふしはらねっとのぶろぐ」）
shared/public/ogp.png          本体サイト（「fushihara.net」）
```

- **共有に 1 枚だけ置く形をやめた。** `/` と `/blog/` のどちらのリンクを貼っても
  同じ絵が出ていた。`scripts/build.mjs` は共有（favicon 3 点）を先にコピーしてから
  `blog/public` を被せるので、**同じ名前があればブログ側が勝つ**。順序を入れ替えると
  本体の絵が黙って配られる（`e2e/blog.spec.ts` の「配信物」がバイト列で見張っている）
- 作り方は本体と同じ。`f.` マーク（`shared/public/favicon.svg` と同じ path）と
  文字を並べた HTML を headless Chrome で 1200x630 に撮り、`sharp` の 64 色
  パレットに落とす（34KB → 13KB）。見出しは Noto Sans JP で、配信している
  ブログと同じ書体
- **記事ごとの上書きは `media.is_ogp`**（記事につき 1 枚。部分ユニーク索引）。
  管理画面の添付一覧の「OGP に使う」で選び、`PUT <mount>/api/posts/<public_id>/ogp`
  が受ける。反映先は記事ページの `og:image` と Bluesky のリンクカード
- **選べるのは PNG / JPEG / WebP だけ**（`OGP_MIMES`）。SVG は多くのクローラが
  OGP として読まず、GIF は 1 コマ目で止まって出る。AVIF は読まないクローラが
  まだあるうえ、`media/dimensions.ts` が寸法を読めないので
  `og:image:width` / `height` も出せない。選べない形式は**ボタン自体を出さない**
  （判断するのは core。`MediaView.canBeOgp` で管理画面へ渡す）
- **`og:image:width` / `height` は分かっているときだけ書く。** 添付の寸法は
  ヘッダから読めないことがあり、共通の絵の 1200x630 を当てると嘘になる
- **選択は `updated_at` を動かさない。** 読者から見える中身は変わらないので、
  Atom の `<updated>` と sitemap の `lastmod` を進めない
- 記事に紐づく行に印を置いているので、**添付を消せば選択も消える**（記事側に
  media への参照を持たせると、消えた絵を指したままになる）
- portable な zip は frontmatter の `ogp:` にファイル名で持つ（`CONTRACT.md`）。
  **書庫に入った添付からしか選ばない**ので、R2 から取れなかった絵を指す名前が
  残ることはない

## Bluesky 告知

**記事の URL を Bluesky へ投げる。管理画面の「告知する」ボタンからだけ。**
中身は `core/bluesky.ts`（XRPC を 3 本叩くだけなので **SDK は入れていない**）と、
`POST <mount>/api/posts/<public_id>/bluesky`。

- **公開とは別の操作にしてある。** 公開は何度でもやり直せる（下書きに戻して直して
  また公開する、公開日時を入れ直す）。そこに投稿を混ぜると、やり直すたびに同じ
  記事がタイムラインへ流れる
- **二重投稿の抑止は `posts.bluesky_uri`。** 告知済みなら AT-URI が入っていて、
  2 回目は 409。**押す前に見る**ので、上流を叩いてから気付くことはない
- **記録は上書きしない**（`setBlueskyUri` の `WHERE … AND bluesky_uri IS NULL`）。
  告知は「読んで → 数秒かけて外へ投げて → 書く」なので、続けて 2 回押されると
  どちらも空を見て**投稿が 2 本できる**。そこで上書きすると先に投げた方の AT-URI が
  消え、**消せる場所（Bluesky 側）へ辿る手掛かりが無くなる**。入れられなかったら
  警告をログに残す
- **告知済みかどうかは `blueskyUri` で見る**（管理画面）。`blueskyPostUrl()` は
  知らない形の AT-URI に null を返すので、URL の有無で判定すると告知済みの記事に
  告知ボタンが出る
- **やり直す口は無い。** Bluesky 側で投稿を消したときにどうするか（消えた投稿を
  指したまま「告知済み」にするか、もう 1 本投げるか）は必要になってから決める
- **`updated_at` を動かさない**（`setBlueskyUri`）。告知しても読者から見える中身は
  1 バイトも変わらないので、Atom の `<updated>` と sitemap の `lastmod` が進んで
  購読者のリーダーに記事が浮き上がってはいけない。`preview_token_hash` と同じ理由で
  `PATCHABLE` にも入れていない
- **リンクカードは自分で組む。** 公式クライアントは貼られた URL を取りに行って OGP
  からカードを作るが、**API から投げた投稿にその処理は走らない**。載せるのは記事の
  URL・タイトル・`postDescription()`（一覧と OGP に出るのと同じ説明）と、サムネに
  **記事ページの `og:image` と同じ絵**（「OGP の絵」の節）
- **サムネは配信しているのと同じ実体**を読む。記事が選んでいれば R2 の添付、
  無ければ `ASSETS` バインディングから共通の `ogp.png`。公開 URL を fetch すると
  自分のゾーンへサブリクエストを出すことになる（本体サイトの `/api/blog` が 522 で
  踏んだのと同じ罠）
- **大きすぎる添付は共通の 1 枚に落とす。** 上限（1MB）を超えたぶんは `announce()`
  が載せずに投げるので、そのままだと選んだ絵でも共通でもない「絵の無いカード」に
  なる。`bytes` は DB にあるので、R2 へ取りに行く前に分かる
- **サムネが取れなくても告知は止めない。** 実体が消えているとき・upload が失敗した
  ときは絵の無いカードで投げる（「押しても告知できない」にしない）
- 本文は「タイトル + 改行 + URL」で、**URL をリンクにする facet を付ける**。無いと
  素のテキストとして出る。範囲は **UTF-8 のバイト位置**なので、日本語のタイトルが
  入ると文字数とずれる。長さの上限は 300 **書記素**（`Intl.Segmenter` で数える。
  `length` だと絵文字 1 つが 11 文字に見えて余計に削られ、`slice` で切ると ZWJ の
  途中で割れて別の絵文字が出る）
- **言語（`langs`）はサイト設定から渡す。** `core/` に `'ja'` を書くと、別の言語の
  deployment が黙って日本語として流れる（Bluesky は言語で絞り込める）。置き場は
  `SiteConfig.lang` で、`<html lang>` も同じ値を見る
- **失敗の理由はそのまま画面に出す。** 押すのは管理者ひとりなので、App Password の
  誤り（`session`）と投稿の失敗（`post`）が見分けられる方がよい（`link-title.ts` が
  理由を返さないのは、あちらが外から来た URL を扱う口だから）。上流の失敗だけ
  **502** で返す（こちらの入力が悪いのか外が落ちているのかで、押し直してよいかが変わる）

### 資格情報

| 何 | どこ |
|---|---|
| ハンドル | `wrangler.jsonc` の `vars.BLUESKY_IDENTIFIER` |
| App Password | Worker の secret `BLUESKY_APP_PASSWORD` |

```bash
npx wrangler secret put BLUESKY_APP_PASSWORD -c ./wrangler.jsonc
```

**アカウントのパスワードを入れない。** App Password は Bluesky の設定
（Settings → Privacy and security → App passwords）からいつでも失効させられる。

**両方揃っているときだけ**告知できる（`src/config.ts` の `blueskyCredentials()`）。
`.dev.vars` が両方を空にしてあるので、**手元と CI から本物のタイムラインへは流れない**
（ボタンは押せて `bluesky-not-configured` が返る）。

**テストは資格情報が空であることに安全を預けない。** ユニットテストは上流の fetch を
スタブで止め、E2E は**告知の口そのものを `page.route()` で止める**。投げに行くのは
Worker の中なので、手元の `.dev.vars` に本物を書いた人が E2E を回すと、素通しでは
フィクスチャの記事が本物のタイムラインへ流れる（取り消せない）。

## Astro からの移行（済）

2026-08-29 に完了し、Astro 側（`blog/content/posts/` と `fushihara-net-blog` Worker）は
翌日に消した。**記事の原本は D1 だけ**で、Markdown を読み返したいときは
`git show 1361402:blog/content/posts/<slug>/index.md`。以下は当時の記録。

**やったのは `blog/content/posts/` を zip にして `<mount>/api/import` に投げること
だけ。** `public_id` / `paths` / `media` を省いた frontmatter がそのまま読めるので、
移行用のコードを別に書かずに済んだ。**この形は今も入口として生きている**ので、
別のところから記事を持ち込むときも同じ道を通す（`CONTRACT.md`）。

```bash
npm run db:migrate:local && npm run build && npm run dev   # 別の端末で
cd ../blog/content && zip -r /tmp/migrate.zip posts        # posts/<slug>/index.md の形
curl -X POST http://localhost:8787/blog/api/import \
  -H 'Origin: http://localhost:8787' -F 'file=@/tmp/migrate.zip'
```

`imported` / `failed` / `ignored` が返る。**`failed` と `ignored` が空であること**を
確かめること（記事が 1 本落ちても 200 で返る）。

### Astro の出力と変わるところ

実記事 8 本で突き合わせた結果。**意図した差分**:

| 何 | 変化 |
|---|---|
| タグ | `<span class="tag">` → `<a href="<mount>/tags/…/">`（タグ一覧ページを足したため） |
| 画像 | `/blog/_astro/<hash>.svg` → `<mount>/media/<public_id>/<filename>` |
| 脚注 | 見出しと戻りリンクが英語 → 日本語 |
| sitemap / 一覧 | `<mount>/tags/…` が増える |
| 同日公開の並び | slug 昇順 → **`public_id` 昇順**（下記） |

RSS の全文（`content:encoded`）は、XML として解析すれば上記以外**完全に一致**する。
生の文字列は違って見えるが、これは `"` を `&quot;` に逃がすかどうかの差で、XML の
テキストノードでは不要な逃がし。本体サイトの `/api/blog`（正規表現で読む）も
そのまま通ることを確認済み。

**同日に公開した記事の並びは変わる。** tie-break が `public_id` 昇順なので、
移行の時点で採番された uuid 次第。**同じ日の順序を決めたいときは `published_at` に
時刻を入れる**（この運用は Astro 版から変わっていない）。

`<img>` の `loading` / `decoding` / `width` / `height` は**埋めた**（上の
「`<img>` の属性」）。Astro が付けていたものとの差は、寸法を読めない添付
（AVIF や `viewBox` の無い SVG）で `width` / `height` が出ないことだけ。

## 本番の配線

| 何 | 値 |
|---|---|
| Worker | `fushihara-blog` |
| cron | `30 18 * * *`（UTC。JST 3:30 に控えを取る） |
| route | `fushihara.net/blog*`（**末尾の `*` は必須**。無いとクエリ付き URL に一致しない） |
| Access | アプリ `fushihara-blog`。パスは `blog/admin` と `blog/api` の 2 本（**ワイルドカード無し**） |
| AUD | `wrangler.jsonc` の `ACCESS_AUD`。**アプリを作り直すと変わる**（名前の変更では変わらない） |
| D1 / R2 | `fushihara-net-lily` / `fushihara-net-lily-media`（控えは別バケット `fushihara-net-lily-backup`） |
| secret | `BLUESKY_APP_PASSWORD`（`wrangler secret put`。ハンドルは `vars`） |
| 本体からの参照 | ルート `wrangler.jsonc` の `services`（`BLOG` → `fushihara-blog`） |

**Zero Trust のダッシュボードはメニュー名が変わった。** 旧「Access」は
**Access controls** で、その下に Applications / Policies / Access settings が並ぶ。
AUD タグはアプリを開いた先の **Additional settings の一番下**（かつての Overview では
ない）。セッションの長さは 3 箇所（グローバル / アプリ / ポリシー）にあり、**延ばしたい
なら Access settings の「Set your global session duration」**（既定 24 時間）。優先順位は
ポリシー > アプリ > グローバルだが、グローバルは再ログインの頻度そのものなので、
アプリだけ延ばしてもグローバルが切れれば再ログインになる。

**AUD が合っているかは管理画面を開けば分かる。** ずれていると Access のログインは
通っても lily が JWT を拒否して 403 になるので、記事一覧まで出た時点で一致している。

デプロイは `.github/workflows/deploy-blog.yml` が main への push で行う
（`blog/**` `shared/**` と自分自身が変わったときだけ）。**マイグレーションが先、
`wrangler deploy` が後。** 逆にすると新しい列を読むコードが古いスキーマに当たる。

mount を変えるのは `src/site/meta.ts` の `MOUNT_PATH` 1 行。テストも E2E も
そこから引いているので、mount の往復で spec を書き換えずに済む。

**配線を動かす手順は `SWITCHOVER.md`。** 順序を間違えると公開ブログを締め出すので、
その場で考えずにあれを読むこと。

### ここで踏んだ罠

- **Access のパスは文字列の前方一致。** アプリのパスに `blog` を入れると
  `/blog` だけでなく **`/blog-next` も掴む**。並走を始めるときにこれをやって、
  **当時の公開ブログを読者ごと締め出した**（RSS も含めて全部 Access のログインへ
  302 した）。`/blog/admin` に絞った今も、将来 `/blogroll` のようなパスを足すと
  巻き添えになる
- **`routes` を書くと `wrangler dev` のリクエスト host が実ドメインになる。**
  route のゾーン（`fushihara.net`）を origin として渡すので、`localhostOnly` が
  「ローカルではない host」として拒否し、**管理画面も E2E のフィクスチャ投入も
  403 になる**。`wrangler.jsonc` の `"dev": { "host": "localhost" }` で戻す
- **CI のトークンは「Account API Token」。** deploy ジョブの `db:migrate` が
  `code: 7403`（D1 へのアクセス権限なし）で落ちたときに、User API Token の一覧
  （`dash.cloudflare.com/profile/api-tokens`）を見ても目当てのトークンが無い。
  編集するのは **Manage Account → API Tokens**（`dash.cloudflare.com/<account>/api-tokens`）
  の方で、要るのは **Account / D1 / Edit**。どちらのトークンかは
  `npx wrangler whoami` が教えてくれる（トークンの値は出ない）
- **`.dev.vars` は vitest のプールも読む。** ローカルで Access を打ち消すために
  置いてあるので、ユニットテストから見える `ACCESS_TEAM` も空になる。
  「この deployment は Access を使う」という assertion はテスト環境からは書けない
  （本番の値は `wrangler.jsonc` の `vars`）

### 記事の入れ方（Access の内側）

管理画面に import / export のボタンは無いので、書庫は API へ直接投げる。**Access を
通った JWT が要る**ので、`cloudflared` で人としてログインしてから叩く。

```bash
cloudflared access login https://fushihara.net/blog/
cloudflared access curl https://fushihara.net/blog/api/import \
  -X POST -H 'Origin: https://fushihara.net' -F 'file=@/tmp/migrate.zip'
```

**サービストークンでは通らない。** Access がサービストークンに出す JWT は `sub` が
空文字で（識別子は `common_name` に入る）、`core/auth/access.ts` は `sub` が無いものを
拒否する。だから**機械から叩く口は作らず**、バックアップは Access の外側
（Worker 自身の Cron Trigger）から D1 と R2 を直に読む形にしてある（「バックアップ」の節）。

## E2E

`e2e/blog.spec.ts` は Astro 版の同名ファイル（`git show 1361402:blog/e2e/blog.spec.ts`）
を**そのまま引き継いだもの**。生成器を差し替えても入出力の契約は変わらない、というのが
`CONTRACT.md` の趣旨で、ここがその出番。**lily 固有の API をここに持ち込まない**（HTTP と DOM から見える
ものだけで合否を出す）。

- フィクスチャは `e2e/fixtures/posts/`。**seed に生 SQL を使わない**のは、添付の実体が
  R2 に要るから。import なら D1 と R2 の両方が同時に埋まる（`e2e/seed.setup.ts`）
- **D1 と R2 は dev と分ける。** `--persist-to .wrangler/e2e` に逃がし、起動のたびに
  捨てる。既定の場所を使うと E2E が手元の記事を消してフィクスチャで上書きする
- ポートは 8788（`wrangler dev` の既定 8787 と分ける。`reuseExistingServer: false`
  なので、同じにすると dev を開いたままテストを回せない）
- **状態を変えるテストは 1 プロジェクトだけで走らせる。** desktop と mobile は
  同じサーバーを共有しているので、プレビューの発行・失効が互いに効いてしまう
- `mount` を spec に直接書かない。`e2e/helpers.ts` が `src/site/meta.ts` から読む
  （切り替えのたびに全 spec を書き換えないため）

**`src/site/meta.ts` には import を足さないこと。** E2E と `playwright.config.ts` が
Node からこれを読むので、設定を辿って CSS まで引き込むと起動しなくなる。

**`e2e/` は `tsconfig.e2e.json` で型検査する**（`npm run typecheck` が回す）。
Workers のランタイム型と DOM は同じプロジェクトに入れられないので分けてあるが、
**型検査の外に置かない**こと。`src/` の export を変えたときに Playwright を
回すまで気付けなくなる。

## 増えてから壊れるもの

件数が少ないうちは通ってしまうので、意識して見張る。

- **D1 のバインドパラメータは 1 クエリ 100 個まで。** `IN (?1, ?2, …)` を id の
  数だけ並べるクエリは `core/db/chunk.ts` を通す
- 一覧は **20 件ごと**（`/blog/page/2/`）、フィードは**直近 50 件**、管理画面は
  30 件ごと。全件返していると、記事が増えたぶんだけ重くなる（フィードは全文を
  配るので特に）
- **sitemap は今も全件。** 50,000 URL / 50MB の上限に当たったら分割が要る

## テストの方針

- D1 の制約（`STRICT` / `CHECK` / 部分ユニーク索引）は**生 SQL で叩いて確かめる**。
  アプリ側の検証を通らない経路でも壊れた行が入らないこと自体が仕様なので、
  query layer 越しに見ても検証にならない
- スキーマの正は `migrations/*.sql` の 1 箇所。テストは
  `readD1Migrations()` でそれを読んで適用する。テストだけ別のスキーマを持たない

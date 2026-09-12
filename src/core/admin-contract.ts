/**
 * 管理画面と、それを配る側の**契約**。
 *
 * `core/routes/admin.ts`（差し込む側）・テーマ（公開ページで読む側。`src/site/` と
 * `src/theme/`）・`src/admin/`（管理画面）が同じ値を見る必要があるものだけを置く。
 *
 * **ここは何も import しない**（型を除く）。管理画面は vite で別にバンドルされるので、
 * route のモジュールから値を import すると hono ごとブラウザ側へ運ぶことになる。
 * URL の組み立ては `core/paths.ts` の持ち物で、ここには置かない。
 */
import type { SiteConfig } from './config.ts';

/**
 * 入口 HTML に差し込む `<meta>` の名前。受け皿は `src/admin/index.html` にある
 * （HTML だけは import できないので、そこだけ 3 箇所目のリテラルになる）。
 */
export const SITE_META = 'lily:site';

/**
 * meta に載せる中身。**サイト設定そのもの。**
 *
 * 別の型として写さないのは、`SiteConfig` に項目を足したときに設定画面へ勝手に
 * 届くようにするため（写すと、足し忘れても型が通って「設定画面にだけ出ない」で終わる）。
 */
export type AdminSiteMeta = SiteConfig;

/**
 * ログアウトの口を管理画面へ伝える `<meta>` の名前。受け皿は
 * `src/admin/index.html`。
 *
 * **空なら管理画面はボタンを出さない。** ログアウトできるかどうかは認証方式で
 * 決まり（Cloudflare Access のようにセッションを Worker の外が握っていると、
 * 押す物が無い）、それを知っているのは配信の側だけ。ビルド済みの管理画面に
 * 焼き込めないので、サイト設定と同じく配信時に差し込む。
 */
export const LOGOUT_META = 'lily:logout';

/**
 * 「この端末では管理画面を開いたことがある」という目印。**権限は何も持たない。**
 *
 * 公開ページに管理画面へのリンクを出すためだけのもので、リンク先は認証が守っている
 * （偽造しても、出るのはログイン画面へ行くリンクだけ）。
 *
 * **公開ページの HTML を訪問者ごとに変えないため**にこの形にしてある。公開ページは
 * `s-maxage` で共有キャッシュに載るので、ログイン中だけ HTML を変えると、その HTML が
 * 匿名の読者にも配られる（逆に匿名版が載っていると管理者にリンクが出ない）。判定を
 * ブラウザ側でやれば、配る HTML は全員同じままにできる。
 *
 * Cloudflare Access の `CF_Authorization` を直接見られないのは、あれが HttpOnly で
 * JS から読めないため。
 *
 * **名前と値を 1 つの単位で持つ。** 読む側は cookie の 1 項目とこれを丸ごと比べるので、
 * 名前だけを共有すると、値を変えた日に比較が黙って false になる。組み立てる側
 * （付けるのと消すの）は `core/admin-hint.ts`。
 */
export const ADMIN_HINT_NAME = 'lily_admin';
export const ADMIN_HINT_VALUE = '1';
export const ADMIN_HINT = `${ADMIN_HINT_NAME}=${ADMIN_HINT_VALUE}`;

/** 目印の寿命（秒）。切れても管理画面を開き直せば付き直る。 */
export const ADMIN_HINT_MAX_AGE = 60 * 60 * 24 * 30;

/**
 * 管理画面へのリンクに付ける class。**目印を読む側と書く側の待ち合わせ場所。**
 *
 * テーマがリンクを出し、下のスクリプトがそれを探す。文字列を 2 箇所に書くと、
 * 片方を変えた日にリンクが黙って出なくなる（画面には何も出ないので気付けない）。
 */
export const ADMIN_LINK_CLASS = 'admin-link';

/**
 * 管理画面へのリンクを出すスクリプト。**リンクの実体は最初から HTML にあり、
 * `hidden` で隠してあるだけ。** ここがするのは目印の cookie を見て外すことだけ。
 *
 * **テーマではなく core が持つ。** 見た目の話ではなく、`ADMIN_HINT` の cookie を
 * どう読むかという契約そのもので、テーマごとに書き直す理由がない（実際、
 * `src/site/` と `src/theme/` で 1 バイトも違わなかった）。
 *
 * 訪問者ごとに HTML を変えないのがこの形の眼目で、公開ページを共有キャッシュに
 * 載せたまま (`s-maxage`) 管理者にだけリンクを見せられる。cookie を立てるのは
 * `core/routes/admin.ts`。
 *
 * 目印が認証のセッションより長生きすることはある。そのときリンクを押すと
 * ログイン画面に行くだけで、押した人に見えるものは変わらない。
 */
export const ADMIN_LINK_SCRIPT = `(function(){
var link=document.querySelector(${JSON.stringify(`.${ADMIN_LINK_CLASS}`)});
if(!link)return;
var has=document.cookie.split(';').some(function(part){return part.trim()===${JSON.stringify(ADMIN_HINT)}});
if(has)link.hidden=false;
})();`;

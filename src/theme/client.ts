/**
 * 標準テーマがページに直書きする小さなスクリプト。
 *
 * **バンドラを前提にしない。** テーマは HTML を組んで返すだけの Worker 側の
 * モジュールなので、ブラウザで動かすものは文字列として持ち、`<script>` に
 * そのまま入れる。ビルド手順が 1 つも増えないのがこの形の眼目。
 */
/**
 * テーマの選択を保存するキー。
 *
 * **lily 自身の名前空間を使う。** 同じドメインに別のサイトが同居していても、
 * 相手の設定を書き換えない。逆に、親サイトと選択を共有したい deployment は
 * このテーマを写して自分のキーに変える（fushihara.net がそうしている）。
 */
export const STORAGE_KEY = 'lily-theme';

const KEY = JSON.stringify(STORAGE_KEY);

/**
 * 保存済みのテーマを**描画前に** stamp する。`<head>` に置くこと。
 * 遅らせると、OS 設定と違うテーマを選んだ訪問者に一瞬ちらつきが出る。
 */
export const THEME_INIT =
  `try{var t=localStorage.getItem(${KEY});` +
  `if(t==='light'||t==='dark')document.documentElement.dataset.theme=t}catch(e){}`;

/**
 * トグルボタンの挙動。
 *
 * アイコンの出し分けは CSS が `:root[data-theme]` で行うので、ここが持つのは
 * `data-theme` の書き換えと保存、それとラベルの更新だけ。
 *
 * OS 設定に追従するかは保存値ではなく `chosen` フラグで見る。`getItem` は通るのに
 * `setItem` だけ throw する環境 (Safari プライベートモード) で、保存に失敗した
 * ユーザーの選択を OS 側の変更に奪われないため。
 *
 * **ラベルは `data-label-*` 属性から読み、無ければ触らない。** 属性名を変えた日に
 * `setAttribute('aria-label', null)` が走ると、読み上げに文字列 `"null"` が出る
 * （画面には何も出ないので気付けない）。HTML にある中立なラベルのまま残す方がよい。
 */
export const THEME_TOGGLE = `(function(){
var K=${KEY},root=document.documentElement,button=document.querySelector('.theme-toggle');
if(!button)return;
var mql=window.matchMedia('(prefers-color-scheme: dark)');
function read(){try{return localStorage.getItem(K)}catch(e){return null}}
function write(v){try{localStorage.setItem(K,v)}catch(e){}}
var stored=read(),chosen=stored==='light'||stored==='dark';
var theme=chosen?stored:(mql.matches?'dark':'light');
function apply(t){theme=t;root.dataset.theme=t;
var label=button.getAttribute(t==='dark'?'data-label-light':'data-label-dark');
if(!label)return;
button.setAttribute('aria-label',label);button.title=label}
apply(theme);
button.addEventListener('click',function(){chosen=true;var next=theme==='dark'?'light':'dark';write(next);apply(next)});
mql.addEventListener('change',function(e){if(!chosen)apply(e.matches?'dark':'light')});
})();`;

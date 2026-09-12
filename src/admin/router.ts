/**
 * ハッシュのルータ。
 *
 * `<mount>/admin/` がどこにマウントされても動き、サーバー側の設定も要らない。
 * 画面が少ないので、ライブラリを足すより短く済む。
 */
import { computed, ref } from 'vue';
import { ADMIN_HASH } from '../core/paths.ts';
import { takeStashedRoute } from './session.ts';

/**
 * いま見ている画面のハッシュ。
 *
 * **`replaceRoute()` はこれを動かさない**（動かすと画面が作り直される）ので、
 * `location.hash` と食い違っていることがある。新規の画面で下書きが生まれた直後が
 * それで、URL は `#/posts/<id>` を指しているのに `route.publicId` は `null` のまま。
 * **「いまどの記事を編集しているか」を知りたい側は `route` を見ない**
 * （編集画面が `postId` として持っている。`views/PostEditor.vue`）。
 */
const hash = ref(openingHash());

addEventListener('hashchange', () => {
  hash.value = currentHash();
});

function currentHash(): string {
  return location.hash.slice(1) || '/';
}

/**
 * 開くときのハッシュ。
 *
 * セッションが切れて読み込み直したときは、**Access のリダイレクトでフラグメントが
 * 落ちて**一覧に戻ってしまう（`#` はサーバーへ送られないので、リダイレクト先に
 * 引き継ぎようがない）。開いていた画面を退避してあるならそこへ戻す。
 *
 * 履歴には積まない。読み込み直しは操作ではないので、「戻る」で一覧に落ちるより
 * 開いていた画面のままの方が辻褄が合う。
 */
function openingHash(): string {
  // **先に消費する。** `location.reload()` はフラグメントを保つし、Access の
  // リダイレクトも引き継ぐことがある。残したままにすると、あとで
  // `<mount>/admin/` を開いた瞬間（公開ページの管理リンク等）に、無関係な
  // 古い記事の編集画面へ勝手に飛ぶ。
  const stashed = takeStashedRoute();

  const current = currentHash();
  if (current !== '/') return current;
  if (stashed === null || stashed === '/') return '/';
  replaceRoute(stashed);
  return stashed;
}

export type Route =
  | { readonly name: 'list' }
  | { readonly name: 'settings' }
  | { readonly name: 'editor'; readonly publicId: string | null };

export const route = computed<Route>(() => {
  const path = hash.value;
  if (path === '/settings') return { name: 'settings' };
  if (path === NEW_POST_ROUTE) return { name: 'editor', publicId: null };
  // **接頭辞は組む側と同じものを使う。** 公開ページの編集リンク
  // (`src/site/layout.ts` が `urls.adminPost()` で組む) と食い違うと、
  // 押しても一覧が開くだけで気付けない。
  if (path.startsWith(ADMIN_HASH.postPrefix)) {
    const publicId = decodeURIComponent(path.slice(ADMIN_HASH.postPrefix.length));
    if (publicId !== '') return { name: 'editor', publicId };
  }
  return { name: 'list' };
});

/** 記事を開くハッシュ。`go()` に渡す。 */
export function postRoute(publicId: string): string {
  return `${ADMIN_HASH.postPrefix}${publicId}`;
}

/** 新規作成の画面。**記事の identity は uuid なので `new` と衝突しない。** */
export const NEW_POST_ROUTE = `${ADMIN_HASH.postPrefix}new`;

export function go(path: string): void {
  location.hash = path;
}

/**
 * 開いている画面はそのままに、**URL だけ**を差し替える。
 *
 * `history.replaceState` は `hashchange` を出さないので、`hash` も `route` も
 * 動かない（上の `hash` の注記）。**それが目的**で、動かすと `App.vue` の `key` が
 * 変わって画面が作り直される。使うのは「画面はそのままだが URL は変わった」
 * 場面だけ ―― 読み込み直しの寄せ直し（`openingHash`）と、新規の画面で下書きが
 * 生まれたとき（`views/PostEditor.vue` の `createdId`）。
 *
 * 履歴にも積まない。どちらも人が起こした遷移ではないので、「戻る」で行ける先に
 * 増やす理由が無い。
 */
export function replaceRoute(path: string): void {
  history.replaceState(null, '', `#${path}`);
}

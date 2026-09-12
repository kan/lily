/**
 * 「この端末では管理画面を開いたことがある」という目印の cookie。
 *
 * **付ける側と消す側を隣に置く。** 属性（`Path` / `Secure`）が揃っていないと
 * 消えず、そのとき起きるのは「共有の端末に Admin のリンクが残り続ける」だけで、
 * 画面にもテストにも異常が出ない。離れた 2 箇所の目視に頼らせない。
 *
 * 何のための目印かは `admin-contract.ts`（権限は何も持たない。公開ページの HTML を
 * 訪問者ごとに変えずにリンクを出すためのもの）。
 */
import { serializeCookie } from './auth/index.ts';
import { ADMIN_HINT_MAX_AGE, ADMIN_HINT_NAME, ADMIN_HINT_VALUE } from './admin-contract.ts';

/**
 * 目印を付ける。**HttpOnly を付けない**（公開ページの JS が読むためのもの）。
 * 付けるのは管理画面の入口 HTML を配るとき（`routes/admin.ts`）。
 */
export function setAdminHint(requestUrl: string, mount: string): string {
  return hint(requestUrl, mount, ADMIN_HINT_VALUE, ADMIN_HINT_MAX_AGE);
}

/** 目印を消す。ログアウトを通ったとき（`routes/require-auth.ts`）。 */
export function clearAdminHint(requestUrl: string, mount: string): string {
  return hint(requestUrl, mount, '', 0);
}

function hint(requestUrl: string, mount: string, value: string, maxAge: number): string {
  return serializeCookie(ADMIN_HINT_NAME, value, {
    path: `${mount}/`,
    maxAge,
    requestUrl,
  });
}

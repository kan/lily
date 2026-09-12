/**
 * この deployment でログアウトできるか。**`core/routes/admin.ts` が差し込む。**
 *
 * 空なら（Cloudflare Access のようにセッションを Worker の外が握っている方式なら）
 * ボタンを出さない。押しても何も起きないボタンを置かないため。
 *
 * `site.ts` と同じく読むのは 1 度だけ。値が変わるのはデプロイのときで、そのとき
 * HTML ごと入れ替わる。
 */
import { LOGOUT_META } from '../core/admin-contract.ts';
import { readMeta } from './site.ts';

export const LOGOUT_URL: string = readMeta(LOGOUT_META);

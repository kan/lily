/**
 * このデプロイのサイト設定。**`core/routes/admin.ts` が入口 HTML に差し込む。**
 *
 * ビルド成果物に焼かないのは `api.ts` の `MOUNT` と同じ理由（mount も設定も
 * deployment の持ち物で、管理画面の成果物はどこにマウントしても同じものを使う）。
 *
 * 読むのは 1 度だけ。設定が変わるのはデプロイのときで、そのとき HTML ごと入れ替わる。
 */
import { SITE_META, type AdminSiteMeta } from '../core/admin-contract.ts';
import { MOUNT } from './api.ts';

export type Site = AdminSiteMeta;

/**
 * 差し込みが無いとき（vite の生成物を直に開いたとき）の値。**ここで落とさない。**
 * 設定が読めないだけで編集できなくなる理由は無い。
 */
const FALLBACK: Site = {
  name: 'lily',
  description: '',
  author: '',
  url: location.origin,
  lang: '',
  // 差し込みが無いときは端末の設定で切り出す。ここで throw する値を残すと、
  // 日付を組む `date.ts` が読み込み時に落ちて画面ごと出なくなる。
  timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  // 管理画面は OGP の絵を出さないので、空の 1 枚で足りる。
  ogImage: { url: '', width: null, height: null },
};

export const SITE: Site = read();

/**
 * 画面に出すマウント位置。**root mount は空文字なので `/` と書く。**
 *
 * `MOUNT` から導く（設定として運ばない）。管理画面は自分がどこに配られたかを
 * `api.ts` で既に割り出していて、API のベース URL もそれで組んでいる。
 */
export const MOUNT_LABEL: string = MOUNT === '' ? '/' : MOUNT;

/**
 * 配信時に差し込まれた値を読む。**受け皿は `index.html` にある。**
 * 差し込みが無ければ空文字（vite の生成物を直に開いたとき）。
 */
export function readMeta(name: string): string {
  return document.querySelector<HTMLMetaElement>(`meta[name="${name}"]`)?.content ?? '';
}

function read(): Site {
  const content = readMeta(SITE_META);
  if (!content) return FALLBACK;
  let site: Site;
  try {
    site = { ...FALLBACK, ...(JSON.parse(content) as Partial<Site>) };
  } catch {
    return FALLBACK;
  }
  // 読めないタイムゾーンは `Intl` が throw する。設定の綴り違いで管理画面が
  // 開かなくなるより、端末の設定で切り出して開けるほうがよい。
  return usableTimeZone(site.timeZone) ? site : { ...site, timeZone: FALLBACK.timeZone };
}

function usableTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    console.warn(`lily admin: タイムゾーンを読めないので端末の設定で切り出す (${timeZone})`);
    return false;
  }
}

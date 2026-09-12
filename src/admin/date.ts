/**
 * 管理画面の日付。**サイトのタイムゾーン（`SiteConfig.timeZone`）で切り出す。**
 *
 * 規則そのものは `core/date.ts`（DOM に触れない純粋な部品）にあり、ここは
 * 設定に束ねるだけ。標準テーマも同じものを読むので、編集画面と公開ページで
 * 日付がずれない。
 */
import { createDateFormat } from '../core/date.ts';
import { SITE } from './site.ts';

export const { isoDate, toDateTimeInput, fromDateTimeInput } = createDateFormat(SITE.timeZone);

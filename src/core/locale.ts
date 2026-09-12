/**
 * 画面の文言の言語。**配信する記事の言語（`SiteConfig.lang`）とは別物。**
 *
 * 両者は普通は揃う（日本語のブログの「次のページ」は日本語でよい）ので、既定は
 * `lang` から取る。ずらしたい deployment は `SiteConfig.uiLang` を置く。
 *
 * **`Accept-Language` では選ばない。** 公開ページは共有キャッシュに載るが、
 * Cloudflare のエッジは `Accept-Encoding` 以外の `Vary` を無視するので、ある読者に
 * 返した言語がそのまま次の読者へ配られる（画像の内容交渉で同じ理屈を踏んでいる。
 * `media/optimize.ts`）。**管理画面は別**で、あちらは認証の内側にあって共有
 * キャッシュに載らないため、ブラウザの言語で選んでよい（`admin/i18n.ts`）。
 *
 * 増やすときは、この型に足して各表（`theme/text.ts`・`auth/login-page.ts`・
 * `admin/i18n.ts`）を埋める。**型が揃っていないと落ちる**ので、書き忘れた表が
 * 残ることはない。
 */
export const LOCALES = ['en', 'ja'] as const;

export type Locale = (typeof LOCALES)[number];

/** 既定。**表に無い言語はここへ落とす。** */
export const DEFAULT_LOCALE: Locale = 'en';

/**
 * BCP 47 のタグ（`ja`・`ja-JP`・`en-GB`）から表を選ぶ。
 *
 * 見るのは最初のサブタグだけ。`ja-JP` と `ja` で別の表を持つ日が来たら、そのとき
 * 完全一致を先に見る形に足せばよい（今は 2 つしかないので要らない）。
 */
export function resolveLocale(tag: string | undefined): Locale {
  if (tag === undefined) return DEFAULT_LOCALE;
  const primary = tag.toLowerCase().split('-')[0];
  return LOCALES.find((locale) => locale === primary) ?? DEFAULT_LOCALE;
}

/**
 * 設定から画面の言語を決める。**「`uiLang` が無ければ `lang`」を持つのはここだけ。**
 *
 * 読むのは標準テーマ（`theme/text.ts`）と core のログイン画面（`core/app.ts` が
 * `AuthContext` に載せる）の 2 つ。写すと、既定を変えた日に片方だけが古い規則で
 * 選ぶことになる。
 */
export function siteLocale(site: { readonly lang: string; readonly uiLang?: string }): Locale {
  return resolveLocale(site.uiLang ?? site.lang);
}

import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LOCALE,
  LOCALES,
  resolveLocale,
  resolveLocales,
  siteLocale,
} from '../src/core/locale.ts';
import { textFor } from '../src/theme/text.ts';

/**
 * 画面の文言の言語。**決め方は 1 箇所（`core/locale.ts`）**にあり、標準テーマと
 * core のログイン画面がそこから引く。
 */
describe('文言の言語', () => {
  it('BCP 47 の最初のサブタグで選ぶ', () => {
    expect(resolveLocale('ja')).toBe('ja');
    expect(resolveLocale('ja-JP')).toBe('ja');
    expect(resolveLocale('JA-jp')).toBe('ja');
    expect(resolveLocale('en-GB')).toBe('en');
  });

  /** **表に無い言語でも画面は出る。** 落ちる先が無いと、その deployment は開かない。 */
  it('表の無い言語と未設定は既定に落ちる', () => {
    expect(resolveLocale('fr')).toBe(DEFAULT_LOCALE);
    expect(resolveLocale('')).toBe(DEFAULT_LOCALE);
    expect(resolveLocale(undefined)).toBe(DEFAULT_LOCALE);
  });

  /**
   * ブラウザは希望の言語を並びで持つ（`navigator.languages`）。**先頭だけを見ない** ——
   * 1 番目が表に無い言語の人に、2 番目に置いた言語があっても英語で出してしまう。
   */
  it('候補の並びは、表のあるものが最初に見つかるまで見る', () => {
    expect(resolveLocales(['zh-CN', 'ja-JP', 'en'])).toBe('ja');
    expect(resolveLocales(['fr', 'de'])).toBe(DEFAULT_LOCALE);
    expect(resolveLocales([])).toBe(DEFAULT_LOCALE);
  });

  /**
   * `lang` は**配信する記事**の言語で、`uiLang` は**画面の文言**の言語。
   * 普通は揃うので既定は `lang` から取り、ずらしたい deployment だけが `uiLang` を置く。
   */
  it('uiLang があればそちら、無ければ lang', () => {
    expect(siteLocale({ lang: 'ja' })).toBe('ja');
    expect(siteLocale({ lang: 'ja', uiLang: 'en' })).toBe('en');
    expect(siteLocale({ lang: 'en', uiLang: 'ja-JP' })).toBe('ja');
  });

  /**
   * **表は言語ごとに同じ形。** 型が揃っているかはコンパイルが見るが、
   * 中身が空のまま足された行はここで落とす。
   */
  it('どの言語の表も、同じキーが埋まっている', () => {
    for (const locale of LOCALES) {
      const text = textFor(locale);
      for (const [key, value] of Object.entries(text)) {
        if (typeof value === 'function') continue;
        expect(value, `${locale}.${key}`).not.toBe('');
      }
      expect(text.page(2), locale).toContain('2');
      expect(text.tagPage('dev'), locale).toContain('dev');
    }
  });
});

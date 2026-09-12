/**
 * RSS 2.0 と Atom。どちらも**全文**を配る。
 *
 * 機械可読の供給 (`posts.json`) と読者向けの配信 (フィード) は別物として扱う。
 * 本体サイトの Blog 付箋はいずれ `posts.json` に移すが、購読者のリーダーには
 * 今までどおり全文を届け続ける。
 */
import type { SiteConfig } from '../config.ts';
import type { Urls } from '../paths.ts';
import { iso8601, rfc822, xmlAttr, xmlText } from './xml.ts';

export type FeedEntry = {
  /** 不変の identity。Atom の `<id>` に使う。 */
  readonly publicId: string;
  readonly title: string;
  readonly description: string | null;
  /** canonical の絶対 URL。 */
  readonly url: string;
  readonly publishedAt: Date;
  readonly updatedAt: Date;
  /** 絶対 URL 化と色の展開まで済ませた本文 HTML。 */
  readonly html: string;
};

const XML_DECLARATION = '<?xml version="1.0" encoding="UTF-8"?>';

/**
 * RSS 2.0。**URL も形式も現行を維持する** (購読者のリーダーが握っている)。
 *
 * `guid` は記事の URL のまま。`urn:uuid:` に変えると、既存の購読者全員に
 * 全記事が「新着」として配り直されてしまう。URL を変えない約束
 * (CONTRACT.md) と合わせて、これで identity として成立している。
 */
export function buildRss(site: SiteConfig, urls: Urls, entries: readonly FeedEntry[]): string {
  const items = entries.map((entry) =>
    [
      '<item>',
      `<title>${xmlText(entry.title)}</title>`,
      `<link>${xmlText(entry.url)}</link>`,
      `<guid isPermaLink="true">${xmlText(entry.url)}</guid>`,
      entry.description === null ? '' : `<description>${xmlText(entry.description)}</description>`,
      `<pubDate>${rfc822(entry.publishedAt)}</pubDate>`,
      `<content:encoded>${xmlText(entry.html)}</content:encoded>`,
      '</item>',
    ].join(''),
  );

  return [
    XML_DECLARATION,
    '<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/">',
    '<channel>',
    `<title>${xmlText(site.name)}</title>`,
    `<description>${xmlText(site.description)}</description>`,
    // チャンネルの link はブログのルート。サイトの origin を渡すと、リーダーの
    // 「サイトを開く」がポートフォリオ側に飛んでしまう。
    `<link>${xmlText(urls.index({ absolute: true }))}</link>`,
    ...items,
    '</channel>',
    '</rss>',
  ].join('');
}

/**
 * Atom。こちらは新設なので `<id>` に `urn:uuid:` を使える。
 *
 * URL ではなく `public_id` を identity にしておくと、記事のパスを変えても
 * リーダーの中で同じ記事として扱われる。
 */
export function buildAtom(site: SiteConfig, urls: Urls, entries: readonly FeedEntry[]): string {
  const self = urls.feed('atom', { absolute: true });
  const home = urls.index({ absolute: true });
  const updated = entries.reduce<Date | null>(
    (newest, entry) => (newest === null || entry.updatedAt > newest ? entry.updatedAt : newest),
    null,
  );

  const items = entries.map((entry) =>
    [
      '<entry>',
      `<title>${xmlText(entry.title)}</title>`,
      `<link rel="alternate" type="text/html" href="${xmlAttr(entry.url)}"/>`,
      `<id>urn:uuid:${xmlText(entry.publicId)}</id>`,
      `<published>${iso8601(entry.publishedAt)}</published>`,
      `<updated>${iso8601(entry.updatedAt)}</updated>`,
      entry.description === null ? '' : `<summary>${xmlText(entry.description)}</summary>`,
      `<content type="html">${xmlText(entry.html)}</content>`,
      '</entry>',
    ].join(''),
  );

  return [
    XML_DECLARATION,
    '<feed xmlns="http://www.w3.org/2005/Atom">',
    `<title>${xmlText(site.name)}</title>`,
    `<subtitle>${xmlText(site.description)}</subtitle>`,
    `<link rel="alternate" type="text/html" href="${xmlAttr(home)}"/>`,
    `<link rel="self" type="application/atom+xml" href="${xmlAttr(self)}"/>`,
    `<id>${xmlText(home)}</id>`,
    // 空のフィードでも <updated> は必須。記事が無いときだけ現在時刻で埋める。
    `<updated>${iso8601(updated ?? new Date())}</updated>`,
    `<author><name>${xmlText(site.author)}</name></author>`,
    ...items,
    '</feed>',
  ].join('');
}

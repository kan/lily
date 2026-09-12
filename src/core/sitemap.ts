/**
 * サイトマップ。**URL は現行 (`sitemap-index.xml` + `sitemap-0.xml`) を維持する。**
 */
import { iso8601, xmlText } from './feed/xml.ts';

export type SitemapEntry = {
  readonly url: string;
  readonly lastModified?: Date;
};

export function buildSitemapIndex(childUrl: string): string {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    `<sitemap><loc>${xmlText(childUrl)}</loc></sitemap>`,
    '</sitemapindex>',
  ].join('');
}

export function buildSitemap(entries: readonly SitemapEntry[]): string {
  const urls = entries.map((entry) =>
    [
      '<url>',
      `<loc>${xmlText(entry.url)}</loc>`,
      entry.lastModified ? `<lastmod>${iso8601(entry.lastModified)}</lastmod>` : '',
      '</url>',
    ].join(''),
  );

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...urls,
    '</urlset>',
  ].join('');
}

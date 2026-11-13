/**
 * 公開ページの JSON-LD（schema.org）。**組むのは core、ページに埋めるのはテーマ。**
 *
 * 中身は記事と設定から決まるので、テーマごとに書くと 2 本のテーマ（標準と利用側）で
 * 食い違う。テーマには `PageContext.jsonLd` として、`<script type="application/ld+json">`
 * の中にそのまま置ける文字列を渡す。
 *
 * 著者・サイトの情報は `SiteConfig` から取る。**lily は特定のサイトを知らない**ので、
 * 設定に無いもの（`authorUrl` / `sameAs`）は項目ごと出さない。
 */
import type { SiteConfig } from '../config.ts';
import type { Urls } from '../paths.ts';
import type { PostView, TagView } from '../theme.ts';

type JsonLd = { readonly [key: string]: unknown };

const CONTEXT = 'https://schema.org';

/** 記事。`url` は canonical の絶対 URL。 */
export function postJsonLd(site: SiteConfig, urls: Urls, post: PostView, url: string): string {
  return serialize({
    '@context': CONTEXT,
    '@type': 'BlogPosting',
    headline: post.title,
    description: post.description ?? undefined,
    url,
    mainEntityOfPage: url,
    datePublished: post.publishedAt?.toISOString(),
    dateModified: post.updatedAt.toISOString(),
    inLanguage: site.lang,
    image: post.image?.url ?? site.ogImage.url,
    keywords: post.tags.length === 0 ? undefined : post.tags.map((t) => t.name),
    author: person(site),
    isPartOf: blog(site, urls),
  });
}

/** トップ（とそのページ送り）。ブログそのもの。 */
export function blogJsonLd(site: SiteConfig, urls: Urls): string {
  return serialize({
    '@context': CONTEXT,
    ...blog(site, urls),
    description: site.description,
    inLanguage: site.lang,
    author: person(site),
  });
}

/** タグの一覧。ブログの中の 1 つの集まり。`url` はそのページの絶対 URL。 */
export function tagJsonLd(site: SiteConfig, urls: Urls, tag: TagView, url: string): string {
  return serialize({
    '@context': CONTEXT,
    '@type': 'CollectionPage',
    name: tag.name,
    url,
    inLanguage: site.lang,
    isPartOf: blog(site, urls),
  });
}

/** ブログ。記事とタグの `isPartOf`、トップの本体。 */
function blog(site: SiteConfig, urls: Urls): JsonLd {
  return { '@type': 'Blog', name: site.name, url: urls.index({ absolute: true }) };
}

/** 書き手。名前が空なら出さない（空の `Person` は何も表さない）。 */
function person(site: SiteConfig): JsonLd | undefined {
  if (site.author.trim() === '') return undefined;
  return {
    '@type': 'Person',
    name: site.author,
    url: site.authorUrl,
    sameAs: site.sameAs?.length ? site.sameAs : undefined,
  };
}

/**
 * エスケープする字。`<` `>` `&` に加えて、行区切り（U+2028）と段落区切り（U+2029）。
 * 後の 2 つは JSON では生のまま書けるが、古い JavaScript の文字列リテラルでは改行として
 * 扱われる。**ソースに生の字を置かない**（編集の道具が改行に変えてしまう）ので、
 * 文字コードから組む。
 */
const UNSAFE = new RegExp(`[<>&${String.fromCharCode(0x2028, 0x2029)}]`, 'g');

/**
 * `<script>` の中に置ける JSON。記事の題に `</script>` と書かれていても、そこで script が
 * 閉じない。JSON としての値は変わらない（エスケープした字は、JSON を読む側が元の字に
 * 戻す）。`undefined` の
 * 項目は `JSON.stringify` が落とす。
 */
function serialize(value: JsonLd): string {
  return JSON.stringify(value).replace(
    UNSAFE,
    (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`,
  );
}

/**
 * 公開側の Agent Ready（issue #59）。`Accept: text/markdown` への出し分け、`Vary` と
 * キャッシュ、`Link` ヘッダ、JSON-LD、404。
 */
import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { setPreviewToken } from '../../src/core/db/posts.ts';
import { createMedia } from '../../src/core/db/media.ts';
import { createPaths } from '../../src/core/paths.ts';
import { MARKDOWN, SHORT_EDGE } from '../../src/core/routes/cache.ts';
import { hashPreviewToken, newPreviewToken } from '../../src/core/tokens.ts';
import { db, resetDb } from '../db/helpers.ts';
import {
  get,
  getRoot,
  getRootWith,
  getWith,
  MOUNT,
  ROOT_SITE_CONFIG,
  seedPost,
  SITE,
  SITE_CONFIG,
} from './helpers.ts';

beforeEach(resetDb);

const MD = { headers: { Accept: 'text/markdown' } };
const BROWSER = {
  headers: { Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8' },
};

// **URL の組み方は本体から取る**（テストだけ別の組み方を持たない）。
const { urls } = createPaths({ site: SITE_CONFIG, mountPath: MOUNT });

describe('記事の Markdown 版', () => {
  it('Accept: text/markdown には原本の Markdown を、frontmatter と見出しを付けて返す', async () => {
    await seedPost({
      title: '題',
      path: 'md-post',
      bodyMd: '本文の *強調*。\n',
      description: '説明',
      tags: ['lily'],
      publishedAt: '2026-08-01T00:00:00.000Z',
    });

    const res = await getWith(`${MOUNT}/md-post/`, MD);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/markdown; charset=utf-8');
    expect(await res.text()).toBe(
      [
        '---',
        'title: 題',
        'description: 説明',
        `url: ${SITE}${MOUNT}/md-post/`,
        // タイムゾーンは設定の Asia/Tokyo。UTC の 0 時は同じ日の 9 時
        'published: 2026-08-01',
        `updated: ${(await updatedDate('md-post'))}`,
        'tags:',
        '  - lily',
        'lang: ja',
        '---',
        '',
        '# 題',
        '',
        '本文の *強調*。',
        '',
      ].join('\n'),
    );
  });

  it('添付の相対参照は絶対 URL に直し、その URL が実際に配れる', async () => {
    const post = await seedPost({ path: 'md-image', bodyMd: '![図](./sample.png)\n' });
    const media = await createMedia(db, {
      postId: post.id,
      filename: 'sample.png',
      r2Key: 'posts/md-image/sample.png',
      mime: 'image/png',
      bytes: 3,
    });
    await env.MEDIA.put(media.r2_key, 'png');

    const body = await (await getWith(`${MOUNT}/md-image/`, MD)).text();
    const url = urls.media(media, { absolute: true });
    expect(body).toContain(`![図](<${url}>)`);

    const image = await get(new URL(url).pathname);
    expect(image.status).toBe(200);
    expect(await image.text()).toBe('png');
  });

  it('ブラウザ・Accept 無し・HTML の方が重い Accept には HTML を返す', async () => {
    await seedPost({ path: 'html-post' });
    for (const init of [BROWSER, {}, { headers: { Accept: 'text/html, text/markdown;q=0.9' } }]) {
      const res = await getWith(`${MOUNT}/html-post/`, init);
      expect(res.headers.get('content-type')).toBe('text/html; charset=UTF-8');
      expect(await res.text()).toContain('<!doctype html>');
    }
  });

  it('alias から来ても 308 で canonical へ寄せる（Markdown でも URL は 1 つ）', async () => {
    await seedPost({ path: 'canonical' });
    const res = await getWith(`${MOUNT}/canonical`, MD);
    expect(res.status).toBe(308);
    expect(res.headers.get('location')).toBe(`${MOUNT}/canonical/`);
  });

  it('下書きは Markdown でも 404', async () => {
    await seedPost({ path: 'secret', draft: true });
    expect((await getWith(`${MOUNT}/secret/`, MD)).status).toBe(404);
  });
});

describe('キャッシュと Vary', () => {
  it('HTML も Markdown も Vary: Accept。共有キャッシュに載るのは HTML だけ', async () => {
    await seedPost({ path: 'cached' });

    const html = await getWith(`${MOUNT}/cached/`, BROWSER);
    expect(html.headers.get('vary')).toBe('Accept');
    expect(html.headers.get('cache-control')).toBe(SHORT_EDGE);

    const md = await getWith(`${MOUNT}/cached/`, MD);
    expect(md.headers.get('vary')).toBe('Accept');
    expect(md.headers.get('cache-control')).toBe(MARKDOWN);
    expect(md.headers.get('cache-control')).toContain('private');
  });

  it('一覧・タグ・404 も同じ', async () => {
    await seedPost({ path: 'tagged', tags: ['lily'] });
    for (const path of [`${MOUNT}/`, `${MOUNT}/tags/lily/`, `${MOUNT}/nope/`]) {
      expect((await getWith(path, BROWSER)).headers.get('vary')).toBe('Accept');
      const md = await getWith(path, MD);
      expect(md.headers.get('vary')).toBe('Accept');
      expect(md.headers.get('cache-control')).toBe(MARKDOWN);
    }
  });
});

describe('一覧の Markdown 版', () => {
  it('トップは記事へのリンクを新しい順に並べる', async () => {
    await seedPost({ title: '古い', path: 'old', publishedAt: '2026-01-01T00:00:00.000Z', description: '前' });
    await seedPost({ title: '新しい', path: 'new', publishedAt: '2026-08-01T00:00:00.000Z', description: '後' });

    const res = await getWith(`${MOUNT}/`, MD);
    expect(res.headers.get('content-type')).toBe('text/markdown; charset=utf-8');
    const body = await res.text();
    expect(body).toContain(`title: ${SITE_CONFIG.name}`);
    expect(body).toContain(`url: ${SITE}${MOUNT}/`);
    expect(body).toContain(`# ${SITE_CONFIG.name}`);
    expect(body).toContain(`- [新しい](<${SITE}${MOUNT}/new/>) — 2026-08-01\n  後`);
    expect(body.indexOf('[新しい]')).toBeLessThan(body.indexOf('[古い]'));
  });

  it('ページ送りは frontmatter の prev / next に絶対 URL で載せる', async () => {
    for (let i = 0; i < 25; i++) {
      await seedPost({
        path: `p${i}`,
        publishedAt: `2026-01-${String(i + 1).padStart(2, '0')}T00:00:00.000Z`,
      });
    }
    const first = await (await getWith(`${MOUNT}/`, MD)).text();
    expect(first).toContain(`next: ${SITE}${MOUNT}/page/2/`);
    expect(first).not.toContain('prev:');

    const second = await (await getWith(`${MOUNT}/page/2/`, MD)).text();
    expect(second).toContain(`prev: ${SITE}${MOUNT}/`);
    expect(second).not.toContain('next:');
  });

  it('タグの一覧は見出しがタグの名前', async () => {
    await seedPost({ title: '付いている', path: 'a', tags: ['lily'] });
    await seedPost({ title: '付いていない', path: 'b' });

    const body = await (await getWith(`${MOUNT}/tags/lily/`, MD)).text();
    expect(body).toContain('# lily');
    expect(body).toContain('[付いている]');
    expect(body).not.toContain('[付いていない]');
  });

  it('題の Markdown の記号は記法にしない', async () => {
    await seedPost({ title: '[罠](x) *強調*', path: 'trap' });
    const body = await (await getWith(`${MOUNT}/`, MD)).text();
    expect(body).toContain('- [\\[罠\\](x) \\*強調\\*](<');
  });

  it('説明が行頭の記号で始まっても、入れ子のリストにしない', async () => {
    await seedPost({ path: 'a', description: '- 下書き & 1. メモ' });
    await seedPost({ path: 'b', description: '1. 番号' });
    const body = await (await getWith(`${MOUNT}/`, MD)).text();
    expect(body).toContain('\n  \\- 下書き \\& 1. メモ\n');
    expect(body).toContain('\n  1\\. 番号\n');
  });
});

describe('Link ヘッダ', () => {
  it('HTML の応答は Markdown 版・サイトマップ・フィードを示す', async () => {
    await seedPost({ path: 'linked' });
    const link = (await getWith(`${MOUNT}/linked/`, BROWSER)).headers.get('link');
    expect(link).toContain(`<${SITE}${MOUNT}/linked/>; rel="alternate"; type="text/markdown"`);
    expect(link).toContain(`<${urls.sitemap({ absolute: true })}>; rel="sitemap"`);
    expect(link).toContain(
      `<${urls.feed('rss', { absolute: true })}>; rel="alternate"; type="application/rss+xml"`,
    );
  });

  it('Markdown の応答は HTML 版を示す', async () => {
    await seedPost({ path: 'linked' });
    const link = (await getWith(`${MOUNT}/linked/`, MD)).headers.get('link');
    expect(link).toContain(`<${SITE}${MOUNT}/linked/>; rel="alternate"; type="text/html"`);
  });

  it('一覧はそのページ自身の URL を示す', async () => {
    const link = (await getWith(`${MOUNT}/`, BROWSER)).headers.get('link');
    expect(link).toContain(`<${SITE}${MOUNT}/>; rel="alternate"; type="text/markdown"`);
  });

  it('404 は別の形を示さない（それ自身の URL を持たせない）', async () => {
    const link = (await getWith(`${MOUNT}/nope/`, BROWSER)).headers.get('link');
    expect(link).not.toContain('text/markdown');
    expect(link).toContain('rel="sitemap"');
  });
});

describe('404', () => {
  it('Accept: text/markdown には、ステータスは 404 のまま Markdown を返す', async () => {
    const res = await getWith(`${MOUNT}/nope/`, MD);
    expect(res.status).toBe(404);
    expect(res.headers.get('content-type')).toBe('text/markdown; charset=utf-8');
    const body = await res.text();
    expect(body).toContain('# 404 Not Found');
    expect(body).toContain(`[${SITE_CONFIG.name}](<${SITE}${MOUNT}/>)`);
    expect(body).toContain(`<${urls.sitemap({ absolute: true })}>`);
  });

  it('マウントの外（アプリ全体の 404）も同じ', async () => {
    const res = await getWith('/outside', MD);
    expect(res.status).toBe(404);
    expect(res.headers.get('content-type')).toBe('text/markdown; charset=utf-8');
  });

  it('ブラウザには今までどおり HTML の 404', async () => {
    const res = await getWith(`${MOUNT}/nope/`, BROWSER);
    expect(res.status).toBe(404);
    expect(await res.text()).toContain('<!doctype html>');
  });
});

describe('下書きプレビュー', () => {
  it('Markdown を求められても HTML を返し、残さない', async () => {
    const post = await seedPost({ path: 'draft-post', draft: true });
    const token = newPreviewToken();
    await setPreviewToken(db, post.id, await hashPreviewToken(token));

    const res = await getWith(`${MOUNT}/preview/${token}`, MD);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.text()).not.toContain('application/ld+json');
  });
});

describe('JSON-LD', () => {
  it('記事は BlogPosting。著者に設定の url と sameAs が出る', async () => {
    await seedPost({
      title: '題',
      path: 'ld-post',
      description: '説明',
      tags: ['lily'],
      publishedAt: '2026-08-01T00:00:00.000Z',
    });
    const data = jsonLd(await (await get(`${MOUNT}/ld-post/`)).text());
    expect(data).toMatchObject({
      '@context': 'https://schema.org',
      '@type': 'BlogPosting',
      headline: '題',
      description: '説明',
      url: `${SITE}${MOUNT}/ld-post/`,
      datePublished: '2026-08-01T00:00:00.000Z',
      inLanguage: 'ja',
      keywords: ['lily'],
      image: SITE_CONFIG.ogImage.url,
      author: {
        '@type': 'Person',
        name: SITE_CONFIG.author,
        url: SITE_CONFIG.authorUrl,
        sameAs: SITE_CONFIG.sameAs,
      },
      isPartOf: { '@type': 'Blog', name: SITE_CONFIG.name, url: `${SITE}${MOUNT}/` },
    });
  });

  it('トップは Blog、タグは CollectionPage', async () => {
    await seedPost({ path: 'tagged', tags: ['lily'] });
    expect(jsonLd(await (await get(`${MOUNT}/`)).text())).toMatchObject({
      '@type': 'Blog',
      name: SITE_CONFIG.name,
      url: `${SITE}${MOUNT}/`,
    });
    expect(jsonLd(await (await get(`${MOUNT}/tags/lily/`)).text())).toMatchObject({
      '@type': 'CollectionPage',
      name: 'lily',
    });
  });

  it('設定に url と sameAs が無ければ、著者は名前だけ', async () => {
    const data = jsonLd(await (await getRoot('/')).text());
    expect(data.author).toEqual({ '@type': 'Person', name: ROOT_SITE_CONFIG.author });
  });

  it('題に </script> があっても script が閉じない', async () => {
    await seedPost({ title: '</script><script>alert(1)</script>', path: 'xss' });
    const html = await (await get(`${MOUNT}/xss/`)).text();
    const script = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)?.[1];
    expect(script).not.toContain('<');
    expect(JSON.parse(script!).headline).toBe('</script><script>alert(1)</script>');
  });

  it('404 には出さない', async () => {
    expect(await (await get(`${MOUNT}/nope/`)).text()).not.toContain('application/ld+json');
  });

  it('root mount でも Markdown が返る（mount を焼き付けていない）', async () => {
    const res = await getRootWith('/', 'text/markdown');
    expect(res.headers.get('content-type')).toBe('text/markdown; charset=utf-8');
    expect(await res.text()).toContain(`url: ${ROOT_SITE_CONFIG.url}/`);
  });
});

/** ページの JSON-LD を 1 つ取り出す。 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- 実際に出た JSON を見る（helpers.ts の json と同じ理由）
function jsonLd(html: string): any {
  const script = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)?.[1];
  if (script === undefined) throw new Error('JSON-LD が無い');
  return JSON.parse(script);
}

/** 記事の更新日（設定のタイムゾーンでの日付）。seedPost が今の時刻で書くので、DB から読む。 */
async function updatedDate(path: string): Promise<string> {
  const row = await db
    .prepare(
      'SELECT p.updated_at FROM posts p JOIN post_paths pp ON pp.post_id = p.id WHERE pp.path = ?',
    )
    .bind(path)
    .first<{ updated_at: string }>();
  return new Intl.DateTimeFormat('en-CA', { timeZone: SITE_CONFIG.timeZone }).format(
    new Date(row!.updated_at),
  );
}

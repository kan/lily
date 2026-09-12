import { describe, expect, it } from 'vitest';
import { createPaths } from '../../src/core/paths.ts';
import { renderMarkdown } from '../../src/core/render/index.ts';
import { mediaPlaceholder, resolveMediaUrls } from '../../src/core/render/placeholder.ts';

const MEDIA = { public_id: 'MEDIA-ID', filename: 'sample.png' };
const urlsFor = (url: string, mountPath: string) => createPaths({ site: { url }, mountPath }).urls;
const blog = urlsFor('https://fushihara.net', '/blog');
const next = urlsFor('https://fushihara.net', '/blog-next');
const root = urlsFor('https://blog.example.com', '/');

describe('resolveMediaUrls', () => {
  it('placeholder を配信 URL に差し替える', () => {
    const html = `<img src="${mediaPlaceholder(MEDIA)}" alt="図">`;
    expect(resolveMediaUrls(html, blog)).toBe(
      '<img src="/blog/media/MEDIA-ID/sample.png" alt="図">',
    );
  });

  it('absolute でフィード向けの絶対 URL になる', () => {
    const html = `<img src="${mediaPlaceholder(MEDIA)}">`;
    expect(resolveMediaUrls(html, blog, { absolute: true })).toBe(
      '<img src="https://fushihara.net/blog/media/MEDIA-ID/sample.png">',
    );
  });

  it('同じ body_html から複数の mount の URL が出る (再生成が要らない)', async () => {
    // mountPath を変えても body_html を作り直さなくてよい、という設計の要。
    // /blog-next で並走しているあいだ、同じ D1 の同じ行が両方に正しく出る。
    const { html } = await renderMarkdown('![図](./sample.png)', { media: [MEDIA] });

    expect(resolveMediaUrls(html, blog)).toContain('/blog/media/MEDIA-ID/sample.png');
    expect(resolveMediaUrls(html, next)).toContain('/blog-next/media/MEDIA-ID/sample.png');
    expect(resolveMediaUrls(html, root)).toContain('"/media/MEDIA-ID/sample.png"');
  });

  it('本文に書いた placeholder は書き換えない (開始タグの中だけを見る)', () => {
    const html = `<pre><code>&#x3C;img src="${mediaPlaceholder(MEDIA)}"></code></pre>`;
    expect(resolveMediaUrls(html, blog)).toBe(html);
  });

  it('壊れた placeholder は書き換えずに残す', () => {
    const html = '<img src="lily-media://MEDIA-ID/%E4%B8%8D%E5">';
    expect(resolveMediaUrls(html, blog)).toBe(html);
  });

  it('placeholder が無ければ何もしない', () => {
    const html = '<p>ただの<a href="../x.md">段落</a></p>';
    expect(resolveMediaUrls(html, blog)).toBe(html);
  });
});

describe('mediaPlaceholder', () => {
  it('URL に置ける形で、記事の本文と紛れない独自スキームを使う', () => {
    expect(mediaPlaceholder(MEDIA)).toBe('lily-media://MEDIA-ID/sample.png');
    expect(mediaPlaceholder({ public_id: 'a', filename: '日本 語.png' })).toBe(
      'lily-media://a/%E6%97%A5%E6%9C%AC%20%E8%AA%9E.png',
    );
  });
});

import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { addAlias } from '../../src/core/db/post-paths.ts';
import { setPreviewToken } from '../../src/core/db/posts.ts';
import { createMedia, setOgpMedia } from '../../src/core/db/media.ts';
import { hashPreviewToken, newPreviewToken } from '../../src/core/tokens.ts';
import { db, paths, resetDb } from '../db/helpers.ts';
import { get, getRoot, getWith, MOUNT, seedPost, SITE } from './helpers.ts';

beforeEach(resetDb);

describe('一覧', () => {
  it('公開記事が出て、下書きは出ない', async () => {
    await seedPost({ title: '公開した記事', path: 'shown' });
    await seedPost({ title: '下書きの記事', path: 'hidden', draft: true });

    const res = await get(`${MOUNT}/`);
    const body = await res.text();
    expect(res.status).toBe(200);
    expect(body).toContain('公開した記事');
    expect(body).toContain(`href="${MOUNT}/shown/"`);
    expect(body).not.toContain('下書きの記事');
  });

  it('新しい順に並ぶ', async () => {
    await seedPost({ title: '古い', path: 'old', publishedAt: '2026-01-01T00:00:00.000Z' });
    await seedPost({ title: '新しい', path: 'new', publishedAt: '2026-08-01T00:00:00.000Z' });

    const body = await get(`${MOUNT}/`);
    const text = await body.text();
    expect(text.indexOf('新しい')).toBeLessThan(text.indexOf('古い'));
  });

  it('記事が無くてもページは出る', async () => {
    const res = await get(`${MOUNT}/`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('No posts yet.');
  });

  it('20 件ごとに分かれ、前後のページへ辿れる', async () => {
    for (let i = 0; i < 25; i++) {
      await seedPost({
        path: `p${i}`,
        title: `記事 ${i}`,
        publishedAt: `2026-01-${String(i + 1).padStart(2, '0')}T00:00:00.000Z`,
      });
    }

    const first = await get(`${MOUNT}/`);
    const firstBody = await first.text();
    expect(firstBody.match(/class="post-list"/g)).toHaveLength(1);
    expect(countPosts(firstBody)).toBe(20);
    expect(firstBody).toContain(`href="${MOUNT}/page/2/"`);
    expect(firstBody).toContain(`<link rel="next" href="${MOUNT}/page/2/" />`);
    expect(firstBody).not.toContain('rel="prev"');

    const second = await get(`${MOUNT}/page/2/`);
    const secondBody = await second.text();
    expect(second.status).toBe(200);
    expect(countPosts(secondBody)).toBe(5);
    expect(secondBody).toContain(`<link rel="prev" href="${MOUNT}/" />`);
    expect(secondBody).not.toContain('rel="next"');
  });

  it('1 ページ目には /page/1/ を作らない (同じ中身が 2 つの URL で出ないように)', async () => {
    await seedPost({ path: 'a' });
    const res = await get(`${MOUNT}/page/1/`);
    expect(res.status).toBe(308);
    expect(res.headers.get('location')).toBe(`${MOUNT}/`);
  });

  it('範囲の外のページは 404', async () => {
    await seedPost({ path: 'a' });
    expect((await get(`${MOUNT}/page/2/`)).status).toBe(404);
    expect((await get(`${MOUNT}/page/0/`)).status).toBe(404);
    expect((await get(`${MOUNT}/page/abc/`)).status).toBe(404);
  });

  it('記事が無くても 1 ページ目は出る', async () => {
    expect((await get(`${MOUNT}/`)).status).toBe(200);
    expect((await get(`${MOUNT}/page/2/`)).status).toBe(404);
  });

  it('1 ページで収まるならページ送りを出さない', async () => {
    await seedPost({ path: 'a' });
    expect(await (await get(`${MOUNT}/`)).text()).not.toContain('class="pager"');
  });

  it('マウント直下のスラッシュ無しは 308 で寄せる', async () => {
    const res = await get(`${MOUNT}`);
    expect(res.status).toBe(308);
    expect(res.headers.get('location')).toBe(`${MOUNT}/`);
  });
});

describe('記事', () => {
  it('canonical path で開ける', async () => {
    await seedPost({ title: 'はじめての記事', path: 'start-blog', tags: ['dev'] });

    const res = await get(`${MOUNT}/start-blog/`);
    const body = await res.text();
    expect(res.status).toBe(200);
    expect(body).toContain('<h1 class="post-title">はじめての記事</h1>');
    expect(body).toContain('<h2>見出し</h2>');
    expect(body).toContain(`<link rel="canonical" href="${SITE}${MOUNT}/start-blog/" />`);
    expect(body).toContain(`href="${MOUNT}/tags/dev/"`);
  });

  it('末尾スラッシュ無しは 308 で寄せる', async () => {
    await seedPost({ path: 'start-blog' });
    const res = await get(`${MOUNT}/start-blog`);
    expect(res.status).toBe(308);
    expect(res.headers.get('location')).toBe(`${MOUNT}/start-blog/`);
  });

  it('alias は canonical へ 308', async () => {
    const post = await seedPost({ path: 'now' });
    await addAlias(db, paths, post.id, 'then');

    const res = await get(`${MOUNT}/then/`);
    expect(res.status).toBe(308);
    expect(res.headers.get('location')).toBe(`${MOUNT}/now/`);
  });

  it('public_id でも辿り着ける (identity は URL から独立)', async () => {
    const post = await seedPost({ path: 'now' });
    const res = await get(`${MOUNT}/${post.public_id}/`);
    expect(res.status).toBe(308);
    expect(res.headers.get('location')).toBe(`${MOUNT}/now/`);
  });

  it('大小文字違いも canonical へ 308', async () => {
    await seedPost({ path: 'Start-Blog' });
    const res = await get(`${MOUNT}/start-blog/`);
    expect(res.status).toBe(308);
    expect(res.headers.get('location')).toBe(`${MOUNT}/Start-Blog/`);
  });

  it('308 でクエリ文字列を落とさない', async () => {
    // 計測パラメータ付きの共有リンクは末尾スラッシュ補正に引っかかりやすい。
    // ここで落とすと計測が丸ごと消える (本体側で同種の事故を踏んでいる)。
    await seedPost({ path: 'now' });
    const post = await get(`${MOUNT}/now?utm_source=twitter`);
    expect(post.headers.get('location')).toBe(`${MOUNT}/now/?utm_source=twitter`);

    const index = await get(`${MOUNT}?utm_source=twitter`);
    expect(index.headers.get('location')).toBe(`${MOUNT}/?utm_source=twitter`);

    const tag = await get(`${MOUNT}/tags/dev?utm_source=twitter`);
    expect(tag.headers.get('location')).toBe(`${MOUNT}/tags/dev/?utm_source=twitter`);
  });

  it('連続スラッシュも canonical へ寄せる (同じ記事が 2 つの URL で出ない)', async () => {
    await seedPost({ path: 'now' });
    const res = await get(`${MOUNT}//now/`);
    expect(res.status).toBe(308);
    expect(res.headers.get('location')).toBe(`${MOUNT}/now/`);
  });

  it('308 の飛び先はもう 308 しない', async () => {
    await seedPost({ path: 'now' });
    const first = await get(`${MOUNT}/now`);
    const second = await get(first.headers.get('location')!);
    expect(second.status).toBe(200);
  });

  it('下書きは 404。パスを当てられても 308 で存在が漏れない', async () => {
    await seedPost({ path: 'secret', draft: true });
    expect((await get(`${MOUNT}/secret/`)).status).toBe(404);
    // 末尾スラッシュ無しでも 308 ではなく 404
    expect((await get(`${MOUNT}/secret`)).status).toBe(404);
  });

  it('body_html が無ければ body_md から描画する', async () => {
    await seedPost({ path: 'fresh', bodyMd: '## あとから描画\n', skipRender: true });
    const body = await (await get(`${MOUNT}/fresh/`)).text();
    expect(body).toContain('<h2>あとから描画</h2>');
  });

  it('本文の相対参照が配信 URL に解決され、その URL が実際に配れる', async () => {
    const post = await seedPost({
      path: 'with-image',
      bodyMd: '![図](./sample.png)\n',
      skipRender: true,
    });
    const media = await createMedia(db, {
      postId: post.id,
      filename: 'sample.png',
      r2Key: 'posts/with-image/sample.png',
      mime: 'image/png',
      bytes: 3,
    });
    await env.MEDIA.put(media.r2_key, 'png');

    const body = await (await get(`${MOUNT}/with-image/`)).text();
    const url = `${MOUNT}/media/${media.public_id}/sample.png`;
    expect(body).toContain(`src="${url}"`);
    expect(body).not.toContain('lily-media://');

    // URL を出すだけでは足りない。その URL が本当に画像を返すところまで見る。
    const image = await get(url);
    expect(image.status).toBe(200);
    expect(image.headers.get('content-type')).toBe('image/png');
    expect(await image.text()).toBe('png');
  });
});

/** 一覧に並んだ記事の数。 */
function countPosts(html: string): number {
  return (html.match(/<li>\s*<div class="post-meta">/g) ?? []).length;
}

describe('OGP の絵', () => {
  /** 添付を 1 つ入れて OGP に選ぶ。実体は R2 に要らない（meta を見るだけ）。 */
  async function seedWithOgp(width: number | null = 600, height: number | null = 400) {
    const post = await seedPost({ path: 'start-blog' });
    const media = await createMedia(db, {
      postId: post.id,
      filename: 'card.png',
      r2Key: `posts/${post.public_id}/card.png`,
      mime: 'image/png',
      bytes: 1234,
      width,
      height,
    });
    await setOgpMedia(db, post.id, media.id);
    return { post, media };
  }

  it('選んでいなければサイト共通の 1 枚', async () => {
    await seedPost({ path: 'start-blog' });
    const body = await (await get(`${MOUNT}/start-blog/`)).text();
    expect(body).toContain(`<meta property="og:image" content="${SITE}${MOUNT}/ogp.png" />`);
    expect(body).toContain('<meta property="og:image:width" content="1200" />');
  });

  it('選んだ添付が絶対 URL と実寸で出る', async () => {
    const { media } = await seedWithOgp();
    const body = await (await get(`${MOUNT}/start-blog/`)).text();

    expect(body).toContain(
      `<meta property="og:image" content="${SITE}${MOUNT}/media/${media.public_id}/card.png" />`,
    );
    expect(body).toContain('<meta property="og:image:width" content="600" />');
    expect(body).toContain('<meta property="og:image:height" content="400" />');
    // 共通の絵の寸法が残っていると、切り抜き位置が狂う。
    expect(body).not.toContain('content="1200"');
  });

  it('寸法が読めなかった添付は width / height を出さない', async () => {
    // 共通の絵の 1200x630 を当てると嘘になる。
    await seedWithOgp(null, null);
    const body = await (await get(`${MOUNT}/start-blog/`)).text();
    expect(body).toContain('property="og:image"');
    expect(body).not.toContain('og:image:width');
  });

  it('一覧とタグには出ない（記事の絵はその記事のもの）', async () => {
    await seedWithOgp();
    for (const path of [`${MOUNT}/`, `${MOUNT}/tags/dev/`]) {
      const body = await (await get(path)).text();
      expect(body, path).toContain(`content="${SITE}${MOUNT}/ogp.png"`);
    }
  });
});

describe('説明', () => {
  // 手で書いていない記事でも、一覧と OGP に本文の冒頭が出る。
  const BODY = ['## 見出し', '', '本文の書き出し。ここが説明になる。'].join('\n');

  it('空なら本文の冒頭が一覧に出る', async () => {
    await seedPost({ path: 'auto', description: null, bodyMd: BODY });
    const body = await (await get(`${MOUNT}/`)).text();
    expect(body).toContain('<p class="post-summary">本文の書き出し。ここが説明になる。</p>');
  });

  it('空なら本文の冒頭が記事の meta と OGP に出る', async () => {
    await seedPost({ path: 'auto', description: null, bodyMd: BODY });
    const body = await (await get(`${MOUNT}/auto/`)).text();
    expect(body).toContain('<meta name="description" content="本文の書き出し。ここが説明になる。" />');
    expect(body).toContain(
      '<meta property="og:description" content="本文の書き出し。ここが説明になる。" />',
    );
  });

  it('手で書いた説明が勝つ', async () => {
    await seedPost({ path: 'manual', description: '手で書いた', bodyMd: BODY });
    const body = await (await get(`${MOUNT}/`)).text();
    expect(body).toContain('<p class="post-summary">手で書いた</p>');
    expect(body).not.toContain('本文の書き出し。');
  });
});

describe('タグ', () => {
  it('そのタグの公開記事だけが出る', async () => {
    await seedPost({ title: '開発の記事', path: 'a', tags: ['dev'] });
    await seedPost({ title: '日常の記事', path: 'b', tags: ['life'] });

    const body = await (await get(`${MOUNT}/tags/dev/`)).text();
    expect(body).toContain('開発の記事');
    expect(body).not.toContain('日常の記事');
  });

  it('末尾スラッシュ無しは 308 で寄せる', async () => {
    const res = await get(`${MOUNT}/tags/dev`);
    expect(res.status).toBe(308);
    expect(res.headers.get('location')).toBe(`${MOUNT}/tags/dev/`);
  });

  it('タグの一覧もページで分かれる', async () => {
    for (let i = 0; i < 22; i++) {
      await seedPost({
        path: `t${i}`,
        title: `記事 ${i}`,
        tags: ['dev'],
        publishedAt: `2026-01-${String(i + 1).padStart(2, '0')}T00:00:00.000Z`,
      });
    }

    expect(countPosts(await (await get(`${MOUNT}/tags/dev/`)).text())).toBe(20);

    const second = await get(`${MOUNT}/tags/dev/page/2/`);
    expect(second.status).toBe(200);
    expect(countPosts(await second.text())).toBe(2);

    const first = await get(`${MOUNT}/tags/dev/page/1/`);
    expect(first.status).toBe(308);
    expect(first.headers.get('location')).toBe(`${MOUNT}/tags/dev/`);
    expect((await get(`${MOUNT}/tags/dev/page/9/`)).status).toBe(404);
  });

  it('知らないタグは 404', async () => {
    expect((await get(`${MOUNT}/tags/nope/`)).status).toBe(404);
  });
});

describe('404', () => {
  it('知らないパスは 404 ページ', async () => {
    const res = await get(`${MOUNT}/no-such-post/`);
    expect(res.status).toBe(404);
    expect(await res.text()).toContain('<h1>404</h1>');
  });

  it('canonical と og:url を出さず noindex にする', async () => {
    const body = await (await get(`${MOUNT}/no-such-post/`)).text();
    expect(body).toContain('<meta name="robots" content="noindex" />');
    expect(body).not.toContain('rel="canonical"');
    expect(body).not.toContain('og:url');
  });

  it('保護された予約パスは 404 ではなく 403 (存在の有無を漏らさない)', async () => {
    expect((await get(`${MOUNT}/admin/`)).status).toBe(403);
    expect((await get(`${MOUNT}/api/posts`)).status).toBe(403);
  });

  it('マウントの外も 404', async () => {
    // mount と同じ文字列で始まるだけのパス (`/blogfoo`)。区切りが無いので mount の
    // 中ではない。**連結であって結合ではない**ので、ここだけスラッシュを挟まない。
    expect((await get(`${MOUNT}foo`)).status).toBe(404);
  });
});

describe('下書きプレビュー', () => {
  async function withPreviewToken(): Promise<string> {
    const post = await seedPost({ path: 'draft-post', draft: true, title: '下書きの記事' });
    const token = newPreviewToken();
    await setPreviewToken(db, post.id, await hashPreviewToken(token));
    return token;
  }

  it('トークンがあれば下書きが読める', async () => {
    const res = await get(`${MOUNT}/preview/${await withPreviewToken()}`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('下書きの記事');
  });

  it('残らないようにして、検索にも載せない', async () => {
    const res = await get(`${MOUNT}/preview/${await withPreviewToken()}`);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('x-robots-tag')).toBe('noindex');
    expect(await res.text()).toContain('<meta name="robots" content="noindex" />');
  });

  it('知らないトークンは 404', async () => {
    expect((await get(`${MOUNT}/preview/nope`)).status).toBe(404);
  });
});

describe('スタイルシート', () => {
  it('トークンとブログの CSS を 1 本にして配る', async () => {
    const res = await get(`${MOUNT}/styles.css`);
    const body = await res.text();
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/css');
    expect(res.headers.get('etag')).toBeTruthy();
    // shared/tokens.css 側
    expect(body).toContain('--bg:');
    // blog.css 側
    expect(body).toContain('.prose pre.shiki');
    // 脚注の見出しは sr-only で出るので、隠す CSS が無いと本文に「脚注」が見える
    expect(body).toContain('.sr-only');
  });

  it('If-None-Match が一致したら 304 を返す', async () => {
    const etag = (await get(`${MOUNT}/styles.css`)).headers.get('etag')!;
    const res = await getWith(`${MOUNT}/styles.css`, { headers: { 'If-None-Match': etag } });
    expect(res.status).toBe(304);
    expect(await res.text()).toBe('');
  });
});

describe('mountPath', () => {
  it('root mount でも同じコアで成立する', async () => {
    await seedPost({ path: 'start-blog', title: 'ルートの記事' });

    const index = await getRoot('/');
    expect(index.status).toBe(200);
    expect(await index.text()).toContain('href="/start-blog/"');

    const post = await getRoot('/start-blog/');
    expect(post.status).toBe(200);
    expect(await post.text()).toContain('ルートの記事');

    const redirect = await getRoot('/start-blog');
    expect(redirect.headers.get('location')).toBe('/start-blog/');
  });
});

describe('キャッシュ', () => {
  it('エッジには 60 秒載せ、ブラウザには毎回確認させる', async () => {
    await seedPost({ path: 'start-blog' });
    for (const path of [`${MOUNT}/`, `${MOUNT}/start-blog/`]) {
      const res = await get(path);
      expect(res.headers.get('cache-control'), path).toBe(
        'public, max-age=0, must-revalidate, s-maxage=60',
      );
    }
  });
});

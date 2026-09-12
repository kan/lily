import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { resetDb } from '../db/helpers.ts';
import {
  getRoot,
  ROOT_LANG,
  ROOT_SITE,
  ROOT_SITE_CONFIG,
  seedPost,
  setStubUser,
} from '../routes/helpers.ts';
import { createLily } from '../../src/core/app.ts';
import { defaultTheme } from '../../src/theme/index.ts';

/**
 * 参照実装（`blog/src/site/`）から写したときに消し忘れそうな固有名詞。
 *
 * **lily は自分を載せるサイトを知らない**ので、値そのものをここに書く。
 * 設定から引くと「設定に無いものは検査できない」ことになり、写し漏れを
 * 見つけるという目的に届かない。
 *
 * **大小文字の両方を挙げる。** `toContain` は大小文字を区別するので、
 * `fushihara` だけだと参照実装がフッタに出している著者名
 * （`KAN Fushihara (伏原 幹)`）を写しても素通りする。
 */
const SITE_SPECIFIC = ['fushihara', 'Fushihara', 'ふしはらねっと', '伏原', 'ratatoskr'];

beforeEach(resetDb);

/**
 * 標準テーマ（`src/theme/`）。**root mount のアプリがこれを使っている。**
 *
 * 見張っているのは「サイト固有の値を 1 つも持たない」こと。ここが崩れると、
 * lily を別のサイトに載せたときに fushihara.net の名前や配色が漏れる。
 * レイアウトの細部（class 名や余白）は見ない。テーマは写して直す前提のもので、
 * そこを固定するとテーマを触るたびにテストを書き換えることになる。
 */
describe('標準テーマ', () => {
  async function indexHtml(): Promise<string> {
    return await (await getRoot('/')).text();
  }

  it('サイトの名前・説明・著者・言語を設定から出す', async () => {
    const html = await indexHtml();
    expect(html).toContain(`<html lang="${ROOT_LANG}">`);
    expect(html).toContain('<title>ルート</title>');
    expect(html).toContain('<meta name="description" content="root mount" />');
    expect(html).toContain('<meta property="og:site_name" content="ルート" />');
    // フッタの著作権表示。**設定の author をそのまま出す。**
    expect(html).toContain('someone');
  });

  it('サイト共通の OGP は設定の絶対 URL と寸法をそのまま出す', async () => {
    const html = await indexHtml();
    expect(html).toContain(`<meta property="og:image" content="${ROOT_SITE}/ogp.png" />`);
    // **寸法も設定から。** 1200x630 を焼き込んでいるとここで落ちる。
    expect(html).toContain('<meta property="og:image:width" content="800" />');
    expect(html).toContain('<meta property="og:image:height" content="400" />');
  });

  it('記事ページは og:type が article で、絵を選んでいなければ共通の 1 枚に落ちる', async () => {
    await seedPost({ path: 'start-blog' });
    const html = await (await getRoot('/start-blog/')).text();
    expect(html).toContain('<meta property="og:type" content="article" />');
    expect(html).toContain(`<meta property="og:image" content="${ROOT_SITE}/ogp.png" />`);
  });

  it('特定のサイトの固有名詞が 1 つも混ざっていない', async () => {
    // 参照実装から写したときに、固有名詞を消し忘れていないか。
    // **記事とタグを実際に出す。** 種を撒かないと記事ページもタグページも 404 に
    // なり、404 の HTML を 3 回見るだけになる（postPage / tagPage / postList /
    // postMeta / pager を 1 行も通らない）。
    await seedPost({ path: 'start-blog', tags: ['dev'] });

    const paths = ['/', '/start-blog/', '/tags/dev/', '/no-such-page/'];
    const pages = await Promise.all(
      paths.map(async (path) => {
        const res = await getRoot(path);
        // 404 だけは 404 であること。他が黙って 404 になると検査が骨抜きになる。
        expect(res.status, path).toBe(path === '/no-such-page/' ? 404 : 200);
        return await res.text();
      }),
    );
    // 記事ページとタグページが実際に記事を出していること。
    expect(pages[1], '記事ページに本文が無い').toContain('start-blog');
    expect(pages[2], 'タグページに記事が無い').toContain('href="/start-blog/"');

    for (const html of pages) {
      for (const leaked of SITE_SPECIFIC) {
        expect(html, `${leaked} が漏れている`).not.toContain(leaked);
      }
    }
  });

  it('日付は設定のタイムゾーンと言語で組む', async () => {
    // 2026-08-19T23:00Z。root mount は timeZone: 'UTC' なので 8/19 のまま
    // （JST を焼き込んでいると 8/20 になる）。
    await seedPost({ path: 'start-blog', publishedAt: '2026-08-19T23:00:00.000Z' });
    const html = await (await getRoot('/start-blog/')).text();
    expect(html).toContain('<time datetime="2026-08-19">');
    // 読み手向けの表記は lang（'en'）で組む。`2026/08/19` は JST 前提の書式。
    expect(html).toContain('Aug 19, 2026');
    expect(html).not.toContain('2026/08/19');
  });

  it('mount を知らない（URL は core が組む）', async () => {
    await seedPost({ path: 'start-blog' });
    const html = await indexHtml();
    expect(html).toContain('href="/rss.xml"');
    expect(html).toContain('href="/styles.css"');
    expect(html).toContain('href="/start-blog/"');
    expect(html).not.toContain('/blog/');
  });

  it('配るスタイルシートは 1 本で、外部へ取りに行かない', async () => {
    const css = await (await getRoot('/styles.css')).text();
    expect(css.length).toBeGreaterThan(0);
    // **npm で配るテーマが第三者へリクエストを出さない。** 利用側の CSP と
    // プライバシー方針を勝手に決めることになる。
    expect(css).not.toContain('@import');
    expect(css).not.toMatch(/https?:\/\//);
    const html = await indexHtml();
    expect(html).not.toContain('fonts.googleapis.com');
    expect(html).not.toContain('fonts.gstatic.com');
  });

  it('タブのアイコンは設定の URL をそのまま出す', async () => {
    // 標準テーマはアセットの**ファイル名を知らない**。`assets` に何を挙げるかは
    // deployment 次第なので、決め打ちで書くと存在しない URL を指す。
    const html = await indexHtml();
    expect(html).toContain(`<link rel="icon" href="${ROOT_SITE}/favicon.ico" />`);
    // 名前から他の 2 点を推測して足したりしない。
    expect(html).not.toContain('apple-touch-icon');
    expect(html).not.toContain('favicon.svg');
  });

  it('favicon が未設定なら link を出さない', async () => {
    const { favicon: _omitted, ...withoutFavicon } = ROOT_SITE_CONFIG;
    const bare = createLily({
      site: withoutFavicon,
      mountPath: '/',
      theme: defaultTheme,
      auth: () => ({ name: 'stub', authenticate: async () => ({ ok: false, reason: 'x' }) }),
    });
    const html = await (await bare.fetch(new Request(`${ROOT_SITE}/`), env)).text();
    expect(html).not.toContain('rel="icon"');
  });

  it('管理画面のリンクは全員に配り、hidden で隠す', async () => {
    // 訪問者ごとに HTML を変えると、共有キャッシュに載ったそれが読者に配られる。
    setStubUser(null);
    const html = await indexHtml();
    // **`hidden` はそのタグの中にあること。** 素の `toContain('hidden')` は
    // アイコンの `aria-hidden="true"` に当たるので、属性を消しても通ってしまう。
    expect(html).toMatch(/<a class="admin-link"[^>]*\shidden[\s>]/);
  });

  it('記事が 0 件のときは空の一覧を出さない', async () => {
    // 標準テーマが一番よく見られるのは「まだ 1 本も書いていない」状態。
    // 文言と空の `ul` を両方出すと、理由の分からない余白がその下に残る。
    const html = await indexHtml();
    expect(html).toContain('No posts yet.');
    expect(html).not.toContain('class="post-list"');
  });

  it('読めない lang でもページを落とさない', async () => {
    // `lang` は deployment の設定。`en_US` のような書き方は
    // `Intl.DateTimeFormat` が throw するので、日付のある全ページが 500 になりうる。
    // 他の場所では `<html lang>` に出るだけで黙って劣化するので、ここも揃える。
    await seedPost({ path: 'start-blog' });
    const broken = createLily({
      site: { ...ROOT_SITE_CONFIG, lang: 'en_US' },
      mountPath: '/',
      theme: defaultTheme,
      auth: () => ({ name: 'stub', authenticate: async () => ({ ok: false, reason: 'x' }) }),
    });
    const res = await broken.fetch(new Request(`${ROOT_SITE}/start-blog/`), env);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('<html lang="en_US">');
    // 日付は既定の言語で出る。ISO の方は言語に依らないので必ず一致する。
    expect(html).toMatch(/<time datetime="\d{4}-\d{2}-\d{2}">/);
  });

  it('404 と一覧以外は canonical を出さず noindex にする', async () => {
    const missing = await getRoot('/no-such-page/');
    expect(missing.status).toBe(404);
    const html = await missing.text();
    expect(html).toContain('<meta name="robots" content="noindex" />');
    expect(html).not.toContain('rel="canonical"');
  });
});

import { env } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ADMIN_HINT } from '../../src/core/admin-contract.ts';
import { resetDb } from '../db/helpers.ts';
import {
  get,
  getRoot,
  getWith,
  MOUNT,
  ROOT_LANG,
  ROOT_SITE,
  seedPost,
  setStubUser,
} from './helpers.ts';

beforeEach(resetDb);
afterEach(() => setStubUser(null));

/** 管理画面の入口 HTML。root mount のアプリなので、パスは `/admin/`。 */
async function entryHtml(): Promise<Response> {
  setStubUser({ id: 'admin' });
  return await getRoot('/admin/');
}

/** 入口 HTML が読み込む JS の名前 (ビルドのたびにハッシュが変わる)。 */
async function assetName(): Promise<string> {
  const html = await (await entryHtml()).text();
  const src = /<script type="module"[^>]*src="([^"]+)"/.exec(html)?.[1];
  expect(src, 'script タグが見つからない').toBeTruthy();
  return src!.replace(/^\.?\//, '');
}

/** cookie を付けて公開ページを取る。**同じ HTML が返ることを見る**ために使う。 */
async function getWithCookie(path: string, cookie: string): Promise<Response> {
  return await getWith(path, { headers: { Cookie: cookie } });
}

describe('管理画面の入口 HTML', () => {
  it('題にサイト名が入る (どのブログの管理画面か分かる)', async () => {
    // 差し込みは配信時。**ビルド成果物には焼かない**ので、素の dist には `lily`
    // しか無い (mount ごとにビルドし直さずに済ませるため)。
    expect(await (await entryHtml()).text()).toContain('<title>ルート - lily</title>');
  });

  it('サイト設定を meta で渡す', async () => {
    const html = await (await entryHtml()).text();
    const content = /<meta name="lily:site" content="([^"]*)"/.exec(html)?.[1];
    expect(content, 'lily:site の meta が無い').toBeTruthy();
    // 属性値のエスケープは HTMLRewriter の仕事。ここでは戻せることだけ見る。
    const site = JSON.parse(content!.replaceAll('&quot;', '"').replaceAll('&amp;', '&'));
    // **サイト設定をそのまま渡している**こと。項目を選び直すと、設定に足したものが
    // 設定画面に届かなくなる。mount は運ばない (管理画面は自分の URL から割り出す)。
    expect(site).toEqual({
      url: ROOT_SITE,
      name: 'ルート',
      description: 'root mount',
      author: 'someone',
      lang: ROOT_LANG,
      timeZone: 'UTC',
      ogImage: { url: `${ROOT_SITE}/ogp.png`, width: 800, height: 400 },
      favicon: `${ROOT_SITE}/favicon.ico`,
    });
  });

  it('HTML 以外は書き換えない', async () => {
    // JS を HTMLRewriter に流すと、中身の `<` が要素の始まりとして解釈される。
    // 素通しであることを、アセットの実体と突き合わせて見る。
    const name = await assetName();

    setStubUser({ id: 'admin' });
    const served = await getRoot(`/admin/${name}`);
    expect(served.status).toBe(200);
    const raw = await env.ASSETS.fetch(new URL(`https://blog.example.com/admin/${name}`));
    expect(await served.text()).toBe(await raw.text());
  });
});

describe('公開ページの管理リンク', () => {
  it('管理画面を開くと目印の cookie が付く', async () => {
    const cookie = (await entryHtml()).headers.get('set-cookie');
    // 名前と値は 1 つの単位。読む側 (`src/site/client.ts`) が丸ごと比べる。
    expect(cookie).toContain(ADMIN_HINT);
    // **HttpOnly を付けない。** 公開ページの JS がこれを読んでリンクを出す。
    expect(cookie).not.toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Lax');
    expect(cookie).toContain('Path=/');
  });

  it('アセットには付けない (入口 HTML だけで足りる)', async () => {
    const name = await assetName();
    setStubUser({ id: 'admin' });
    expect((await getRoot(`/admin/${name}`)).headers.get('set-cookie')).toBeNull();
  });

  it('記事ページのリンクはその記事の編集画面に向く', async () => {
    const post = await seedPost({ path: 'start-blog' });
    const html = await (await get(`${MOUNT}/start-blog/`)).text();
    expect(html).toContain(`href="${MOUNT}/admin/#/posts/${post.public_id}"`);
    // 既定では隠してある。外すのはブラウザ側 (cookie を見て client.ts が外す)。
    expect(html).toMatch(/<a class="admin-link"[^>]*hidden/);
  });

  it('一覧のリンクは管理画面のトップに向く', async () => {
    const html = await (await get(`${MOUNT}/`)).text();
    expect(html).toContain(`href="${MOUNT}/admin/"`);
  });

  it('cookie の有無で HTML が変わらない', async () => {
    // **これが崩れると共有キャッシュに載った管理者向けの HTML が読者に配られる**
    // (逆に匿名版が載っていると管理者にリンクが出ない)。ログイン中かどうかの判定を
    // ブラウザ側に置いているのは、この不変条件を保つため。
    await seedPost({ path: 'start-blog' });
    for (const path of [`${MOUNT}/`, `${MOUNT}/start-blog/`]) {
      const anonymous = await (await get(path)).text();
      const withHint = await getWithCookie(path, ADMIN_HINT);
      expect(await withHint.text()).toBe(anonymous);
      // キャッシュの指示も同じであること。
      expect(withHint.headers.get('cache-control')).toBe((await get(path)).headers.get('cache-control'));
    }
  });
});

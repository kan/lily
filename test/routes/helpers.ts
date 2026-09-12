import { env } from 'cloudflare:test';
import { createLily } from '../../src/core/app.ts';
import type { AuthAdapter, AuthUser } from '../../src/core/auth/index.ts';
import type { BlueskyCredentials } from '../../src/core/bluesky.ts';
import type { LilyBindings, LilyConfig, SiteConfig } from '../../src/core/config.ts';
import { createPost, publishPost, setRenderedHtml } from '../../src/core/db/posts.ts';
import { setPostTags } from '../../src/core/db/tags.ts';
import { RENDERER_VERSION, renderMarkdown } from '../../src/core/render/index.ts';
import type { PostRow } from '../../src/core/db/types.ts';
import { normalizeMountPath } from '../../src/core/paths.ts';
import { defaultTheme } from '../../src/theme/index.ts';
import { db, paths } from '../db/helpers.ts';

/**
 * **lily は自分を載せるサイトを知らない。** テストのアプリも、実在の
 * deployment ではなくここで組んだフィクスチャ。利用側の配線 (`src/config.ts` が
 * Access を選べているか等) は利用側のリポジトリが見る。
 */
export const SITE = 'https://example.test';

export const ROOT_SITE = 'https://root.example.test';

/**
 * root mount のアプリの言語。`<html lang>` と Bluesky の告知に出る。
 *
 * **本番（`ja`）とわざと違う値にしてある。** 同じにすると、設定を読まずに
 * `'ja'` を焼き込んだ実装でもテストが通ってしまう。
 */
export const ROOT_LANG = 'en';

/**
 * root mount のアプリが配る静的アセット。**本番の一覧とわざと違う**ので、
 * `<mount>/favicon.svg` のような route が設定から来ていることを確かめられる
 * （`favicon.svg` はここに無いので、root mount では 404 になる）。
 */
export const ROOT_ASSETS = ['favicon.ico', 'ogp.png'];
/**
 * マウント位置のフィクスチャ。**root ではない**ところに置くのが要点で、
 * `getRoot()` の root mount と対にして「core に mount が焼き付いていない」ことを
 * 見る。
 *
 * **テストに `/blog` を直接書かない。** ここを動かすだけで全 spec が追随する。
 */
const MOUNT_PATH = '/blog';
export const MOUNT: string = normalizeMountPath(MOUNT_PATH);

/** mount 付きのアプリ。 */
export async function get(path: string): Promise<Response> {
  return await mountedApp.fetch(new Request(`${SITE}${path}`), env);
}

/** 同じアプリに、ヘッダを付けて取りに行く（Accept / Cookie / If-None-Match）。 */
export async function getWith(path: string, init: RequestInit): Promise<Response> {
  return await mountedApp.fetch(new Request(`${SITE}${path}`, init), env);
}

/**
 * 認証のスタブ。`stubUser` に値を入れると通り、null なら拒否する。
 *
 * 本番の設定 (`src/config.ts`) は Cloudflare Access で、テストでは
 * ACCESS_TEAM / ACCESS_AUD が空なので必ず拒否になる。通る側を見たいときは
 * こちらのアプリを使う。
 */
export let stubUser: AuthUser | null = null;

export function setStubUser(user: AuthUser | null): void {
  stubUser = user;
}

const stubAuth: AuthAdapter = {
  name: 'stub',
  authenticate: async () =>
    stubUser ? { ok: true, user: stubUser } : { ok: false, reason: 'スタブが拒否' },
};

/**
 * Bluesky の資格情報のスタブ。**既定は未設定。**
 *
 * 本番の設定 (`src/config.ts`) は `.dev.vars` が両方を空にするので、テストからは
 * 必ず null になる。設定されている側を見たいときだけこれで入れる（上流の fetch は
 * 別途スタブすること。本物へ投げない）。
 */
export let stubBlueskyCredentials: BlueskyCredentials | null = null;

export function setStubBluesky(credentials: BlueskyCredentials | null): void {
  stubBlueskyCredentials = credentials;
}

/**
 * root mount のサイト設定。**本番とわざと違う値にしてある**（テーマや core が
 * 設定を読まずに焼き込んでいると、そこで落ちる）。テーマのテストが別の設定で
 * アプリを組み直すときにも使う。
 */
export const ROOT_SITE_CONFIG: SiteConfig = {
  url: ROOT_SITE,
  name: 'ルート',
  description: 'root mount',
  author: 'someone',
  lang: ROOT_LANG,
  timeZone: 'UTC',
  // **寸法は本番（1200x630）とわざと違う。** 同じにすると、設定を読まずに
  // 寸法を焼き込んだテーマでもテストが通ってしまう。
  ogImage: { url: `${ROOT_SITE}/ogp.png`, width: 800, height: 400 },
  // タブのアイコン。`ROOT_ASSETS` で配っているものを指す。
  favicon: `${ROOT_SITE}/favicon.ico`,
};

/**
 * mount 付きのサイト設定。root mount と**わざと全部の値を変えてある**ので、
 * どちらかを焼き込んだ実装は必ずどちらかで落ちる。
 */
export const SITE_CONFIG: SiteConfig = {
  url: SITE,
  name: 'マウント付き',
  description: 'mounted',
  author: 'だれか',
  lang: 'ja',
  timeZone: 'Asia/Tokyo',
  ogImage: { url: `${SITE}${MOUNT}/ogp.png`, width: 1200, height: 630 },
  favicon: `${SITE}${MOUNT}/favicon.ico`,
};

/**
 * `<mount>` にマウントしたアプリ。**利用側の deployment ではなくフィクスチャ。**
 *
 * 配る静的アセットは root mount と別の一覧にしてある（`favicon.svg` はこちらに
 * だけある）。core が一覧を持っていないことを、2 つのアプリの差で見る。
 */
export const MOUNTED_ASSETS = ['favicon.ico', 'favicon.svg', 'apple-touch-icon.png', 'ogp.png'];

/**
 * 同じ設定で、**認証だけを差し替えた**アプリ。
 *
 * 認証方式ごとの配線（ログインの口・拒否のしかた）を見る spec が、設定を写さずに
 * 済むようにしてある。写すと、フィクスチャを直した日に片方だけ古くなる。
 */
export function mountedAppWith(auth: LilyConfig<LilyBindings>['auth']) {
  return createLily({
    site: SITE_CONFIG,
    mountPath: MOUNT_PATH,
    theme: defaultTheme,
    assets: MOUNTED_ASSETS,
    ogImageAsset: 'ogp.png',
    media: { images: true },
    auth,
    bluesky: () => stubBlueskyCredentials,
  });
}

const mountedApp = mountedAppWith(() => stubAuth);

/** 任意のアプリへ 1 本投げる。**`env` を渡すのを忘れない**ためのもの。 */
export async function fetchOn(
  app: ReturnType<typeof mountedAppWith>,
  request: Request,
): Promise<Response> {
  return await app.fetch(request, env);
}

/**
 * root mount のアプリ。core に mount が焼き付いていないことを見るために使う。
 *
 * **テーマは標準テーマ（`src/theme/`）。** 利用側のテーマを読むと、core の
 * テストがそのサイトに依存する。
 */
const rootApp = createLily({
  site: ROOT_SITE_CONFIG,
  mountPath: '/',
  theme: defaultTheme,
  // 配る静的アセット。**core は 1 つも知らない**ので、設定から来ていることは
  // ここが空でないと確かめられない。
  assets: ROOT_ASSETS,
  // 告知カードのサムネ。本番 (`src/config.ts`) と同じく `assets` の 1 つを指す。
  ogImageAsset: 'ogp.png',
  auth: () => stubAuth,
  bluesky: () => stubBlueskyCredentials,
});

export async function getRoot(path: string): Promise<Response> {
  return await rootApp.fetch(new Request(`${ROOT_SITE}${path}`), env);
}

/** root mount のアプリに、受け入れる形式を伝えて取りに行く。 */
export async function getRootWith(path: string, accept: string): Promise<Response> {
  return await rootApp.fetch(
    new Request(`${ROOT_SITE}${path}`, { headers: { Accept: accept } }),
    env,
  );
}

export async function getRootRequest(request: Request): Promise<Response> {
  return await rootApp.fetch(request, env);
}

export type SeedOptions = {
  title?: string;
  bodyMd?: string;
  /** null を渡すと説明を空にする (本文から自動で作る経路を見る)。 */
  description?: string | null;
  path?: string;
  publishedAt?: string;
  tags?: string[];
  /** 下書きのまま置く。 */
  draft?: boolean;
  /** body_html を作らない (配信時に body_md から描画する経路を見る)。 */
  skipRender?: boolean;
};

export async function seedPost(options: SeedOptions = {}): Promise<PostRow> {
  const created = await createPost(db, paths, {
    title: options.title ?? 'はじめての記事',
    bodyMd: options.bodyMd ?? '## 見出し\n\n本文。\n',
    description: options.description === undefined ? 'ためしに書いた' : options.description,
    path: options.path ?? 'start-blog',
  });
  if (!created.ok) throw new Error(`seedPost に失敗した: ${created.error.code}`);
  const post = created.value;

  if (options.tags) await setPostTags(db, post.id, options.tags);
  if (!options.skipRender) {
    const { html } = await renderMarkdown(post.body_md);
    await setRenderedHtml(db, post.id, html, RENDERER_VERSION);
  }
  if (!options.draft) {
    return (await publishPost(db, post.id, options.publishedAt ?? '2026-08-01T00:00:00.000Z'))!;
  }
  return post;
}

/**
 * 管理 API を認証済みで叩く。root mount のアプリなので、パスは `/api/...`。
 *
 * 本番の設定 (`src/config.ts`) は Cloudflare Access で、テストでは
 * ACCESS_TEAM / ACCESS_AUD が空なので必ず拒否になる。通る側を見たいときは
 * こちらを使う。
 */
export async function api(path: string, init?: RequestInit): Promise<Response> {
  setStubUser({ id: 'admin', email: 'kan@example.com' });
  const request = new Request(`${ROOT_SITE}${path}`, init);
  // ブラウザは同一オリジンでも非 GET には Origin を付ける。CSRF の防御が
  // それを見ているので、テストのリクエストも同じ形にする。
  if (!request.headers.has('Origin')) request.headers.set('Origin', ROOT_SITE);
  return await getRootRequest(request);
}

/** レスポンスの JSON。テストでは形を都度書かずに読む。 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function json(res: Response): Promise<any> {
  return await res.json();
}

/** JSON を送って JSON を受け取る。 */
export async function apiJson(
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; body: any }> {
  const res = await api(path, {
    method,
    ...(body === undefined
      ? {}
      : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  });
  return { status: res.status, body: await json(res) };
}

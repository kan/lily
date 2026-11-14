import { beforeEach, describe, expect, it } from 'vitest';
import { mcpServerCard } from '../../src/core/agent/discovery.ts';
import { createPaths } from '../../src/core/paths.ts';
import { paths, resetDb } from '../db/helpers.ts';
import {
  fetchOn,
  get,
  getRoot,
  getWith,
  mountedAppWithFeatures,
  MOUNT,
  readRpc,
  ROOT_SITE,
  seedPost,
  SITE,
  SITE_CONFIG,
} from './helpers.ts';

beforeEach(resetDb);

const CATALOG = `${MOUNT}/.well-known/api-catalog`;
const CARD = `${MOUNT}/mcp/server-card`;
const AI_CATALOG = `${MOUNT}/.well-known/ai-catalog.json`;

type Linkset = { linkset: { anchor: string; [rel: string]: unknown }[] };

/** API Catalog の `item` に並んだ URL。 */
function items(catalog: Linkset): string[] {
  const head = catalog.linkset.find((entry) => entry.anchor.endsWith('/.well-known/api-catalog'));
  return ((head?.item ?? []) as { href: string }[]).map((link) => link.href);
}

/** 旧い版の tools/list を投げて、道具の一覧を返す。 */
async function tools(app: ReturnType<typeof mountedAppWithFeatures>): Promise<{ name: string }[]> {
  const res = await fetchOn(
    app,
    new Request(`${SITE}${MOUNT}/mcp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        'MCP-Protocol-Version': '2025-11-25',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
    }),
  );
  return (await readRpc(res)).result.tools as { name: string }[];
}

describe('API Catalog (RFC 9727)', () => {
  it('linkset で検索・一覧・MCP の在りかを示す', async () => {
    const res = await get(CATALOG);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe(
      'application/linkset+json; profile="https://www.rfc-editor.org/info/rfc9727"',
    );
    const catalog = await res.json<Linkset>();
    expect(items(catalog)).toEqual([
      `${SITE}${MOUNT}/posts.json`,
      `${SITE}${MOUNT}/search.json`,
      `${SITE}${MOUNT}/mcp`,
    ]);
    // MCP の機械向けの説明は Server Card
    const mcp = catalog.linkset.find((entry) => entry.anchor === `${SITE}${MOUNT}/mcp`);
    expect(mcp?.['service-meta']).toEqual([
      { href: `${SITE}${CARD}`, type: 'application/mcp-server-card+json' },
    ]);
  });

  it('HEAD にも Link: rel="api-catalog" を返す (2 節の SHALL)', async () => {
    const res = await getWith(CATALOG, { method: 'HEAD' });
    expect(res.status).toBe(200);
    expect(res.headers.get('Link')).toBe(`<${SITE}${CATALOG}>; rel="api-catalog"`);
    expect(await res.text()).toBe('');
  });

  it('root mount なら、サイトの /.well-known/api-catalog そのものになる', async () => {
    const res = await getRoot('/.well-known/api-catalog');
    expect(res.status).toBe(200);
    expect(items(await res.json<Linkset>())).toContain(`${ROOT_SITE}/search.json`);
  });

  it('公開ページの Link ヘッダから辿れる', async () => {
    const res = await get(`${MOUNT}/`);
    expect(res.headers.get('Link')).toContain(`<${SITE}${CATALOG}>; rel="api-catalog"`);
  });
});

describe('MCP Server Card (SEP-2127)', () => {
  it('名前と接続先を示す。道具の一覧は載せない', async () => {
    const res = await get(CARD);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('application/mcp-server-card+json');
    expect(await res.json()).toEqual({
      $schema: 'https://static.modelcontextprotocol.io/schemas/v1/server-card.schema.json',
      // 逆順のドメイン + mount の名前
      name: 'test.example/blog',
      version: '1.0.0',
      title: 'マウント付き',
      description: 'mounted',
      websiteUrl: `${SITE}${MOUNT}/`,
      remotes: [{ type: 'streamable-http', url: `${SITE}${MOUNT}/mcp` }],
    });
  });

  it('root mount の名前は lily', async () => {
    const card = await (await getRoot('/mcp/server-card')).json<{ name: string }>();
    expect(card.name).toBe('test.example.root/lily');
  });

  it('提案の MUST の CORS と、SHOULD のキャッシュを付ける', async () => {
    const res = await get(CARD);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(res.headers.get('Access-Control-Expose-Headers')).toBe('ETag');
    expect(res.headers.get('Cache-Control')).toBe('public, max-age=3600');
    const preflight = await getWith(CARD, { method: 'OPTIONS' });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get('Access-Control-Allow-Methods')).toBe('GET');
  });

  it.each([
    ['そのまま', (etag: string) => etag],
    // Cloudflare は圧縮した応答の ETag を弱いものに書き換える
    ['弱い ETag', (etag: string) => `W/${etag}`],
    ['複数の値', (etag: string) => `"other", ${etag}`],
  ])('ETag が合えば 304 (%s)', async (_name, send) => {
    const etag = (await get(CARD)).headers.get('ETag')!;
    const res = await getWith(CARD, { headers: { 'If-None-Match': send(etag) } });
    expect(res.status).toBe(304);
  });

  it('違う ETag なら本文を返す', async () => {
    expect((await getWith(CARD, { headers: { 'If-None-Match': '"other"' } })).status).toBe(200);
  });

  it.each([
    ['/日記', 'net.example/_E6_97_A5_E8_A8_98'],
    ['/写真', 'net.example/_E5_86_99_E7_9C_9F'],
    ['/a_b', 'net.example/a_5Fb'],
    ['/blog/2026', 'net.example/blog.2026'],
  ])('mount %s の名前は %s (日本語の mount 同士がぶつからない)', (mountPath, name) => {
    const { urls } = createPaths({ site: { url: 'https://example.net' }, mountPath });
    const card = JSON.parse(mcpServerCard(SITE_CONFIG, urls)) as { name: string };
    expect(card.name).toBe(name);
    expect(card.name).toMatch(/^[a-zA-Z0-9.-]+\/[a-zA-Z0-9._-]+$/);
  });

  it('AI Catalog から Server Card を指す', async () => {
    const res = await get(AI_CATALOG);
    expect(res.headers.get('Content-Type')).toBe('application/ai-catalog+json');
    expect(await res.json()).toEqual({
      specVersion: '1.0',
      host: { displayName: 'マウント付き', identifier: 'example.test' },
      entries: [
        {
          identifier: 'urn:air:example.test:mcp:blog',
          // ARD が MUST にしている（無いと isitagentready の ard がエントリを 0 件と数える）
          displayName: 'マウント付き',
          type: 'application/mcp-server-card+json',
          url: `${SITE}${CARD}`,
        },
      ],
    });
  });

  it('AI Catalog の名前はサイトの設定から取る (root mount は別の名前)', async () => {
    const catalog = await (await getRoot('/.well-known/ai-catalog.json')).json<{
      host: { displayName: string; identifier: string };
      entries: { displayName: string }[];
    }>();
    expect(catalog.host).toEqual({ displayName: 'ルート', identifier: 'root.example.test' });
    expect(catalog.entries[0]!.displayName).toBe('ルート');
  });
});

describe('設定で止める', () => {
  it('search: false なら検索の口が消え、カタログと MCP からも外れる', async () => {
    const app = mountedAppWithFeatures({ search: false });
    await seedPost({ path: 'a' });
    expect((await fetchOn(app, new Request(`${SITE}${MOUNT}/search.json?q=abc`))).status).toBe(404);

    const catalog = await (await fetchOn(app, new Request(`${SITE}${CATALOG}`))).json<Linkset>();
    expect(items(catalog)).toEqual([`${SITE}${MOUNT}/posts.json`, `${SITE}${MOUNT}/mcp`]);
    expect((await tools(app)).map((tool) => tool.name)).toEqual(['get_post', 'list_tags']);
    // 登録していない道具を説明で指さない（相手のモデルが呼ぼうとする）
    expect(JSON.stringify(await tools(app))).not.toContain('search_posts');

    // WebMCP は search_posts を登録しない（実際に走らせて見るのは webmcp.test.ts）
    const page = await (await fetchOn(app, new Request(`${SITE}${MOUNT}/a/`))).text();
    expect(page).toContain('"search":null');
  });

  it('mcp: false なら MCP と Server Card が消え、カタログからも外れる', async () => {
    const app = mountedAppWithFeatures({ mcp: false });
    const status = async (path: string, init?: RequestInit) =>
      (await fetchOn(app, new Request(`${SITE}${path}`, init))).status;
    expect(await status(`${MOUNT}/mcp`, { method: 'POST', body: '{}' })).toBe(404);
    expect(await status(CARD)).toBe(404);
    expect(await status(AI_CATALOG)).toBe(404);

    const catalog = await (await fetchOn(app, new Request(`${SITE}${CATALOG}`))).json<Linkset>();
    expect(items(catalog)).toEqual([`${SITE}${MOUNT}/posts.json`, `${SITE}${MOUNT}/search.json`]);
  });

  it('止めた口の名前で始まるパスは、止めても記事に当たらない (予約語のまま)', async () => {
    // 記事の側は作れない（予約語）ので、URL を叩いて記事として読まれないことを見る
    const app = mountedAppWithFeatures({ search: false, mcp: false });
    for (const path of ['search.json/x/', 'mcp/x/', '.well-known/x/']) {
      expect(paths.normalizePostPath(path.slice(0, -1)).ok, path).toBe(false);
      expect((await fetchOn(app, new Request(`${SITE}${MOUNT}/${path}`))).status, path).toBe(404);
    }
  });
});

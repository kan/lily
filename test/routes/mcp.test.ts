import { beforeEach, describe, expect, it } from 'vitest';
import { db, resetDb } from '../db/helpers.ts';
import { getWith, MOUNT, seedPost, SITE } from './helpers.ts';

beforeEach(resetDb);

const LEGACY = '2025-11-25';
const MODERN = '2026-07-28';

/** JSON-RPC の応答。テストでは中身の形を都度書かずに読む。 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- test/routes/helpers.ts の JsonBody と同じ理由
type RpcResponse = { result?: any; error?: { code: number; message: string } };

async function post(body: unknown, headers: Record<string, string> = {}): Promise<Response> {
  return await getWith(`${MOUNT}/mcp`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

/**
 * 応答の JSON-RPC を読む。**2025 年の版は SSE、2026 年の版は JSON で返る**（どちらも
 * 仕様が許す形で、クライアントは両方を読める）。SSE なら最初の `data:` 行を読む。
 */
async function rpc(res: Response): Promise<RpcResponse> {
  const text = await res.text();
  if (!res.headers.get('Content-Type')?.startsWith('text/event-stream')) return JSON.parse(text) as RpcResponse;
  const data = text.split('\n').find((line) => line.startsWith('data: '));
  if (data === undefined) throw new Error(`SSE に data が無い: ${text}`);
  return JSON.parse(data.slice('data: '.length)) as RpcResponse;
}

/** 2025 年の版。握手（initialize）は stateless なので、要求ごとに独立して答えが返る。 */
async function legacy(method: string, params: Record<string, unknown> = {}): Promise<RpcResponse> {
  const res = await post({ jsonrpc: '2.0', id: 1, method, params }, { 'MCP-Protocol-Version': LEGACY });
  expect(res.status, method).toBe(200);
  return await rpc(res);
}

/**
 * 2026-07-28 版。握手は無く、要求ごとに版とクライアントの能力を `_meta` で名乗り、
 * 同じものをヘッダでも送る（食い違えば 400）。
 */
async function modern(method: string, params: Record<string, unknown> = {}): Promise<RpcResponse> {
  const headers: Record<string, string> = { 'MCP-Protocol-Version': MODERN, 'Mcp-Method': method };
  if (method === 'tools/call') headers['Mcp-Name'] = String(params.name);
  const res = await post(
    {
      jsonrpc: '2.0',
      id: 1,
      method,
      params: {
        ...params,
        _meta: {
          'io.modelcontextprotocol/protocolVersion': MODERN,
          'io.modelcontextprotocol/clientCapabilities': {},
          'io.modelcontextprotocol/clientInfo': { name: 'test', version: '0' },
        },
      },
    },
    headers,
  );
  expect(res.status, method).toBe(200);
  return await rpc(res);
}

/** 道具を呼ぶ。版によらず同じ結果になることを、両方で呼んで確かめる。 */
async function call(name: string, args: Record<string, unknown>): Promise<RpcResponse['result']> {
  const params = { name, arguments: args };
  const [a, b] = [(await legacy('tools/call', params)).result, (await modern('tools/call', params)).result];
  expect(b.content, `${name} の結果が版で違う`).toEqual(a.content);
  return a;
}

describe('MCP の握手と道具の一覧', () => {
  it('2025 年の版の initialize に、同じ版と道具の能力で答える', async () => {
    const { result } = await legacy('initialize', {
      protocolVersion: LEGACY,
      capabilities: {},
      clientInfo: { name: 'test', version: '0' },
    });
    expect(result.protocolVersion).toBe(LEGACY);
    expect(result.capabilities.tools).toBeDefined();
    expect(result.serverInfo).toMatchObject({ name: 'lily', websiteUrl: `${SITE}${MOUNT}/` });
    expect(result.instructions).toContain(`${SITE}${MOUNT}/`);
  });

  it('2026-07-28 版の server/discover に答える', async () => {
    const { result } = await modern('server/discover');
    expect(result.supportedVersions).toContain(MODERN);
    expect(result.capabilities.tools).toBeDefined();
  });

  it('道具は読み取りの 3 つだけで、すべて読み取り専用と注釈する', async () => {
    for (const listed of [(await legacy('tools/list')).result, (await modern('tools/list')).result]) {
      const tools = listed.tools as { name: string; annotations: Record<string, boolean> }[];
      expect(tools.map((t) => t.name).sort()).toEqual(['get_post', 'list_tags', 'search_posts']);
      for (const tool of tools) {
        expect(tool.annotations, tool.name).toMatchObject({ readOnlyHint: true, openWorldHint: false });
      }
    }
  });
});

describe('search_posts', () => {
  it('search.json と同じ規則・同じ 1 件の形で、公開記事だけを返す', async () => {
    await seedPost({ path: 'new', title: '新しい', bodyMd: '全文検索を入れた', tags: ['dev'], publishedAt: '2026-08-02T00:00:00.000Z' });
    await seedPost({ path: 'old', title: '古い', bodyMd: '全文検索の下調べ' });
    await seedPost({ path: 'draft', title: '下書き', bodyMd: '全文検索の秘密', draft: true });

    const result = await call('search_posts', { query: '全文検索', limit: 1 });
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent.posts).toEqual([
      expect.objectContaining({ title: '新しい', url: `${SITE}${MOUNT}/new/`, tags: ['dev'] }),
    ]);
    expect(result.structuredContent.next_offset).toBe(1);
    // structuredContent を読まないクライアントのため、同じものを文字列でも入れる
    expect(JSON.parse(result.content[0].text)).toEqual(result.structuredContent);

    const rest = await call('search_posts', { query: '全文検索', offset: 1 });
    expect(rest.structuredContent.posts.map((p: { title: string }) => p.title)).toEqual(['古い']);
    expect(rest.structuredContent.next_offset).toBeNull();
  });

  it.each([
    ['語が多すぎる', { query: 'a b c d e f' }, 'query is limited to 5 words.'],
    ['長すぎる', { query: 'あ'.repeat(101) }, 'query is limited to 100 characters.'],
    ['空', { query: ' ' }, 'Give the words to search for in query.'],
    ['offset が上限を越える', { query: 'abc', offset: 1001 }, 'offset is limited to 1000.'],
  ])('検索の規則に合わなければ、道具の失敗として説明を返す (%s)', async (_name, args, message) => {
    // 上限は SDK の入力の検査ではなく検索の規則が持つ。プロトコルのエラーにすると、
    // 相手のモデルが読める説明にならない
    const result = await call('search_posts', args);
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe(message);
  });

  it.each([
    ['上限を越える', 999],
    ['整数でない', 7.5],
  ])('limit は search.json と同じく丸める (%s値でも断らない)', async (_name, limit) => {
    await seedPost({ path: 'a', title: '記事', bodyMd: '共通の語' });
    const result = await call('search_posts', { query: '共通の語', limit });
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent.posts).toHaveLength(1);
  });
});

describe('get_post', () => {
  it('記事の Markdown 版（Accept: text/markdown と同じもの）を返す', async () => {
    await seedPost({ path: 'a', title: '題', bodyMd: '本文です' });
    const page = await getWith(`${MOUNT}/a/`, { headers: { Accept: 'text/markdown' } });
    const result = await call('get_post', { url: `${SITE}${MOUNT}/a/` });
    expect(result.isError).toBeFalsy();
    expect(result.content).toEqual([{ type: 'text', text: await page.text() }]);
  });

  it.each([
    ['絶対 URL', `${SITE}${MOUNT}/a/`],
    ['mount 付きのパス', `${MOUNT}/a/`],
    ['mount を除いたパス', 'a'],
    ['旧い URL (alias)', `${SITE}${MOUNT}/old-a/`],
    ['フラグメント付きのパス', `${MOUNT}/a/#comments`],
    ['クエリ付きのパス (mount を除いた形)', 'a?utm_source=x'],
    ['クエリ付きの絶対 URL', `${SITE}${MOUNT}/a/?utm_source=x`],
  ])('%s でも引ける', async (_name, url) => {
    const post = await seedPost({ path: 'old-a', title: '題' });
    await db.prepare("UPDATE post_paths SET path = 'a' WHERE post_id = ?1 AND is_canonical = 1").bind(post.id).run();
    await db
      .prepare("INSERT INTO post_paths (path, post_id, is_canonical, created_at) VALUES ('old-a', ?1, 0, '2026-08-01T00:00:00.000Z')")
      .bind(post.id)
      .run();
    const result = await call('get_post', { url });
    expect(result.isError, url).toBeFalsy();
    expect(result.content[0].text).toContain(`url: ${SITE}${MOUNT}/a/`);
  });

  it('「無い」と答えるとき、受け取った参照を長く埋め返さない', async () => {
    const result = await call('get_post', { url: 'x'.repeat(5000) });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe(`No published post at ${'x'.repeat(200)}.`);
  });

  it('記事の id でも引ける', async () => {
    const post = await seedPost({ path: 'a', title: '題' });
    expect((await call('get_post', { url: post.public_id })).isError).toBeFalsy();
  });

  it.each([
    ['下書き', `${SITE}${MOUNT}/draft/`],
    ['無い記事', `${SITE}${MOUNT}/nothing/`],
    ['よそのオリジン', `https://evil.test${MOUNT}/a/`],
    ['mount の外', '/elsewhere/a/'],
    ['URL でない', 'javascript:alert(1)'],
    ['よそのオリジン (スキーム省略)', '//evil.test/blog/a/'],
  ])('%s は「無い」と答える', async (_name, url) => {
    await seedPost({ path: 'a', title: '題' });
    await seedPost({ path: 'draft', title: '下書き', draft: true });
    const result = await call('get_post', { url });
    expect(result.isError, url).toBe(true);
    expect(result.content[0].text).toContain('No published post');
  });
});

describe('list_tags', () => {
  it('公開記事が付いているタグだけを、件数の多い順に返す', async () => {
    await seedPost({ path: 'a', tags: ['dev', '日記'] });
    await seedPost({ path: 'b', tags: ['dev'] });
    await seedPost({ path: 'c', draft: true, tags: ['下書きだけ'] });

    const result = await call('list_tags', {});
    expect(result.structuredContent.tags).toEqual([
      { name: 'dev', url: `${SITE}${MOUNT}/tags/dev/`, post_count: 2 },
      { name: '日記', url: expect.stringContaining(`${SITE}${MOUNT}/tags/`), post_count: 1 },
    ]);
  });
});

describe('HTTP の扱い', () => {
  /** 旧い版の tools/list を、ヘッダを足して送る。 */
  const listTools = (headers: Record<string, string> = {}) =>
    post({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }, { 'MCP-Protocol-Version': LEGACY, ...headers });

  it('よそのオリジンからの要求は 403 で断る (DNS rebinding の対策)', async () => {
    const res = await listTools({ Origin: 'https://evil.test' });
    expect(res.status).toBe(403);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
  });

  it('サイト自身のオリジンからの要求は通す', async () => {
    expect((await listTools({ Origin: SITE })).status).toBe(200);
  });

  it('GET は 405 (stateless なので流し続ける口を持たない)', async () => {
    expect((await getWith(`${MOUNT}/mcp`, {})).status).toBe(405);
  });

  it('共有キャッシュに残させない', async () => {
    expect((await listTools()).headers.get('Cache-Control')).toBe('no-store');
  });

  it('2026 版の応答は SSE ではなく JSON 1 本', async () => {
    // responseMode を既定 (auto) にしてあるので、道具が途中で通知を出すようになると SSE に変わる
    const res = await post(
      {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/list',
        params: {
          _meta: {
            'io.modelcontextprotocol/protocolVersion': MODERN,
            'io.modelcontextprotocol/clientCapabilities': {},
          },
        },
      },
      { 'MCP-Protocol-Version': MODERN, 'Mcp-Method': 'tools/list' },
    );
    expect(res.headers.get('Content-Type')).toContain('application/json');
  });

  it('本文が大きすぎる要求は読まずに断る', async () => {
    const res = await post(
      { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'search_posts', arguments: { query: 'x'.repeat(70_000) } } },
      { 'MCP-Protocol-Version': LEGACY },
    );
    expect(res.status).toBe(413);
  });
});

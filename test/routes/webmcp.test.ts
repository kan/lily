/**
 * WebMCP の script を**実際に走らせて**確かめる。ページの HTML から取り出し、偽の
 * `document.modelContext` と、このアプリへ届く `fetch` を渡して評価する。
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { resetDb } from '../db/helpers.ts';
import { get, getWith, MOUNT, readRpc, seedPost, SITE } from './helpers.ts';

beforeEach(resetDb);

type Tool = {
  name: string;
  description: string;
  inputSchema: unknown;
  annotations: { readOnlyHint: boolean };
  execute(input: Record<string, unknown>): Promise<string>;
};

/**
 * ページの script を、ブラウザの代わりの値を渡して評価する。**評価するのはこのアプリが
 * 出したページの script だけ**で、テストの外から来た文字列は渡さない。
 */
function evaluate(script: string, document: unknown, location: unknown, fetch: unknown): void {
  // eslint-disable-next-line @typescript-eslint/no-implied-eval -- ページに埋めた script を、そのまま走らせて確かめるため
  new Function('document', 'location', 'fetch', script)(document, location, fetch);
}

/** ページの HTML から WebMCP の script を取り出す。無ければ null。 */
async function scriptOf(html: string): Promise<string | null> {
  // HTML は正規表現で切らず、workerd の HTMLRewriter で読む（大文字の `<SCRIPT>` や
  // `</script >` も script として扱う）。
  const scripts: string[] = [];
  let current = '';
  await new HTMLRewriter()
    .on('script', {
      element(element) {
        current = '';
        element.onEndTag(() => {
          scripts.push(current);
        });
      },
      text(chunk) {
        current += chunk.text;
      },
    })
    .transform(new Response(html))
    .text();
  return scripts.find((s) => s.includes('modelContext')) ?? null;
}

/**
 * script を評価して、登録された道具を返す。`origin` はページを開いたオリジン。
 * `fetch` はこのアプリへ届け、呼ばれた URL を `fetched` に残す。
 */
async function run(script: string, origin = SITE) {
  const tools: Tool[] = [];
  const fetched: string[] = [];
  const document = {
    modelContext: {
      registerTool: (tool: Tool) => {
        tools.push(tool);
        return Promise.resolve();
      },
    },
  };
  const location = { href: `${origin}${MOUNT}/`, origin };
  const fetch = async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    fetched.push(url);
    // ページのオリジンが違っても、届け先はこのアプリ（パスとヘッダだけを渡す）。
    // ブラウザの fetch と同じく、308 は追う（末尾スラッシュの補正と alias）。
    let target = new URL(url);
    for (let hop = 0; hop < 5; hop++) {
      const res = await getWith(`${target.pathname}${target.search}`, init ?? {});
      const next = res.headers.get('Location');
      if (res.status !== 308 || next === null) return res;
      target = new URL(next, target);
    }
    throw new Error(`${url} のリダイレクトが終わらない`);
  };
  evaluate(script, document, location, fetch);
  await Promise.resolve();
  const tool = (name: string): Tool => {
    const found = tools.find((t) => t.name === name);
    if (found === undefined) throw new Error(`${name} が登録されていない`);
    return found;
  };
  return { tools, fetched, tool };
}

async function pageScript(path = `${MOUNT}/`): Promise<string> {
  const script = await scriptOf(await (await get(path)).text());
  if (script === null) throw new Error(`${path} に WebMCP の script が無い`);
  return script;
}

describe('WebMCP', () => {
  it('検索と記事の読み出しを、読み取りの道具として登録する', async () => {
    const { tools } = await run(await pageScript());
    expect(tools.map((t) => t.name)).toEqual(['search_posts', 'get_post']);
    expect(tools.every((t) => t.annotations.readOnlyHint)).toBe(true);
  });

  it('名前・説明・引数は MCP サーバの道具と同じ', async () => {
    const { tools } = await run(await pageScript());
    const res = await getWith(`${MOUNT}/mcp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        'MCP-Protocol-Version': '2025-11-25',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
    });
    const mcp = (await readRpc(res)).result.tools as Tool[];
    for (const tool of tools) {
      const same = mcp.find((t) => t.name === tool.name)!;
      expect(tool.description).toBe(same.description);
      expect(tool.inputSchema).toEqual(same.inputSchema);
    }
  });

  it('search_posts は search.json を返す', async () => {
    await seedPost({ path: 'a', title: '記事', bodyMd: '共通の語' });
    const { tool, fetched } = await run(await pageScript());
    const body = JSON.parse(await tool('search_posts').execute({ query: '共通の語', limit: 5 })) as {
      posts: { url: string }[];
    };
    expect(body.posts.map((p) => p.url)).toEqual([`${SITE}${MOUNT}/a/`]);
    expect(fetched).toEqual([`${SITE}${MOUNT}/search.json?q=${encodeURIComponent('共通の語')}&limit=5`]);
  });

  it.each([
    ['検索の結果の絶対 URL', `${SITE}${MOUNT}/a/`],
    ['mount を除いたパス', 'a'],
  ])('get_post は記事の Markdown を返す (%s)', async (_name, url) => {
    await seedPost({ path: 'a', title: '記事', bodyMd: '本文' });
    const { tool } = await run(await pageScript());
    const markdown = await tool('get_post').execute({ url });
    expect(markdown).toContain('title: 記事');
    expect(markdown).toContain('本文');
  });

  it('別のホストで開いたページでは、site.url の URL をページのオリジンへ読み替える', async () => {
    await seedPost({ path: 'a' });
    const preview = 'https://lily.example.workers.dev';
    const { tool, fetched } = await run(await pageScript(), preview);
    await tool('get_post').execute({ url: `${SITE}${MOUNT}/a/` });
    expect(fetched).toEqual([`${preview}${MOUNT}/a/`]);
  });

  it.each([
    ['よそのオリジン', 'https://evil.test/blog/a/'],
    ['mount の外', `${SITE}/elsewhere/`],
    ['URL でない', 'javascript:alert(1)'],
  ])('get_post は %s を取りに行かない (失敗として投げる)', async (_name, url) => {
    const { tool, fetched } = await run(await pageScript());
    await expect(tool('get_post').execute({ url })).rejects.toThrow(`No published post at ${url}.`);
    expect(fetched).toEqual([]);
  });

  it('下書きは「無い」と答える', async () => {
    await seedPost({ path: 'd', draft: true });
    const { tool } = await run(await pageScript());
    await expect(tool('get_post').execute({ url: 'd' })).rejects.toThrow('No published post at d.');
  });

  it.each([
    ['トップ', `${MOUNT}/`],
    ['mount そのもの', MOUNT],
    ['タグのページ', `${MOUNT}/tags/dev/`],
    ['JSON の口', `${MOUNT}/posts.json`],
  ])('get_post は記事でないページ (%s) を記事として返さない', async (_name, url) => {
    await seedPost({ path: 'a', tags: ['dev'] });
    const { tool, fetched } = await run(await pageScript());
    await expect(tool('get_post').execute({ url })).rejects.toThrow('No published post at');
    // 取りには行く (mount の下なので)。返ってきたものが記事でないので断る
    expect(fetched).toHaveLength(1);
  });

  it('search_posts は断られた検索を失敗として投げる (説明は search.json の message)', async () => {
    const { tool } = await run(await pageScript());
    await expect(tool('search_posts').execute({ query: 'a b c d e f' })).rejects.toThrow(
      '?q= is limited to 5 words.',
    );
  });

  it.each([
    ['何も返さない', () => undefined],
    ['同期で投げる', () => {
      throw new Error('InvalidStateError');
    }],
    ['断る Promise を返す', () => Promise.reject(new Error('NotAllowedError'))],
  ])('registerTool が %s ときも、ページを止めず次の道具を登録しに行く', async (_name, registerTool) => {
    const script = await pageScript();
    const names: string[] = [];
    const document = {
      modelContext: {
        registerTool: (tool: Tool) => {
          names.push(tool.name);
          return registerTool();
        },
      },
    };
    expect(() => evaluate(script, document, { href: `${SITE}${MOUNT}/`, origin: SITE }, () => undefined)).not.toThrow();
    await Promise.resolve();
    expect(names).toEqual(['search_posts', 'get_post']);
  });

  it('WebMCP の無いブラウザでは何もしない', async () => {
    const script = await pageScript();
    expect(() => evaluate(script, {}, {}, () => undefined)).not.toThrow();
  });

  it('404 には置かない', async () => {
    expect(await scriptOf(await (await get(`${MOUNT}/nope/`)).text())).toBeNull();
  });
});

/**
 * エージェントが口を見つけるための文書（issue #65 の段階 4）。**中身は設定だけで決まる**
 * ので、起動時に 1 度だけ組む。
 *
 * - API Catalog（RFC 9727）: 検索・一覧・MCP の在りか（`<mount>/.well-known/api-catalog`）
 * - MCP Server Card（SEP-2127、草案）: MCP サーバの名前と接続先（`<mount>/mcp/server-card`）
 * - AI Catalog（同じ提案の、ドメイン単位の索引）: Server Card の在りか
 *   （`<mount>/.well-known/ai-catalog.json`）
 *
 * `/.well-known/` は本来サイトの root に置くもの。root に mount していればここが
 * そのまま root の文書になる。mount 付きのサイトでは、root から転送するのは利用側
 * （`docs/agents.md`）。API Catalog は公開ページの `Link: rel="api-catalog"` からも
 * 辿れる（RFC 9727 の 3 節。置き場所は任意）。
 */
import type { AgentFeatures, SiteConfig } from '../config.ts';
import type { Urls } from '../paths.ts';
import { clip, TOOLS_VERSION } from './tools.ts';

/** 各口の説明。lily の版ごとの文書ではなく main を指す（サイトが自分で書くものは無い）。 */
const DOCS = 'https://github.com/kan/lily/blob/main/docs/agents.md';

export const API_CATALOG_TYPE = 'application/linkset+json; profile="https://www.rfc-editor.org/info/rfc9727"';
export const SERVER_CARD_TYPE = 'application/mcp-server-card+json';
export const AI_CATALOG_TYPE = 'application/ai-catalog+json';

const SERVER_CARD_SCHEMA = 'https://static.modelcontextprotocol.io/schemas/v1/server-card.schema.json';

/** Server Card の `title` と `description` の上限（文字数）。 */
const CARD_TEXT_MAX = 100;

/**
 * API Catalog を指す `Link` の値。**公開ページと、API Catalog 自身の応答（HEAD の SHALL）が
 * 同じものを付ける。**
 */
export function apiCatalogLink(urls: Urls): string {
  return `<${urls.wellKnown('apiCatalog', { absolute: true })}>; rel="api-catalog"`;
}

type Link = { readonly href: string; readonly type?: string };

/**
 * API Catalog。**API の口は `item` に並べる**（RFC 9727 の MUST）。口ごとの説明は
 * その口を `anchor` にした項目に置く（`service-doc` は人が読む説明、`service-meta` は
 * 機械が読む説明。MCP なら Server Card）。止めてある口は載せない。
 */
export function apiCatalog(urls: Urls, features: AgentFeatures): string {
  const json = 'application/json';
  const endpoints: {
    readonly on: boolean;
    readonly href: string;
    readonly type?: string;
    readonly doc: string;
    readonly meta?: Link;
  }[] = [
    { on: true, href: urls.postsJson({ absolute: true }), type: json, doc: 'postsjson' },
    { on: features.search, href: urls.search({ absolute: true }), type: json, doc: 'search' },
    {
      on: features.mcp,
      href: urls.mcp({ absolute: true }),
      doc: 'mcp',
      meta: { href: urls.mcpServerCard({ absolute: true }), type: SERVER_CARD_TYPE },
    },
  ];
  const shown = endpoints.filter((endpoint) => endpoint.on);

  return JSON.stringify({
    linkset: [
      {
        anchor: urls.wellKnown('apiCatalog', { absolute: true }),
        item: shown.map(({ href, type }) => ({ href, type })),
      },
      ...shown.map(({ href, doc, meta }) => ({
        anchor: href,
        ...(meta === undefined ? {} : { 'service-meta': [meta] }),
        'service-doc': [{ href: `${DOCS}#${doc}`, type: 'text/html' }],
      })),
    ],
  });
}

/**
 * MCP Server Card。**道具の一覧は載せない**（提案が載せないと決めている。道具は
 * 接続してから `tools/list` で知る）。
 */
export function mcpServerCard(site: SiteConfig, urls: Urls): string {
  const { namespace, name } = serverCardName(urls);
  return JSON.stringify({
    $schema: SERVER_CARD_SCHEMA,
    name: `${namespace}/${name}`,
    version: TOOLS_VERSION,
    title: clip(site.name, CARD_TEXT_MAX),
    description: clip(site.description.trim() || `Published posts of ${site.name}`, CARD_TEXT_MAX),
    websiteUrl: urls.index({ absolute: true }),
    remotes: [{ type: 'streamable-http', url: urls.mcp({ absolute: true }) }],
  });
}

/**
 * AI Catalog。Server Card を 1 つ指す。
 *
 * **エントリに `displayName` を置く。** AI Catalog の仕様は「参照先が自分の名前を持つなら
 * 付けない」ことを勧める（SHOULD）が、ARD（Agentic Resource Discovery）はエントリの
 * `displayName` を MUST にしていて、isitagentready の `ard` の検査はこちらで見る
 * （無いとエントリが 0 件扱いになる。issue #71）。禁止ではないので ARD に合わせる。
 * 値は Server Card の `title` と同じサイト名。
 *
 * `host` は任意。置くなら `displayName` が MUST（AI Catalog）。サイトの名前とホスト名を
 * 置いて、カタログを出しているのが誰かを示す。
 */
export function aiCatalog(site: SiteConfig, urls: Urls): string {
  const { host, name } = serverCardName(urls);
  const displayName = clip(site.name, CARD_TEXT_MAX);
  return JSON.stringify({
    specVersion: '1.0',
    host: { displayName, identifier: host },
    entries: [
      {
        identifier: `urn:air:${host}:mcp:${name}`,
        displayName,
        type: SERVER_CARD_TYPE,
        url: urls.mcpServerCard({ absolute: true }),
      },
    ],
  });
}

/**
 * Server Card の名前の部品。名前は `<逆順のドメイン>/<名前>`（提案の形。例:
 * `net.example/blog`）で、名前は mount の名前（root なら `lily`）。同じホストに 2 つ
 * 置いても名前がぶつからないように。
 *
 * 提案の規則（`^[a-zA-Z0-9.-]+/[a-zA-Z0-9._-]+$`）に合わない字は、**URL エンコードの
 * `%` を `_` にした形**で入れる（`/日記` → `_E6_97_A5_E8_A8_98`）。`-` などの 1 字に
 * 潰すと、日本語の mount 同士が同じ名前になる。ホスト名は既に規則の字だけ（IDN も
 * `URL` が punycode にする）。
 */
function serverCardName(urls: Urls): { host: string; namespace: string; name: string } {
  const host = new URL(urls.index({ absolute: true })).hostname;
  const namespace = host.split('.').reverse().join('.');
  const mount = urls.mountPath
    .split('/')
    .filter(Boolean)
    .map((segment) => encodeName(decodeURIComponent(segment)))
    .join('.');
  return { host, namespace, name: mount || 'lily' };
}

/**
 * 英数字と `.` `-` 以外を `_XX`（UTF-8 のバイト）にする。**`_` 自身も変える**ので、
 * もともと `_E6` と書かれた mount と `æ` の mount が同じ名前にならない。
 */
function encodeName(segment: string): string {
  return [...segment]
    .map((char) =>
      /[a-zA-Z0-9.-]/.test(char)
        ? char
        : [...new TextEncoder().encode(char)].map((b) => `_${b.toString(16).toUpperCase().padStart(2, '0')}`).join(''),
    )
    .join('');
}

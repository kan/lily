/**
 * 発見のための文書（`agent/discovery.ts`）を配る。**認証の外。** どれも設定だけで
 * 決まるので、起動時に組んで ETag も 1 度だけ計る（`fixedResponse`）。
 *
 * - `<mount>/.well-known/api-catalog`（RFC 9727）。HEAD にも `Link: rel="api-catalog"`
 *   を返す（2 節の SHALL。Hono は GET の route で HEAD にも答える）
 * - `<mount>/mcp/server-card` と `<mount>/.well-known/ai-catalog.json`（SEP-2127）。
 *   MCP を止めていれば出さない
 *
 * **3 本とも CORS を `*` で開ける。** Server Card は提案が MUST にしていて、ほかの 2 本も
 * 公開ページから読めるもの以上を含まない（ブラウザで動くエージェントが読めるように）。
 */
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import {
  AI_CATALOG_TYPE,
  aiCatalog,
  API_CATALOG_TYPE,
  apiCatalog,
  apiCatalogLink,
  mcpServerCard,
  SERVER_CARD_TYPE,
} from '../agent/discovery.ts';
import { agentFeatures, type LilyBindings, type PageConfig } from '../config.ts';
import { createPaths } from '../paths.ts';
import { DISCOVERY, fixedResponse } from './cache.ts';

type Env = { Bindings: LilyBindings };

/** Server Card の提案が挙げる CORS のヘッダ。 */
const CORS = cors({
  origin: '*',
  allowMethods: ['GET'],
  allowHeaders: ['Content-Type', 'If-None-Match'],
  exposeHeaders: ['ETag'],
});

export function discoveryRoutes(config: PageConfig): Hono<Env> {
  const app = new Hono<Env>();
  const { urls } = createPaths(config);
  const features = agentFeatures(config);

  /** 1 本の文書を GET（と HEAD）で配り、CORS の preflight にも答える。 */
  const serve = (path: string, body: string, headers: Record<string, string>) => {
    const respond = fixedResponse(body, { 'Cache-Control': DISCOVERY, ...headers });
    app.use(path, CORS);
    app.get(path, (c) => respond(c.req.header('If-None-Match')));
  };

  serve(urls.wellKnown('apiCatalog'), apiCatalog(urls, features), {
    'Content-Type': API_CATALOG_TYPE,
    Link: apiCatalogLink(urls),
  });
  if (features.mcp) {
    serve(urls.mcpServerCard(), mcpServerCard(config.site, urls), { 'Content-Type': SERVER_CARD_TYPE });
    serve(urls.wellKnown('aiCatalog'), aiCatalog(urls), { 'Content-Type': AI_CATALOG_TYPE });
  }
  return app;
}

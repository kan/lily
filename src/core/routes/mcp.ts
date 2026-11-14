/**
 * `<mount>/mcp`。MCP サーバの入口（`core/mcp.ts`）。**認証の外に置く**（読み取りだけで、
 * 公開ページで読めるもの以上は返さない）。`PageConfig.mcp` が false なら張らない。
 * Server Card は `routes/discovery.ts`。
 *
 * メソッドで振り分けない。POST 以外（GET / DELETE）への答え方も版で決まっているので、
 * SDK のハンドラに全部渡す。
 */
import { Hono } from 'hono';
import { agentFeatures, type LilyBindings, type PageConfig } from '../config.ts';
import { createMcpEndpoint } from '../mcp.ts';
import { createPaths } from '../paths.ts';

type Env = { Bindings: LilyBindings };

export function mcpRoutes(config: PageConfig): Hono<Env> {
  const app = new Hono<Env>();
  const features = agentFeatures(config);
  if (!features.mcp) return app;

  const paths = createPaths(config);
  const endpoint = createMcpEndpoint({ site: config.site, paths, features });
  app.all(paths.urls.mcp(), (c) => endpoint(c.req.raw, c.env.DB));
  return app;
}

/**
 * 404。ページのルータとアプリ全体の両方から使うので、生成をここに 1 つ置く。
 *
 * **`Accept: text/markdown` には Markdown で返す。ステータスは 404 のまま。** エージェントが
 * 存在しないページを開いたときに、HTML の中から行き先を探させずに、トップとサイトマップを
 * 示す。形はリクエストから中で選ぶので、呼ぶ側は渡し忘れようがない。
 */
import type { Context } from 'hono';
import { notFoundMarkdown } from '../agent/markdown.ts';
import type { PageConfig } from '../config.ts';
import { createPaths } from '../paths.ts';
import { createPageResponse, requestFormat } from './negotiated.ts';

export function createNotFound(config: PageConfig): (c: Context) => Promise<Response> {
  const { urls } = createPaths(config);
  const respond = createPageResponse(urls);
  // 設定だけで決まるので 1 度だけ組む（404 はボットに叩かれやすい）。
  const markdown = notFoundMarkdown(config.site, urls);

  return async (c) => {
    const format = requestFormat(c);
    const body =
      format === 'markdown'
        ? markdown
        : await config.theme.notFound({ site: config.site, urls, canonicalUrl: null, jsonLd: null });
    return respond(format, body, { self: null, status: 404 });
  };
}

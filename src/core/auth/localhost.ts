/**
 * ローカル開発でだけ通すアダプタ。
 *
 * **本番では構造上通らない。** 判定はリクエストの host だけで、`localhost` と
 * `127.0.0.1` 以外は必ず拒否する。Cloudflare は host でルーティングするので、
 * 実際のドメイン (`fushihara.net`) や `*.workers.dev` に来たリクエストが
 * この条件を満たすことはない。
 *
 * これが要るのは、Cloudflare Access を手元で再現できないため。無いと管理画面を
 * ローカルで一度も開けない。
 */
import type { AuthAdapter, AuthResult } from './index.ts';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

export function localhostOnly(): AuthAdapter {
  return {
    name: 'localhost-only',
    authenticate: async (request: Request): Promise<AuthResult> => {
      const { hostname } = new URL(request.url);
      if (!LOCAL_HOSTS.has(hostname)) {
        return { ok: false, reason: `ローカルではない host からの要求 (${hostname})` };
      }
      return { ok: true, user: { id: 'localhost', name: 'ローカル開発' } };
    },
  };
}

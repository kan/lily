import { describe, expect, it } from 'vitest';
import { localhostOnly } from '../../src/core/auth/localhost.ts';

/**
 * ローカル開発の抜け道が**本番を開けない**ことを見る。判定は host だけなので、
 * Cloudflare が host でルーティングする以上、実ドメインに来た要求は通らない。
 */
const adapter = localhostOnly();

function request(url: string): Request {
  return new Request(url);
}

describe('localhostOnly', () => {
  it('ローカルからは通る', async () => {
    for (const url of ['http://localhost:8788/blog/admin/', 'http://127.0.0.1:8788/blog/admin/']) {
      expect((await adapter.authenticate(request(url))).ok, url).toBe(true);
    }
  });

  it('本番のドメインからは通らない', async () => {
    for (const url of [
      'https://fushihara.net/blog/admin/',
      'https://lily.workers.dev/admin/',
      // 名前に localhost を含むだけのドメイン
      'https://localhost.evil.example.com/blog/admin/',
      'https://evil.example.com/blog/admin/',
    ]) {
      expect((await adapter.authenticate(request(url))).ok, url).toBe(false);
    }
  });
});

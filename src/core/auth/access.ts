/**
 * Cloudflare Access のアダプタ。
 *
 * Access は Worker の手前でリクエストを止め、通したものに JWT を付けてよこす。
 * **ここでの検証は二重の守り**で、Access を経由しない経路 (route の設定漏れ、
 * 別ドメインからの直接アクセス) で管理画面が開かないようにするためのもの。
 *
 * 検証は `jose` に任せる。JWT の検証は自前で書くと `alg: none` や HS256 への
 * すり替えを踏みやすい (公開鍵を HMAC の鍵として使わせる古典的な攻撃)。
 */
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';
import { readCookie, type AuthAdapter, type AuthResult } from './index.ts';

/** Access が付ける JWT。ヘッダに無ければ Cookie を見る。 */
const HEADER = 'Cf-Access-Jwt-Assertion';
const COOKIE = 'CF_Authorization';

export type AccessOptions = {
  /** チーム名。`<team>.cloudflareaccess.com` の部分。 */
  readonly team: string;
  /** アプリケーションの AUD タグ。**これが違う JWT は他のアプリのもの。** */
  readonly aud: string;
};

/**
 * 鍵は isolate ごとに 1 度だけ取りに行く。`createRemoteJWKSet` が取得と
 * キャッシュ、鍵の入れ替えを見てくれる。
 */
const keySets = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

function keySetFor(issuer: string): ReturnType<typeof createRemoteJWKSet> {
  let keys = keySets.get(issuer);
  if (!keys) {
    keys = createRemoteJWKSet(new URL(`${issuer}/cdn-cgi/access/certs`));
    keySets.set(issuer, keys);
  }
  return keys;
}

export function cloudflareAccess(options: AccessOptions): AuthAdapter {
  // 設定が無いまま動かしたら必ず拒否する。空のチーム名で issuer を組むと
  // `https://.cloudflareaccess.com` を叩きに行くことになり、失敗の理由も
  // 分かりにくい。**開いてしまうより閉じたまま止まる方が安全。**
  if (!options.team || !options.aud) {
    return {
      name: 'cloudflare-access',
      authenticate: async () => ({ ok: false, reason: 'ACCESS_TEAM / ACCESS_AUD が未設定' }),
    };
  }

  const issuer = `https://${options.team}.cloudflareaccess.com`;

  return {
    name: 'cloudflare-access',
    async authenticate(request: Request): Promise<AuthResult> {
      const token = request.headers.get(HEADER) ?? readCookie(request, COOKIE);
      if (!token) return { ok: false, reason: `${HEADER} も ${COOKIE} も無い` };

      try {
        const { payload } = await jwtVerify(token, keySetFor(issuer), {
          issuer,
          audience: options.aud,
          // Access が使うのは RS256 だけ。HS256 へのすり替え (公開鍵を HMAC の鍵と
          // して使わせる古典的な攻撃) は、JWKS の鍵が RSA 公開鍵である時点で jose が
          // 先に弾く。これは二重の錠で、将来 JWKS に別の種類の鍵が並んだときに
          // アルゴリズムの取り違えが起きないようにするためのもの。
          algorithms: ['RS256'],
        });
        if (typeof payload.sub !== 'string' || payload.sub === '') {
          return { ok: false, reason: 'sub が無い' };
        }
        return { ok: true, user: { id: payload.sub, email: emailOf(payload) } };
      } catch (error) {
        return { ok: false, reason: error instanceof Error ? error.message : String(error) };
      }
    },
  };
}

function emailOf(payload: JWTPayload): string | undefined {
  return typeof payload.email === 'string' ? payload.email : undefined;
}

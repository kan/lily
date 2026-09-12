import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { SignJWT, exportJWK, generateKeyPair } from 'jose';
import { cloudflareAccess } from '../../src/core/auth/access.ts';

/**
 * 実際に鍵を作って JWT を署名し、**偽造が弾かれるところまで**見る。
 *
 * JWT の検証は自前で書くと `alg: none` や HS256 へのすり替え (公開鍵を HMAC の
 * 鍵として使わせる古典的な攻撃) を踏みやすい。ライブラリに任せていても、
 * 渡すオプションを間違えれば同じ穴が開くので、通る側だけでなく**弾く側**を
 * 揃えて確かめる。
 */
const TEAM = 'lily-test';
const AUD = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
const ISSUER = `https://${TEAM}.cloudflareaccess.com`;
const KID = 'test-key';

let privateKey: CryptoKey;
let hmacKey: CryptoKey;
let otherKey: CryptoKey;

beforeAll(async () => {
  const pair = await generateKeyPair('RS256', { extractable: true });
  privateKey = pair.privateKey as CryptoKey;
  const jwk = { ...(await exportJWK(pair.publicKey)), kid: KID, alg: 'RS256', use: 'sig' };

  // 別人の鍵。署名だけ差し替えたトークンを作るのに使う。
  otherKey = (await generateKeyPair('RS256', { extractable: true })).privateKey as CryptoKey;
  hmacKey = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode('公開鍵のふりをした共有鍵'),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );

  // JWKS の取得だけを差し替える。jose は isolate ごとに 1 度取りに行って
  // キャッシュするので、最初の 1 回で足りる。
  vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url === `${ISSUER}/cdn-cgi/access/certs`) {
      return Response.json({ keys: [jwk] });
    }
    throw new Error(`テストで想定していない fetch: ${url}`);
  });
});

afterEach(() => vi.clearAllMocks());

type Claims = { aud?: string; iss?: string; sub?: string | null; expiresIn?: string };

async function token(claims: Claims = {}, key: CryptoKey = privateKey, alg = 'RS256') {
  let jwt = new SignJWT({ email: 'kan@example.com' })
    .setProtectedHeader({ alg, kid: KID })
    .setIssuedAt()
    .setIssuer(claims.iss ?? ISSUER)
    .setAudience(claims.aud ?? AUD)
    .setExpirationTime(claims.expiresIn ?? '1h');
  if (claims.sub !== null) jwt = jwt.setSubject(claims.sub ?? 'user-1');
  return await jwt.sign(key);
}

function withHeader(jwt: string): Request {
  return new Request('https://fushihara.net/blog/admin/', {
    headers: { 'Cf-Access-Jwt-Assertion': jwt },
  });
}

const adapter = () => cloudflareAccess({ team: TEAM, aud: AUD });

describe('通る場合', () => {
  it('正しい JWT なら sub と email を返す', async () => {
    const result = await adapter().authenticate(withHeader(await token()));
    expect(result).toEqual({ ok: true, user: { id: 'user-1', email: 'kan@example.com' } });
  });

  it('Cookie からも読む (ヘッダが無い経路)', async () => {
    const request = new Request('https://fushihara.net/blog/admin/', {
      headers: { Cookie: `other=x; CF_Authorization=${await token()}; y=z` },
    });
    expect((await adapter().authenticate(request)).ok).toBe(true);
  });
});

describe('弾く場合', () => {
  async function reject(request: Request): Promise<string> {
    const result = await adapter().authenticate(request);
    expect(result.ok).toBe(false);
    return result.ok ? '' : result.reason;
  }

  it('トークンが無い', async () => {
    await reject(new Request('https://fushihara.net/blog/admin/'));
  });

  it('署名が別の鍵', async () => {
    await reject(withHeader(await token({}, otherKey)));
  });

  // 弾いているのは algorithms の指定ではなく、JWKS の鍵が RSA 公開鍵で
  // HMAC の検証に使えないこと (実測で確認)。それでも攻撃が通らないことは
  // 別の話として押さえておく。
  it('HS256 にすり替えたもの (公開鍵を共有鍵として使わせる攻撃)', async () => {
    await reject(withHeader(await token({}, hmacKey, 'HS256')));
  });

  it('aud が別のアプリのもの', async () => {
    await reject(withHeader(await token({ aud: 'ffffffff' })));
  });

  it('iss が別のチームのもの', async () => {
    await reject(withHeader(await token({ iss: 'https://evil.cloudflareaccess.com' })));
  });

  it('期限切れ', async () => {
    await reject(withHeader(await token({ expiresIn: '-1h' })));
  });

  it('sub が無い', async () => {
    await reject(withHeader(await token({ sub: null })));
  });

  it('そもそも JWT でない', async () => {
    await reject(withHeader('not-a-jwt'));
  });
});

describe('設定が無いとき', () => {
  it('team も aud も空なら、鍵を取りに行かずに拒否する (fail closed)', async () => {
    const result = await cloudflareAccess({ team: '', aud: '' }).authenticate(
      withHeader(await token()),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain('未設定');
  });
});

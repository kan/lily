/**
 * Bluesky の上流（XRPC）のスタブ。**本物へは投げない。**
 *
 * `test/bluesky.test.ts`（何をどの順で送るか）と `test/api/bluesky.test.ts`
 * （押せる条件と DB に残るもの）が同じ応答を見るので、ここに 1 本だけ置く。
 * 別々に持つと、片方の応答を直した日にもう片方が古い形のまま通る。
 */
import { vi } from 'vitest';

/** スタブが返す AT-URI。テストはこれで「告知済み」を確かめる。 */
export const AT_URI = 'at://did:plc:abc/app.bsky.feed.post/3kxyz';

export type XrpcCall = {
  url: string;
  init: RequestInit;
  /** JSON の口はこちら。`uploadBlob` は生のバイト列なので空文字。 */
  body: string;
  /** 送ったバイト数。**どの絵を載せたか**を見分けるのに使う（`uploadBlob`）。 */
  byteLength: number;
};

let calls: XrpcCall[] = [];

/**
 * 3 本の XRPC を既定で成功させ、**呼ばれたものを全部覚える**。
 *
 * `overrides` は nsid（`com.atproto.repo.createRecord` など）で応答を差し替える。
 * 記録は毎回捨てるので、`beforeEach` で呼べばよい。
 */
export function stubBluesky(overrides: Record<string, () => Response> = {}): void {
  calls = [];
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input instanceof Request ? input.url : input);
    calls.push({
      url,
      init,
      body: typeof init.body === 'string' ? init.body : '',
      byteLength: bodyLength(init.body),
    });

    for (const [nsid, respond] of Object.entries(overrides)) {
      if (url.endsWith(`/xrpc/${nsid}`)) return respond();
    }
    if (url.endsWith('/xrpc/com.atproto.server.createSession')) {
      return Response.json({ accessJwt: 'jwt-1', did: 'did:plc:abc' });
    }
    if (url.endsWith('/xrpc/com.atproto.repo.uploadBlob')) {
      return Response.json({ blob: { $type: 'blob', ref: { $link: 'bafy' } } });
    }
    if (url.endsWith('/xrpc/com.atproto.repo.createRecord')) {
      return Response.json({ uri: AT_URI, cid: 'bafycid' });
    }
    // **素通しにしない。** 知らない宛先を黙って通すと、テストから外へ出ていく
    // 経路ができる（告知は取り消せない）。
    throw new Error(`スタブしていない外向きの fetch: ${url}`);
  });
}

export function xrpcCalls(): readonly XrpcCall[] {
  return calls;
}

/** 記録だけ捨てる。「このあと 1 本も投げていない」を見るのに使う。 */
export function resetXrpcCalls(): void {
  calls = [];
}

/** createRecord へ送った record。 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function sentRecord(): any {
  const call = calls.find((c) => c.url.endsWith('/xrpc/com.atproto.repo.createRecord'));
  if (!call) throw new Error('createRecord を呼んでいない');
  return JSON.parse(call.body).record;
}

export function xrpcHeader(call: XrpcCall, name: string): string | undefined {
  return (call.init.headers as Record<string, string> | undefined)?.[name];
}

function bodyLength(body: BodyInit | null | undefined): number {
  if (typeof body === 'string') return new TextEncoder().encode(body).byteLength;
  if (body instanceof ArrayBuffer) return body.byteLength;
  if (ArrayBuffer.isView(body)) return body.byteLength;
  return 0;
}

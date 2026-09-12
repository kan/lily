/**
 * 下書きプレビューのトークン。
 *
 * **生トークンは保存しない。** DB に入るのは SHA-256 の hex だけで、URL を
 * 知っている人だけが下書きを見られる。失効は hash を NULL にするだけ。
 */

import { sha256, toBase64Url, toHex } from './ids.ts';

const TOKEN_BYTES = 32;

/** URL に置ける形 (base64url) のランダムトークン。 */
export function newPreviewToken(): string {
  return toBase64Url(crypto.getRandomValues(new Uint8Array(TOKEN_BYTES)));
}

export async function hashPreviewToken(token: string): Promise<string> {
  return toHex(await sha256(token));
}

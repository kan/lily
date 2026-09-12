/**
 * identity と時刻。テストから差し替えたくなったらここだけ見ればよいようにまとめる。
 */

/** 記事と media の不変の identity。既定の URL でもある。 */
export function newPublicId(): string {
  return crypto.randomUUID();
}

/** UTC ISO8601 (末尾 Z・ミリ秒あり)。文字列比較でそのまま並べられる。 */
export function nowIso(): string {
  return new Date().toISOString();
}

/** バイト列を 16 進に。ハッシュを人の読める形で持ち回るのに使う。 */
export function toHex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** バイト列を base64url に。URL にも cookie にもそのまま置ける形。 */
export function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

/**
 * 文字列の SHA-256。**バイト列で返す**ので、保存するなら `toHex()` を通す
 * （DB に入っているのは hex）。
 */
export async function sha256(value: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
}

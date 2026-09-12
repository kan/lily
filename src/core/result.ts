/**
 * 失敗が「起こりうる正常系」のときに使う戻り値。
 *
 * 例外にしないのは、パスの正規化や alias の重複のように、呼び出し側が必ず
 * 分岐して 400 を返すたぐいの失敗だから。想定外 (D1 の障害、制約違反) は
 * そのまま throw させる。
 */
export type Result<T, E> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: E };

export function ok<T>(value: T): Result<T, never> {
  return { ok: true, value };
}

export function err<E>(error: E): Result<never, E> {
  return { ok: false, error };
}

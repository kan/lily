/**
 * API のエラー。**形を 1 つに揃える。**
 *
 * 管理画面は `error` のコードだけを見て分岐し、`message` は人が読むためのもの。
 * query layer が返す `Result` のコードをそのまま載せるので、DB 側の判断と
 * API の応答が食い違わない。
 */
export type ApiError = { readonly error: string; readonly message?: string };

/**
 * この API が返す失敗はこの 4 つだけ。
 *
 * **広い `ContentfulStatusCode` にしない。** Hono RPC はステータスから
 * レスポンスの型を絞るので、200 が混じった型だと管理画面側で
 * `if (res.ok)` の絞り込みが効かなくなる（失敗どうしを足すぶんには効く）。
 */
export type ApiErrorStatus = 400 | 404 | 409 | 502;

/**
 * パスやタグの衝突は 409、形が違うものは 400、無いものは 404、
 * **上流（Bluesky）が返した失敗は 502**。
 *
 * 502 を分けているのは、こちらの入力が悪いのか外が落ちているのかで、押し直して
 * よいかが変わるため。
 */
export function statusFor(code: string): ApiErrorStatus {
  if (code === 'post-not-found' || code === 'media-not-found' || code === 'not-found') return 404;
  if (
    code === 'path-taken' ||
    code === 'public-id-taken' ||
    code === 'slug-taken' ||
    code === 'filename-taken' ||
    code === 'already-announced'
  ) {
    return 409;
  }
  // 貼った先が読めない (落ちている / 題が無い) のもこちらの入力の問題ではない。
  if (code === 'bluesky-failed' || code === 'link-unreachable') return 502;
  return 400;
}

export function apiError(code: string, message?: string): [ApiError, ApiErrorStatus] {
  return [{ error: code, ...(message === undefined ? {} : { message }) }, statusFor(code)];
}

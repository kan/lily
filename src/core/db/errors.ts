/**
 * D1 が投げる制約違反を、呼び出し側が分岐できる形に写像するための判定。
 *
 * 事前に SELECT で確かめてから INSERT する経路 (createPost / addAlias) は
 * check-then-act なので、同じパスを同時に作られると素の例外が漏れる。
 * DB の UNIQUE 違反も同じ `Result` のエラーに畳んで、呼び出し側から見た
 * 振る舞いを 1 つにする。
 */

/**
 * UNIQUE 違反なら、破られた制約の名前を返す。
 *
 * D1 (SQLite) のメッセージは 2 形になる。実測した形:
 *
 *   UNIQUE constraint failed: posts.public_id
 *   UNIQUE constraint failed: index 'post_paths_path_ci'
 *
 * 真偽値だけを返すと、1 つの batch が複数の表に INSERT するとき
 * (createPost は posts と post_paths の両方) にどちらの違反かが潰れ、
 * 呼び出し側が別々の失敗を同じエラーに写してしまう。
 */
export function uniqueViolationTarget(error: unknown): string | null {
  if (!(error instanceof Error)) return null;
  const matched = /UNIQUE constraint failed: (?:index '([^']+)'|([^:]+))/.exec(error.message);
  return matched?.[1] ?? matched?.[2]?.trim() ?? null;
}

export function isUniqueViolation(error: unknown): boolean {
  return uniqueViolationTarget(error) !== null;
}

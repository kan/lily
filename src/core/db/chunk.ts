/**
 * D1 の**バインドパラメータは 1 クエリ 100 個まで**。
 *
 * `IN (?1, ?2, …)` を id の数だけ並べるクエリは、記事が 101 本になった日に
 * `variable number must be between ?1 and ?100` で 500 になる。件数が増えて
 * 初めて壊れるので、その日まで誰も気付けない。
 */
const MAX_BIND_PARAMS = 100;

export function chunkIds(ids: readonly number[]): number[][] {
  const chunks: number[][] = [];
  for (let i = 0; i < ids.length; i += MAX_BIND_PARAMS) {
    chunks.push(ids.slice(i, i + MAX_BIND_PARAMS));
  }
  return chunks;
}

/** id の配列を 100 件ずつに分けて引き、結果を連結する。 */
export async function queryInChunks<T>(
  ids: readonly number[],
  query: (chunk: number[]) => Promise<T[]>,
): Promise<T[]> {
  if (ids.length === 0) return [];
  const results = await Promise.all(chunkIds(ids).map(query));
  return results.flat();
}

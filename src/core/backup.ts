/**
 * バックアップ。**portable export を別の R2 バケットへ置く。**
 *
 * 中身は `<mount>/api/export` が返すのと同じ zip（記事の Markdown と添付）なので、
 * **lily を捨てても読める**。D1 の dump（`wrangler d1 export`）は D1 という構成に
 * 依存するが、こちらは書庫を開けば記事が出てくる。
 *
 * **置き場所を別バケットにしてある。** 添付と同じバケットに入れると、バケットごとの
 * 誤削除やライフサイクル規則の事故で、本体と控えが同時に消える。控えの意味は
 * 「別の場所に置くこと」なので、prefix を分けるだけでは足りない。
 *
 * **Access の外側から動く。** 管理 API は Cloudflare Access の内側にあり、Access が
 * サービストークンに出す JWT は `sub` が空文字なので `auth/access.ts` が拒否する
 * （`README.md` の「記事の入れ方」）。機械が通れる口を開けるより、Worker 自身の
 * Cron Trigger から D1 と R2 を直に読む方が、開ける穴が 1 つ少ない。
 */
import { exportArchive, logExportWarnings } from './transfer/index.ts';

/**
 * 書庫の置き場所と、**自分が置いたものの目印**。
 *
 * 世代を数えるのは `archives/lily-` で始まるものだけ。`archives/` 配下を丸ごと
 * 数えると、人が手で置いた書庫が世代を 1 つ食い、本物の控えが余計に消える
 * （名前次第では「最新」の側に並ぶ）。
 */
const PREFIX = 'archives/lily-';

/** R2 の `list` が 1 回で返す上限。世代がこれを超えるなら続きを取る。 */
const LIST_LIMIT = 1000;

/** R2 の一括削除の上限。**超えると投げる**ので、ここで切って渡す。 */
const DELETE_LIMIT = 1000;

export type BackupResult = {
  readonly key: string;
  readonly bytes: number;
  readonly posts: number;
  readonly media: number;
  /** 書庫に入れられなかった添付の数。**0 でないことは失敗ではない**が、記録は残す。 */
  readonly warnings: number;
  /** 世代の上限を超えて消したもの。 */
  readonly deleted: readonly string[];
};

export type BackupOptions = {
  /** 残す世代の数。これを超えた古いものから消す。 */
  readonly keep: number;
  /** 書庫の名前に使う時刻。既定は現在時刻（テストから固定するために受ける）。 */
  readonly now?: Date;
};

export async function runBackup(
  db: D1Database,
  media: R2Bucket,
  backup: R2Bucket,
  options: BackupOptions,
): Promise<BackupResult> {
  const result = await exportArchive(db, media);
  logExportWarnings('backup', result.warnings);

  const key = archiveKey(options.now ?? new Date());
  await backup.put(key, result.archive, {
    httpMetadata: { contentType: 'application/zip' },
    // 何が入っているかを、書庫を開かずに R2 の一覧から読めるようにする。
    customMetadata: {
      posts: String(result.posts),
      media: String(result.media),
      warnings: String(result.warnings.length),
    },
  });

  return {
    key,
    bytes: result.archive.byteLength,
    posts: result.posts,
    media: result.media,
    warnings: result.warnings.length,
    deleted: await prune(backup, options.keep),
  };
}

/**
 * 書庫の名前。**UTC の ISO8601 から記号を落としたもの。**
 *
 * 名前を辞書順に並べると時刻順になるので、世代の判定に日付の解析が要らない。
 * JST にしないのは、core が配信先のタイムゾーンを知らないため（`/api/export` の
 * ファイル名と同じ理由）。
 */
function archiveKey(now: Date): string {
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  return `${PREFIX}${stamp}.zip`;
}

/**
 * 古い世代を消す。**残す数を超えた分だけ**、古い方から。
 *
 * 日付で「何日より前」と切らないのは、cron が止まっているあいだに世代が古く
 * なっていた場合に、**残っている控えを全部消してしまう**ため。数で切れば、
 * 最後に取れたものは必ず残る。
 */
async function prune(backup: R2Bucket, keep: number): Promise<string[]> {
  const keys: string[] = [];
  let cursor: string | undefined;
  do {
    const listed = await backup.list({ prefix: PREFIX, limit: LIST_LIMIT, cursor });
    keys.push(...listed.objects.map((object) => object.key));
    cursor = listed.truncated ? listed.cursor : undefined;
  } while (cursor !== undefined);

  // R2 の list は key の昇順。名前が時刻順なので、そのまま古い順になる。
  const extra = keys.slice(0, Math.max(0, keys.length - keep));
  for (let i = 0; i < extra.length; i += DELETE_LIMIT) {
    await backup.delete(extra.slice(i, i + DELETE_LIMIT));
  }
  return extra;
}

import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { runBackup } from '../src/core/backup.ts';
import { exportArchive } from '../src/core/transfer/index.ts';
import { db, resetDb } from './db/helpers.ts';
import { seedPost } from './routes/helpers.ts';

beforeEach(async () => {
  await resetDb();
  // 前のテストが置いた控えを消す。R2 はテストをまたいで生き続ける。
  const listed = await env.BACKUP.list({ prefix: 'archives/' });
  if (listed.objects.length > 0) {
    await env.BACKUP.delete(listed.objects.map((object) => object.key));
  }
});

async function keys(): Promise<string[]> {
  return (await env.BACKUP.list({ prefix: 'archives/' })).objects.map((object) => object.key);
}

describe('バックアップ', () => {
  it('portable export と同じ書庫を別バケットへ置く', async () => {
    await seedPost({ path: 'first', title: 'ひとつ目' });

    const result = await runBackup(db, env.MEDIA, env.BACKUP, { keep: 30 });

    // **中身が export と同じであること。** ここがずれると、控えから戻せない
    // (export は往復の検証があるが、控えの経路に別実装が挟まると意味が無い)。
    const expected = await exportArchive(db, env.MEDIA);
    const stored = await env.BACKUP.get(result.key);
    expect(stored).not.toBeNull();
    expect(new Uint8Array(await stored!.arrayBuffer())).toEqual(expected.archive);

    expect(result.posts).toBe(1);
    expect(result.bytes).toBe(expected.archive.byteLength);
  });

  it('名前は時刻順に並ぶ（世代の判定に日付の解析が要らない）', async () => {
    await seedPost({ path: 'p' });
    const older = await runBackup(db, env.MEDIA, env.BACKUP, {
      keep: 30,
      now: new Date('2026-08-01T18:30:00.000Z'),
    });
    const newer = await runBackup(db, env.MEDIA, env.BACKUP, {
      keep: 30,
      now: new Date('2026-08-02T18:30:00.000Z'),
    });
    expect(older.key < newer.key).toBe(true);
    expect(await keys()).toEqual([older.key, newer.key]);
  });

  it('何が入っているかを書庫を開かずに読める', async () => {
    await seedPost({ path: 'p' });
    const result = await runBackup(db, env.MEDIA, env.BACKUP, { keep: 30 });
    const stored = await env.BACKUP.get(result.key);
    expect(stored?.customMetadata).toMatchObject({ posts: '1', media: '0', warnings: '0' });
    expect(stored?.httpMetadata?.contentType).toBe('application/zip');
  });

  it('世代の上限を超えたら古い方から消す', async () => {
    await seedPost({ path: 'p' });
    const made: string[] = [];
    for (let day = 1; day <= 4; day++) {
      const result = await runBackup(db, env.MEDIA, env.BACKUP, {
        keep: 2,
        now: new Date(`2026-08-0${day}T18:30:00.000Z`),
      });
      made.push(result.key);
    }
    // 最後の 2 つだけが残る
    expect(await keys()).toEqual(made.slice(-2));
  });

  it('日数ではなく数で切る（cron が止まっても最後の控えは残る）', async () => {
    await seedPost({ path: 'p' });
    // 1 年前の控えしか無い状態で、次の 1 本を置く
    const old = await runBackup(db, env.MEDIA, env.BACKUP, {
      keep: 2,
      now: new Date('2025-08-01T18:30:00.000Z'),
    });
    const fresh = await runBackup(db, env.MEDIA, env.BACKUP, {
      keep: 2,
      now: new Date('2026-08-30T18:30:00.000Z'),
    });
    expect(await keys()).toEqual([old.key, fresh.key]);
  });

  it('人が手で置いたものは世代として数えない', async () => {
    // `archives/` を丸ごと数えると、置いた書庫が世代を 1 つ食い、本物の控えが
    // 余計に消える（名前次第では「最新」の側に並ぶ）。
    await seedPost({ path: 'p' });
    await env.BACKUP.put('archives/zzz-手で置いたもの.zip', new Uint8Array([1, 2, 3]));

    const first = await runBackup(db, env.MEDIA, env.BACKUP, {
      keep: 1,
      now: new Date('2026-08-01T18:30:00.000Z'),
    });
    const second = await runBackup(db, env.MEDIA, env.BACKUP, {
      keep: 1,
      now: new Date('2026-08-02T18:30:00.000Z'),
    });

    expect(second.deleted).toEqual([first.key]);
    // 手で置いたものは残っている
    expect(await env.BACKUP.get('archives/zzz-手で置いたもの.zip')).not.toBeNull();
  });

  it('記事が 1 本も無くても書庫を作る（空を控えないと消えたことに気付けない）', async () => {
    const result = await runBackup(db, env.MEDIA, env.BACKUP, { keep: 30 });
    expect(result.posts).toBe(0);
    expect(await env.BACKUP.get(result.key)).not.toBeNull();
  });
});


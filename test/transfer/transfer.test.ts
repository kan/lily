import { env } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createMedia,
  getOgpMedia,
  listMediaByPost,
  mediaR2Key,
  setOgpMedia,
} from '../../src/core/db/media.ts';
import { addAlias } from '../../src/core/db/post-paths.ts';
import { getPostByPublicId, listAllPosts } from '../../src/core/db/posts.ts';
import { getTagsForPost } from '../../src/core/db/tags.ts';
import { exportArchive } from '../../src/core/transfer/export.ts';
import { importArchive } from '../../src/core/transfer/import.ts';
import { createZip, readZip } from '../../src/core/transfer/zip.ts';
import { db, paths, resetDb } from '../db/helpers.ts';
import { pngHeader } from '../fixtures/png.ts';
import {
  api,
  getRoot,
  getRootRequest,
  json,
  ROOT_SITE,
  seedPost,
  setStubUser,
} from '../routes/helpers.ts';

beforeEach(resetDb);
afterEach(() => setStubUser(null));

/** 1x1 の PNG。中身のあるファイルとして扱えればよいので何でもよい。 */
const PNG = Uint8Array.from(
  atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='),
  (c) => c.charCodeAt(0),
);

const encoder = new TextEncoder();
const decoder = new TextDecoder();

async function attach(postId: number, postPublicId: string, filename: string, data = PNG) {
  const key = mediaR2Key(postPublicId, filename);
  const media = await createMedia(db, {
    postId,
    filename,
    r2Key: key,
    mime: 'image/png',
    bytes: data.length,
  });
  await env.MEDIA.put(key, data);
  return media;
}

async function exportBytes(): Promise<Uint8Array> {
  return (await exportArchive(db, env.MEDIA)).archive;
}

/** 書庫の中身を「パス → 中身」で取り出す。 */
async function entriesOf(archive: Uint8Array): Promise<Map<string, Uint8Array>> {
  return new Map((await readZip(archive)).map((f) => [f.path, f.data]));
}

/** zip のヘッダに入る MS-DOS 形式の日時 (2 秒刻み・1980 年起点)。 */
function dosStamp(at: Date): { time: number; date: number } {
  return {
    time: (at.getUTCHours() << 11) | (at.getUTCMinutes() << 5) | (at.getUTCSeconds() >> 1),
    date: ((at.getUTCFullYear() - 1980) << 9) | ((at.getUTCMonth() + 1) << 5) | at.getUTCDate(),
  };
}

/** 記事 1 本ぶんの `index.md` を組み立てる (取り込み側だけを見たいとき用)。 */
function postFile(frontmatter: string[], body = '本文。\n'): Uint8Array {
  return encoder.encode(['---', ...frontmatter, '---', body].join('\n'));
}

describe('export', () => {
  it('記事と添付を posts/<canonical>/ に並べる', async () => {
    const post = await seedPost({ path: 'ratatoskr/1', tags: ['dev'] });
    await attach(post.id, post.public_id, 'sample.png');

    const files = await entriesOf(await exportBytes());
    expect([...files.keys()]).toEqual([
      'posts/ratatoskr/1/index.md',
      'posts/ratatoskr/1/sample.png',
    ]);
    expect([...(files.get('posts/ratatoskr/1/sample.png') as Uint8Array)]).toEqual([...PNG]);
  });

  it('frontmatter に identity と全パスと添付の id が載る', async () => {
    const post = await seedPost({ path: 'start-blog', tags: ['blog', 'dev'] });
    await addAlias(db, paths, post.id, 'old-path');
    const media = await attach(post.id, post.public_id, 'sample.png');

    const files = await entriesOf(await exportBytes());
    const text = decoder.decode(files.get('posts/start-blog/index.md'));
    expect(text).toContain(`public_id: ${post.public_id}`);
    // canonical が先頭。public_id と旧パスも alias として残っている。
    expect(text).toContain('paths:\n  - start-blog\n');
    expect(text).toContain(`  - ${post.public_id}\n`);
    expect(text).toContain('  - old-path\n');
    expect(text).toContain(`  sample.png: ${media.public_id}\n`);
    expect(text).toContain('tags:\n  - blog\n  - dev\n');
  });

  it('OGP に選んだ添付はファイル名で載る', async () => {
    const post = await seedPost({ path: 'start-blog' });
    await attach(post.id, post.public_id, 'other.png');
    const card = await attach(post.id, post.public_id, 'card.png');
    await setOgpMedia(db, post.id, card.id);

    const files = await entriesOf(await exportBytes());
    const text = decoder.decode(files.get('posts/start-blog/index.md'));
    // public_id ではなくファイル名。media を省いた形でも書けるようにするため。
    expect(text).toContain('ogp: card.png\n');
  });

  it('選んでいなければ ogp の行を書かない', async () => {
    const post = await seedPost({ path: 'start-blog' });
    await attach(post.id, post.public_id, 'card.png');

    const files = await entriesOf(await exportBytes());
    expect(decoder.decode(files.get('posts/start-blog/index.md'))).not.toContain('ogp:');
  });

  it('実体の無い添付は OGP に選ばれていても書かない', async () => {
    // 書庫に入らなかった絵を指すと、取り込み直したときに解決できない名前だけが残る。
    const post = await seedPost({ path: 'start-blog' });
    const card = await attach(post.id, post.public_id, 'card.png');
    await setOgpMedia(db, post.id, card.id);
    await env.MEDIA.delete(card.r2_key);

    const files = await entriesOf(await exportBytes());
    expect(decoder.decode(files.get('posts/start-blog/index.md'))).not.toContain('ogp:');
  });

  it('本文は body_md のまま (相対参照を書き換えない)', async () => {
    const bodyMd = '![図](./sample.png)\n\n本文。\n';
    const post = await seedPost({ path: 'p', bodyMd });
    await attach(post.id, post.public_id, 'sample.png');

    const files = await entriesOf(await exportBytes());
    expect(decoder.decode(files.get('posts/p/index.md'))).toContain(bodyMd);
  });

  it('下書きも出す (portable export は「記事が残る」ためのもの)', async () => {
    await seedPost({ path: 'draft-post', draft: true });
    const text = decoder.decode((await entriesOf(await exportBytes())).get('posts/draft-post/index.md'));
    expect(text).toContain('draft: true');
    // 公開していない記事に公開日は無い
    expect(text).not.toContain('date:');
  });

  it('実体の無い添付は警告にして、export 自体は止めない', async () => {
    const post = await seedPost({ path: 'p' });
    const media = await attach(post.id, post.public_id, 'sample.png');
    await env.MEDIA.delete(media.r2_key);

    const result = await exportArchive(db, env.MEDIA);
    expect(result.warnings).toEqual([
      { postPath: 'p', filename: 'sample.png', reason: 'media-missing' },
    ]);
    // 書庫は作れているし、frontmatter にも入っていない添付は載らない
    const files = await entriesOf(result.archive);
    expect([...files.keys()]).toEqual(['posts/p/index.md']);
    expect(decoder.decode(files.get('posts/p/index.md'))).not.toContain('media:');
  });

  it('同じ中身からは同じ書庫が出る', async () => {
    await seedPost({ path: 'a' });
    await seedPost({ path: 'b', title: '2 本目' });
    expect([...(await exportBytes())]).toEqual([...(await exportBytes())]);
  });

  it('書庫に載る日時は記事の更新日時 (実行時刻を混ぜない)', async () => {
    // 上の「同じ書庫が出る」だけでは足りない。MS-DOS の日時は 2 秒刻みなので、
    // 実行時刻を書いていても 2 回の export が同じ枠に収まって通ってしまう。
    const post = await seedPost({ path: 'p' });
    // 実行時刻と紛れない昔の日時にする (updated_at は名前の付いた操作からしか
    // 動かせないので、ここだけ生 SQL で入れる)。
    const updatedAt = '2020-02-03T04:05:06.000Z';
    await db.prepare('UPDATE posts SET updated_at = ?1 WHERE id = ?2').bind(updatedAt, post.id).run();

    // 先頭の項目のローカルヘッダ (10 バイト目が時刻、12 バイト目が日付)
    const view = new DataView((await exportBytes()).buffer);
    expect({ time: view.getUint16(10, true), date: view.getUint16(12, true) }).toEqual(
      dosStamp(new Date(updatedAt)),
    );
  });
});

describe('往復 (import → export → import)', () => {
  /**
   * 元の DB を書庫にして、**空の DB に入れ直す**。
   *
   * 同じ DB に入れ直すと public_id が必ず衝突する (上書きしないため)。
   * 見たいのは「書庫が記事を余さず持っているか」なので、復旧と同じ形で確かめる。
   */
  async function reimport(archive: Uint8Array) {
    await resetDb();
    const result = await importArchive(db, paths, env.MEDIA, archive);
    expect(result.failed, JSON.stringify(result.failed)).toEqual([]);
    return result;
  }

  it('identity・canonical・alias・本文・添付が維持される', async () => {
    const bodyMd = '# 見出し\n\n![図](./sample.png)\n\n本文。\n';
    const original = await seedPost({
      path: 'ratatoskr/1',
      bodyMd,
      tags: ['dev', 'ratatoskr'],
      description: 'ためしに書いた',
      publishedAt: '2026-08-23T04:00:00.000Z',
    });
    await addAlias(db, paths, original.id, 'old-path');
    const media = await attach(original.id, original.public_id, 'sample.png');
    // **日時を実行時刻から引き離す。** そうしないと「2 周目も同じ書庫になる」が、
    // 往復で保たれない列 (media.created_at など) を書庫に載せていても、同じ
    // 2 秒枠に収まって通ってしまう。
    await db.batch([
      db.prepare("UPDATE posts SET updated_at = '2020-02-03T04:05:06.000Z' WHERE id = ?1").bind(original.id),
      db.prepare("UPDATE media SET created_at = '2019-01-02T03:04:05.000Z' WHERE id = ?1").bind(media.id),
    ]);

    const first = await exportBytes();
    await reimport(first);

    const post = await getPostByPublicId(db, original.public_id);
    expect(post).not.toBeNull();
    expect(post?.title).toBe(original.title);
    expect(post?.body_md).toBe(bodyMd);
    expect(post?.description).toBe('ためしに書いた');
    expect(post?.status).toBe('published');
    expect(post?.published_at).toBe('2026-08-23T04:00:00.000Z');
    expect(post?.updated_at).toBe('2020-02-03T04:05:06.000Z');

    const tags = await getTagsForPost(db, post?.id as number);
    expect(tags.map((t) => t.name)).toEqual(['dev', 'ratatoskr']);

    const attachments = await listMediaByPost(db, post?.id as number);
    expect(attachments).toHaveLength(1);
    // 配信 URL は public_id で決まるので、往復で変わらないことまで見る
    expect(attachments[0]?.public_id).toBe(media.public_id);
    const object = await env.MEDIA.get(attachments[0]?.r2_key as string);
    expect([...new Uint8Array(await (object as R2ObjectBody).arrayBuffer())]).toEqual([...PNG]);

    // 2 周目も同じ書庫になる = 取りこぼしが無い
    expect([...(await exportBytes())]).toEqual([...first]);
  });

  it('OGP の選択が往復で残る', async () => {
    const original = await seedPost({ path: 'ratatoskr/1' });
    await attach(original.id, original.public_id, 'other.png');
    const card = await attach(original.id, original.public_id, 'card.png');
    await setOgpMedia(db, original.id, card.id);

    await reimport(await exportBytes());

    const post = await getPostByPublicId(db, original.public_id);
    expect((await getOgpMedia(db, post?.id as number))?.filename).toBe('card.png');
  });

  it('alias で引ける URL がそのまま残る', async () => {
    const original = await seedPost({ path: 'ratatoskr/1' });
    await addAlias(db, paths, original.id, 'old-path');

    await reimport(await exportBytes());

    // canonical・alias・public_id のどれでも記事に辿り着く
    expect((await getRoot('/ratatoskr/1/')).status).toBe(200);
    expect((await getRoot('/old-path/')).status).toBe(308);
    expect((await getRoot(`/${original.public_id}/`)).status).toBe(308);
  });

  it('下書きは下書きのまま戻る', async () => {
    const original = await seedPost({ path: 'draft-post', draft: true });
    await reimport(await exportBytes());

    const post = await getPostByPublicId(db, original.public_id);
    expect(post?.status).toBe('draft');
    expect(post?.published_at).toBeNull();
  });

  it('body_html を作り直すので、公開ページの画像が解決される', async () => {
    const original = await seedPost({ path: 'p', bodyMd: '![図](./sample.png)\n' });
    const media = await attach(original.id, original.public_id, 'sample.png');
    await reimport(await exportBytes());

    const html = await (await getRoot('/p/')).text();
    expect(html).toContain(`/media/${media.public_id}/sample.png`);
    expect(html).not.toContain('lily-media://');
  });
});

describe('import', () => {
  async function importFiles(files: Record<string, Uint8Array>) {
    const archive = createZip(Object.entries(files).map(([path, data]) => ({ path, data })));
    return await importArchive(db, paths, env.MEDIA, archive);
  }

  it('public_id と paths が無い記事も取り込める (Astro からの移行はこの形)', async () => {
    const result = await importFiles({
      'posts/start-blog/index.md': postFile([
        'title: ブログ始めました',
        'date: 2026-08-23',
        'tags:',
        '  - blog',
        'description: 令和の今頃になって',
      ]),
    });
    expect(result.failed).toEqual([]);
    expect(result.imported).toHaveLength(1);

    const post = await getPostByPublicId(db, result.imported[0]?.publicId as string);
    expect(post?.status).toBe('published');
    // 日付だけの指定は UTC 深夜として読む (Astro の z.date() と同じ)
    expect(post?.published_at).toBe('2026-08-23T00:00:00.000Z');
    expect(post?.body_md).toBe('本文。\n');
    expect((await listAllPosts(db))[0]?.canonical_path).toBe('start-blog');
  });

  it('添付の寸法を読んで body_html の <img> に出す', async () => {
    // 移行で入る記事もこの経路を通る。ここで読まないと、全記事が width / height の
    // 無い <img> になり、画像が届くまで本文が飛ぶ。
    const result = await importFiles({
      'posts/p/index.md': postFile(['title: あ', 'date: 2026-08-23'], '![図](./sample.png)\n'),
      'posts/p/sample.png': pngHeader(96, 48),
    });
    expect(result.failed).toEqual([]);

    const post = await getPostByPublicId(db, result.imported[0]?.publicId as string);
    expect((await listMediaByPost(db, post?.id as number))[0]).toMatchObject({
      width: 96,
      height: 48,
    });
    expect(post?.body_html).toContain('width="96" height="48" loading="lazy" decoding="async"');
  });

  it('updated が無い記事は公開日を更新日にする (取り込み時刻を入れない)', async () => {
    // Astro 版の frontmatter は updated を省ける。現在時刻を入れると移行した
    // 全記事が「今日更新された」ことになり、記事に更新日が出て、Atom と sitemap
    // にも伝わる。
    const result = await importFiles({
      'posts/p/index.md': postFile(['title: あ', 'date: 2026-08-23']),
    });
    const post = await getPostByPublicId(db, result.imported[0]?.publicId as string);
    expect(post?.updated_at).toBe('2026-08-23T00:00:00.000Z');
    expect(post?.published_at).toBe('2026-08-23T00:00:00.000Z');
  });

  it('canonical はディレクトリ名。paths の残りが alias になる', async () => {
    const result = await importFiles({
      'posts/new-path/index.md': postFile([
        'title: あ',
        'date: 2026-08-23',
        'paths:',
        '  - old-path',
        '  - new-path',
      ]),
    });
    expect(result.imported[0]?.warnings).toEqual([]);

    expect((await getRoot('/new-path/')).status).toBe(200);
    expect((await getRoot('/old-path/')).status).toBe(308);
  });

  it('index.md が無いディレクトリは記事にしない', async () => {
    const result = await importFiles({
      'posts/notes/memo.md': encoder.encode('# メモ'),
      'README.md': encoder.encode('説明'),
    });
    expect(result.imported).toEqual([]);
    expect(result.ignored).toEqual(['README.md', 'posts/notes/memo.md']);
  });

  it('既にある public_id は上書きせず、その記事だけ落とす', async () => {
    const existing = await seedPost({ path: 'taken' });
    const result = await importFiles({
      'posts/other/index.md': postFile([
        'title: あ',
        'date: 2026-08-23',
        `public_id: ${existing.public_id}`,
      ]),
    });
    expect(result.imported).toEqual([]);
    expect(result.failed[0]?.error).toContain('public-id-taken');
    // 元の記事は触られていない
    expect((await getPostByPublicId(db, existing.public_id))?.title).toBe(existing.title);
  });

  it('1 本壊れていても残りは取り込む', async () => {
    const result = await importFiles({
      'posts/good/index.md': postFile(['title: よい', 'date: 2026-08-23']),
      'posts/broken/index.md': encoder.encode('frontmatter が無い'),
    });
    expect(result.imported.map((p) => p.path)).toEqual(['good']);
    expect(result.failed.map((p) => p.path)).toEqual(['broken']);
  });

  it.each([
    ['知らないキー', ['title: あ', 'date: 2026-08-23', 'layout: post'], '知らない frontmatter'],
    ['タイトルが無い', ['date: 2026-08-23'], 'title'],
    ['公開済みなのに date が無い', ['title: あ'], 'date'],
    ['予約語の public_id', ['title: あ', 'date: 2026-08-23', 'public_id: admin'], 'public_id'],
    ['スラッシュ入りの public_id', ['title: あ', 'date: 2026-08-23', 'public_id: a/b'], 'public_id'],
  ])('%s は取り込まない', async (_name, frontmatter, message) => {
    const result = await importFiles({ 'posts/p/index.md': postFile(frontmatter) });
    expect(result.imported).toEqual([]);
    expect(result.failed[0]?.error).toContain(message);
  });

  it('予約語のディレクトリは記事のパスにできない', async () => {
    const result = await importFiles({
      'posts/admin/index.md': postFile(['title: あ', 'date: 2026-08-23']),
    });
    expect(result.failed[0]?.error).toContain('reserved-path');
  });

  it('添付は形式で絞る (書庫に Content-Type が無いので拡張子で決める)', async () => {
    const result = await importFiles({
      'posts/p/index.md': postFile(['title: あ', 'date: 2026-08-23']),
      'posts/p/sample.png': PNG,
      'posts/p/notes.txt': encoder.encode('メモ'),
    });
    expect(result.imported[0]?.media).toBe(1);
    expect(result.imported[0]?.warnings).toEqual([
      '添付を無視した (対応していない形式): notes.txt',
    ]);
  });

  it('使えない public_id の添付は採番し直す (壊れた配信 URL を作らない)', async () => {
    // media.public_id には NOT NULL UNIQUE しか無い。空文字を通すと
    // `/media//sample.png` になり、どの route にも当たらない。
    const result = await importFiles({
      'posts/p/index.md': postFile([
        'title: あ',
        'date: 2026-08-23',
        'media:',
        "  sample.png: ''",
      ]),
      'posts/p/sample.png': PNG,
    });
    expect(result.imported[0]?.warnings).toEqual([
      '添付の public_id が使えないので採番し直した: sample.png',
    ]);

    const post = await getPostByPublicId(db, result.imported[0]?.publicId as string);
    const media = await listMediaByPost(db, post?.id as number);
    expect(media[0]?.public_id).not.toBe('');
    expect(media[0]?.public_id.length).toBeGreaterThan(0);
  });

  it('本文が解決できない参照を持っていたら警告する', async () => {
    const result = await importFiles({
      'posts/p/index.md': postFile(['title: あ', 'date: 2026-08-23'], '![図](./missing.png)\n'),
    });
    expect(result.imported[0]?.warnings).toEqual(['本文の参照を解決できない: ./missing.png']);
  });

  it('名前が NFC で同じになる添付は畳む (media の UNIQUE で投げさせない)', async () => {
    // macOS の書庫は NFD で名前を持つ。正規化すると別々の名前が同じになり、
    // media(post_id, filename) の UNIQUE に当たる。
    const nfd = 'が.png'.normalize('NFD');
    const result = await importFiles({
      'posts/p/index.md': postFile(['title: あ', 'date: 2026-08-23']),
      'posts/p/が.png': PNG,
      [`posts/p/${nfd}`]: PNG,
    });
    expect(result.failed).toEqual([]);
    // 片方だけが入り、落ちた方は警告で残る (どちらが残るかは名前順で決まる)
    expect(result.imported[0]?.media).toBe(1);
    expect(result.imported[0]?.warnings).toHaveLength(1);
    expect(result.imported[0]?.warnings[0]).toMatch(/正規化すると .+ が重なる/);
  });

  it('1 本が投げても他の記事は入り、どれが落ちたか分かる', async () => {
    // R2 が落ちた場合など、検証をすり抜けて例外になる経路。素通しすると 500 になり、
    // 既に入った記事の一覧まで失われる。
    const broken = {
      ...env.MEDIA,
      put: async () => {
        throw new Error('R2 が落ちた');
      },
    } as unknown as R2Bucket;

    const archive = createZip([
      { path: 'posts/a/index.md', data: postFile(['title: 添付なし', 'date: 2026-08-23']) },
      { path: 'posts/b/index.md', data: postFile(['title: 添付あり', 'date: 2026-08-23']) },
      { path: 'posts/b/sample.png', data: PNG },
    ]);
    const result = await importArchive(db, paths, broken, archive);

    expect(result.imported.map((p) => p.path)).toEqual(['a']);
    expect(result.failed).toEqual([{ path: 'b', error: '取り込み中に失敗した: R2 が落ちた' }]);
  });

  it('zip でなければ 1 本も取り込まない', async () => {
    await expect(importArchive(db, paths, env.MEDIA, encoder.encode('これは zip ではない'))).rejects.toThrow();
  });
});

describe('添付の形式', () => {
  /** 管理画面からのアップロード。書庫を経由しない経路。 */
  async function upload(filename: string, type: string) {
    const post = await seedPost({ path: `up-${filename}` });
    const form = new FormData();
    form.set('file', new File([PNG], filename, { type }));
    const res = await api(`/api/posts/${post.public_id}/media`, { method: 'POST', body: form });
    return { status: res.status, body: await json(res) };
  }

  it('拡張子で決めるので、上げられたものは必ず取り込み直せる', async () => {
    expect((await upload('sample.png', 'image/png')).status).toBe(201);
  });

  it.each([
    ['取り込めない拡張子', 'photo.jfif', 'image/jpeg', 'extension-not-allowed'],
    ['拡張子が無い', 'photo', 'image/jpeg', 'extension-not-allowed'],
    ['名前と中身の申告が食い違う', 'photo.jpg', 'image/png', 'mime-mismatch'],
  ])('%s は受けない', async (_name, filename, type, code) => {
    // ここを Content-Type だけで通すと、export したあと import で黙って消える
    // (書庫に Content-Type は無く、取り込み側は拡張子しか見られない)。
    const res = await upload(filename, type);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe(code);
  });
});

describe('API', () => {
  it('未認証では触れない', async () => {
    setStubUser(null);
    expect((await getRoot('/api/export')).status).toBe(403);
    // POST は Origin を付けて出す。無いと CSRF の方で落ちて、認証を見たことにならない。
    const post = new Request(`${ROOT_SITE}/api/import`, {
      method: 'POST',
      body: new FormData(),
      headers: { Origin: ROOT_SITE },
    });
    expect((await getRootRequest(post)).status).toBe(403);
  });

  it('export は zip を返す', async () => {
    await seedPost({ path: 'p' });
    const res = await api('/api/export');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/zip');
    expect(res.headers.get('content-disposition')).toMatch(/^attachment; filename="lily-export-/);
    expect(res.headers.get('x-lily-posts')).toBe('1');

    const files = await entriesOf(new Uint8Array(await res.arrayBuffer()));
    expect([...files.keys()]).toEqual(['posts/p/index.md']);
  });

  it('export した zip をそのまま import に渡せる', async () => {
    const original = await seedPost({ path: 'p', tags: ['dev'] });
    const archive = await (await api('/api/export')).arrayBuffer();
    await resetDb();

    const form = new FormData();
    form.set('file', new File([archive], 'export.zip', { type: 'application/zip' }));
    const res = await api('/api/import', { method: 'POST', body: form });
    expect(res.status).toBe(200);

    const body = await json(res);
    expect(body.failed).toEqual([]);
    expect(body.imported[0].publicId).toBe(original.public_id);
  });

  it('壊れた書庫は 400 (中で投げっぱなしにしない)', async () => {
    const form = new FormData();
    form.set('file', new File(['これは zip ではない'], 'x.zip'));
    const res = await api('/api/import', { method: 'POST', body: form });
    expect(res.status).toBe(400);
    expect((await json(res)).error).toBe('invalid-archive');
  });

  it('multipart として読めない body は 400 (500 にしない)', async () => {
    const res = await api('/api/import', {
      method: 'POST',
      headers: { 'Content-Type': 'multipart/form-data; boundary=----x' },
      body: 'これは multipart ではない',
    });
    expect(res.status).toBe(400);
    expect((await json(res)).error).toBe('invalid-form');
  });

  it('ファイルが無ければ 400', async () => {
    const res = await api('/api/import', { method: 'POST', body: new FormData() });
    expect(res.status).toBe(400);
    expect((await json(res)).error).toBe('file-required');
  });
});

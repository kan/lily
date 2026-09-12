/**
 * portable import。**export と同じ形の書庫を読んで D1 と R2 に入れる。**
 *
 * 記事ごとに独立して取り込み、失敗した記事だけを報告する。1 本の記事の
 * frontmatter が壊れていたせいで書庫まるごと入らない、という形にはしない
 * (移行の途中で必ず起きるうえ、どれが悪いのか分からなくなる)。
 *
 * **既にある記事は上書きしない。** `public_id` が衝突したらその記事を
 * `public-id-taken` で落とす。上書きの意味は「本文だけ」「パスも」「消えた
 * 添付も」で変わり、取り違えると記事が壊れる。復旧 (空の DB へ入れ直す) と
 * 移行にはこれで足りるので、必要になってから決める。
 */
import {
  createMedia,
  findByPostAndFilename,
  getMediaByPublicId,
  mediaR2Key,
  setOgpMedia,
} from '../db/media.ts';
import { imageDimensions } from '../media/dimensions.ts';
import { canBeOgp, mimeForFilename } from '../media/formats.ts';
import { addAlias } from '../db/post-paths.ts';
import { createPost, getPostByPublicId } from '../db/posts.ts';
import { applyTags, resolveTags } from '../db/tags.ts';
import { renderAndStore } from '../delivery.ts';
import { normalizeSegment, type PostPaths } from '../paths.ts';
import { parsePostFile, POST_FILENAME, POSTS_DIR } from './format.ts';
import { readZip, type ZipFile } from './zip.ts';

export type ImportedPost = {
  readonly path: string;
  readonly publicId: string;
  readonly media: number;
  /** 取り込めたが完全ではなかったもの (別記事が持っている alias、未対応の添付など)。 */
  readonly warnings: readonly string[];
};

export type FailedPost = {
  readonly path: string;
  readonly error: string;
};

export type ImportResult = {
  readonly imported: readonly ImportedPost[];
  readonly failed: readonly FailedPost[];
  /** 記事として読まなかったファイル。 */
  readonly ignored: readonly string[];
};

export async function importArchive(
  db: D1Database,
  paths: PostPaths,
  bucket: R2Bucket,
  archive: Uint8Array,
): Promise<ImportResult> {
  const { groups, ignored } = groupPosts(await readZip(archive));

  const imported: ImportedPost[] = [];
  const failed: FailedPost[] = [];

  // パス順に取り込む。失敗したときにどこまで進んだかが読める。
  for (const directory of [...groups.keys()].sort()) {
    const group = groups.get(directory) as PostGroup;
    // **投げても他の記事を巻き込まない。** D1 の一時的な失敗や、検証をすり抜けた
    // 制約違反はここまで上がってくる。素通しすると 500 になり、既に入った記事の
    // 一覧まで失われる (どこまで進んだか分からないまま、入れ直すと衝突する)。
    let result: PostOutcome;
    try {
      result = await importPost(db, paths, bucket, directory, group);
    } catch (error) {
      result = { ok: false, error: `取り込み中に失敗した: ${messageOf(error)}` };
    }
    if (result.ok) imported.push(result.value);
    else failed.push({ path: directory, error: result.error });
  }

  return { imported, failed, ignored };
}

type PostGroup = {
  index: Uint8Array | null;
  /** 記事と同じディレクトリにあるファイル (ファイル名 → 中身)。 */
  readonly files: Map<string, Uint8Array>;
};

/**
 * 書庫を記事ごとにまとめる。**`posts/<path>/index.md` があるディレクトリだけ**が
 * 記事で、同じ階層のファイルがその添付。
 *
 * ディレクトリは何階層でも掘れて、そのまま URL になる (`posts/a/b/index.md`
 * → `a/b`)。記事の下のさらに下にあるファイルは添付にできない
 * (`media.filename` に `/` を入れられないため)。
 */
function groupPosts(files: readonly ZipFile[]): {
  groups: Map<string, PostGroup>;
  ignored: string[];
} {
  const prefix = `${POSTS_DIR}/`;
  const groups = new Map<string, PostGroup>();
  const ignored: string[] = [];

  for (const file of files) {
    if (!file.path.startsWith(prefix)) {
      ignored.push(file.path);
      continue;
    }
    const rest = file.path.slice(prefix.length);
    const separator = rest.lastIndexOf('/');
    if (separator <= 0) {
      // posts/ の直下に置かれたファイル。記事ディレクトリが無いので読まない。
      ignored.push(file.path);
      continue;
    }

    const directory = rest.slice(0, separator);
    const filename = rest.slice(separator + 1);
    const group = groups.get(directory) ?? { index: null, files: new Map() };
    if (filename === POST_FILENAME) group.index = file.data;
    else group.files.set(filename, file.data);
    groups.set(directory, group);
  }

  // index.md が無いディレクトリは記事ではない。中身は添付にもできないので落とす。
  for (const [directory, group] of [...groups]) {
    if (group.index !== null) continue;
    groups.delete(directory);
    for (const filename of group.files.keys()) ignored.push(`${prefix}${directory}/${filename}`);
  }

  return { groups, ignored: ignored.sort() };
}

type PostOutcome =
  | { ok: true; value: ImportedPost }
  | { ok: false; error: string };

async function importPost(
  db: D1Database,
  paths: PostPaths,
  bucket: R2Bucket,
  directory: string,
  group: PostGroup,
): Promise<PostOutcome> {
  const canonical = paths.normalizePostPath(directory);
  if (!canonical.ok) {
    return { ok: false, error: `パスとして使えない (${canonical.error.code})` };
  }

  const parsed = parsePostFile(new TextDecoder().decode(group.index as Uint8Array), paths);
  if (!parsed.ok) return { ok: false, error: parsed.error.message };
  const { frontmatter, bodyMd } = parsed.value;

  const status = frontmatter.draft ? 'draft' : 'published';
  if (status === 'published' && frontmatter.date === undefined) {
    return { ok: false, error: '公開済みの記事に date が無い' };
  }
  if (frontmatter.public_id && (await getPostByPublicId(db, frontmatter.public_id))) {
    return { ok: false, error: `public-id-taken: ${frontmatter.public_id}` };
  }

  // **タグは記事を作る前に解決する。** 作ってから弾くと、失敗を返したのに記事だけ
  // 残り、入れ直そうとすると衝突して手詰まりになる (管理 API と同じ理由)。
  const tags = await resolveTags(db, frontmatter.tags ?? []);
  if (!tags.ok) return { ok: false, error: `タグを解決できない (${tags.error.code}: ${tags.error.name})` };

  const created = await createPost(db, paths, {
    title: frontmatter.title,
    bodyMd,
    description: frontmatter.description ?? null,
    status,
    publishedAt: frontmatter.date ?? null,
    publicId: frontmatter.public_id,
    path: canonical.value,
    // created_at は portable な形式が持っていない。公開日 → 更新日の順で当てる
    // (どちらも無ければ createPost が現在時刻を入れる)。
    createdAt: frontmatter.date ?? frontmatter.updated,
    // **updated が無いときに現在時刻を入れない。** 「公開してから直していない」の
    // つもりで書かれていないキーなので、取り込み時刻を入れると移行した全記事が
    // 「今日更新された」ことになる (記事に更新日が出て、Atom の <updated> と
    // sitemap の lastmod も動き、購読者のリーダーに全記事が浮き上がる)。
    updatedAt: frontmatter.updated ?? frontmatter.date,
  });
  if (!created.ok) return { ok: false, error: `${created.error.code}` };
  const post = created.value;

  const warnings: string[] = [];
  if (tags.value.length > 0) await applyTags(db, post.id, tags.value);

  for (const alias of frontmatter.paths ?? []) {
    const normalized = paths.normalizePostPath(alias);
    if (!normalized.ok) {
      warnings.push(`alias を無視した (${normalized.error.code}): ${alias}`);
      continue;
    }
    // canonical と public_id は createPost が入れている。一意性の判定に合わせて
    // 大小文字を無視して比べる (ci の索引があるので、素通しすると必ず衝突する)。
    if (samePath(normalized.value, canonical.value) || samePath(normalized.value, post.public_id)) {
      continue;
    }
    const added = await addAlias(db, paths, post.id, normalized.value);
    if (!added.ok) warnings.push(`alias を追加できなかった (${added.error.code}): ${alias}`);
  }

  const media = await importMedia(db, bucket, post.id, post.public_id, group.files, frontmatter.media ?? {}, warnings);

  // OGP は**添付を入れたあと**に選ぶ（まだ無い行は指せない）。
  if (frontmatter.ogp !== undefined) {
    await applyOgp(db, post.id, frontmatter.ogp, warnings);
  }

  // 添付を入れてから描く。順番を逆にすると `./sample.png` が解決できず、
  // 貼ってあるはずの画像が公開ページから消える。
  const unresolved = await renderAndStore(db, post);
  for (const reference of unresolved) warnings.push(`本文の参照を解決できない: ${reference}`);

  return { ok: true, value: { path: canonical.value, publicId: post.public_id, media, warnings } };
}

/**
 * frontmatter の `ogp` が指す添付を OGP に選ぶ。
 *
 * **見つからなくても記事は取り込む。** 選択が落ちるだけで、共通の絵に戻るだけ
 * （書庫を丸ごと弾く理由にはならない）。名前は添付と同じ規則で正規化してから
 * 突き合わせる（`importMedia` が入れた名前もそれを通っている）。
 */
async function applyOgp(
  db: D1Database,
  postId: number,
  name: string,
  warnings: string[],
): Promise<void> {
  const filename = normalizeSegment(name);
  const media = filename.ok ? await findByPostAndFilename(db, postId, filename.value) : null;
  if (!media) {
    warnings.push(`ogp を無視した (その名前の添付が無い): ${name}`);
    return;
  }
  if (!canBeOgp(media.mime)) {
    warnings.push(`ogp を無視した (OGP に使えない形式 ${media.mime}): ${name}`);
    return;
  }
  await setOgpMedia(db, postId, media.id);
}

async function importMedia(
  db: D1Database,
  bucket: R2Bucket,
  postId: number,
  postPublicId: string,
  files: ReadonlyMap<string, Uint8Array>,
  publicIds: Readonly<Record<string, string>>,
  warnings: string[],
): Promise<number> {
  let count = 0;
  /** 正規化した名前 → 元の名前。書庫の中での衝突をここで畳む。 */
  const seen = new Map<string, string>();

  for (const name of [...files.keys()].sort()) {
    const data = files.get(name) as Uint8Array;
    // ファイル名は記事のパスと同じ規則で見る。export でそのままディレクトリへ
    // 書き出すので、書ける形であることまで含めて縛る (管理 API と同じ)。
    const filename = normalizeSegment(name);
    if (!filename.ok) {
      warnings.push(`添付を無視した (${filename.error.code}): ${name}`);
      continue;
    }
    // **NFC に揃えると別々の名前が同じになることがある** (macOS の書庫は NFD)。
    // media(post_id, filename) は UNIQUE なので、素通しすると 2 つ目の
    // createMedia が制約違反で投げる。
    // 見た目が同じ 2 つの名前が並ぶので、どちらが残ったかまで書く。
    const kept = seen.get(filename.value);
    if (kept !== undefined) {
      warnings.push(`添付を無視した (正規化すると ${filename.value} が重なる。残したのは ${kept}): ${name}`);
      continue;
    }
    seen.set(filename.value, name);

    // 書庫に Content-Type は無いので拡張子で決める (受け付ける範囲は管理 API と同じ)。
    const mime = mimeForFilename(filename.value);
    if (mime === undefined) {
      warnings.push(`添付を無視した (対応していない形式): ${name}`);
      continue;
    }
    if (data.length === 0) {
      warnings.push(`添付を無視した (中身が空): ${name}`);
      continue;
    }

    // public_id は配信 URL なので、書庫にあるものを引き継ぐ。ただし**そのまま
    // URL の 1 セグメントになる**ので、記事のパスと同じ規則で見る。空文字を
    // 通すと `<mount>/media//<filename>` になり、どの route にも当たらない
    // (media.public_id には NOT NULL UNIQUE しか無く、DB は形を見ない)。
    let publicId = Object.hasOwn(publicIds, name) ? publicIds[name] : undefined;
    if (publicId !== undefined) {
      const checked = normalizeSegment(publicId);
      if (!checked.ok || checked.value !== publicId) {
        warnings.push(`添付の public_id が使えないので採番し直した: ${name}`);
        publicId = undefined;
      } else if (await getMediaByPublicId(db, publicId)) {
        warnings.push(`添付の public_id が使われていたので採番し直した: ${name}`);
        publicId = undefined;
      }
    }

    // 寸法は `<img>` の width / height に使う。読めなければ NULL のまま
    // (属性が出ないだけで、記事は取り込める)。
    const size = imageDimensions(data, mime);

    const r2Key = mediaR2Key(postPublicId, filename.value);
    await createMedia(db, {
      postId,
      filename: filename.value,
      r2Key,
      mime,
      bytes: data.length,
      width: size?.width,
      height: size?.height,
      publicId,
    });
    await bucket.put(r2Key, data, { httpMetadata: { contentType: mime } });
    count++;
  }

  return count;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** パスの一意性は `lower(path)` で見ているので、比較もそれに合わせる。 */
function samePath(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

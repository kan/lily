/**
 * portable な記事ファイルの形。**import と export で同じ 1 形式。**
 *
 * ```
 * posts/<canonical-path>/index.md   frontmatter + 本文 (相対参照のまま)
 * posts/<canonical-path>/sample.png 添付
 * ```
 *
 * 本文は `body_md` をそのまま入れる。**mount も deployment も知らない**ので、
 * 書き出したものを別の場所に import しても同じ記事になる。
 *
 * frontmatter のキーはここに並んでいるものだけで、**知らないキーは拒否する**。
 * 黙って捨てると往復で情報が落ち、書き間違いにも気付けない。
 */
import { z } from 'zod';
import type { MediaRow, PostRow } from '../db/types.ts';
import type { PostPaths } from '../paths.ts';
import { err, ok, type Result } from '../result.ts';
import {
  parseFrontmatter,
  plain,
  stringifyFrontmatter,
  type FmEntry,
  type FmValue,
} from './frontmatter.ts';

/** 記事 1 本のファイル名。**これ以外の Markdown は記事として読まない。** */
export const POST_FILENAME = 'index.md';

/** 書庫の中で記事が並ぶディレクトリ。 */
export const POSTS_DIR = 'posts';

/**
 * frontmatter のキー。**この順で書き出す。**
 *
 * `title` … `draft` は Astro 版から引き継いだもので、`public_id` 以降が lily で
 * 足したもの。移行のときに前者だけの記事を読めるよう、後者はすべて省略できる。
 */
export const FRONTMATTER_KEYS = [
  'title',
  'date',
  'updated',
  'description',
  'tags',
  'draft',
  'public_id',
  'paths',
  'media',
  'ogp',
] as const;

/** 空欄 (`description:` のように値を書かない) は「書いていない」と同じ扱いにする。 */
function blankAsUnset<T extends z.ZodTypeAny>(schema: T) {
  return z.preprocess((value) => (value === null || value === '' ? undefined : value), schema.optional());
}

/** `2026-08-24` も `2026-08-24T00:00:00.000Z` も受けて、UTC ISO8601 に揃える。 */
const dateTime = z
  .string()
  .refine((value) => !Number.isNaN(Date.parse(value)), '日時として読めない')
  .transform((value) => new Date(value).toISOString());

const boolean = z
  .enum(['true', 'false'], { message: 'true か false' })
  .transform((value) => value === 'true');

const schema = z.object({
  title: z.string().min(1, 'タイトルは必須'),
  /**
   * 公開日時。**下書きでは省略できる** (公開していない記事に公開日は無い)。
   * 公開済みとして取り込むときに欠けていれば import が弾く。
   */
  date: blankAsUnset(dateTime),
  updated: blankAsUnset(dateTime),
  description: blankAsUnset(z.string()),
  tags: blankAsUnset(z.array(z.string())),
  draft: blankAsUnset(boolean),
  /**
   * 不変の identity。**export では必ず書く。** 移行のときだけ省略でき、
   * その場合は取り込み側で採番する。
   */
  public_id: blankAsUnset(z.string()),
  /** canonical + alias。canonical はディレクトリ名の方が正なので、順序は問わない。 */
  paths: blankAsUnset(z.array(z.string())),
  /** ファイル名 → 添付の public_id。配信 URL を往復で保つために持つ。 */
  media: blankAsUnset(z.record(z.string(), z.string())),
  /**
   * OGP に使う添付の**ファイル名**（`media` のキーと同じもの）。
   *
   * public_id ではなくファイル名で指すのは、`media` を省いた形（＝よそから
   * 持ち込む形）でも書けるようにするため。書き手が見て分かる値でもある。
   */
  ogp: blankAsUnset(z.string()),
});

export type PostFrontmatter = z.infer<typeof schema>;

export type PostFileErrorCode =
  | 'frontmatter'
  | 'unknown-key'
  | 'invalid-frontmatter'
  | 'invalid-public-id';

export type PostFileError = { readonly code: PostFileErrorCode; readonly message: string };

export type ParsedPostFile = {
  readonly frontmatter: PostFrontmatter;
  /** `body_md` に入れる本文。**1 バイトも触っていない。** */
  readonly bodyMd: string;
};

export function parsePostFile(
  text: string,
  paths: PostPaths,
): Result<ParsedPostFile, PostFileError> {
  const document = parseFrontmatter(text);
  if (!document.ok) {
    const { code, line, detail } = document.error;
    return err({
      code: 'frontmatter',
      message: `frontmatter を読めない (${code}, ${line} 行目${detail ? `: ${detail}` : ''})`,
    });
  }

  const data: Record<string, FmValue> = { ...document.value.data };
  const unknown = Object.keys(data).filter(
    (key) => !(FRONTMATTER_KEYS as readonly string[]).includes(key),
  );
  if (unknown.length > 0) {
    return err({ code: 'unknown-key', message: `知らない frontmatter のキー: ${unknown.join(', ')}` });
  }

  const parsed = schema.safeParse(data);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const path = issue?.path.join('.') ?? '';
    return err({
      code: 'invalid-frontmatter',
      message: `frontmatter が不正${path ? ` (${path})` : ''}: ${issue?.message ?? '検証に失敗'}`,
    });
  }

  const publicId = parsed.data.public_id;
  if (publicId !== undefined) {
    const checked = checkPublicId(publicId, paths);
    if (!checked.ok) return checked;
  }

  return ok({ frontmatter: parsed.data, bodyMd: document.value.body });
}

/**
 * `public_id` は identity であると同時に**パスとしても登録される**
 * (「記事は常に public_id で引ける」)。だから記事のパスと同じ規則で見る。
 *
 * `normalizePostPath` を通さずに入れると、`admin` のような予約語が
 * `post_paths` に入って route を食う経路が開く。
 */
function checkPublicId(publicId: string, paths: PostPaths): Result<string, PostFileError> {
  const normalized = paths.normalizePostPath(publicId);
  if (!normalized.ok) {
    return err({
      code: 'invalid-public-id',
      message: `public_id をパスとして使えない (${normalized.error.code}): ${publicId}`,
    });
  }
  if (normalized.value !== publicId || publicId.includes('/')) {
    return err({
      code: 'invalid-public-id',
      message: `public_id は正規化済みの 1 セグメントであること: ${publicId}`,
    });
  }
  return ok(publicId);
}

export type BuildPostFileInput = {
  readonly post: PostRow;
  /** canonical を先頭にした全パス。 */
  readonly paths: readonly string[];
  readonly tags: readonly string[];
  /** 書庫に実際に入れた添付だけ。R2 から取れなかったものは含めない。 */
  readonly media: readonly Pick<MediaRow, 'filename' | 'public_id' | 'is_ogp'>[];
};

/** 記事 1 本を `index.md` の中身にする。 */
export function buildPostFile(input: BuildPostFileInput): string {
  const { post } = input;
  const mediaMap: Record<string, string> = {};
  for (const item of input.media) mediaMap[item.filename] = item.public_id;

  const entries: FmEntry[] = [
    ['title', post.title],
    // 日時は引用符なしで書く。標準の YAML パーサにも同じ型で読ませたいため。
    ['date', post.published_at === null ? undefined : plain(post.published_at)],
    ['updated', plain(post.updated_at)],
    ['description', post.description ?? undefined],
    ['tags', input.tags],
    // 公開済みのときは書かない (既定が「下書きではない」なので、行が増えない)。
    // 真偽値も引用符なし (標準の YAML パーサに bool として読ませる)。
    ['draft', post.status === 'draft' ? plain('true') : undefined],
    ['public_id', post.public_id],
    ['paths', input.paths],
    ['media', mediaMap],
    // **書庫に入った添付から選ぶ。** R2 から取れなかった絵を指して書き出すと、
    // 取り込み直したときに解決できない名前だけが残る。
    ['ogp', input.media.find((item) => item.is_ogp === 1)?.filename],
  ];

  return stringifyFrontmatter(entries, post.body_md);
}

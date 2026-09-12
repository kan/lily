/**
 * 管理 API の入力。**外から来るものはここを通る。**
 *
 * zod は外部入力の検証、TypeScript はアプリ内部の型、SQLite の制約が永続化時の
 * 最後の砦。3 層のうち、この層が受け持つのは「形が合っているか」だけで、
 * 「そのパスが空いているか」のような DB を見ないと分からないことは query layer が返す。
 *
 * リクエストの型はここで 1 度だけ定義し、**レスポンスの型は handler から推論**させる
 * (Hono RPC)。手で書いた型と実装がずれる余地を作らない。
 */
import { z } from 'zod';

/** UTC ISO8601。DB に入る形に揃える。 */
const isoDateTime = z
  .string()
  .refine((value) => !Number.isNaN(Date.parse(value)), '日時として読めない')
  .transform((value) => new Date(value).toISOString());

/** 空文字は「書いていない」と同じ扱いにする (フォームは空欄を空文字で送る)。 */
const optionalText = z
  .string()
  .transform((value) => (value.trim() === '' ? null : value))
  .nullable();

/**
 * 記事のタイトル。**空白だけも空と同じ。**
 *
 * DB の `CHECK (length(title) > 0)` は空文字しか弾かないので、`"   "` が通ると
 * 一覧に何も書いていない行が並ぶ（管理画面が「題を入れてから」と言う判定とも
 * 食い違う）。`trim()` を先に通すので、前後の空白は保存される値からも落ちる。
 */
const title = z.string().trim().min(1, 'タイトルは必須');

export const createPostSchema = z.object({
  title,
  bodyMd: z.string().default(''),
  description: optionalText.optional(),
  /** 省略すると public_id がそのまま URL になる。 */
  path: z.string().optional(),
  tags: z.array(z.string()).optional(),
  /**
   * 公開日時。下書きのうちから決めておける (公開のときにこの日時が使われる)。
   * 省略すると、公開したときの時刻になる。
   */
  publishedAt: isoDateTime.optional(),
});

export const updatePostSchema = z.object({
  title: title.optional(),
  bodyMd: z.string().optional(),
  description: optionalText.optional(),
  tags: z.array(z.string()).optional(),
  /**
   * 公開日時。**null にはできない。** 公開中の記事から日付を消すと DB の CHECK に
   * 弾かれるし、下げたいなら「取り下げる」の方が意図が伝わる。
   */
  publishedAt: isoDateTime.optional(),
});

export const publishSchema = z.object({
  /** 省略すると初回は現在時刻、再公開では元の日付を保つ。 */
  publishedAt: isoDateTime.optional(),
});

export const pathSchema = z.object({
  path: z.string().min(1),
});

/** OGP に使う添付。**null で選択を外す**（「無し」を送れないと戻せない）。 */
export const ogpSchema = z.object({
  mediaPublicId: z.string().min(1).nullable(),
});

/**
 * 絞り込みの語。**空文字は「絞り込み無し」。** 画面の入力欄を空にしたときに
 * `?q=` が付いて飛んでくるので、それを「空文字に一致する記事」と読まない。
 */
const filterWord = z
  .string()
  .trim()
  .transform((value) => (value === '' ? undefined : value))
  .optional();

export const listPostsSchema = z.object({
  status: z.enum(['draft', 'published']).optional(),
  /** タグの slug。 */
  tag: filterWord,
  /** タイトル・説明・本文の部分一致。 */
  q: filterWord,
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export const renderSchema = z.object({
  bodyMd: z.string(),
  /** 添付を解決するための記事。新規作成中は省略する。 */
  publicId: z.string().optional(),
});

export const linkTitleSchema = z.object({
  url: z.string().url(),
});

export const linkCardSchema = z.object({
  url: z.string().url(),
});

export type CreatePostInput = z.infer<typeof createPostSchema>;
export type UpdatePostInput = z.infer<typeof updatePostSchema>;

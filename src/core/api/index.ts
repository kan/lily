/**
 * 管理 API。**`<mount>/api` にマウントされる前提**で、ここでのパスは `/posts` の
 * ように mount を知らない形にしてある。Hono RPC の型がリテラルのまま残るので、
 * 管理画面は `hc<LilyApi>('<mount>/api')` だけで全エンドポイントに型が付く。
 *
 * リクエストの検証は zod を `zValidator` で 1 度だけ書き、**レスポンスの型は
 * handler から推論**させる。手で書いた型と実装がずれる余地を作らない。
 */
import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import type { AuthUser } from '../auth/index.ts';
import {
  announce,
  BlueskyError,
  MAX_THUMB_BYTES,
  type BlueskyCredentials,
  type BlueskyThumb,
} from '../bluesky.ts';
import type { LilyBindings, PageConfig } from '../config.ts';
import { renderAndStore } from '../delivery.ts';
import {
  createMedia,
  deleteMedia,
  findByPostAndFilename,
  getMediaByPublicId,
  getOgpMedia,
  listMediaByPost,
  mediaR2Key,
  setOgpMedia,
} from '../db/media.ts';
import {
  addAlias,
  changeCanonicalPath,
  getCanonicalPath,
  removePath,
} from '../db/post-paths.ts';
import {
  countPosts,
  countPostsNeedingRender,
  createPost,
  deletePost,
  getPostById,
  getPostByPublicId,
  listAllPosts,
  listPostsNeedingRender,
  publishPost,
  setBlueskyUri,
  setPreviewToken,
  unpublishPost,
  updatePost,
} from '../db/posts.ts';
import { applyTags, getTagsForPosts, listTagsWithCounts, resolveTags } from '../db/tags.ts';
import { groupByPost } from '../view.ts';
import type { MediaRow, PostRow } from '../db/types.ts';
import { buildLinkCard } from '../link-card.ts';
import { fetchLinkTitle, linkUserAgent } from '../link-preview.ts';
import { imageDimensions } from '../media/dimensions.ts';
import { canBeOgp, mimeForFilename } from '../media/formats.ts';
import { createPaths, normalizeSegment, type Urls } from '../paths.ts';
import { RENDERER_VERSION, renderMarkdown } from '../render/index.ts';
import { resolveMediaUrls } from '../render/placeholder.ts';
import { postDescription, summarize } from '../summary.ts';
import { hashPreviewToken, newPreviewToken } from '../tokens.ts';
import {
  bytesBody,
  exportArchive,
  importArchive,
  logExportWarnings,
  ZipError,
} from '../transfer/index.ts';
import { uniqueViolationTarget } from '../db/errors.ts';
import { apiError } from './errors.ts';
import {
  createPostSchema,
  linkCardSchema,
  linkTitleSchema,
  listPostsSchema,
  ogpSchema,
  pathSchema,
  publishSchema,
  renderSchema,
  updatePostSchema,
} from './schema.ts';
import { toMediaView, toPostView, toTagRefs } from './view.ts';

/**
 * API が要求する形。**バインディングでジェネリックにしない。**
 * 認証アダプタを作るのに要る deployment 固有の設定は `routes/api.ts` の
 * ミドルウェア側が受け持つので、こちらは core が使う分だけ知っていればよい。
 */
export type ApiEnv = {
  Bindings: LilyBindings;
  /** `bluesky` は `routes/api.ts` が env から解決して載せる（未設定なら null）。 */
  Variables: { user: AuthUser; bluesky: BlueskyCredentials | null };
};

/** 添付の上限。R2 は大きくても置けるが、記事の挿し絵にこれ以上は要らない。 */
const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

/**
 * 1 回の再描画で扱う記事の数。1 記事あたり D1 に数回問い合わせるので、
 * Workers の subrequest の上限に当たらない範囲に抑える。
 */
const RERENDER_BATCH = 50;

/**
 * 取り込める書庫の上限。**展開したものを丸ごとメモリに載せる**ので、
 * Workers の 128MB に対して余裕を持たせてある。
 */
const MAX_IMPORT_BYTES = 50 * 1024 * 1024;

export function createApi(config: PageConfig) {
  const paths = createPaths(config);
  const { urls } = paths;
  // 外へ取りに行くときに名乗る名前。**空だと断られる先がある**（`link-preview.ts`）。
  const userAgent = linkUserAgent(config.site);
  const api = new Hono<ApiEnv>();

  return api
    .get('/me', (c) => c.json({ user: c.get('user') }))

    /**
     * 編集中のプレビュー。**保存しない。**
     *
     * 公開ページと同じ renderer と同じ resolver を通すので、書きながら見ている
     * ものと出るものが食い違わない。管理画面に Markdown のパーサを 2 本目として
     * 持ち込まずに済む、という意味でもある。
     */
    .post('/render', zValidator('json', renderSchema), async (c) => {
      const db = c.env.DB;
      const { bodyMd, publicId } = c.req.valid('json');
      const post = publicId ? await getPostByPublicId(db, publicId) : null;
      const media = post ? await listMediaByPost(db, post.id) : [];

      const rendered = await renderMarkdown(bodyMd, { media });
      return c.json({
        html: resolveMediaUrls(rendered.html, urls),
        unresolvedMedia: rendered.unresolvedMedia,
        // 説明を空のままにしたときに出るもの。**配信側と同じ関数**なので、
        // 管理画面が見せている控えと実際に出るものが食い違わない。ここに載せる
        // のは、解析器を管理画面のバンドルへ運ばずに済ませるため。
        autoDescription: summarize(bodyMd),
      });
    })

    /** タグの補完と一覧の絞り込みに使う。件数の多い順。 */
    .get('/tags', async (c) => {
      const tags = await listTagsWithCounts(c.env.DB);
      // slug も返す。絞り込みは slug で行う (名前は表示のため)。
      return c.json({
        tags: tags.map((tag) => ({ name: tag.name, slug: tag.slug, count: tag.post_count })),
      });
    })

    /**
     * 貼り付けた URL のタイトル。ブラウザからは CORS で読めないので代わりに取る。
     * 取れなくても書くのを止めないよう、失敗は `title: null` で返す。
     */
    .post('/link-title', zValidator('json', linkTitleSchema), async (c) => {
      return c.json(await fetchLinkTitle(c.req.valid('json').url, userAgent));
    })

    .get('/posts', zValidator('query', listPostsSchema), async (c) => {
      const db = c.env.DB;
      const { status, limit, offset, tag, q } = c.req.valid('query');
      // **行と件数に同じ絞り込みを渡す。** 片方だけ絞ると総件数が食い違い、
      // ページャが「次がある」と言い続ける。
      const filter = { status, tag, q };
      // 総件数も返す。無いと管理画面が「次のページがあるか」を出せない。
      const [posts, total] = await Promise.all([
        listAllPosts(db, { ...filter, limit, offset }),
        countPosts(db, filter),
      ]);
      // タグはまとめて引く (1 行ずつ引くと 1 ページで 30 クエリになる)。
      const tags = groupByPost(await getTagsForPosts(db, posts.map((post) => post.id)));
      return c.json({
        total,
        limit,
        offset,
        posts: posts.map((post) => ({
          publicId: post.public_id,
          title: post.title,
          description: post.description,
          status: post.status,
          publishedAt: post.published_at,
          updatedAt: post.updated_at,
          canonicalPath: post.canonical_path,
          url: urls.post(post.canonical_path),
          tags: toTagRefs(tags.get(post.id) ?? []),
        })),
      });
    })

    .post('/posts', zValidator('json', createPostSchema), async (c) => {
      const db = c.env.DB;
      const input = c.req.valid('json');

      // **タグは記事を作る前に検証する。** 作ってから弾くと、失敗を返したのに
      // 記事だけ残り、同じパスで作り直すと 409 になって手詰まりになる。
      const tags = await resolveTags(db, input.tags ?? []);
      if (!tags.ok) return c.json(...apiError(tags.error.code, tags.error.name));

      const created = await createPost(db, paths, {
        title: input.title,
        bodyMd: input.bodyMd,
        description: input.description,
        path: input.path,
        publishedAt: input.publishedAt,
      });
      if (!created.ok) return c.json(...apiError(created.error.code, created.error.segment));

      if (input.tags) await applyTags(db, created.value.id, tags.value);
      return c.json(await save(db, urls, created.value), 201);
    })

    .get('/posts/:publicId', async (c) => {
      const post = await getPostByPublicId(c.env.DB, c.req.param('publicId'));
      if (!post) return c.json(...apiError('post-not-found'));
      // **GET は書き込まない。** body_html は最後の保存で作ってある。
      return c.json({ post: await toPostView(c.env.DB, urls, post) });
    })

    .patch('/posts/:publicId', zValidator('json', updatePostSchema), async (c) => {
      const db = c.env.DB;
      const post = await getPostByPublicId(db, c.req.param('publicId'));
      if (!post) return c.json(...apiError('post-not-found'));

      const input = c.req.valid('json');
      if (input.tags) {
        const tags = await resolveTags(db, input.tags);
        if (!tags.ok) return c.json(...apiError(tags.error.code, tags.error.name));
        await applyTags(db, post.id, tags.value);
      }

      const updated = await updatePost(db, post.id, {
        title: input.title,
        description: input.description,
        body_md: input.bodyMd,
        published_at: input.publishedAt,
      });
      if (!updated) return c.json(...apiError('post-not-found'));
      return c.json(await save(db, urls, updated));
    })

    .delete('/posts/:publicId', async (c) => {
      const db = c.env.DB;
      const post = await getPostByPublicId(db, c.req.param('publicId'));
      if (!post) return c.json(...apiError('post-not-found'));

      // R2 のオブジェクト削除は**コミット後**。失敗分は残骸として残るが、
      // DB を巻き戻すより安い。
      const keys = await deletePost(db, post.id);
      // allSettled なのは、R2 の 1 つが失敗しても 200 を返しきるため。DB は
      // もうコミット済みで、消せなかったぶんは孤児として残す方が安い。
      await Promise.allSettled(keys.map((key) => c.env.MEDIA.delete(key)));
      return c.json({ deleted: post.public_id });
    })

    .post('/posts/:publicId/publish', zValidator('json', publishSchema), async (c) => {
      const db = c.env.DB;
      const post = await getPostByPublicId(db, c.req.param('publicId'));
      if (!post) return c.json(...apiError('post-not-found'));

      const published = await publishPost(db, post.id, c.req.valid('json').publishedAt);
      if (!published) return c.json(...apiError('post-not-found'));
      return c.json(await save(db, urls, published));
    })

    .post('/posts/:publicId/unpublish', async (c) => {
      const db = c.env.DB;
      const post = await getPostByPublicId(db, c.req.param('publicId'));
      if (!post) return c.json(...apiError('post-not-found'));

      const draft = await unpublishPost(db, post.id);
      if (!draft) return c.json(...apiError('post-not-found'));
      return c.json(await save(db, urls, draft));
    })

    /**
     * Bluesky へ告知する。**押したときだけ投げ、1 記事につき 1 回だけ。**
     *
     * 公開と分けてあるのは、公開が何度でもやり直せる操作だから（下書きへ戻して
     * 直してまた公開する、公開日時を入れ直す）。自動にすると、そのたびに同じ
     * 記事がタイムラインへ流れる。
     *
     * **やり直す口は作っていない。** 告知済みの記事は 409 で断る。Bluesky 側で
     * 投稿を消したときにどうするか（消えた投稿を指したまま「告知済み」にするか、
     * もう 1 本投げるか）は、必要になってから決める。
     */
    .post('/posts/:publicId/bluesky', async (c) => {
      const db = c.env.DB;
      const post = await getPostByPublicId(db, c.req.param('publicId'));
      if (!post) return c.json(...apiError('post-not-found'));
      // 下書きの URL は読者には 404 なので、リンクカードが組めない。
      if (post.status !== 'published') return c.json(...apiError('post-not-published'));
      // 二重投稿の抑止。**先に見る**ので、資格情報が無くてもここは同じ答えになる。
      if (post.bluesky_uri !== null) {
        return c.json(...apiError('already-announced', post.bluesky_uri));
      }

      const credentials = c.get('bluesky');
      if (!credentials) return c.json(...apiError('bluesky-not-configured'));

      // 記事のパスとサムネは互いに無関係なので同時に取る（サムネは
      // 「どれを載せるか」を引いてから実体を読むので、2 段まとめて片側に置く）。
      const [canonical, thumb] = await Promise.all([
        getCanonicalPath(db, post.id),
        getOgpMedia(db, post.id).then((ogp) => cardThumb(config, c.env, c.req.url, ogp)),
      ]);

      let announced;
      try {
        announced = await announce(credentials, {
          url: urls.post(canonical ?? post.public_id, { absolute: true }),
          title: post.title,
          // 一覧・OGP・フィードに出るものと同じ説明（手書きが無ければ本文の冒頭）。
          description: postDescription(post) ?? '',
          langs: [config.site.lang],
          thumb,
        });
      } catch (error) {
        // **記録は残さない。** 投稿できていないのに告知済みにすると、直したあとに
        // もう押せなくなる。
        if (error instanceof BlueskyError) {
          console.warn(`bluesky: ${error.step} で失敗した (${post.public_id}): ${error.message}`);
          return c.json(...apiError('bluesky-failed', error.message));
        }
        throw error;
      }

      // **上書きはしない。** 続けて 2 回押されると、どちらも空を見てから外へ
      // 投げるので投稿は 2 本できる。せめて先に投げた方の AT-URI を残す
      // （消すのは Bluesky 側でしかできず、記録が消えると辿れなくなる）。
      if (!(await setBlueskyUri(db, post.id, announced.uri))) {
        console.warn(
          `bluesky: 告知が競合した。二重に投稿している (${post.public_id}): ${announced.uri}`,
        );
      }
      const fresh = (await getPostByPublicId(db, post.public_id)) ?? post;
      return c.json({ post: await toPostView(db, urls, fresh) });
    })

    // canonical の張り替え。**旧パスは alias として残る**ので、共有された URL は生き続ける。
    .put('/posts/:publicId/path', zValidator('json', pathSchema), async (c) => {
      const db = c.env.DB;
      const post = await getPostByPublicId(db, c.req.param('publicId'));
      if (!post) return c.json(...apiError('post-not-found'));

      const changed = await changeCanonicalPath(db, paths, post.id, c.req.valid('json').path);
      if (!changed.ok) return c.json(...apiError(changed.error.code, changed.error.segment));
      // 本文は変わらないので描き直さない (URL の解決は配信時に行われる)。
      return c.json({ post: await toPostView(db, urls, post) });
    })

    .post('/posts/:publicId/paths', zValidator('json', pathSchema), async (c) => {
      const db = c.env.DB;
      const post = await getPostByPublicId(db, c.req.param('publicId'));
      if (!post) return c.json(...apiError('post-not-found'));

      const added = await addAlias(db, paths, post.id, c.req.valid('json').path);
      if (!added.ok) return c.json(...apiError(added.error.code, added.error.segment));
      // 本文は変わらないので描き直さない (URL の解決は配信時に行われる)。
      return c.json({ post: await toPostView(db, urls, post) });
    })

    .delete('/posts/:publicId/paths', zValidator('json', pathSchema), async (c) => {
      const db = c.env.DB;
      const post = await getPostByPublicId(db, c.req.param('publicId'));
      if (!post) return c.json(...apiError('post-not-found'));

      const removed = await removePath(db, paths, post.id, c.req.valid('json').path);
      if (!removed.ok) return c.json(...apiError(removed.error.code, removed.error.segment));
      // 本文は変わらないので描き直さない (URL の解決は配信時に行われる)。
      return c.json({ post: await toPostView(db, urls, post) });
    })

    // プレビュー URL の発行。**生のトークンを返すのはこの 1 回だけ**で、
    // DB に入るのは SHA-256 のハッシュ。
    .post('/posts/:publicId/preview', async (c) => {
      const db = c.env.DB;
      const post = await getPostByPublicId(db, c.req.param('publicId'));
      if (!post) return c.json(...apiError('post-not-found'));

      const token = newPreviewToken();
      await setPreviewToken(db, post.id, await hashPreviewToken(token));
      // **絶対 URL にはしない。** 設定の site.url を使うと、ローカルで発行した
      // リンクが本番のホストを指して開けなくなる。管理画面は必ず配信元と同じ
      // オリジンで動いているので、そちらで `location.origin` と繋ぐ方が正しい。
      return c.json({ path: urls.preview(token) });
    })

    .delete('/posts/:publicId/preview', async (c) => {
      const db = c.env.DB;
      const post = await getPostByPublicId(db, c.req.param('publicId'));
      if (!post) return c.json(...apiError('post-not-found'));

      await setPreviewToken(db, post.id, null);
      return c.json({ revoked: post.public_id });
    })

    /**
     * OGP に使う添付を選ぶ。**記事につき 1 枚**で、`null` で選択を外す。
     *
     * 反映先は記事ページの `og:image` と、Bluesky の告知のリンクカード。
     * 選んでいない記事はサイト共通の絵に落ちる。
     */
    .put('/posts/:publicId/ogp', zValidator('json', ogpSchema), async (c) => {
      const db = c.env.DB;
      const post = await getPostByPublicId(db, c.req.param('publicId'));
      if (!post) return c.json(...apiError('post-not-found'));

      const { mediaPublicId } = c.req.valid('json');
      let mediaId: number | null = null;
      if (mediaPublicId !== null) {
        const media = await getMediaByPublicId(db, mediaPublicId);
        // **他の記事の添付は指せない。** 指せると、記事を消したときに OGP だけ
        // 生き残る（あるいは消えた絵を指し続ける）。
        if (!media || media.post_id !== post.id) return c.json(...apiError('media-not-found'));
        if (!canBeOgp(media.mime)) {
          return c.json(...apiError('ogp-format-not-allowed', media.mime));
        }
        mediaId = media.id;
      }

      await setOgpMedia(db, post.id, mediaId);
      // 本文は変わらないので描き直さない。
      return c.json({ post: await toPostView(db, urls, post) });
    })

    .post('/posts/:publicId/media', async (c) => {
      const db = c.env.DB;
      const post = await getPostByPublicId(db, c.req.param('publicId'));
      if (!post) return c.json(...apiError('post-not-found'));

      const form = await c.req.formData();
      const file = form.get('file');
      if (!(file instanceof File)) return c.json(...apiError('file-required'));
      if (file.size === 0) return c.json(...apiError('file-empty'));
      if (file.size > MAX_UPLOAD_BYTES) return c.json(...apiError('file-too-large'));

      // ファイル名は記事のパスと同じ規則で見る。export でそのままディレクトリに
      // 書き出すので、書ける形であることまで含めて縛る。
      const filename = normalizeSegment(String(form.get('filename') ?? file.name));
      if (!filename.ok) return c.json(...apiError(filename.error.code));

      // **形式は拡張子で決める。** import には Content-Type が無いので、ここだけ
      // ブラウザの申告で通すと、上げられるのに取り込み直せない添付ができる
      // (export → import で画像だけが消える)。
      const mime = mimeForFilename(filename.value);
      if (mime === undefined) {
        return c.json(...apiError('extension-not-allowed', filename.value));
      }
      // 名前と中身の申告が食い違うものは受けない。どちらを信じても、往復か配信の
      // どちらかで辻褄が合わなくなる。
      if (file.type !== mime) {
        return c.json(...apiError('mime-mismatch', `${file.type} / ${filename.value}`));
      }

      // **DB を先に入れてから R2 に置く。** r2Key は (記事, ファイル名) から
      // 決まるので、逆順にすると 2 回目の upload が既存の実体を上書きしてから
      // 409 を返すことになる (「失敗した」と言いながら元の画像は消えている)。
      if (await findByPostAndFilename(db, post.id, filename.value)) {
        return c.json(...apiError('filename-taken', filename.value));
      }

      // 寸法は `<img>` の width / height に使う。**R2 に置く前にここで読む。**
      // 後から読むには実体を取り直すことになり、置いた直後にもう 1 往復が要る。
      const data = new Uint8Array(await file.arrayBuffer());
      const size = imageDimensions(data, mime);

      const r2Key = mediaR2Key(post.public_id, filename.value);
      let media;
      try {
        media = await createMedia(db, {
          postId: post.id,
          filename: filename.value,
          r2Key,
          mime,
          bytes: file.size,
          width: size?.width,
          height: size?.height,
        });
      } catch (error) {
        // 上の SELECT との間に同じ名前を作られた場合だけ 409。それ以外
        // (D1 の一時的な失敗など) を握り潰すと、名前を変えても直らない
        // 「ファイル名の衝突」を延々と見せることになる。
        if (uniqueViolationTarget(error) !== null) {
          return c.json(...apiError('filename-taken', filename.value));
        }
        throw error;
      }

      await c.env.MEDIA.put(r2Key, data, {
        httpMetadata: { contentType: file.type },
      });

      // 本文の `./<filename>` が解決できるようになるので描き直す。
      const unresolved = await renderAndStore(db, post);
      return c.json({ media: toMediaView(urls, media), unresolvedMedia: unresolved }, 201);
    })

    /**
     * 貼った URL を、題・説明・サムネの付いたカード（生 HTML）にする。
     *
     * **記事に紐づくのはサムネを添付として取り込むから。** 中身は `link-card.ts`。
     *
     * ここで本文を描き直さない。返した HTML を本文へ入れるかどうかは管理画面が
     * 決めることで、まだ `body_md` に入っていない（添付が増えただけの状態では、
     * 描き直しても出力は変わらない）。
     */
    .post('/posts/:publicId/link-card', zValidator('json', linkCardSchema), async (c) => {
      const db = c.env.DB;
      const post = await getPostByPublicId(db, c.req.param('publicId'));
      if (!post) return c.json(...apiError('post-not-found'));

      const card = await buildLinkCard(
        { db, bucket: c.env.MEDIA, userAgent },
        post,
        c.req.valid('json').url,
      );
      if (!card.ok) return c.json(...apiError(card.error));

      return c.json({
        html: card.value.html,
        media: card.value.media === null ? null : toMediaView(urls, card.value.media),
      });
    })

    .delete('/media/:publicId', async (c) => {
      const db = c.env.DB;
      const media = await getMediaByPublicId(db, c.req.param('publicId'));
      if (!media) return c.json(...apiError('not-found'));

      const key = await deleteMedia(db, media.id);
      if (key) await c.env.MEDIA.delete(key);

      // **消したら描き直す。** body_html は配信される実体なので、そのままだと
      // 消えた画像を指す <img> が公開ページに残り続ける。
      const owner = media.post_id === null ? null : await getPostById(db, media.post_id);
      const unresolvedMedia = owner ? await renderAndStore(db, owner) : [];
      return c.json({ deleted: media.public_id, unresolvedMedia });
    })

    /**
     * portable export。**記事の Markdown と添付を 1 つの zip にする。**
     *
     * D1 の dump (運用復旧用) とは別物で、こちらは lily を捨てても読める形。
     * 実体が無い添付は書庫に入らないが、**export 自体は止めない**
     * (書庫が作れないことで、R2 から消えている事実を隠さない)。
     */
    .get('/export', async (c) => {
      const result = await exportArchive(c.env.DB, c.env.MEDIA);
      logExportWarnings('export', result.warnings);
      // 日付は UTC。core は配信先のタイムゾーンを知らないうえ、書庫の名前は
      // 読み手に見せる日付ではない。
      const name = `lily-export-${new Date().toISOString().slice(0, 10)}.zip`;
      return new Response(bytesBody(result.archive), {
        headers: {
          'Content-Type': 'application/zip',
          'Content-Disposition': `attachment; filename="${name}"`,
          'Cache-Control': 'no-store',
          'X-Lily-Posts': String(result.posts),
          'X-Lily-Media': String(result.media),
          'X-Lily-Warnings': String(result.warnings.length),
        },
      });
    })

    /**
     * portable import。**記事ごとに独立して取り込み、失敗した記事だけを返す。**
     *
     * 1 本の frontmatter が壊れていたせいで書庫まるごと入らない、という形には
     * しない (移行の途中で必ず起きるうえ、どれが悪いのか分からなくなる)。
     * 既にある `public_id` は上書きせず、その記事を失敗として返す。
     */
    .post('/import', async (c) => {
      // **body を読む前に大きさを見る。** formData() は全部をメモリに載せるので、
      // 読んでから測るのでは MAX_IMPORT_BYTES が memory を守れない
      // (Content-Length が無いときは測れないので、下の file.size でもう一度見る)。
      const declared = Number(c.req.header('Content-Length') ?? '0');
      if (declared > MAX_IMPORT_BYTES) return c.json(...apiError('file-too-large'));

      let file: File | string | null;
      try {
        file = (await c.req.formData()).get('file');
      } catch {
        // multipart として読めない body。入力の誤りなので 400 にする
        // (投げっぱなしにすると 500 になり、他の入力の誤りと扱いが揃わない)。
        return c.json(...apiError('invalid-form'));
      }
      if (!(file instanceof File)) return c.json(...apiError('file-required'));
      if (file.size === 0) return c.json(...apiError('file-empty'));
      if (file.size > MAX_IMPORT_BYTES) return c.json(...apiError('file-too-large'));

      try {
        const archive = new Uint8Array(await file.arrayBuffer());
        return c.json(await importArchive(c.env.DB, paths, c.env.MEDIA, archive));
      } catch (error) {
        // 壊れた書庫は入力の誤りなので 400。それ以外は投げ直す。
        if (error instanceof ZipError) return c.json(...apiError('invalid-archive', error.message));
        throw error;
      }
    })

    /**
     * 再描画がどれだけ残っているか。**同じパスで `GET` が「あと何件か」、
     * `POST` が「進める」。**
     *
     * lily を更新して出力が変わっても、配信側は保存済みの `body_html` を
     * そのまま返すので、**古い HTML のままでも画面には何も出ない。** 管理画面が
     * これを見て、`remaining > 0` のときだけ知らせる。
     *
     * **配信側での lazy 再描画は採らない。**「`GET` は D1 に書かない」を壊す
     * （一覧から詳細を開くだけで書き込みが起きる）。cron での自動再描画も採らない
     * ―― 静かに全記事を書き換えるうえ、cron を張っていない deployment には効かない。
     */
    .get('/rerender', async (c) => {
      const remaining = await countPostsNeedingRender(c.env.DB, RENDERER_VERSION);
      return c.json({ rendererVersion: RENDERER_VERSION, remaining });
    })

    /**
     * `body_html` は派生データなので、renderer を更新したら作り直す。
     * 下書きも含めて、**今の renderer で描かれていない記事だけ**が対象。
     *
     * 1 回で処理する数に上限を置き、残りを返す。Workers の subrequest には
     * 上限があるので、黙って打ち切ると「成功したのに古いままの記事」が残る。
     * 呼び出し側は `remaining` が 0 になるまで呼ぶ。
     */
    .post('/rerender', async (c) => {
      const db = c.env.DB;
      const posts = await listPostsNeedingRender(db, RENDERER_VERSION, RERENDER_BATCH);
      const warnings: { publicId: string; unresolvedMedia: readonly string[] }[] = [];

      for (const post of posts) {
        const unresolved = await renderAndStore(db, post);
        if (unresolved.length > 0) {
          warnings.push({ publicId: post.public_id, unresolvedMedia: unresolved });
        }
      }
      const remaining = await countPostsNeedingRender(db, RENDERER_VERSION);
      return c.json({ rendered: posts.length, remaining, warnings });
    });
}

export type LilyApi = ReturnType<typeof createApi>;

/**
 * 本文が変わる操作のあとの応答。**ここでだけ描き直す。**
 *
 * 配信側は保存済みの `body_html` をそのまま出すので、書き換えたら作り直す。
 * 逆に読み取りやパスの操作では呼ばない (GET が書き込む副作用を作らない)。
 */
async function save(db: D1Database, urls: Urls, post: PostRow) {
  const unresolvedMedia = await renderAndStore(db, post);
  const fresh = (await getPostByPublicId(db, post.public_id)) ?? post;
  return { post: await toPostView(db, urls, fresh), unresolvedMedia };
}

/**
 * リンクカードのサムネ。**記事が OGP を選んでいればその絵、無ければ共通の 1 枚。**
 *
 * 記事ページの `og:image` と同じ絵を出すためで、選び方（`is_ogp`）も同じ 1 本を
 * 通る。**大きすぎる添付は共通へ落とす。** 上限を超えたぶんは `announce()` が
 * 載せずに投げるので、そのままだと選んだ絵でも共通でもない「絵の無いカード」に
 * なる。`bytes` は DB にあるので、R2 から取りに行く前に分かる。
 */
async function cardThumb(
  config: PageConfig,
  env: LilyBindings,
  requestUrl: string,
  ogp: MediaRow | null,
): Promise<BlueskyThumb | null> {
  if (ogp !== null && ogp.bytes <= MAX_THUMB_BYTES) {
    try {
      const object = await env.MEDIA.get(ogp.r2_key);
      // 実体が消えていれば共通へ落ちる（告知そのものは止めない）。
      if (object) return { bytes: await object.arrayBuffer(), mime: ogp.mime };
    } catch (error) {
      // **R2 の失敗で告知を落とさない。** ここは絵を選ぶだけの処理なので、
      // 読めなければ共通の 1 枚に落ちればよい（`ogpThumb` と同じ扱い）。
      console.warn(`bluesky: OGP の添付を読めないので共通の絵にする (${ogp.r2_key}): ${error}`);
    }
  }
  return await ogpThumb(config, env, requestUrl);
}

/**
 * サイト共通の OGP。**取れなくても告知は止めない**（絵の無いカードが出る）。
 *
 * 読むのは配信しているのと同じ実体（`ASSETS` バインディング）。**mount は付けない**
 * ―― 静的アセットは root 直下に置かれるので、渡すのは `/ogp.png` の形
 * （`routes/feeds.ts` が配信するときと同じ）。`site.ogImage.url` を素で fetch
 * できない理由は `core/config.ts` の `ogImageAsset`。
 */
async function ogpThumb(
  config: PageConfig,
  env: LilyBindings,
  requestUrl: string,
): Promise<BlueskyThumb | null> {
  if (!config.ogImageAsset) return null;
  try {
    const response = await env.ASSETS.fetch(new URL(`/${config.ogImageAsset}`, requestUrl));
    if (!response.ok) return null;
    const bytes = await response.arrayBuffer();
    if (bytes.byteLength === 0) return null;
    // 大きさの上限は `announce()` が見る（超えたら載せずに投げる）。
    const mime = response.headers.get('Content-Type')?.split(';')[0]?.trim();
    return { bytes, mime: mime === undefined || mime === '' ? 'image/png' : mime };
  } catch {
    // アセットが読めないだけで告知を諦めない。
    return null;
  }
}

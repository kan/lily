/**
 * 添付の配信。`<mount>/media/<public_id>/<filename>`。
 *
 * 原本は R2 にあり、この route は D1 の `media` 行を引いて R2 のキーに読み替える。
 * **Cloudflare Images を使うかどうかに関わらず URL は同じ**で、最適化はこの
 * ハンドラの内側で振り分ける (今はまだ原本をそのまま返すだけ)。
 */
import { Hono } from 'hono';
import type { LilyBindings, PageConfig } from '../config.ts';
import { getMediaByPublicId } from '../db/media.ts';
import { isNegotiable, optimize, pickFormat } from '../media/optimize.ts';
import { createPaths } from '../paths.ts';
import { ROUTE } from './fixed.ts';

type Env = { Bindings: LilyBindings };

/**
 * media の URL は **不変**。ファイルを差し替えるときは行ごと作り直すので
 * `public_id` が変わり、URL も変わる。だから長期キャッシュしてよい。
 */
const IMMUTABLE = 'public, max-age=31536000, immutable';

/**
 * 相手によって中身が変わるときのキャッシュ。**共有キャッシュには置かせない。**
 *
 * Cloudflare のエッジは `Accept-Encoding` 以外の `Vary` を見ないので、
 * `public` のままだと最初に入った表現が URL ごと居座る。AVIF が先に入れば、
 * AVIF を読めない相手にもそれが 1 年配られることになる。
 *
 * 共有キャッシュに入るのは常に原本 (誰でも読める) だけにして、変換した方は
 * ブラウザにだけ持たせる。
 */
const NEGOTIATED = 'private, max-age=86400';

/** 画像が無いときに HTML の 404 ページを返しても仕方がないので、素で返す。 */
const missing = (): Response => new Response('Not Found', { status: 404 });

export function mediaRoutes(config: PageConfig): Hono<Env> {
  const app = new Hono<Env>();
  const { urls } = createPaths(config);
  const mount = urls.mountPath;

  app.get(`${mount}/${ROUTE.media}/:publicId/:filename`, async (c) => {
    const media = await getMediaByPublicId(c.env.DB, c.req.param('publicId'));
    // ファイル名まで一致を要求する。URL に出ている名前と中身が食い違うと、
    // 保存したときのファイル名が変わってしまう。
    if (!media || media.filename !== c.req.param('filename')) return missing();

    const object = await c.env.MEDIA.get(media.r2_key);
    if (!object) return missing();

    /**
     * 共通のヘッダ。
     *
     * Content-Length は付けない。D1 の `bytes` と R2 の実体がずれたときに嘘を
     * 返すことになるし、固定長のストリームなのでランタイムが正しく付ける。
     */
    const headers = (contentType: string, negotiated = false): Record<string, string> => ({
      'Content-Type': contentType,
      'Cache-Control': negotiated ? NEGOTIATED : IMMUTABLE,
      // **形式ごとに別の ETag にする。** 同じ URL から違うバイト列を返すのに
      // 検証子が同じだと、キャッシュが「変わっていない」と判断して、頼んで
      // いない形式を返しうる。
      ETag: negotiated ? etagFor(object.httpEtag, contentType) : object.httpEtag,
      // 記事に貼る SVG も配るので、**直接開かれたとき**にスクリプトが走らない
      // ようにする (<img> での埋め込みには影響しない)。同一オリジンで
      // 自分が上げたものを配る以上、置いておくのが安い。
      'Content-Security-Policy': 'sandbox',
      'X-Content-Type-Options': 'nosniff',
      // 同じ URL が相手によって違う形式で返るので、そのことを明示する。
      // **変換を有効にしている経路では、原本を返すときも付ける。** 付けたり
      // 付けなかったりすると、内容交渉していない応答として共有キャッシュに
      // 収まってしまう。
      ...(negotiating ? { Vary: 'Accept' } : {}),
    });

    const images = c.env.IMAGES;
    // この URL が内容交渉の対象か。SVG のように変換しないものは対象外。
    const negotiating =
      config.media?.images === true && images !== undefined && isNegotiable(media.mime);
    const format = negotiating ? pickFormat(c.req.header('Accept') ?? null, media.mime) : null;

    if (format !== null && images) {
      const converted = await optimize(images, object.body, format);
      // 変換できなければ原本。**ストリームは使い切っているので取り直す。**
      if (converted) return new Response(converted.body, { headers: headers(format, true) });

      const original = await c.env.MEDIA.get(media.r2_key);
      if (!original) return missing();
      return new Response(original.body, { headers: headers(media.mime) });
    }

    return new Response(object.body, { headers: headers(media.mime) });
  });

  return app;
}

/** 形式ごとに検証子を分ける。R2 の etag はどの形式でも同じなので、後ろに足す。 */
function etagFor(base: string, contentType: string): string {
  const suffix = contentType.replace('image/', '');
  return base.endsWith('"') ? `${base.slice(0, -1)}-${suffix}"` : `"${base}-${suffix}"`;
}

/**
 * Bluesky（AT Protocol）への告知。**押したときだけ投げる。**
 *
 * 公開と告知を分けてあるのは、公開が何度でもやり直せる操作だから
 * （下書きに戻して直してまた公開する、公開日時を入れ直す）。そこに投稿を
 * 混ぜると、やり直すたびにタイムラインへ同じ記事が流れる。二重投稿の抑止は
 * `posts.bluesky_uri`（告知済みなら AT-URI が入る）が持つ。
 *
 * **SDK は入れていない。** 使うのは XRPC の 3 本
 * （`createSession` / `uploadBlob` / `createRecord`）だけで、いずれも
 * 素の JSON を POST するだけ。`@atproto/api` はブラウザ向けのバンドルも含めて
 * 大きく、Worker のサイズ（今の総量の大半は Shiki の言語定義）に見合わない。
 *
 * **App Password を使う。** 本物のパスワードでもログインできてしまうが、
 * 失効させられないものを Worker の secret に置かない。
 */
import { nowIso } from './ids.ts';

/** PDS の入口。自前の PDS に置いた人は設定で差し替える。 */
const DEFAULT_SERVICE = 'https://bsky.social';

/** 1 本あたりの待ち時間。管理画面が押しっぱなしで固まらない程度。 */
const TIMEOUT_MS = 10_000;

/**
 * 本文の長さ。**バイトではなく書記素で数える。**
 * lexicon は `maxLength: 3000`（バイト）と `maxGraphemes: 300` の両方を持つが、
 * 日本語では必ず後者に先に当たる。
 */
const MAX_GRAPHEMES = 300;

/** サムネに使える大きさ。これを超える絵は**載せずに投稿する**（告知は止めない）。 */
export const MAX_THUMB_BYTES = 1_000_000;

/** 上流のエラー本文をログと画面に載せる長さ。 */
const MAX_ERROR_CHARS = 200;

export type BlueskyCredentials = {
  /** ハンドル（`kan.fushihara.net`）か DID。 */
  readonly identifier: string;
  /** App Password。**アカウントのパスワードを入れない。** */
  readonly appPassword: string;
  /** PDS の入口。既定は `https://bsky.social`。 */
  readonly service?: string;
};

/**
 * リンクカードのサムネ。載せられないときは省く。
 *
 * `Uint8Array` ではなく `ArrayBuffer` で持つのは、そのまま body に渡せるから
 * （`Uint8Array<ArrayBufferLike>` は `BodyInit` に入らず、キャストが要る）。
 */
export type BlueskyThumb = { readonly bytes: ArrayBuffer; readonly mime: string };

/**
 * 告知する記事。**リンクカードは自分で組む。**
 *
 * 公式クライアントは貼られた URL を取りに行って OGP からカードを作るが、
 * API から投稿したものにその処理は走らない。ここで組まないとカードが出ない。
 */
export type BlueskyCard = {
  /** 記事の絶対 URL。本文にも載せ、カードの飛び先にもなる。 */
  readonly url: string;
  readonly title: string;
  readonly description: string;
  readonly thumb?: BlueskyThumb | null;
  /**
   * 本文の言語（BCP 47）。Bluesky の言語での絞り込みに効く。
   *
   * **core は既定値を持たない。** `'ja'` をここに書くと、別の言語の deployment が
   * 黙って日本語として流れる（サイトの言語は `SiteConfig.lang`）。
   */
  readonly langs?: readonly string[];
};

export type BlueskyPost = {
  /** `at://<did>/app.bsky.feed.post/<rkey>`。これが二重投稿の抑止に入る。 */
  readonly uri: string;
  readonly cid: string;
};

/**
 * どこで失敗したか。**画面に出す**ので、資格情報の誤り（`session`）と投稿の
 * 失敗（`post`）を区別できる。
 *
 * `thumb` は `uploadThumb()` の中で握り潰すので**外へは出ない**（ログにだけ残り、
 * 告知そのものは絵の無いカードで通る）。
 */
export type BlueskyStep = 'session' | 'thumb' | 'post';

export class BlueskyError extends Error {
  readonly step: BlueskyStep;

  constructor(step: BlueskyStep, message: string) {
    super(message);
    this.name = 'BlueskyError';
    this.step = step;
  }
}

/**
 * 告知を 1 本投げる。**成功したら AT-URI を返す。**
 *
 * サムネの upload だけは失敗しても投げ直さない（カードの絵が出ないだけで、
 * 告知そのものは成立する）。session と createRecord の失敗は `BlueskyError`。
 */
export async function announce(
  credentials: BlueskyCredentials,
  card: BlueskyCard,
): Promise<BlueskyPost> {
  const service = (credentials.service ?? DEFAULT_SERVICE).replace(/\/+$/, '');

  const session = await xrpc<{ accessJwt: string; did: string }>(
    service,
    'com.atproto.server.createSession',
    'session',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        identifier: credentials.identifier,
        password: credentials.appPassword,
      }),
    },
  );

  const thumb = await uploadThumb(service, session.accessJwt, card.thumb ?? null);
  const { text, facets } = composePost(card.title, card.url);

  const created = await xrpc<{ uri: string; cid: string }>(
    service,
    'com.atproto.repo.createRecord',
    'post',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.accessJwt}`,
      },
      body: JSON.stringify({
        repo: session.did,
        collection: 'app.bsky.feed.post',
        record: {
          $type: 'app.bsky.feed.post',
          text,
          // **投稿の時刻。** 記事の公開日時ではない（昔の記事を今告知することがある）。
          createdAt: nowIso(),
          ...(card.langs === undefined ? {} : { langs: card.langs }),
          facets,
          embed: {
            $type: 'app.bsky.embed.external',
            external: {
              uri: card.url,
              title: card.title,
              description: card.description,
              ...(thumb === null ? {} : { thumb }),
            },
          },
        },
      }),
    },
  );

  return { uri: created.uri, cid: created.cid };
}

/**
 * 本文と facet。**URL をリンクにするのは自分の仕事。**
 *
 * Bluesky の本文はただの文字列で、クライアントは facet が指すバイト範囲だけを
 * リンクとして描く。付けないと URL が素のテキストとして出る。
 *
 * **範囲は UTF-8 のバイト位置**なので、日本語のタイトルが入ると文字数とずれる。
 */
export function composePost(
  title: string,
  url: string,
): { text: string; facets: readonly Facet[] } {
  const urlLength = graphemes(url);
  // タイトル + 改行 + URL。入らないぶんはタイトルを削る（URL は必ず残す）。
  const room = MAX_GRAPHEMES - urlLength - 1;
  const head = room <= 0 ? '' : `${truncate(title, room)}\n`;
  const text = `${head}${url}`;

  const byteStart = utf8Length(head);
  return {
    text,
    facets: [
      {
        index: { byteStart, byteEnd: byteStart + utf8Length(url) },
        features: [{ $type: 'app.bsky.richtext.facet#link', uri: url }],
      },
    ],
  };
}

export type Facet = {
  readonly index: { readonly byteStart: number; readonly byteEnd: number };
  readonly features: readonly { readonly $type: string; readonly uri: string }[];
};

/**
 * AT-URI → bsky.app で開ける URL。**形を知っているのはここだけ。**
 *
 * 管理画面には完成した URL を渡す（`at://` を組み替える規則を画面側に持たせない）。
 * DID のまま出すのは、ハンドルが変わっても切れないため。
 */
export function blueskyPostUrl(uri: string): string | null {
  const match = /^at:\/\/([^/]+)\/app\.bsky\.feed\.post\/([^/]+)$/.exec(uri);
  if (match === null) return null;
  return `https://bsky.app/profile/${match[1]}/post/${match[2]}`;
}

/**
 * サムネを上げる。**失敗しても null を返す。**
 *
 * 絵が無いカードは地味なだけだが、ここで投げ直すと「押しても告知できない」に
 * なる。大きすぎるものも同じ扱い（PDS の上限に当たって 400 で返るのを待たない）。
 */
async function uploadThumb(
  service: string,
  jwt: string,
  thumb: BlueskyThumb | null,
): Promise<unknown> {
  if (thumb === null) return null;
  if (thumb.bytes.byteLength > MAX_THUMB_BYTES) {
    console.warn(`bluesky: サムネが大きすぎるので載せない (${thumb.bytes.byteLength} bytes)`);
    return null;
  }

  try {
    const uploaded = await xrpc<{ blob: unknown }>(service, 'com.atproto.repo.uploadBlob', 'thumb', {
      method: 'POST',
      headers: { 'Content-Type': thumb.mime, Authorization: `Bearer ${jwt}` },
      body: thumb.bytes,
    });
    return uploaded.blob;
  } catch (error) {
    console.warn(`bluesky: サムネを上げられなかったので載せない (${describe(error)})`);
    return null;
  }
}

/**
 * XRPC を 1 本叩く。**失敗の理由は握り潰さずに載せる。**
 *
 * 押した人は管理者ひとりなので、「App Password が違う」のか「PDS が落ちている」
 * のかが画面から分かる方がよい（`link-preview.ts` が理由を返さないのは、あちらが
 * 外から来た URL を扱う口だから）。
 */
async function xrpc<T>(
  service: string,
  nsid: string,
  step: BlueskyStep,
  init: RequestInit,
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${service}/xrpc/${nsid}`, {
      ...init,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    throw new BlueskyError(step, `${nsid} に届かなかった: ${describe(error)}`);
  }

  if (!response.ok) {
    throw new BlueskyError(step, `${nsid} が ${response.status}: ${await errorText(response)}`);
  }
  return (await response.json()) as T;
}

/** XRPC のエラーは `{ error, message }` の JSON。読めなければ生のまま切って出す。 */
async function errorText(response: Response): Promise<string> {
  let body: string;
  try {
    body = await response.text();
  } catch {
    return '(本文を読めなかった)';
  }
  try {
    const parsed = JSON.parse(body) as { error?: string; message?: string };
    if (parsed.error) return clip(parsed.message ? `${parsed.error}: ${parsed.message}` : parsed.error);
  } catch {
    // JSON でないならそのまま出す。
  }
  return clip(body);
}

function clip(text: string): string {
  const trimmed = text.trim();
  return trimmed.length > MAX_ERROR_CHARS ? `${trimmed.slice(0, MAX_ERROR_CHARS)}…` : trimmed;
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * 書記素の数。**`length` で数えない。**
 *
 * 絵文字や結合文字を含むタイトルだと、UTF-16 のコード単位で数えた長さは
 * Bluesky が見るものより大きく出る（そのぶん余計に削ることになる）。
 */
const segmenter = new Intl.Segmenter();

function graphemes(text: string): number {
  let count = 0;
  for (const _ of segmenter.segment(text)) count++;
  return count;
}

/** 書記素で数えて切り、切ったことが分かるように `…` を足す。 */
function truncate(text: string, limit: number): string {
  if (graphemes(text) <= limit) return text;
  let taken = '';
  let count = 0;
  for (const { segment } of segmenter.segment(text)) {
    if (count >= limit - 1) break;
    taken += segment;
    count++;
  }
  return `${taken}…`;
}

const encoder = new TextEncoder();

function utf8Length(text: string): number {
  return encoder.encode(text).byteLength;
}

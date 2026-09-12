/**
 * 貼り付けた URL から、そのページの素性（題・説明・OG 画像・サイト名）を取る。
 *
 * ブラウザからは CORS で読めないので Worker が代わりに取りに行く。**外から来た
 * URL をそのまま fetch する口**なので、次の 5 つで狭めてある。
 *
 *   1. http / https だけ (file: や data: を弾く)
 *   2. 宛先の検査 (`isAllowed`)。IP リテラルとローカル向けの名前を弾く
 *   3. **リダイレクトは自分で追い、飛び先も毎回検査する。**
 *      `redirect: 'follow'` に任せると、公開 URL から内側へ飛ばされたときに
 *      素通りする (最初の 1 回しか見ないため)
 *   4. 時間の上限
 *   5. 読むのは先頭だけ。`og:*` は `<head>` にあるので全部読む必要がない
 *
 * **この関門は 1 つだけにする。** リンクカードが OG 画像を取りに行くときも
 * （`link-card.ts`）、GitHub の API を叩くときも（`link-github.ts`）
 * `fetchExternal()` を通す。取りに行く口が 2 つになると、片方だけ緩い日ができる。
 */

const TIMEOUT_MS = 5000;

/** `<head>` を探すのに読む長さ。ここに無ければ諦める。 */
const MAX_BYTES = 64 * 1024;

/** 追うリダイレクトの数。 */
const MAX_REDIRECTS = 3;

/** IPv4 / IPv6 のリテラル。数字で直接指定されたものは通さない。 */
const IP_LITERAL = /^(\d{1,3}(\.\d{1,3}){3}|\[[0-9a-f:]+\])$/i;

/**
 * ローカルや内部向けの名前。IP リテラルを弾くだけでは、`localhost` や
 * `*.internal` のような名前で同じところへ行ける。
 */
const LOCAL_NAME = /^(localhost|.*\.localhost|.*\.local|.*\.internal|.*\.home\.arpa)$/i;

export type LinkTitle = { readonly title: string | null };

export type LinkPreview = {
  readonly title: string | null;
  readonly description: string | null;
  /** OG 画像。**取れたときは絶対 URL**（リダイレクト後の URL を基準に解決する）。 */
  readonly image: string | null;
  readonly siteName: string | null;
};

/** 取りに行けた応答と、**リダイレクトを追い終えた後の URL**。 */
export type Fetched = { readonly response: Response; readonly url: URL };

/**
 * 名乗る User-Agent。**空のまま出すと断られる先がある**（Wikimedia は UA の無い
 * 要求に 403 を返す。実際に踏んだ）。
 *
 * **core にドメインを焼かない。** `lang` と同じ理由で、名前と連絡先は呼び出し側の
 * `SiteConfig` から来る。生成器の名前だけは core のもの（`lily-media` スキームと同じ）。
 */
export function linkUserAgent(site: { readonly name: string; readonly url: string }): string {
  return `lily-link-preview (${site.name}; +${site.url})`;
}

function isAllowed(url: URL): boolean {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
  if (IP_LITERAL.test(url.hostname)) return false;
  if (LOCAL_NAME.test(url.hostname)) return false;
  return true;
}

/**
 * 外から来た URL を、上の 4 つ（宛先・リダイレクト・時間・スキーム）を守って取る。
 *
 * 取れなければ null。理由は返さない（呼び出し側は「取れなかった」としてしか
 * 扱わない）。読む量の上限は中身の形で変わるので、ここでは掛けない。
 */
export async function fetchExternal(
  rawUrl: string | URL,
  accept: string,
  userAgent: string,
): Promise<Fetched | null> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (!isAllowed(url)) return null;

    let response: Response;
    try {
      response = await fetch(url, {
        redirect: 'manual',
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: { Accept: accept, 'User-Agent': userAgent },
      });
    } catch {
      return null;
    }

    if (response.status < 300 || response.status >= 400) {
      if (response.ok) return { response, url };
      // 読まずに捨てるときは明示的に畳む（開いたままのストリームを残さない）。
      // 未認証の api.github.com は 60 回/時なので、403 は日常的にここへ来る。
      await response.body?.cancel().catch(() => {});
      return null;
    }

    const location = response.headers.get('Location');
    if (location === null) return null;
    try {
      url = new URL(location, url);
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * 応答の中身を上限まで読む。**超えたら諦めて null。**
 *
 * `arrayBuffer()` / `json()` に任せると、相手が申告と違う大きさを流してきたときに、
 * 全部受け取ってから捨てることになる。読む量の上限は中身の形で変わる（絵と JSON で
 * 違う）ので `fetchExternal()` には持たせず、呼ぶ側が渡す。
 */
export async function readCapped(response: Response, max: number): Promise<Uint8Array | null> {
  const reader = response.body?.getReader();
  if (!reader) return null;

  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > max) return null;
      chunks.push(value);
    }
  } catch {
    return null;
  } finally {
    await reader.cancel().catch(() => {});
  }

  const data = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) {
    data.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return data;
}

const HTML_ACCEPT = 'text/html,application/xhtml+xml';

export async function fetchLinkPreview(rawUrl: string, userAgent: string): Promise<LinkPreview> {
  const none: LinkPreview = { title: null, description: null, image: null, siteName: null };

  const fetched = await fetchExternal(rawUrl, HTML_ACCEPT, userAgent);
  if (fetched === null) return none;
  if (!(fetched.response.headers.get('Content-Type') ?? '').includes('html')) return none;

  const head = await readHead(fetched.response);
  const meta = metaContents(head);

  // **`first` を通す。** `content=""` を書くページがあり、`??` だと空文字が勝って
  // 後ろの候補に落ちない（そのうえ空の URL は相手のページ自身に解決される）。
  const image = first(meta.get('og:image'), meta.get('twitter:image'));
  return {
    title: first(meta.get('og:title'), extractTitle(head)),
    description: first(meta.get('og:description'), meta.get('description')),
    // **相対で書いてあることがある。** 基準はリダイレクトを追い終えた後の URL。
    image: httpUrl(image, fetched.url)?.href ?? null,
    siteName: first(meta.get('og:site_name')),
  };
}

/** 題だけを見る呼び出し側（貼り付けの既定）のための薄い包み。 */
export async function fetchLinkTitle(rawUrl: string, userAgent: string): Promise<LinkTitle> {
  return { title: (await fetchLinkPreview(rawUrl, userAgent)).title };
}

/** 最初に見つかった空でない値。無ければ null。 */
function first(...values: readonly (string | null | undefined)[]): string | null {
  for (const value of values) {
    if (value !== null && value !== undefined && value !== '') return value;
  }
  return null;
}

/**
 * 文字列を URL にする。**http / https 以外と、読めない形は null。**
 *
 * 相手のページや API が書いた文字列を URL として扱う場所はここと `link-github.ts`
 * にあり、規則が割れると片方だけ `javascript:` を通す日ができる。
 */
export function httpUrl(value: string | null | undefined, base?: URL): URL | null {
  if (value === null || value === undefined || value === '') return null;
  try {
    const url = new URL(value, base);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url : null;
  } catch {
    return null;
  }
}

/**
 * 先頭だけ読む。`</head>` が見つかったらそこで止める。
 *
 * **`</title>` では止めない。** `og:*` は `<title>` より後ろに書かれることが多く、
 * そこで打ち切ると題しか取れない。
 */
async function readHead(response: Response): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return '';

  const decoder = new TextDecoder();
  let text = '';
  // **読んだバイト数で数える。** 文字数で数えると、1 文字 3 バイトの
  // ページで上限の 3 倍まで読むことになる。
  let bytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      text += decoder.decode(value, { stream: true });
      if (text.includes('</head>') || bytes >= MAX_BYTES) break;
    }
  } catch {
    // **途中で切れても、そこまでを使う。** ヘッダだけ返して黙る相手に当たると
    // 5 秒の打ち切りがここで例外になる。投げると呼び出し側の「取れなかった」
    // 経路を飛び越えて 500 になる (打ち切りは想定内の失敗)。
  } finally {
    await reader.cancel().catch(() => {});
  }
  // **`</head>` の先は捨てる。** 1 回の chunk に本文まで入っていることがあるので、
  // 読むのをやめただけでは「head だけを見る」にならない。
  const end = text.indexOf('</head>');
  return end === -1 ? text : text.slice(0, end);
}

const META_TAG = /<meta\s[^>]*>/gi;
const ATTRIBUTE = /([a-z][a-z0-9:_-]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/gi;

/**
 * `<meta>` の `property` / `name` → `content`。**先に書いてある方を採る。**
 *
 * `og:image` を 2 つ書くページがある（1 枚目が本命、2 枚目以降は別サイズ）ので、
 * 後から来たもので上書きしない。
 */
function metaContents(html: string): Map<string, string> {
  const found = new Map<string, string>();

  for (const tagMatch of html.matchAll(META_TAG)) {
    const attributes = new Map<string, string>();
    for (const [, name, quoted, single, bare] of tagMatch[0].matchAll(ATTRIBUTE)) {
      if (name === undefined) continue;
      attributes.set(name.toLowerCase(), quoted ?? single ?? bare ?? '');
    }

    const key = attributes.get('property') ?? attributes.get('name');
    const content = attributes.get('content');
    if (key === undefined || content === undefined) continue;

    const normalized = key.toLowerCase();
    if (!found.has(normalized)) found.set(normalized, clean(content));
  }
  return found;
}

function extractTitle(html: string): string | null {
  const matched = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  if (!matched?.[1]) return null;
  const title = clean(matched[1]);
  return title === '' ? null : title;
}

function clean(text: string): string {
  return decodeEntities(text).replace(/\s+/g, ' ').trim();
}

/**
 * 符号位置として書けない値は**そのまま残す**。`String.fromCodePoint` は範囲外で
 * `RangeError` を投げるので、相手のページの `&#x110000;` 1 つで 500 になる。
 */
function codePoint(value: number): string | null {
  if (!Number.isInteger(value) || value < 0 || value > 0x10ffff) return null;
  // 単独のサロゲートは文字列に入れると壊れた JSON になる
  if (value >= 0xd800 && value <= 0xdfff) return null;
  return String.fromCodePoint(value);
}

/** タイトルや説明に出てくる範囲の実体参照だけ戻す。 */
function decodeEntities(text: string): string {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (whole, hex: string) => codePoint(parseInt(hex, 16)) ?? whole)
    .replace(/&#(\d+);/g, (whole, dec: string) => codePoint(Number(dec)) ?? whole)
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&nbsp;', ' ')
    .replaceAll('&amp;', '&');
}

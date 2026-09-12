import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchLinkPreview, fetchLinkTitle, linkUserAgent } from '../../src/core/link-preview.ts';

/** 名乗る名前は呼び出し側が決める。テストからは固定のものを渡す。 */
const UA = linkUserAgent({ name: 'テストのブログ', url: 'https://blog.example.com' });

const preview = (url: string) => fetchLinkPreview(url, UA);
const title = (url: string) => fetchLinkTitle(url, UA);

/**
 * **外から来た URL をそのまま fetch する口**なので、通る側だけでなく
 * 「取りに行かない」側を揃えて確かめる。
 */
function html(body: string, init: ResponseInit = {}): Response {
  return new Response(body, {
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
    ...init,
  });
}

let requested: string[] = [];

beforeEach(() => {
  requested = [];
  vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
    const url = String(input instanceof Request ? input.url : input);
    requested.push(url);
    return html('<html><head><title>ページの題</title></head><body>x</body></html>');
  });
});

afterEach(() => vi.unstubAllGlobals());

describe('取りに行くもの', () => {
  it('title を返す', async () => {
    expect(await title('https://example.com/a')).toEqual({ title: 'ページの題' });
  });

  it('User-Agent を名乗る', async () => {
    // **空のまま出すと断られる先がある**（Wikimedia は UA の無い要求に 403。実際に踏んだ）。
    // 連絡先が要るので、名前と URL は呼び出し側の SiteConfig から来る。
    let sent: string | null = null;
    vi.stubGlobal('fetch', async (_input: RequestInfo | URL, init?: RequestInit) => {
      sent = new Headers(init?.headers).get('User-Agent');
      return html('<title>題</title>');
    });

    await title('https://example.com/a');
    expect(sent).toBe(UA);
    expect(sent).toContain('https://blog.example.com');
  });

  it('実体参照を戻し、空白を畳む', async () => {
    vi.stubGlobal('fetch', async () =>
      html('<title>\n  A &amp; B &#x2014; C\n</title>'),
    );
    expect(await title('https://example.com/')).toEqual({ title: 'A & B — C' });
  });
});

describe('取りに行かないもの', () => {
  async function skipped(url: string): Promise<void> {
    expect(await title(url), url).toEqual({ title: null });
    expect(requested, url).toEqual([]);
  }

  it('http / https 以外', async () => {
    await skipped('file:///etc/passwd');
    await skipped('data:text/html,<title>x</title>');
    await skipped('ftp://example.com/');
  });

  it('IP リテラル宛て (内側を覗きに行かせない)', async () => {
    await skipped('http://127.0.0.1/');
    await skipped('http://169.254.169.254/latest/meta-data/');
    await skipped('http://[::1]/');
  });

  it('ローカル向けの名前', async () => {
    // IP リテラルを弾くだけでは、名前で同じところへ行ける。
    await skipped('http://localhost:8787/blog/api/posts');
    await skipped('http://foo.localhost/');
    await skipped('http://printer.local/');
    await skipped('http://db.internal/');
  });

  it('URL として読めないもの', async () => {
    await skipped('とりあえずメモ');
  });
});

describe('リダイレクト', () => {
  /** `from` に来たら `to` へ飛ばし、それ以外は普通の HTML を返す。 */
  function redirectingFetch(from: string, to: string): void {
    vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
      const url = String(input instanceof Request ? input.url : input);
      requested.push(url);
      if (url === from) {
        return new Response(null, { status: 302, headers: { Location: to } });
      }
      return html('<title>飛んだ先の題</title>');
    });
  }

  it('公開 URL から内側へ飛ばされても取りに行かない', async () => {
    // `redirect: 'follow'` に任せると、最初の 1 回しか検査されないので素通りする。
    redirectingFetch('https://example.com/go', 'http://169.254.169.254/latest/meta-data/');
    expect(await title('https://example.com/go')).toEqual({ title: null });
    // 1 ホップ目だけ叩いて、飛び先は叩いていない
    expect(requested).toEqual(['https://example.com/go']);
  });

  it('外向きのリダイレクトなら追う', async () => {
    redirectingFetch('https://example.com/go', 'https://example.org/dest');
    expect(await title('https://example.com/go')).toEqual({ title: '飛んだ先の題' });
    expect(requested).toEqual(['https://example.com/go', 'https://example.org/dest']);
  });

  it('相対の Location も元の URL を起点に解決する', async () => {
    redirectingFetch('https://example.com/go', '/dest');
    expect(await title('https://example.com/go')).toEqual({ title: '飛んだ先の題' });
    expect(requested[1]).toBe('https://example.com/dest');
  });

  it('回り続けるものは打ち切る', async () => {
    vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
      requested.push(String(input));
      return new Response(null, { status: 302, headers: { Location: 'https://example.com/loop' } });
    });
    expect(await title('https://example.com/loop')).toEqual({ title: null });
    expect(requested.length).toBeLessThanOrEqual(4);
  });

  it('Location が無ければ諦める', async () => {
    vi.stubGlobal('fetch', async () => new Response(null, { status: 302 }));
    expect(await title('https://example.com/')).toEqual({ title: null });
  });
});

describe('取れなかったとき', () => {
  it('HTML でなければ、中に <title> があっても使わない', async () => {
    // 任意のバイト列を HTML として読まないための線。RSS のように `<title>` を
    // 持つ形式もあるので、「見つかったか」ではなく Content-Type で決める。
    vi.stubGlobal('fetch', async () =>
      new Response('<rss><channel><title>フィードの題</title></channel></rss>', {
        headers: { 'Content-Type': 'application/xml' },
      }),
    );
    expect(await title('https://example.com/rss.xml')).toEqual({ title: null });
  });

  it('エラーでも落ちない', async () => {
    vi.stubGlobal('fetch', async () => { throw new Error('つながらない'); });
    expect(await title('https://example.com/')).toEqual({ title: null });

    vi.stubGlobal('fetch', async () => html('x', { status: 500 }));
    expect(await title('https://example.com/')).toEqual({ title: null });
  });

  it('title が無ければ null', async () => {
    vi.stubGlobal('fetch', async () => html('<html><body>題が無い</body></html>'));
    expect(await title('https://example.com/')).toEqual({ title: null });
  });
});

describe('OGP', () => {
  /** `<head>` に meta を並べたページ。`</head>` の後ろは本文。 */
  function page(head: string, body = '中身'): Response {
    return html(`<html><head>${head}</head><body>${body}</body></html>`);
  }

  /**
   * 少しずつ流すページ。**読むのをどこでやめるか**を見るテストで使う。
   *
   * 1 個の chunk で返すと、読むのをやめた後の中身まで手元の文字列に載っているので、
   * 打ち切りの条件を変えても結果が変わらない（何も検証しないテストになる）。
   */
  function chunked(source: string, size = 24): Response {
    const bytes = new TextEncoder().encode(source);
    let offset = 0;
    return new Response(
      new ReadableStream<Uint8Array>({
        pull(controller) {
          if (offset >= bytes.byteLength) return controller.close();
          controller.enqueue(bytes.slice(offset, offset + size));
          offset += size;
        },
      }),
      { headers: { 'Content-Type': 'text/html; charset=utf-8' } },
    );
  }

  it('og:* を読む', async () => {
    vi.stubGlobal('fetch', async () =>
      page(`
        <title>素の題</title>
        <meta property="og:title" content="OG の題">
        <meta property="og:description" content="OG の説明">
        <meta property="og:image" content="https://cdn.example.com/a.png">
        <meta property="og:site_name" content="Example">
      `),
    );
    expect(await preview('https://example.com/a')).toEqual({
      title: 'OG の題',
      description: 'OG の説明',
      image: 'https://cdn.example.com/a.png',
      siteName: 'Example',
    });
  });

  it('og:* が無ければ title と meta[name=description] に落ちる', async () => {
    vi.stubGlobal('fetch', async () =>
      page('<title>素の題</title><meta name="description" content="素の説明">'),
    );
    expect(await preview('https://example.com/a')).toMatchObject({
      title: '素の題',
      description: '素の説明',
      image: null,
      siteName: null,
    });
  });

  it('`</title>` より後ろの og:image も拾う', async () => {
    // 読むのを `</title>` で打ち切ると題しか取れない。og:* は後ろに書かれる方が多い。
    //
    // **細かく刻んで流す。** 1 個の chunk に全部入れると、どこで読むのをやめても
    // 手元の文字列には最後まで載っていて、**打ち切り位置を何も検証しない**テストになる。
    vi.stubGlobal('fetch', async () =>
      chunked('<html><head><title>題</title><meta property="og:image" content="/thumb.png"></head><body>x</body></html>'),
    );
    expect((await preview('https://example.com/a')).image).toBe(
      'https://example.com/thumb.png',
    );
  });

  it('相対の og:image は、リダイレクトを追い終えた URL を基準に解決する', async () => {
    vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === 'https://example.com/go') {
        return new Response(null, { status: 302, headers: { Location: 'https://cdn.example.org/x/' } });
      }
      return page('<meta property="og:image" content="../thumb.png"><title>題</title>');
    });
    expect((await preview('https://example.com/go')).image).toBe(
      'https://cdn.example.org/thumb.png',
    );
  });

  it('og:image が並んでいたら先頭を採る', async () => {
    // 1 枚目が本命で、2 枚目以降は別サイズ、という書き方をするページがある。
    vi.stubGlobal('fetch', async () =>
      page(`
        <title>題</title>
        <meta property="og:image" content="https://cdn.example.com/large.png">
        <meta property="og:image" content="https://cdn.example.com/small.png">
      `),
    );
    expect((await preview('https://example.com/a')).image).toBe(
      'https://cdn.example.com/large.png',
    );
  });

  it('属性の順や引用符が違っても読む', async () => {
    vi.stubGlobal('fetch', async () =>
      page(`<title>題</title><meta content='単引用の題' property=og:title>`),
    );
    expect((await preview('https://example.com/a')).title).toBe('単引用の題');
  });

  it('body に置かれた og:image は見ない', async () => {
    // 読むのは `<head>` まで。**1 個の chunk に本文まで入って届く**ので、読むのを
    // やめるだけでは足りず、`</head>` の先を捨てるところまで要る。
    vi.stubGlobal('fetch', async () =>
      page('<title>題</title>', '<meta property="og:image" content="https://cdn.example.com/x.png">'),
    );
    expect((await preview('https://example.com/a')).image).toBeNull();
  });

  it('content が空の og:image は無いものとして扱う', async () => {
    // `??` で繋ぐと空文字が勝ち、しかも空の URL は**相手のページ自身**に解決される
    // （画像として取りに行く 1 往復を無駄にする）。
    vi.stubGlobal('fetch', async () =>
      page(`
        <title>題</title>
        <meta property="og:image" content="">
        <meta name="twitter:image" content="https://cdn.example.com/t.png">
      `),
    );
    expect((await preview('https://example.com/a')).image).toBe(
      'https://cdn.example.com/t.png',
    );
  });

  it('符号位置として書けない実体参照でも落ちない', async () => {
    // `String.fromCodePoint` は範囲外で RangeError。相手のページの 1 文字で
    // 500 にしない（読めないものは書いてあるまま残す）。
    vi.stubGlobal('fetch', async () =>
      page('<title>題 &#x110000; &#99999999;</title>'),
    );
    expect((await preview('https://example.com/a')).title).toBe(
      '題 &#x110000; &#99999999;',
    );
  });

  it('ヘッダだけ返して黙る相手でも落ちない', async () => {
    // 5 秒の打ち切りは body を読んでいる最中に来る。投げると「取れなかった」の
    // 経路を飛び越えて 500 になる。
    vi.stubGlobal('fetch', async () => {
      return new Response(
        new ReadableStream<Uint8Array>({
          pull() {
            throw new Error('timed out');
          },
        }),
        { headers: { 'Content-Type': 'text/html' } },
      );
    });
    expect(await preview('https://example.com/a')).toMatchObject({ title: null });
  });

  it('http / https 以外の og:image は捨てる', async () => {
    vi.stubGlobal('fetch', async () =>
      page('<title>題</title><meta property="og:image" content="data:image/png;base64,AAAA">'),
    );
    expect((await preview('https://example.com/a')).image).toBeNull();
  });
});

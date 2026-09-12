import { describe, expect, it } from 'vitest';
import { ADMIN_HASH, createPaths, normalizeMountPath, siteOrigin } from '../src/core/paths.ts';
import type { PathErrorCode } from '../src/core/paths.ts';
import { ROUTE } from '../src/core/routes/fixed.ts';

/**
 * 配る静的アセットの名前。**core は 1 つも知らない**ので、予約されるものを
 * 見たいテストは自分で渡す（本番の一覧は `src/site/meta.ts`）。
 */
const ASSETS = ['favicon.svg', 'favicon.ico', 'ogp.png'];

const site = { site: { url: 'https://fushihara.net' }, mountPath: '/blog', assets: ASSETS };
const root = { site: { url: 'https://blog.example.com' }, mountPath: '/', assets: ASSETS };

const { normalizePostPath, isReservedSegment } = createPaths(site);

/** 成功したときの値。失敗していたらエラーコード付きで落とす。 */
function value(input: string): string {
  const result = normalizePostPath(input);
  if (!result.ok) throw new Error(`正規化に失敗した: ${input} (${result.error.code})`);
  return result.value;
}

function code(input: string): PathErrorCode | 'ok' {
  const result = normalizePostPath(input);
  return result.ok ? 'ok' : result.error.code;
}

describe('normalizePostPath', () => {
  it('そのまま通るもの', () => {
    expect(value('start-blog')).toBe('start-blog');
    expect(value('ratatoskr/1')).toBe('ratatoskr/1');
    expect(value('a/b/c')).toBe('a/b/c');
    expect(value('01234567-89ab-cdef-0123-456789abcdef')).toBe('01234567-89ab-cdef-0123-456789abcdef');
  });

  it('前後のスラッシュは入力ミスとして取り除く', () => {
    expect(value('/start-blog')).toBe('start-blog');
    expect(value('start-blog/')).toBe('start-blog');
    expect(value('/ratatoskr/1/')).toBe('ratatoskr/1');
  });

  it('連続スラッシュと空セグメントは拒否する (黙って畳まない)', () => {
    expect(code('a//b')).toBe('empty-segment');
    expect(code('//a')).toBe('empty-segment');
    expect(code('a//')).toBe('empty-segment');
  });

  it('空は拒否する', () => {
    expect(code('')).toBe('empty');
    expect(code('/')).toBe('empty');
  });

  it('percent encoding は 1 回だけデコードして、残っていたら拒否する', () => {
    // %2F は素の / として扱われる。セグメントの中に / を紛れ込ませられない。
    expect(value('a%2Fb')).toBe('a/b');
    expect(code('%252F')).toBe('percent-not-allowed');
    expect(code('a%25b')).toBe('percent-not-allowed');
    expect(code('%')).toBe('malformed-percent-encoding');
    expect(code('%zz')).toBe('malformed-percent-encoding');
  });

  it('. と .. のセグメントを拒否する', () => {
    expect(code('..')).toBe('dot-segment');
    expect(code('a/../b')).toBe('dot-segment');
    expect(code('a/./b')).toBe('dot-segment');
  });

  it('ファイル名にも URL にも使えない文字を拒否する', () => {
    expect(code('a\\b')).toBe('forbidden-character');
    expect(code('a:b')).toBe('forbidden-character');
    expect(code('a?b')).toBe('forbidden-character');
    expect(code('a*b')).toBe('forbidden-character');
    expect(code('a<b')).toBe('forbidden-character');
    expect(code('a|b')).toBe('forbidden-character');
  });

  it('制御文字を拒否する', () => {
    expect(code(`a${String.fromCharCode(0)}b`)).toBe('control-character');
    expect(code(`a${String.fromCharCode(0x1f)}b`)).toBe('control-character');
    expect(code(`a${String.fromCharCode(0x7f)}b`)).toBe('control-character');
  });

  it('Windows の予約名を拒否する (拡張子付きも)', () => {
    expect(code('con')).toBe('windows-reserved-name');
    expect(code('CON')).toBe('windows-reserved-name');
    expect(code('COM1')).toBe('windows-reserved-name');
    expect(code('lpt9')).toBe('windows-reserved-name');
    expect(code('nul.txt')).toBe('windows-reserved-name');
    // 予約名で始まるだけのものは通す
    expect(value('console')).toBe('console');
  });

  it('末尾のドットと空白を拒否する (Windows が落とすので往復で別物になる)', () => {
    expect(code('foo.')).toBe('trailing-dot-or-space');
    expect(code('foo ')).toBe('trailing-dot-or-space');
    expect(code('a/b./c')).toBe('trailing-dot-or-space');
  });

  it('長さの上限', () => {
    expect(code(`${'a'.repeat(81)}`)).toBe('segment-too-long');
    expect(value('a'.repeat(80))).toHaveLength(80);
    expect(code(Array.from({ length: 4 }, () => 'a'.repeat(70)).join('/'))).toBe('too-long');
  });

  it('NFD で来ても NFC に揃える (macOS から export/import しても別物にならない)', () => {
    // 'が' を NFD (か + U+3099) で書く。見た目では区別が付かないのでコードポイントで作る。
    const nfd = `あ${String.fromCharCode(0x304b, 0x3099)}`;
    expect(nfd).not.toBe('あが');
    expect(value(nfd)).toBe('あが');
  });

  it('予約パスを拒否する (第 1 セグメントだけ見る)', () => {
    expect(code('admin')).toBe('reserved-path');
    expect(code('api/posts')).toBe('reserved-path');
    expect(code('media')).toBe('reserved-path');
    expect(code('preview/abc')).toBe('reserved-path');
    expect(code('tags/dev')).toBe('reserved-path');
    expect(code('rss.xml')).toBe('reserved-path');
    expect(code('atom.xml')).toBe('reserved-path');
    expect(code('posts.json')).toBe('reserved-path');
    expect(code('sitemap-index.xml')).toBe('reserved-path');
    expect(code('404')).toBe('reserved-path');
    expect(code('favicon.svg')).toBe('reserved-path');
    expect(code('ogp.png')).toBe('reserved-path');
    expect(code('page')).toBe('reserved-path');
    expect(code('_next')).toBe('reserved-path');
    // パスの一意性も解決も lower() なので、予約判定もそろえる
    expect(code('Admin')).toBe('reserved-path');
    expect(code('RSS.xml')).toBe('reserved-path');
    // 第 2 セグメント以降は予約に当たらない
    expect(value('post/admin')).toBe('post/admin');
  });
});

describe('normalizeMountPath', () => {
  it('root mount は空文字になる', () => {
    expect(normalizeMountPath('/')).toBe('');
    expect(normalizeMountPath('')).toBe('');
  });

  it('先頭スラッシュ付き・末尾スラッシュ無しに揃える', () => {
    expect(normalizeMountPath('/blog')).toBe('/blog');
    expect(normalizeMountPath('blog')).toBe('/blog');
    expect(normalizeMountPath('/blog/')).toBe('/blog');
    expect(normalizeMountPath('/a/b/')).toBe('/a/b');
  });
});

describe('createPaths().urls', () => {
  const urlsOf = (config: typeof site) => createPaths(config).urls;

  it('fushihara.net の現行 URL を組める', () => {
    const urls = urlsOf(site);
    expect(urls.index()).toBe('/blog/');
    expect(urls.post('ratatoskr/1')).toBe('/blog/ratatoskr/1/');
    expect(urls.tag({ slug: 'dev' })).toBe('/blog/tags/dev/');
    expect(urls.feed('rss')).toBe('/blog/rss.xml');
    expect(urls.feed('atom')).toBe('/blog/atom.xml');
    expect(urls.postsJson()).toBe('/blog/posts.json');
    expect(urls.sitemap()).toBe('/blog/sitemap-index.xml');
    expect(urls.media({ public_id: 'abc', filename: 'sample.png' })).toBe('/blog/media/abc/sample.png');
    expect(urls.preview('tok')).toBe('/blog/preview/tok');
    expect(urls.admin()).toBe('/blog/admin/');
    expect(urls.admin('posts')).toBe('/blog/admin/posts');
    expect(urls.asset('favicon.svg')).toBe('/blog/favicon.svg');
  });

  it('一覧のページ番号は 2 ページ目から付く', () => {
    // `/blog/` と `/blog/page/1/` が両方あると、同じ中身が 2 つの URL で出る。
    const urls = urlsOf(site);
    expect(urls.index()).toBe('/blog/');
    expect(urls.index({ page: 1 })).toBe('/blog/');
    expect(urls.index({ page: 2 })).toBe('/blog/page/2/');
    expect(urls.tag({ slug: 'dev' }, { page: 3 })).toBe('/blog/tags/dev/page/3/');
    expect(urls.index({ page: 2, absolute: true })).toBe('https://fushihara.net/blog/page/2/');
  });

  it('absolute でサイトの絶対 URL になる', () => {
    const urls = urlsOf(site);
    expect(urls.post('ratatoskr/1', { absolute: true })).toBe('https://fushihara.net/blog/ratatoskr/1/');
    expect(urls.media({ public_id: 'abc', filename: 'a.png' }, { absolute: true })).toBe(
      'https://fushihara.net/blog/media/abc/a.png',
    );
  });

  it('root mount でも同じ関数で組める (core に /blog を焼き付けない)', () => {
    const urls = urlsOf(root);
    expect(urls.index()).toBe('/');
    expect(urls.post('ratatoskr/1')).toBe('/ratatoskr/1/');
    expect(urls.feed('rss')).toBe('/rss.xml');
    expect(urls.post('ratatoskr/1', { absolute: true })).toBe('https://blog.example.com/ratatoskr/1/');
  });

  it('管理画面で記事を開く URL を組める', () => {
    // ハッシュの形は `ADMIN_HASH` が正。**組む側と、解く側 (`src/admin/router.ts`)
    // が同じものを見る**ので、ここで形を固定しておく。
    const urls = urlsOf(site);
    expect(urls.adminPost('abc')).toBe(`/blog/admin/#${ADMIN_HASH.postPrefix}abc`);
    expect(urls.adminPost('abc')).toBe('/blog/admin/#/posts/abc');
    expect(urlsOf(root).adminPost('abc')).toBe('/admin/#/posts/abc');
  });

  it('origin の末尾スラッシュは落とす (// にならない)', () => {
    expect(siteOrigin('https://fushihara.net/')).toBe('https://fushihara.net');
    expect(siteOrigin('https://fushihara.net///')).toBe('https://fushihara.net');
    expect(siteOrigin('https://fushihara.net')).toBe('https://fushihara.net');
    // URL 生成器も同じものを通す。
    expect(
      urlsOf({ ...site, site: { url: 'https://fushihara.net/' } }).index({ absolute: true }),
    ).toBe('https://fushihara.net/blog/');
  });

  it('保存されているパスはセグメント単位でエンコードする', () => {
    const urls = urlsOf(site);
    expect(urls.post('日本語/1')).toBe('/blog/%E6%97%A5%E6%9C%AC%E8%AA%9E/1/');
    expect(urls.tag({ slug: '日記' })).toBe('/blog/tags/%E6%97%A5%E8%A8%98/');
  });
});

describe('URL 生成と予約パスの対応', () => {
  it('生成器が作る固定 URL は、すべて記事に取られないよう予約されている', () => {
    // route を 1 本足したときに fixed.ts だけ直して paths.ts を忘れる (逆も) と、
    // 「URL は生成できるが予約されていない」が黙って成立する。ここで塞ぐ。
    const urls = createPaths({ site: { url: 'https://example.com' }, mountPath: '/' }).urls;
    const generated = [
      urls.tag({ slug: 'x' }),
      urls.media({ public_id: 'a', filename: 'b.png' }),
      urls.feed('rss'),
      urls.feed('atom'),
      urls.preview('t'),
      urls.admin(),
      urls.admin('posts'),
      urls.postsJson(),
      urls.sitemap(),
    ];

    for (const url of generated) {
      const first = url.slice(1).split('/')[0] as string;
      expect(isReservedSegment(first), `${url} の ${first} が予約されていない`).toBe(true);
      expect(normalizePostPath(first).ok, `${first} が記事パスとして通る`).toBe(false);
    }
  });

  it('ROUTE のセグメントはすべて予約されている', () => {
    for (const segment of Object.values(ROUTE)) {
      expect(isReservedSegment(segment), `${segment} が予約されていない`).toBe(true);
    }
  });

  it('配ると宣言した静的アセットも予約される', () => {
    // 配るのに予約しないと、その名前で作った記事が静的アセットの影に入る。
    // **大小文字は無視する**（記事パスの一意性が ci なので、`Favicon.ico` を
    // 通すと `/favicon.ICO` がその記事に解決されてしまう）。
    for (const asset of ASSETS) {
      expect(isReservedSegment(asset), `${asset} が予約されていない`).toBe(true);
      expect(code(asset)).toBe('reserved-path');
      expect(isReservedSegment(asset.toUpperCase())).toBe(true);
    }
  });

  it('予約するのは deployment が配ると言ったものだけ', () => {
    // core に既定のアセット名を持たせない。持たせると、配りもしないのに
    // `favicon.ico` という記事パスが作れないサイトができる。
    const bare = createPaths({ site: { url: 'https://example.com' }, mountPath: '/' });
    expect(bare.isReservedSegment('favicon.ico')).toBe(false);
    expect(bare.normalizePostPath('favicon.ico').ok).toBe(true);
    expect(bare.assets).toEqual([]);
  });
});

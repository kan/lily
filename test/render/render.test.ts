import { describe, expect, it } from 'vitest';
import { renderMarkdown, type RenderMedia } from '../../src/core/render/index.ts';
import { blockPadding, imageMarkdown, inLinkUrl } from '../../src/core/render/markdown.ts';
import { linkCardHtml } from '../../src/core/link-card.ts';

const MEDIA: readonly RenderMedia[] = [
  { public_id: 'MEDIA-ID', filename: 'sample.png', width: 96, height: 48 },
];

async function html(markdown: string, media: readonly RenderMedia[] = MEDIA): Promise<string> {
  return (await renderMarkdown(markdown, { media })).html;
}

describe('CommonMark + GFM', () => {
  it('見出し・リスト・引用・強調が出る', async () => {
    const out = await html(
      ['## 見出し 2', '', '- 箇条書き', '', '> 引用', '', '**強い**と*斜め*'].join('\n'),
    );
    expect(out).toContain('<h2>見出し 2</h2>');
    expect(out).toContain('<li>箇条書き</li>');
    expect(out).toContain('<blockquote>');
    expect(out).toContain('<strong>強い</strong>');
    expect(out).toContain('<em>斜め</em>');
  });

  it('GFM の表・取り消し線・タスクリストが出る', async () => {
    const out = await html(
      ['| 表 | も |', '|---|---|', '| 使 | える |', '', '~~消し~~', '', '- [x] done'].join('\n'),
    );
    expect(out).toContain('<table>');
    expect(out).toContain('<del>消し</del>');
    expect(out).toContain('<input type="checkbox" checked disabled>');
  });

  it('表が壊れない (rehype-raw を使うと表の外へ空行が漏れる)', async () => {
    const out = await html(['```', 'x', '```', '', '| a |', '|---|', '| b |'].join('\n'));
    // </pre> と <table> の間に空行が並んでいたら、HTML を parse5 で読み直している
    expect(out).not.toMatch(/\n{3,}/);
  });
});

describe('脚注', () => {
  it('参照と定義が繋がり、定義は末尾にまとまる', async () => {
    const out = await html(['本文[^1]。', '', '[^1]: 脚注の中身。'].join('\n'));
    expect(out).toContain('<sup>');
    expect(out).toContain('data-footnote-ref');
    expect(out).toContain('<section data-footnotes');
    expect(out).toContain('脚注の中身。');
  });

  it('見出しと戻りリンクの文言が日本語', async () => {
    // 画面には出ない (sr-only) が読み上げには出るので、英語のままにしない。
    const out = await html(['本文[^1]。', '', '[^1]: 中身。'].join('\n'));
    expect(out).toContain('>脚注</h2>');
    expect(out).toContain('aria-label="本文の 1 に戻る"');
    expect(out).not.toContain('>Footnotes</h2>');
  });

  it('見出しは sr-only で出す (CSS が無いと本文に見えてしまう)', async () => {
    const out = await html(['本文[^1]。', '', '[^1]: 中身。'].join('\n'));
    expect(out).toContain('class="sr-only"');
  });
});

describe('コードハイライト', () => {
  it('色は CSS 変数で出す (defaultColor: false を維持する)', async () => {
    const out = await html(['```ts', 'export const a = 1;', '```'].join('\n'));
    expect(out).toContain('--shiki-light:');
    expect(out).toContain('--shiki-dark:');
    // 色を直接書かれると blog.css の light-dark() を殴るので !important が要る
    expect(out).not.toMatch(/style="[^"]*[^-]color:/);
  });

  it('言語指定なしのフェンスも Shiki を通る (スタイルが当たるように)', async () => {
    const out = await html(['```', 'ただの文字', '```'].join('\n'));
    expect(out).toContain('class="shiki');
  });

  it('載せていない言語でも落ちない', async () => {
    const out = await html(['```brainfuck', '+++.', '```'].join('\n'));
    expect(out).toContain('class="shiki');
    expect(out).toContain('+++.');
  });

  it('折り返しは CSS に任せる (保存する HTML に見せ方を焼き込まない)', async () => {
    const out = await html(['```ts', 'const a = 1;', '```'].join('\n'));
    expect(out).not.toContain('white-space');
  });
});

describe('画像記法の組み立て', () => {
  /**
   * **組み立てと解析を対で見る。** 管理画面が入れた記法が renderer で解決
   * されなければ、上げたのに出ない画像になる (空白入りのファイル名で実際に踏んだ)。
   */
  async function insertAndResolve(filename: string): Promise<string> {
    const media = [{ public_id: 'MEDIA-ID', filename }];
    return (await renderMarkdown(imageMarkdown(filename), { media })).html;
  }

  it('素で書けるファイル名はそのまま', () => {
    expect(imageMarkdown('sample.png')).toBe('![](./sample.png)');
    expect(imageMarkdown('日本語.png')).toBe('![](./日本語.png)');
  });

  it('空白と括弧を含むときは <…> で囲む', () => {
    // `![](./my photo.png)` は CommonMark ではリンク先として解析されない。
    expect(imageMarkdown('my photo.png')).toBe('![](<./my photo.png>)');
    expect(imageMarkdown('図 (1).png')).toBe('![](<./図 (1).png>)');
  });

  it('組み立てた記法は必ず解決される', async () => {
    for (const filename of ['sample.png', '日本語.png', 'my photo.png', '図 (1).png', "don't.png"]) {
      const html = await insertAndResolve(filename);
      expect(html, filename).toContain('lily-media://MEDIA-ID/');
      expect(html, filename).not.toContain('./');
    }
  });
});

describe('img の属性', () => {
  /**
   * Astro 版が出していた `width` / `height` / `loading` / `decoding` の引き継ぎ。
   * **`width` / `height` が無いと画像が届くまで高さが 0 で、本文が飛ぶ。**
   */
  it('寸法と読み込み方が付く', async () => {
    expect(await html('![図](./sample.png)')).toContain(
      '<img src="lily-media://MEDIA-ID/sample.png" alt="図" width="96" height="48" loading="lazy" decoding="async">',
    );
  });

  it('寸法が読めていない添付でも loading / decoding は付く', async () => {
    const media = [{ public_id: 'X', filename: 'sample.png', width: null, height: null }];
    const out = await html('![図](./sample.png)', media);
    expect(out).toContain('loading="lazy"');
    expect(out).toContain('decoding="async"');
    expect(out).not.toContain('width=');
    expect(out).not.toContain('height=');
  });

  it('解決できなかった画像には付かない', async () => {
    // 添付が無いので URL も書き換わらない。属性だけ足すと、無い画像の寸法を
    // 主張することになる。
    const out = await html('![無い](./missing.png)');
    expect(out).toContain('<img src="./missing.png" alt="無い">');
  });

  it('生 HTML の img には URL の解決しかしない', async () => {
    // 属性は著者が決めている。片方だけ足すと指定と違う比率に潰れる。
    const out = await html('<img src="./sample.png" width="300">');
    expect(out).toContain('<img src="lily-media://MEDIA-ID/sample.png" width="300">');
    expect(out).not.toContain('loading=');
  });
});

describe('本文に書いた HTML', () => {
  it('コードブロックと inline code は書き換えられずそのまま出る', async () => {
    const out = await html(
      ['インラインの `<img src="./sample.png">` と:', '', '```', '<img src="./sample.png">', '```'].join('\n'),
    );
    // text ノードなので `<` はエスケープされるが、中身は素のまま残る
    expect(out).toContain('&#x3C;img src="./sample.png">');
    expect(out.match(/lily-media:/g)).toBeNull();
  });

  it('生 HTML はパースし直さずそのまま運ぶ', async () => {
    const out = await html('<div class="note" data-x="1">本文</div>');
    expect(out).toContain('<div class="note" data-x="1">本文</div>');
  });
});

describe('相対参照の解決', () => {
  it('Markdown の画像記法を placeholder にする', async () => {
    expect(await html('![図](./sample.png)')).toContain(
      '<img src="lily-media://MEDIA-ID/sample.png" alt="図"',
    );
  });

  it('./ 無しでも突き合わせる', async () => {
    expect(await html('![図](sample.png)')).toContain('lily-media://MEDIA-ID/sample.png');
  });

  it('生 HTML で書いた相対参照も同じ規則で解決する', async () => {
    const out = await html('<img src="./sample.png" width="300">');
    expect(out).toContain('<img src="lily-media://MEDIA-ID/sample.png" width="300">');
  });

  it('生 HTML の属性は大小文字とクォートの形を選ばない', async () => {
    // ここが狭いと未解決のまま配信物に残り、しかも onUnresolved にも出ないので
    // 警告にすら現れない (相対 URL のまま公開ページに出て 404 になる)。
    //
    // 引用符なしで `src=./sample.png` と書いた場合は micromark が生 HTML と
    // 見なさず、エスケープされたテキストとして出る (実測)。そもそも raw ノードに
    // ならないので、ここでは引用符なしは `sample.png` の形で見ている。
    const forms = [
      'src="./sample.png"',
      "src='./sample.png'",
      'SRC="./sample.png"',
      'src = "./sample.png"',
      'src=sample.png',
    ];

    for (const attribute of forms) {
      const out = await html(`<img ${attribute}>`);
      // 書き換えたぶんは必ず二重引用符で囲み直す (属性名の大小はそのまま残す)
      expect(out, attribute).toMatch(/<img src="lily-media:\/\/MEDIA-ID\/sample\.png">/i);
    }
  });

  it('リンクの href も解決する', async () => {
    expect(await html('[図](./sample.png)')).toContain('href="lily-media://MEDIA-ID/sample.png"');
  });

  it('別ディレクトリ・外部 URL・アンカーには触らない', async () => {
    const out = await html(
      [
        '[a](../../CONTRACT.md)',
        '[b](https://example.com/sample.png)',
        '[c](#anchor)',
        '[d](mailto:a@example.com)',
      ].join('\n\n'),
    );
    expect(out).toContain('href="../../CONTRACT.md"');
    expect(out).toContain('href="https://example.com/sample.png"');
    expect(out).toContain('href="#anchor"');
    expect(out).toContain('href="mailto:a@example.com"');
  });

  it('解決できない ./ の参照は元のまま残し、警告として返す', async () => {
    const result = await renderMarkdown('![無い](./missing.png)', { media: MEDIA });
    expect(result.html).toContain('src="./missing.png"');
    expect(result.unresolvedMedia).toEqual(['./missing.png']);
  });

  it('同じ参照が何度出ても警告は 1 回', async () => {
    const result = await renderMarkdown('![a](./missing.png) と ![b](./missing.png)', { media: MEDIA });
    expect(result.unresolvedMedia).toEqual(['./missing.png']);
  });

  it('./ 無しの記事間リンクは警告しない', async () => {
    const result = await renderMarkdown('[他の記事](other.md)', { media: MEDIA });
    expect(result.unresolvedMedia).toEqual([]);
  });

  it('スキームに見える値はスキームとして扱う (同名の添付があっても)', async () => {
    // `media.filename` は `:` を含められるので `mailto:x.png` という添付は作れる。
    // そのとき `[a](mailto:x.png)` をどちらに解釈するかは決めておく必要がある。
    const media = [{ public_id: 'X', filename: 'mailto:x.png' }];
    expect(await html('[a](mailto:x.png)', media)).toContain('href="mailto:x.png"');
  });

  it('percent encoding された名前も突き合わせる', async () => {
    const media = [{ public_id: 'JP', filename: '日本語.png' }];
    const out = await html('![図](./%E6%97%A5%E6%9C%AC%E8%AA%9E.png)', media);
    expect(out).toContain('lily-media://JP/%E6%97%A5%E6%9C%AC%E8%AA%9E.png');
  });
});

describe('inLinkUrl (貼り付けで URL を展開してよいか)', () => {
  /** `|` の位置をカーソルとして読む。 */
  function at(withCursor: string): boolean {
    const cursor = withCursor.indexOf('|');
    return inLinkUrl(withCursor.replace('|', ''), cursor);
  }

  it('リンクの URL 欄の中にいる', () => {
    expect(at('[題](|)')).toBe(true);
    expect(at('[リンク](https://|)')).toBe(true);
    // 閉じ括弧をまだ打っていない書きかけ
    expect(at('[題](|')).toBe(true);
    // 画像記法も同じ
    expect(at('![図](|)')).toBe(true);
  });

  it('本文の途中では中にいない', () => {
    expect(at('|')).toBe(false);
    expect(at('ここに貼る |')).toBe(false);
    // 閉じたリンクの後ろ
    expect(at('[題](https://example.com) |')).toBe(false);
    // 題を書いている途中
    expect(at('[|]')).toBe(false);
    // `]` と `(` のあいだ
    expect(at('[題]|(https://example.com)')).toBe(false);
  });

  it('行をまたいだ `](` は見ない', () => {
    expect(at('[題](\n|')).toBe(false);
  });
});

describe('リンクカード', () => {
  const CARD = linkCardHtml({
    url: 'https://example.com/a?x=1&y=2',
    title: '相手の題',
    description: '相手の説明',
    siteName: 'example.com',
    thumbnail: { filename: 'sample.png', width: 96, height: 48 },
  });

  it('ブロックとして出て、サムネが placeholder になる', async () => {
    const out = await html(`本文。\n\n${CARD}\n\n続き。`);
    // 生 HTML なので renderer は素通しする。書き換わるのは添付の参照だけ。
    expect(out).toContain('<a class="link-card" href="https://example.com/a?x=1&amp;y=2">');
    expect(out).toContain('src="lily-media://MEDIA-ID/sample.png"');
    expect(out).toContain('相手の題');
    // 段落に飲まれていない（`<p>` の中に入ると本文の途中に混ざる）
    expect(out).toContain('</p>\n<a class="link-card"');
  });

  it('題と説明はエスケープされる', () => {
    const card = linkCardHtml({
      url: 'https://example.com/"><script>alert(1)</script>',
      title: '<script>alert(1)</script>',
      description: 'a & b',
      siteName: 'example.com',
      thumbnail: null,
    });
    expect(card).not.toContain('<script>');
    expect(card).toContain('a &amp; b');
  });

  it('サムネが無ければ img を出さない', () => {
    const card = linkCardHtml({
      url: 'https://example.com/',
      title: '題',
      description: null,
      siteName: 'example.com',
      thumbnail: null,
    });
    expect(card).not.toContain('<img');
    expect(card).not.toContain('link-card-desc');
  });

  it('空行を含まない (HTML ブロックが途中で切れる)', () => {
    expect(CARD).not.toMatch(/\n\s*\n/);
  });
});

describe('blockPadding (ブロックとして置き換えるための改行)', () => {
  /** `|` 2 つで置き換える範囲を示す。 */
  function pad(text: string): { before: string; after: string } {
    const start = text.indexOf('|');
    const end = text.indexOf('|', start + 1) - 1;
    return blockPadding(text.replaceAll('|', ''), start, end);
  }

  it('段落の途中なら前後に空行を足す', () => {
    expect(pad('本文の途中に |リンク| を貼った')).toEqual({ before: '\n\n', after: '\n\n' });
  });

  it('既にある改行は数える', () => {
    expect(pad('前の段落\n\n|リンク|\n\n次の段落')).toEqual({ before: '', after: '' });
    expect(pad('前の段落\n|リンク|\n次の段落')).toEqual({ before: '\n', after: '\n' });
  });

  it('文書の端では足さない', () => {
    expect(pad('|リンク|')).toEqual({ before: '', after: '' });
  });
});

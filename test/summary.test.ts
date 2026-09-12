import { describe, expect, it } from 'vitest';
import { postDescription, summarize } from '../src/core/summary.ts';

describe('summarize', () => {
  it('最初の段落だけを取る（段落をまたいで繋がない）', () => {
    expect(summarize(['書き出しの段落。', '', '次の段落。'].join('\n'))).toBe('書き出しの段落。');
  });

  it('見出しから始まる本文は見出しを飛ばす', () => {
    expect(summarize(['# 題', '', '## 小見出し', '', '中身。'].join('\n'))).toBe('中身。');
  });

  it('折り返した日本語は空白を入れずに繋ぐ', () => {
    expect(summarize(['行を折り返して', '書いた文章。'].join('\n'))).toBe('行を折り返して書いた文章。');
  });

  it('英語の折り返しには空白を入れる', () => {
    expect(summarize(['hello', 'world'].join('\n'))).toBe('hello world');
  });

  it('リンクは題だけ、画像と脚注は落とす', () => {
    // 脚注は定義があってはじめて参照になる (定義の無い `[^1]` は GFM でもただの
    // 文字列で、renderer もそう出す)。
    const md = ['これは[lily](https://example.com)の話[^1]。![図](./a.png)', '', '[^1]: 注。'].join(
      '\n',
    );
    expect(summarize(md)).toBe('これはlilyの話。');
  });

  it('強調・コード・エスケープの記号を外す', () => {
    expect(summarize('**強い**と`code`と\\*星\\*。')).toBe('強いとcodeと*星*。');
  });

  it('コードブロックから始まる本文はその先を取る', () => {
    expect(summarize(['```ts', 'const x = 1;', '```', '', '説明の段落。'].join('\n'))).toBe(
      '説明の段落。',
    );
  });

  it('箇条書きと引用は印を外して拾う', () => {
    expect(summarize(['- ひとつ目', '- ふたつ目'].join('\n'))).toBe('ひとつ目 ふたつ目');
    expect(summarize('> 引用から始まる記事。')).toBe('引用から始まる記事。');
  });

  it('長い本文は句点で切る', () => {
    const md = `${'あ'.repeat(60)}。${'い'.repeat(60)}。`;
    expect(summarize(md)).toBe(`${'あ'.repeat(60)}。`);
  });

  it('句点が前の方にしか無ければ … で切る', () => {
    const md = `短い。${'あ'.repeat(200)}`;
    const out = summarize(md, 100);
    expect(out).toBe(`短い。${'あ'.repeat(97)}…`);
  });

  it('切る必要がなければそのまま返す', () => {
    expect(summarize('短い本文。')).toBe('短い本文。');
  });

  it('setext の見出しは下線ごと落とす', () => {
    // ATX (`# 題`) を飛ばしているのに setext を拾うと、書き方の違いだけで
    // 見出しが説明に出る。
    expect(summarize(['題', '===', '', '本文。'].join('\n'))).toBe('本文。');
    expect(summarize(['題', '---', '', '本文。'].join('\n'))).toBe('本文。');
  });

  it('印の内側の見出しも落とす', () => {
    expect(summarize(['> # 見出しの引用', '', '本文。'].join('\n'))).toBe('本文。');
  });

  it('字下げのコードブロックは段落として拾わない', () => {
    expect(summarize(['    indented code', '', '本文。'].join('\n'))).toBe('本文。');
  });

  it('水平線は書き方によらず飛ばす', () => {
    // `---` は setext の下線と、`- - -` は箇条書きと紛らわしい。正規表現で
    // 読んでいたころは後者が `-` という説明になっていた。
    for (const rule of ['---', '- - -', '***', '___']) {
      expect(summarize([rule, '', '本文。'].join('\n')), rule).toBe('本文。');
    }
  });

  it('表とリンク参照定義は飛ばす', () => {
    expect(summarize(['| a | b |', '|---|---|', '| 1 | 2 |', '', '本文。'].join('\n'))).toBe(
      '本文。',
    );
    expect(summarize(['[ref]: https://example.com', '', '本文。'].join('\n'))).toBe('本文。');
  });

  it('文章の無い本文では null を返す（空の説明を出さない）', () => {
    expect(summarize('')).toBeNull();
    expect(summarize('# 題だけ')).toBeNull();
    expect(summarize('![図](./a.png)')).toBeNull();
    expect(summarize(['```', 'code', '```'].join('\n'))).toBeNull();
  });
});

describe('postDescription', () => {
  it('手で書いた説明が常に勝つ', () => {
    expect(postDescription({ description: '手書き', body_md: '本文。' })).toBe('手書き');
  });

  it('空なら本文から作る', () => {
    expect(postDescription({ description: null, body_md: '本文。' })).toBe('本文。');
  });

  it('空白だけの説明も書いていないものとして扱う', () => {
    // import が通る frontmatter (`description: "   "`) はそのまま DB に入る。
    expect(postDescription({ description: '   ', body_md: '本文。' })).toBe('本文。');
  });

  it('前後の空白は落として返す', () => {
    expect(postDescription({ description: ' 手書き ', body_md: '本文。' })).toBe('手書き');
  });
});

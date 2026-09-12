import { describe, expect, it } from 'vitest';
import {
  parseFrontmatter,
  plain,
  stringifyFrontmatter,
  type FmEntry,
} from '../../src/core/transfer/frontmatter.ts';

/** 読めたことを前提に中身を取り出す。失敗はテストの失敗として出す。 */
function parse(text: string) {
  const result = parseFrontmatter(text);
  if (!result.ok) throw new Error(`読めなかった: ${JSON.stringify(result.error)}`);
  return result.value;
}

function errorOf(text: string) {
  const result = parseFrontmatter(text);
  if (result.ok) throw new Error('読めてしまった');
  return result.error;
}

describe('読む', () => {
  it('スカラ・並び・写像を読む', () => {
    const { data, body } = parse(
      [
        '---',
        'title: RSSで全文を配信',
        'date: 2026-08-24',
        'tags:',
        '  - blog',
        '  - dev',
        'media:',
        '  sample.png: 3f2a',
        '---',
        '本文。',
        '',
      ].join('\n'),
    );
    expect(data.title).toBe('RSSで全文を配信');
    expect(data.date).toBe('2026-08-24');
    expect(data.tags).toEqual(['blog', 'dev']);
    expect(data.media).toEqual({ 'sample.png': '3f2a' });
    expect(body).toBe('本文。\n');
  });

  it('フローの並びも読む', () => {
    const { data } = parse("---\ntags: [blog, 'd, ev']\n---\n");
    expect(data.tags).toEqual(['blog', 'd, ev']);
    expect(parse('---\ntags: []\n---\n').data.tags).toEqual([]);
  });

  it('値を書かないキーは null (「書いていない」と同じ扱いにするため)', () => {
    const { data } = parse('---\ntitle: あ\ndescription:\n---\n');
    expect(data.description).toBeNull();
  });

  it('引用符の中はそのまま読む', () => {
    const { data } = parse(
      ['---', "a: 'it''s'", 'b: "1 行目\\n2 行目"', 'c: "\\u3042"', '---', ''].join('\n'),
    );
    expect(data.a).toBe("it's");
    expect(data.b).toBe('1 行目\n2 行目');
    expect(data.c).toBe('あ');
  });

  it('プレーンスカラの # は本文の一部 (行末コメントは無い)', () => {
    expect(parse('---\ntitle: a # b\n---\n').data.title).toBe('a # b');
  });

  it('行頭のコメントと空行は飛ばす', () => {
    const { data } = parse(['---', '# めも', '', 'title: あ', '---', ''].join('\n'));
    expect(data).toEqual({ title: 'あ' });
  });

  it('写像のキーは引用できる (ファイル名に記号が入るため)', () => {
    const { data } = parse(['---', 'media:', "  'a b.png': 1", '---', ''].join('\n'));
    expect(data.media).toEqual({ 'a b.png': '1' });
  });
});

describe('本文には触らない', () => {
  it('末尾の改行を足さない', () => {
    expect(parse('---\ntitle: あ\n---\n改行なし').body).toBe('改行なし');
  });

  it('本文が --- で始まってもよい (閉じるのは最初の --- だけ)', () => {
    expect(parse('---\ntitle: あ\n---\n---\n水平線\n').body).toBe('---\n水平線\n');
  });

  it('CRLF はそのまま残す', () => {
    const { data, body } = parse('---\r\ntitle: あ\r\n---\r\n本文\r\n');
    expect(data.title).toBe('あ');
    expect(body).toBe('本文\r\n');
  });
});

describe('読めないものは拒否する (黙って別物として解釈しない)', () => {
  it.each([
    ['先頭が --- でない', 'title: あ\n', 'missing-open'],
    ['閉じの --- が無い', '---\ntitle: あ\n', 'missing-close'],
    ['キーが重複', '---\ntitle: あ\ntitle: い\n---\n', 'duplicate-key'],
    ['最上位が字下げ', '---\n  title: あ\n---\n', 'unexpected-indent'],
    ['ブロックスカラ', '---\ntitle: |\n  あ\n---\n', 'unsupported-syntax'],
    ['アンカー', '---\ntitle: &a あ\n---\n', 'unsupported-syntax'],
    ['入れ子の写像', '---\na:\n  b:\n    c: 1\n---\n', 'inconsistent-indent'],
    ['閉じていない引用符', '---\ntitle: "あ\n---\n', 'unterminated-quote'],
    ['知らないエスケープ', '---\ntitle: "\\q"\n---\n', 'invalid-escape'],
    ['引用符の後ろに何かある', '---\ntitle: "あ" い\n---\n', 'unsupported-syntax'],
    ['字下げが揃っていない', '---\ntags:\n  - a\n    - b\n---\n', 'inconsistent-indent'],
    // `__proto__` は代入しても素のオブジェクトにキーが生えないので、通すと
    // 「知らないキーは拒否する」の網を黙ってすり抜ける。
    ['__proto__ のキー', '---\ntitle: あ\n__proto__: x\n---\n', 'unsafe-key'],
    ['写像の中の __proto__', '---\nmedia:\n  __proto__: x\n---\n', 'unsafe-key'],
  ])('%s', (_name, text, code) => {
    expect(errorOf(text).code).toBe(code);
  });

  it('prototype のプロパティ名は重複ではなく知らないキーとして扱う', () => {
    // `key in data` が継承分を拾うと、書き間違いが duplicate-key に化けて
    // 「同じキーが 2 つある」という的外れなエラーになる。
    const { data } = parse('---\ntitle: あ\nconstructor: x\n---\n');
    expect(data.constructor).toBe('x');
    expect(Object.keys(data).sort()).toEqual(['constructor', 'title']);
  });

  it('何行目かを返す', () => {
    expect(errorOf('---\ntitle: あ\ntitle: い\n---\n').line).toBe(3);
  });
});

describe('書く', () => {
  const roundTrip = (entries: FmEntry[], body = '本文\n') =>
    parse(stringifyFrontmatter(entries, body));

  it('キーは渡した順に並ぶ', () => {
    const text = stringifyFrontmatter(
      [
        ['title', 'あ'],
        ['date', plain('2026-08-24T00:00:00.000Z')],
      ],
      '',
    );
    expect(text).toBe('---\ntitle: あ\ndate: 2026-08-24T00:00:00.000Z\n---\n');
  });

  it('undefined と空の並び・写像は行ごと書かない', () => {
    const text = stringifyFrontmatter(
      [
        ['title', 'あ'],
        ['description', undefined],
        ['tags', []],
        ['media', {}],
      ],
      '',
    );
    expect(text).toBe('---\ntitle: あ\n---\n');
  });

  it.each([
    ['先頭が #', '#tag'],
    ['途中に空白と #', 'Rust # 入門'],
    ['真偽値に見える', 'true'],
    ['数値に見える', '0.5'],
    ['引用符で始まる', '"あ"'],
    ['前後に空白', ' あ '],
    ['空文字', ''],
    ['コロンと空白', 'a: b'],
    ['改行入り', '1 行目\n2 行目'],
    ['タブ入り', 'a\tb'],
    ['指示子で始まる', '|あ'],
    ['ハイフンと空白で始まる', '- あ'],
  ])('引用が要る値も往復する (%s)', (_name, value) => {
    expect(roundTrip([['title', value]]).data.title).toBe(value);
  });

  it.each([
    ['先頭が #', '#tag'],
    ['途中に空白と #', 'Rust # 入門'],
    ['真偽値に見える', 'true'],
    ['数値に見える', '0.5'],
  ])('標準の YAML パーサが別の値に読むものは引用して書く (%s)', (_name, value) => {
    // このパーサは引用が無くても同じ値を読むので、往復では確かめられない。
    // export した Markdown は他の道具にも読まれるので、出力そのものを見る。
    expect(stringifyFrontmatter([['title', value]], '')).toBe(`---\ntitle: '${value}'\n---\n`);
  });

  it('plain という名前のキーがあっても写像のまま書く', () => {
    // 目印を「plain というキーがあるか」で見ていると、この添付 1 つで写像全体が
    // 1 行のスカラに化け、他の添付の public_id が黙って落ちる。
    const { data } = roundTrip([['media', { plain: 'x', 'a.png': 'y' }]]);
    expect(data.media).toEqual({ plain: 'x', 'a.png': 'y' });
  });

  it('並びと写像も往復する', () => {
    const { data } = roundTrip([
      ['tags', ['blog', "it's", '#tag']],
      ['media', { 'a b.png': 'x', 'c.png': 'y' }],
    ]);
    expect(data.tags).toEqual(['blog', "it's", '#tag']);
    expect(data.media).toEqual({ 'a b.png': 'x', 'c.png': 'y' });
  });

  it('本文をそのまま繋ぐ', () => {
    expect(roundTrip([['title', 'あ']], '改行なし').body).toBe('改行なし');
    expect(roundTrip([['title', 'あ']], '').body).toBe('');
  });

  it('引用符なしで書けない値を plain に渡したら投げる (呼び出し側の誤り)', () => {
    expect(() => stringifyFrontmatter([['a', plain('x: y')]], '')).toThrow();
  });
});

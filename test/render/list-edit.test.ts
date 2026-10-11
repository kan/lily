import { describe, expect, it } from 'vitest';
import { listEnter, listIndent, replacement } from '../../src/core/render/list-edit.ts';
import type { Edited, TextRange } from '../../src/core/render/list-edit.ts';

/**
 * `|` をカーソルとして読み、結果も `|` 入りで返す。**2 つ書くと選択範囲。**
 * 本文と位置を別々に比べると、位置のずれが数字の違いにしか見えない。
 */
function run(marked: string, edit: (value: string, selection: TextRange) => Edited | null): string | null {
  const start = marked.indexOf('|');
  if (start === -1) throw new Error(`カーソルの目印が無い: ${marked}`);
  const second = marked.indexOf('|', start + 1);
  const end = second === -1 ? start : second - 1;

  const edited = edit(marked.replaceAll('|', ''), { start, end });
  if (edited === null) return null;

  const { value } = edited;
  return edited.start === edited.end
    ? `${value.slice(0, edited.start)}|${value.slice(edited.start)}`
    : `${value.slice(0, edited.start)}|${value.slice(edited.start, edited.end)}|${value.slice(edited.end)}`;
}

const enter = (marked: string) => run(marked, listEnter);
const indent = (marked: string) => run(marked, (value, selection) => listIndent(value, selection, 1));
const outdent = (marked: string) => run(marked, (value, selection) => listIndent(value, selection, -1));

describe('listEnter (リストの上での改行)', () => {
  it('次の行に同じ印を置く', () => {
    expect(enter('- a|')).toBe('- a\n- |');
    expect(enter('* a|')).toBe('* a\n* |');
    expect(enter('  + a|')).toBe('  + a\n  + |');
  });

  it('行の途中なら、後ろを次の項目へ送る', () => {
    expect(enter('- ab|cd\n- e')).toBe('- ab\n- |cd\n- e');
  });

  it('選択範囲は置き換える', () => {
    expect(enter('- a|bc|d')).toBe('- a\n- |d');
  });

  it('番号は次へ進め、後ろを振り直す', () => {
    expect(enter('1. a|\n2. b\n3. c')).toBe('1. a\n2. |\n3. b\n4. c');
    expect(enter('1) a|')).toBe('1) a\n2) |');
  });

  it('桁が上がっても、カーソルは印の後ろにいる', () => {
    expect(enter('8. a|\n9. b')).toBe('8. a\n9. |\n10. b');
    expect(enter('9. a|')).toBe('9. a\n10. |');
  });

  it('開始番号は残す', () => {
    expect(enter('5. a|\n6. b')).toBe('5. a\n6. |\n7. b');
  });

  it('子のリストの番号は親と別に数える', () => {
    expect(enter('1. a|\n   1. x\n   2. y\n2. b')).toBe('1. a\n2. |\n   1. x\n   2. y\n3. b');
  });

  it('空行を挟んだ項目まで振り直す', () => {
    expect(enter('1. a|\n\n2. b')).toBe('1. a\n2. |\n\n3. b');
  });

  it('段落で切れた先の別のリストには触らない', () => {
    expect(enter('1. a|\n\n段落\n\n1. b')).toBe('1. a\n2. |\n\n段落\n\n1. b');
    expect(enter('1. x\n\n段落\n1. a|\n2. b')).toBe('1. x\n\n段落\n1. a\n2. |\n3. b');
  });

  it('空行が無くても、見出しや引用の先は別のリスト', () => {
    expect(enter('1. a|\n## h\n1. b\n1. c')).toBe('1. a\n2. |\n## h\n1. b\n1. c');
    expect(enter('1. a|\n> q\n1. b')).toBe('1. a\n2. |\n> q\n1. b');
    expect(enter('1. a|\n```\n5. x\n5. y\n```')).toBe('1. a\n2. |\n```\n5. x\n5. y\n```');
  });

  it('区切りが違えば別のリスト', () => {
    expect(enter('1. a|\n2. b\n\n1) c\n2) d')).toBe('1. a\n2. |\n3. b\n\n1) c\n2) d');
  });

  it('項目の中のコードブロックは振り直さず、その先は続ける', () => {
    expect(enter('1. step|\n   ```\n   1. foo\n   1. foo\n   ```\n2. next')).toBe(
      '1. step\n2. |\n   ```\n   1. foo\n   1. foo\n   ```\n3. next',
    );
    expect(enter('1. a|\n\n   ```\n   7. keep\n\n   7. keep\n   ```\n\n2. b')).toBe(
      '1. a\n2. |\n\n   ```\n   7. keep\n\n   7. keep\n   ```\n\n3. b',
    );
  });

  it('チェックボックスは空で続ける', () => {
    expect(enter('- [x] 済|')).toBe('- [x] 済\n- [ ] |');
  });

  it('中身の無い項目ではリストを抜ける', () => {
    expect(enter('- a\n- |')).toBe('- a\n|');
    expect(enter('- [ ] |')).toBe('|');
    expect(enter('1. a\n2. |\n3. b')).toBe('1. a\n|\n2. b');
  });

  it('字下げされた中身の無い項目は、段を 1 つ上げる', () => {
    expect(enter('- a\n  - |')).toBe('- a\n- |');
    expect(enter('1. a\n   1. b\n   2. |')).toBe('1. a\n   1. b\n2. |');
  });

  it('リストでなければ既定の改行に任せる', () => {
    expect(enter('本文|')).toBeNull();
    expect(enter('-a|')).toBeNull();
    expect(enter('**強調** の続き|')).toBeNull();
    // 水平線
    expect(enter('* * *|')).toBeNull();
    expect(enter('- - -|')).toBeNull();
  });

  it('印より前では既定の改行に任せる', () => {
    expect(enter('|- a')).toBeNull();
    expect(enter('  |- a')).toBeNull();
    expect(enter('- [ |] a')).toBeNull();
  });

  it('コードブロックの中では何もしない', () => {
    expect(enter('```\n- a|\n```')).toBeNull();
    expect(enter('~~~\n- a|')).toBeNull();
    // 項目の中に字下げして置いたコードブロック
    expect(enter('- a\n  - b\n    ```\n    - x|\n    ```')).toBeNull();
    expect(indent('- a\n  - b\n    ```\n    - x\n    - y|\n    ```')).toBeNull();
    // 開きより短い囲みや、種類の違う囲みでは閉じない
    expect(enter('````\n```\n- a|')).toBeNull();
    expect(enter('```\n~~~\n- a|')).toBeNull();
    // 閉じたあとはリスト
    expect(enter('```\ncode\n```\n- a|')).toBe('```\ncode\n```\n- a\n- |');
  });
});

describe('listIndent (段を下げる / 上げる)', () => {
  it('直前のきょうだいの中身の位置まで下げる', () => {
    expect(indent('- a\n- b|')).toBe('- a\n  - b|');
    expect(indent('1. a\n2. b|')).toBe('1. a\n   1. b|');
    expect(indent('10. a\n11. b|')).toBe('10. a\n    1. b|');
  });

  it('きょうだいが前に無ければ下げない', () => {
    expect(indent('- a|')).toBe('- a|');
    expect(indent('- a\n  - b|')).toBe('- a\n  - b|');
    // 段落は親になれない
    expect(indent('段落\n- a|')).toBe('段落\n- a|');
  });

  it('既にある子のリストへ加わる', () => {
    expect(indent('- a\n  - x\n- b|')).toBe('- a\n  - x\n  - b|');
    expect(indent('1. a\n   1. x\n2. b|\n3. c')).toBe('1. a\n   1. x\n   2. b|\n2. c');
  });

  it('下げた項目の番号は 1 から、元のリストは詰める', () => {
    expect(indent('1. a\n2. b|\n3. c')).toBe('1. a\n   1. b|\n2. c');
  });

  it('子と続きの行を連れていく', () => {
    expect(indent('- a\n- b|\n  - c\n  続き\n- d')).toBe('- a\n  - b|\n    - c\n    続き\n- d');
    expect(outdent('- a\n  - b|\n    - c\n- d')).toBe('- a\n- b|\n  - c\n- d');
  });

  it('親の位置まで上げる', () => {
    expect(outdent('- a\n  - b|')).toBe('- a\n- b|');
    expect(outdent('1. a\n   1. b|\n2. c')).toBe('1. a\n2. b|\n3. c');
    expect(outdent('1. a\n   - x\n     - y|')).toBe('1. a\n   - x\n   - y|');
  });

  it('いちばん上の段では Shift+Tab を既定の動きに任せる (入力欄から出られるように)', () => {
    expect(outdent('- a|')).toBeNull();
    expect(outdent('- a\n- b|')).toBeNull();
  });

  it('上げたあとに残った弟は、新しい子のリストとして 1 から数える', () => {
    expect(outdent('1. a\n   1. b|\n   2. c\n   3. d')).toBe('1. a\n2. b|\n   1. c\n   2. d');
    expect(enter('1. a\n   1. b\n   2. |\n   3. c')).toBe('1. a\n   1. b\n2. |\n   1. c');
  });

  it('印の後ろの空白が広い項目には、その中身の位置まで下げる', () => {
    expect(indent('-   a\n-   b|')).toBe('-   a\n    -   b|');
  });

  it('タブの字下げは幅 4 として数える', () => {
    expect(indent('- a\n\t- x\n\t- y|')).toBe('- a\n\t- x\n      - y|');
    expect(outdent('- a\n\t- x|')).toBe('- a\n- x|');
  });

  it('段落で切れた前のリストの子にはならない', () => {
    expect(indent('1. a\n\n段落\n2. b|')).toBe('1. a\n\n段落\n2. b|');
  });

  it('リストから離れた字下げの行は連れていかない', () => {
    expect(indent('- a\n- b|\n\n\n    code\n\npara')).toBe('- a\n  - b|\n\n\n    code\n\npara');
    // 空行 1 つなら、その項目の続きの段落
    expect(indent('- a\n- b|\n\n  続き')).toBe('- a\n  - b|\n\n    続き');
  });

  it('親のいない字下げは行頭へ戻す', () => {
    expect(outdent('  - a|')).toBe('- a|');
  });

  it('選んだ行をまとめて動かす', () => {
    expect(indent('- a\n- |b\n- c|\n- d')).toBe('- a\n  - |b\n  - c|\n- d');
    expect(outdent('- a\n  - |b\n  - c|\n- d')).toBe('- a\n- |b\n- c|\n- d');
  });

  it('行頭で終わる選択は、その行を動かさない', () => {
    expect(indent('- a\n|- b\n|- c')).toBe('- a\n  |- b\n|- c');
  });

  it('カーソルは中身に対して同じ位置に残る', () => {
    expect(indent('- a\n- b|c')).toBe('- a\n  - b|c');
    expect(outdent('- a\n  |- b')).toBe('- a\n|- b');
    expect(outdent('- a\n |  - b')).toBe('- a\n|- b');
  });

  it('リストでなければ Tab を既定の動きに任せる', () => {
    expect(indent('本文|')).toBeNull();
    expect(outdent('本文|')).toBeNull();
    expect(indent('```\n- a\n- b|\n```')).toBeNull();
  });
});

describe('replacement (差分だけを入れる)', () => {
  function apply(before: string, after: string): string {
    const { start, end, text } = replacement(before, after);
    return before.slice(0, start) + text + before.slice(end);
  }

  it('変わったところだけを返す', () => {
    expect(replacement('- a\n- b', '- a\n  - b')).toEqual({ start: 4, end: 4, text: '  ' });
    expect(replacement('- a\n  - b', '- a\n- b')).toEqual({ start: 4, end: 6, text: '' });
  });

  it('当てると編集後の本文になる', () => {
    for (const [before, after] of [
      ['1. a\n2. b\n3. c', '1. a\n2. \n3. b\n4. c'],
      ['aaa', 'aa'],
      ['aa', 'aaa'],
      ['', 'x'],
      ['same', 'same'],
    ] as const) {
      expect(apply(before, after)).toBe(after);
    }
  });
});

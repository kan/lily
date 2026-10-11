/**
 * 入力欄でのリストの編集（改行で続ける / 段を下げる / 段を上げる）。
 *
 * **DOM を触らない。** 本文と選択範囲を受け取って、編集後の本文と選択範囲を返す。
 * キーの受け方と textarea への反映は `admin/views/MarkdownEditor.vue` の仕事。
 * ここに置いてあるのは、管理画面（`src/admin`）がテストの型検査の外にあるため
 * （`blockPadding` と同じ理由）。
 *
 * **番号は振り直す。** 途中に項目を足したり段を動かしたりすると、後ろの番号が
 * 重複する。Markdown は最初の番号しか見ないので描画は変わらないが、原稿の番号が
 * 嘘になる。振り直すのは触ったリスト（空行 1 つまでで繋がる範囲）だけで、
 * 各リストの最初の番号は開始番号として残す。
 */

export type TextRange = { readonly start: number; readonly end: number };

/** 編集後の本文と、そのとき選んでおく範囲。 */
export type Edited = TextRange & { readonly value: string };

type Item = {
  /** 行頭の空白の幅（タブは 4 の倍数まで進める）。段の比較に使う。 */
  readonly indent: number;
  /** 行頭の空白の文字数。行を切るときに使う。 */
  readonly lead: number;
  /** `-` や `12.`。 */
  readonly marker: string;
  /** 番号付きなら番号。箇条書きなら null。 */
  readonly number: number | null;
  /** 番号の後ろの `.` か `)`。箇条書きなら空。 */
  readonly delimiter: string;
  /** 中身が始まる桁。**子の項目はここまで字下げしないと子にならない。** */
  readonly content: number;
  /** 打てる中身が始まる文字位置（字下げ + 印 + 空白 + チェックボックス）。 */
  readonly prefix: number;
  readonly task: boolean;
};

const ITEM = /^[ \t]*([-*+]|(\d{1,9})([.)]))( +)(\[[ xX]\] +)?/;
/** `* * *` や `- - -` は水平線。箇条書きとして続けない。 */
const RULE = /^ {0,3}([-*_])(?: *\1){2,} *$/;
const FENCE = /^([ \t]*)(`{3,}|~{3,})(.*)$/;
/** 行頭から始まる見出しと引用。**空行が無くてもリストを終わらせる。** */
const BREAK = /^(?:#{1,6}(?:[ \t]|$)|>)/;

/** 行頭の空白。`width` は桁、`length` は文字数（タブがあると食い違う）。 */
function leading(line: string): { width: number; length: number } {
  let width = 0;
  let length = 0;
  for (const char of line) {
    if (char === ' ') width++;
    else if (char === '\t') width += 4 - (width % 4);
    else break;
    length++;
  }
  return { width, length };
}

function parseItem(line: string | undefined): Item | null {
  if (line === undefined || RULE.test(line)) return null;
  const matched = ITEM.exec(line);
  if (matched === null) return null;

  const [whole, marker = '', digits, delimiter = '', spaces = ' ', task] = matched;
  const { width, length } = leading(line);
  return {
    indent: width,
    lead: length,
    marker,
    number: digits === undefined ? null : Number(digits),
    delimiter,
    // 印の後ろの空白は 4 つまでが中身の位置を決める（5 つ以上は字下げコード扱いで 1）。
    content: width + marker.length + (spaces.length <= 4 ? spaces.length : 1),
    prefix: whole.length,
    task: task !== undefined,
  };
}

function isBlank(line: string | undefined): boolean {
  return line === undefined || line.trim() === '';
}

/**
 * 行の種類。
 *
 * - `code`: 字下げされたコードブロックの中（囲みの行も含む）。リストの一部だが、
 *   **中の `1. ` は項目ではない**ので読まないし書き換えない
 * - `break`: リストを終わらせる行。行頭から始まる見出し・引用・水平線・コードブロック
 * - `text`: それ以外
 */
type Kind = 'text' | 'code' | 'break';

function classify(lines: readonly string[]): Kind[] {
  let fence: { char: string; length: number; kind: Kind } | null = null;

  return lines.map((line) => {
    const [, indent = '', marks = '', info = ''] = FENCE.exec(line) ?? [];
    if (fence !== null) {
      const { kind } = fence;
      // 閉じるのは、同じ記号で開きより短くなく、後ろに何も付かない行だけ。
      if (marks.startsWith(fence.char) && marks.length >= fence.length && info.trim() === '') {
        fence = null;
      }
      return kind;
    }
    if (marks !== '') {
      fence = { char: marks.charAt(0), length: marks.length, kind: indent === '' ? 'break' : 'code' };
      return fence.kind;
    }
    return BREAK.test(line) || (leading(line).length === 0 && RULE.test(line)) ? 'break' : 'text';
  });
}

/** その行の項目。**コードの中の行は、形が `1. ` でも項目として読まない。** */
function itemAt(lines: readonly string[], kinds: readonly Kind[], index: number): Item | null {
  return kinds[index] === 'text' ? parseItem(lines[index]) : null;
}

/** 2 つの文字列の末尾が何文字同じか。`limit` 文字までしか数えない。 */
function commonSuffix(a: string, b: string, limit: number): number {
  let count = 0;
  while (count < limit && a[a.length - 1 - count] === b[b.length - 1 - count]) count++;
  return count;
}

type Point = { readonly line: number; readonly column: number };

function locate(lines: readonly string[], offset: number): Point {
  let rest = offset;
  for (const [index, line] of lines.entries()) {
    if (rest <= line.length) return { line: index, column: rest };
    rest -= line.length + 1;
  }
  const last = lines.length - 1;
  return { line: last, column: lines[last]?.length ?? 0 };
}

function offsetOf(lines: readonly string[], point: Point): number {
  let offset = point.column;
  for (const line of lines.slice(0, point.line)) offset += line.length + 1;
  return offset;
}

/**
 * 行数が同じ 2 つの本文のあいだで位置を写す。
 *
 * **変わるのは行頭（字下げと番号）だけ**という前提で、行末から数えて同じところへ
 * 置く。変わった部分の中にあった位置は、中身の先頭までに丸める。
 */
function remap(before: readonly string[], after: readonly string[], offset: number): number {
  const { line, column } = locate(before, offset);
  const old = before[line] ?? '';
  const now = after[line] ?? '';

  const kept = commonSuffix(old, now, Math.min(old.length, now.length));
  const fromEnd = old.length - column;
  const moved = fromEnd <= kept ? now.length - fromEnd : Math.min(column, now.length - kept);
  return offsetOf(after, { line, column: moved });
}

/**
 * `index` の行を含むリストの範囲（行番号、両端を含む）。
 *
 * 空行 1 つは跨ぐ（項目のあいだを空けたリスト）。ただし**空行の下がリストの項目か
 * 字下げされた行のときだけ。** 字下げの無い段落が空行のあとに来たら、リストは
 * そこで終わっている。`break` の行は空行が無くても跨がない。
 */
function blockAround(lines: readonly string[], kinds: readonly Kind[], index: number): [number, number] {
  /** 空行のあとに来ても、まだリストの中だと言える行か。 */
  const continues = (at: number): boolean => {
    const line = lines[at] ?? '';
    if (kinds[at] === 'code') return true;
    if (kinds[at] !== 'text' || isBlank(line)) return false;
    return leading(line).length > 0 || parseItem(line) !== null;
  };

  const joins = (at: number): boolean => {
    const kind = kinds[at];
    if (kind === undefined || kind === 'break') return false;
    if (kind === 'code' || !isBlank(lines[at])) return true;
    // 空行。下の行がリストを続けていて、上の行がリストを切っていないこと。
    return continues(at + 1) && !isBlank(lines[at - 1]) && kinds[at - 1] !== 'break';
  };

  let from = index;
  let to = index;
  while (joins(from - 1)) from--;
  while (joins(to + 1)) to++;
  return [from, to];
}

/**
 * `around` の行を含むリストの番号を振り直す。
 *
 * 段ごとに「次の番号」を積んで上から歩く。**各リストの最初の番号は変えない**
 * （5 から始めたリストは 5 から）。ただし `fresh` の行がリストの先頭になるときは
 * 1 にする —— 段を動かした項目は元のリストでの番号を持ち込んでいるし、動かした
 * 項目の下に残った弟は、新しい子のリストの先頭になるため。
 *
 * 印の種類（箇条書き / `1.` / `1)`）が変わったら、同じ段でも別のリストとして数える。
 */
function renumber(
  lines: readonly string[],
  around: number,
  fresh: ReadonlySet<number> = new Set(),
): string[] {
  const kinds = classify(lines);
  const [from, to] = blockAround(lines, kinds, around);
  const out = [...lines];
  const stack: { indent: number; kind: string; next: number }[] = [];

  for (let index = from; index <= to; index++) {
    const line = lines[index] ?? '';
    const item = itemAt(lines, kinds, index);
    if (item === null) continue;

    while ((stack.at(-1)?.indent ?? -1) > item.indent) stack.pop();

    const start = fresh.has(index) ? 1 : (item.number ?? 0);
    let top = stack.at(-1);
    if (top === undefined || top.indent < item.indent) {
      top = { indent: item.indent, kind: item.delimiter, next: start };
      stack.push(top);
    } else if (top.kind !== item.delimiter) {
      top.kind = item.delimiter;
      top.next = start;
    }

    if (item.number !== null) {
      const body = line.slice(item.lead + item.marker.length);
      out[index] = `${line.slice(0, item.lead)}${top.next}${item.delimiter}${body}`;
      top.next++;
    }
  }
  return out;
}

/**
 * リストの項目の上で改行したときの編集。**リストの外なら null**（既定の改行に任せる）。
 *
 * - 中身のある項目 → 次の行に同じ印を置く（番号は次へ、チェックボックスは空で）
 * - 中身の無い項目 → リストを抜ける。字下げされていれば段を 1 つ上げ、
 *   いちばん上の段なら印を消す
 *
 * 印より前にカーソルがあるときも null。そこでの改行は「この項目の前に行を空ける」
 * であって、項目を足す操作ではない。
 */
export function listEnter(value: string, selection: TextRange): Edited | null {
  const lines = value.split('\n');
  const at = locate(lines, selection.start);
  const line = lines[at.line] ?? '';
  const item = parseItem(line);
  if (item === null || at.column < item.prefix || classify(lines)[at.line] !== 'text') return null;

  if (selection.start === selection.end && isBlank(line.slice(item.prefix))) {
    if (item.indent > 0) return listIndent(value, selection, -1);

    const cleared = lines.map((kept, index) => (index === at.line ? '' : kept));
    const start = selection.start - at.column;
    return { value: renumber(cleared, at.line).join('\n'), start, end: start };
  }

  const marker = item.number === null ? item.marker : `${item.number + 1}${item.delimiter}`;
  const prefix = `${line.slice(0, item.lead)}${marker} ${item.task ? '[ ] ' : ''}`;
  const inserted = `${value.slice(0, selection.start)}\n${prefix}${value.slice(selection.end)}`;

  const before = inserted.split('\n');
  const after = renumber(before, at.line + 1);
  const caret = remap(before, after, selection.start + 1 + prefix.length);
  return { value: after.join('\n'), start: caret, end: caret };
}

/**
 * 選んでいる項目の段を下げる（`1`）/ 上げる（`-1`）。**先頭の行がリストの項目で
 * なければ null**（Tab を既定の動き = フォーカス移動に任せる）。
 *
 * **字下げの幅は決め打ちにしない。** 子になるには親の中身の位置まで下げる必要が
 * あり、それは `- ` なら 2、`1. ` なら 3、`10. ` なら 4 と印で変わる。下げるときは
 * 直前のきょうだいの中身の位置へ、上げるときは親の位置へ揃える。
 *
 * 子の項目と続きの行は一緒に動かす。
 *
 * 動かせないときの返し方は向きで違う。**下げられない**（きょうだいが前に無い）ときは
 * 本文を変えずに返して Tab を飲む —— リストを打っている最中に押した Tab で
 * フォーカスが飛ぶのを避ける。**上げられない**（もういちばん上）ときは null を返して
 * Shift+Tab を既定の動きに任せる。両方飲むと、リストしか無い本文ではキーボードで
 * 入力欄から出られなくなる。
 */
export function listIndent(value: string, selection: TextRange, direction: 1 | -1): Edited | null {
  const lines = value.split('\n');
  const first = locate(lines, selection.start).line;
  // 先に形を見る。リストでない行の Tab で、本文全体の種類分けまで走らせない。
  if (parseItem(lines[first]) === null) return null;
  const kinds = classify(lines);
  const item = itemAt(lines, kinds, first);
  if (item === null) return null;

  // この項目より上にある項目を、近い順に。
  const [blockStart] = blockAround(lines, kinds, first);
  const above: Item[] = [];
  for (let index = first - 1; index >= blockStart; index--) {
    const found = itemAt(lines, kinds, index);
    if (found !== null) above.push(found);
  }

  let target: number;
  if (direction === 1) {
    // 同じ段の項目が前にあるときだけ、その子になれる。
    const sibling = above.find((other) => other.indent <= item.indent);
    target = sibling?.indent === item.indent ? sibling.content : item.indent;
  } else {
    target = above.find((other) => other.indent < item.indent)?.indent ?? 0;
  }

  const delta = target - item.indent;
  if (delta === 0) return direction === 1 ? { value, ...selection } : null;

  // 行頭で終わる選択は、その行を含めない（上の行までを選んだつもりの操作）。
  const end = locate(lines, selection.end);
  let last = end.column === 0 && end.line > first ? end.line - 1 : end.line;

  // 最後の行にぶら下がっている行（子の項目と続きの行）も連れていく。
  // **リストの範囲の外へは出ない**（空行 2 つ先の字下げコードは別物）。
  const [, blockEnd] = blockAround(lines, kinds, last);
  const base = leading(lines[last] ?? '').width;
  let below = last + 1;
  for (; below <= blockEnd; below++) {
    const line = lines[below] ?? '';
    if (isBlank(line)) continue;
    if (leading(line).width <= base) break;
    last = below;
  }

  const shifted = lines.map((line, index) => {
    if (index < first || index > last || isBlank(line)) return line;
    const { width, length } = leading(line);
    return ' '.repeat(Math.max(0, width + delta)) + line.slice(length);
  });
  // `below` は動かした範囲のすぐ下の行。段を上げたとき、そこに残った弟が
  // 新しい子のリストの先頭になる。
  const after = renumber(shifted, first, new Set([first, below]));

  return {
    value: after.join('\n'),
    start: remap(lines, after, selection.start),
    end: remap(lines, after, selection.end),
  };
}

/**
 * 2 つの本文の違いを「`[start, end)` を `text` に置き換える」の形にする。
 *
 * **textarea には差分だけを入れる**ため。全文を入れ直すと、取り消し 1 回で戻る
 * 範囲が本文全体になり、スクロール位置も飛ぶ。
 */
export function replacement(before: string, after: string): TextRange & { readonly text: string } {
  const shorter = Math.min(before.length, after.length);
  let head = 0;
  while (head < shorter && before[head] === after[head]) head++;

  const tail = commonSuffix(before, after, shorter - head);
  return { start: head, end: before.length - tail, text: after.slice(head, after.length - tail) };
}

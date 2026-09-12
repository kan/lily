/**
 * portable export / import の frontmatter。**YAML のごく一部だけを扱う。**
 *
 * 汎用の YAML パーサを入れていないのは、この形式が lily の契約そのものだから。
 * 書く側 (export) もここなので、往復で形が変わらないことを自分で保証できる。
 * 代償として書ける記法は狭いが、**対応していない記法は黙って別物として解釈せず
 * 拒否する**ので、失敗は必ず表に出る。
 *
 * 読み書きできるのは次だけ:
 *
 * ```yaml
 * key: 値                  # プレーンスカラ (行末まで。`#` は本文の一部)
 * key: 'クオート'          # '' で ' を表す
 * key: "改行\nあり"        # \\ \" \n \r \t \/ \uXXXX
 * key:                     # 値なし → null (「書いていない」と同じ扱い)
 * key: [a, b]              # フローシーケンス (スカラのみ)
 * key:                     # ブロックシーケンス
 *   - a
 *   - b
 * key:                     # ブロックマッピング (値はスカラのみ)
 *   name: 値
 * ```
 *
 * 対応しないもの (すべてエラーにする): ネスト・アンカー / エイリアス・タグ・
 * ブロックスカラ (`|` `>`)・複数ドキュメント・行末コメント。
 * **行頭コメント (`#` で始まる行) だけは読み飛ばす。**
 *
 * 汎用の YAML が要るようになったら、差し替えるのはこのファイル 1 つ。
 */
import { err, ok, type Result } from '../result.ts';

/** 読み書きできる値。スカラ・文字列の並び・文字列への写像だけ。 */
export type FmValue = string | readonly string[] | Readonly<Record<string, string>> | null;

/**
 * 引用符を付けずに書く値。日時のように、**標準の YAML パーサにも同じ型で
 * 読ませたい**ものに使う (`date: 2026-08-24T00:00:00.000Z`)。`plain()` で作る。
 *
 * 引用が要る文字列を渡すと `stringifyFrontmatter` が投げる (呼び出し側の誤り)。
 *
 * **目印を symbol にしてあるのは、書き出す値と紛れないため。** `plain` という
 * 名前のキーで見分けていると、`media` の写像に `plain` という名前のファイルが
 * 入った瞬間、その記事の添付が写像ごと 1 行のスカラに化ける。
 */
const PLAIN = Symbol('lily.frontmatter.plain');

export type FmPlain = { readonly [PLAIN]: string };

export function plain(value: string): FmPlain {
  return { [PLAIN]: value };
}

export type FrontmatterErrorCode =
  /** 先頭が `---` で始まっていない。 */
  | 'missing-open'
  /** 閉じの `---` が無い。 */
  | 'missing-close'
  | 'invalid-line'
  | 'duplicate-key'
  /** 最上位のキーが字下げされている。 */
  | 'unexpected-indent'
  /** 同じブロックの中で字下げが揃っていない。 */
  | 'inconsistent-indent'
  /** 対応していない YAML の記法。 */
  | 'unsupported-syntax'
  | 'unterminated-quote'
  | 'invalid-escape'
  | 'empty-value'
  /** `__proto__` のように、オブジェクトのキーとして特別扱いされる名前。 */
  | 'unsafe-key';

export type FrontmatterError = {
  readonly code: FrontmatterErrorCode;
  /** 1 始まりの行番号。 */
  readonly line: number;
  readonly detail?: string;
};

export type FrontmatterDoc = {
  readonly data: Readonly<Record<string, FmValue>>;
  /** `---` の次の行から末尾まで。**1 バイトも触らない。** */
  readonly body: string;
};

const DELIMITER = '---';

/** 最上位のキーに使える形。ここを緩めると本文の `:` を含む行と見分けが付かなくなる。 */
const KEY = /^[A-Za-z_][A-Za-z0-9_-]*$/;

/**
 * オブジェクトのキーとして受け付けない名前。
 *
 * `__proto__` は `KEY` を満たすが、素のオブジェクトに代入すると prototype の
 * setter が動くだけで**キーが生えない**。読めているのに `Object.keys()` に出ない
 * ので、「知らないキーは拒否する」の網をすり抜けて**黙って消える**
 * (このファイル自身は Object.create(null) を使うが、zod や JSON を通った先まで
 * 面倒を見きれないので、入口で断る)。
 */
const UNSAFE_KEYS = new Set(['__proto__']);

/** プレーンスカラとして始められない文字 (YAML の指示子)。 */
const INDICATORS = /^[[\]{}|>&*!%@`]/;

export function parseFrontmatter(text: string): Result<FrontmatterDoc, FrontmatterError> {
  const lines = text.split('\n');
  if (chomp(lines[0] ?? '') !== DELIMITER) return err({ code: 'missing-open', line: 1 });

  let close = -1;
  for (let i = 1; i < lines.length; i++) {
    if (chomp(lines[i] as string) === DELIMITER) {
      close = i;
      break;
    }
  }
  if (close === -1) return err({ code: 'missing-close', line: lines.length });

  // 本文は行に分けたものを繋ぎ直すだけ。CRLF もそのまま残る。
  const body = lines.slice(close + 1).join('\n');

  // prototype を持たせない。`key in data` が継承したプロパティを拾うと、
  // `constructor` のようなキーが duplicate-key に化ける。
  const data: Record<string, FmValue> = Object.create(null);
  let i = 1;
  while (i < close) {
    const line = chomp(lines[i] as string);
    const at = i + 1;
    i++;

    if (line.trim() === '' || /^\s*#/.test(line)) continue;
    if (/^\s/.test(line)) return err({ code: 'unexpected-indent', line: at });

    const separator = line.indexOf(':');
    if (separator === -1) return err({ code: 'invalid-line', line: at, detail: line });
    const key = line.slice(0, separator).trim();
    if (!KEY.test(key)) return err({ code: 'invalid-line', line: at, detail: key });
    if (UNSAFE_KEYS.has(key)) return err({ code: 'unsafe-key', line: at, detail: key });
    if (key in data) return err({ code: 'duplicate-key', line: at, detail: key });

    const inline = line.slice(separator + 1).trim();
    if (inline !== '') {
      const value = inline.startsWith('[')
        ? parseFlowSequence(inline, at)
        : readScalar(inline, at);
      if (!value.ok) return value;
      data[key] = value.value;
      continue;
    }

    // 値が無い。続く字下げ行がブロック、無ければ null。
    const block: { text: string; line: number }[] = [];
    while (i < close) {
      const next = chomp(lines[i] as string);
      if (next.trim() === '') {
        i++;
        continue;
      }
      if (!/^\s/.test(next)) break;
      if (!/^\s*#/.test(next)) block.push({ text: next, line: i + 1 });
      i++;
    }
    if (block.length === 0) {
      data[key] = null;
      continue;
    }

    const indent = indentOf(block[0]?.text as string);
    for (const entry of block) {
      if (indentOf(entry.text) !== indent) {
        return err({ code: 'inconsistent-indent', line: entry.line, detail: entry.text });
      }
    }

    const parsed = /^-(\s|$)/.test((block[0] as { text: string }).text.trim())
      ? parseBlockSequence(block)
      : parseBlockMapping(block);
    if (!parsed.ok) return parsed;
    data[key] = parsed.value;
  }

  return ok({ data, body });
}

function parseBlockSequence(
  block: readonly { text: string; line: number }[],
): Result<string[], FrontmatterError> {
  const items: string[] = [];
  for (const entry of block) {
    const text = entry.text.trim();
    if (!/^-(\s|$)/.test(text)) {
      return err({ code: 'invalid-line', line: entry.line, detail: text });
    }
    const rest = text.slice(1).trim();
    if (rest === '') return err({ code: 'empty-value', line: entry.line });
    const value = readScalar(rest, entry.line);
    if (!value.ok) return value;
    items.push(value.value);
  }
  return ok(items);
}

function parseBlockMapping(
  block: readonly { text: string; line: number }[],
): Result<Record<string, string>, FrontmatterError> {
  const map: Record<string, string> = Object.create(null);
  for (const entry of block) {
    const text = entry.text.trim();

    // キーは引用できる。ファイル名は空白や記号を含みうるので、値と同じ規則で読む。
    let key: string;
    let rest: string;
    if (text.startsWith("'") || text.startsWith('"')) {
      const quoted = readQuoted(text, 0, entry.line);
      if (!quoted.ok) return quoted;
      key = quoted.value.value;
      rest = text.slice(quoted.value.end).trim();
      if (!rest.startsWith(':')) {
        return err({ code: 'invalid-line', line: entry.line, detail: text });
      }
      rest = rest.slice(1).trim();
    } else {
      const separator = text.indexOf(':');
      if (separator === -1) return err({ code: 'invalid-line', line: entry.line, detail: text });
      key = text.slice(0, separator).trim();
      rest = text.slice(separator + 1).trim();
    }

    if (key === '') return err({ code: 'invalid-line', line: entry.line, detail: text });
    if (UNSAFE_KEYS.has(key)) return err({ code: 'unsafe-key', line: entry.line, detail: key });
    if (key in map) return err({ code: 'duplicate-key', line: entry.line, detail: key });
    if (rest === '') return err({ code: 'empty-value', line: entry.line, detail: key });

    const value = readScalar(rest, entry.line);
    if (!value.ok) return value;
    map[key] = value.value;
  }
  return ok(map);
}

/** `[a, 'b']`。中身はスカラだけで、入れ子は受け付けない。 */
function parseFlowSequence(text: string, line: number): Result<string[], FrontmatterError> {
  const items: string[] = [];
  let i = 1;
  const skipSpaces = (): void => {
    while (i < text.length && /\s/.test(text[i] as string)) i++;
  };

  skipSpaces();
  if (text[i] === ']') {
    i++;
  } else {
    for (;;) {
      skipSpaces();
      const head = text[i];
      if (head === undefined) return err({ code: 'unsupported-syntax', line, detail: text });

      if (head === "'" || head === '"') {
        const quoted = readQuoted(text, i, line);
        if (!quoted.ok) return quoted;
        items.push(quoted.value.value);
        i = quoted.value.end;
      } else {
        let end = i;
        while (end < text.length && text[end] !== ',' && text[end] !== ']') end++;
        const value = text.slice(i, end).trim();
        if (value === '') return err({ code: 'empty-value', line, detail: text });
        if (INDICATORS.test(value)) return err({ code: 'unsupported-syntax', line, detail: value });
        items.push(value);
        i = end;
      }

      skipSpaces();
      if (text[i] === ',') {
        i++;
        continue;
      }
      if (text[i] === ']') {
        i++;
        break;
      }
      return err({ code: 'unsupported-syntax', line, detail: text });
    }
  }

  if (text.slice(i).trim() !== '') return err({ code: 'unsupported-syntax', line, detail: text });
  return ok(items);
}

/** 引用符付き / プレーンのスカラ 1 つ。`text` は前後を trim 済みであること。 */
function readScalar(text: string, line: number): Result<string, FrontmatterError> {
  if (text.startsWith("'") || text.startsWith('"')) {
    const quoted = readQuoted(text, 0, line);
    if (!quoted.ok) return quoted;
    // 引用符の後ろに何か続くのは、行末コメントか未対応の記法。どちらも拒否する。
    if (text.slice(quoted.value.end).trim() !== '') {
      return err({ code: 'unsupported-syntax', line, detail: text });
    }
    return ok(quoted.value.value);
  }
  if (INDICATORS.test(text) || /^-(\s|$)/.test(text) || /^[?:](\s|$)/.test(text)) {
    return err({ code: 'unsupported-syntax', line, detail: text });
  }
  return ok(text);
}

type Quoted = { value: string; end: number };

function readQuoted(
  text: string,
  start: number,
  line: number,
): Result<Quoted, FrontmatterError> {
  const quote = text[start];
  let i = start + 1;
  let value = '';

  if (quote === "'") {
    while (i < text.length) {
      if (text[i] === "'") {
        // '' は ' 1 つ
        if (text[i + 1] === "'") {
          value += "'";
          i += 2;
          continue;
        }
        return ok({ value, end: i + 1 });
      }
      value += text[i];
      i++;
    }
    return err({ code: 'unterminated-quote', line, detail: text.slice(start) });
  }

  while (i < text.length) {
    const char = text[i];
    if (char === '"') return ok({ value, end: i + 1 });
    if (char !== '\\') {
      value += char;
      i++;
      continue;
    }
    const escape = text[i + 1];
    switch (escape) {
      case '\\':
      case '"':
      case '/':
        value += escape;
        i += 2;
        break;
      case 'n':
        value += '\n';
        i += 2;
        break;
      case 'r':
        value += '\r';
        i += 2;
        break;
      case 't':
        value += '\t';
        i += 2;
        break;
      case 'u': {
        const hex = text.slice(i + 2, i + 6);
        if (!/^[0-9a-fA-F]{4}$/.test(hex)) {
          return err({ code: 'invalid-escape', line, detail: text.slice(i, i + 6) });
        }
        value += String.fromCharCode(Number.parseInt(hex, 16));
        i += 6;
        break;
      }
      default:
        return err({ code: 'invalid-escape', line, detail: `\\${escape ?? ''}` });
    }
  }
  return err({ code: 'unterminated-quote', line, detail: text.slice(start) });
}

/** 書き出す 1 項目。`undefined` の項目は行ごと書かない (「空欄 = 省略」に揃える)。 */
export type FmEntry = readonly [key: string, value: FmValue | FmPlain | undefined];

/**
 * frontmatter と本文を 1 つの文字列にする。
 *
 * **キーの順序は引数の順**。本文には触らない (末尾の改行も足さない) ので、
 * `body_md` をそのまま渡せば往復で 1 バイトも変わらない。
 *
 * 空の並び・空の写像は「書いていない」と同じ扱いにして省く。読み戻したときに
 * `[]` / `{}` になるか未設定になるかで挙動が変わらないよう、書く側で畳んでおく。
 */
export function stringifyFrontmatter(entries: readonly FmEntry[], body: string): string {
  const lines: string[] = [DELIMITER];

  for (const [key, value] of entries) {
    if (value === undefined || value === null) continue;
    if (!KEY.test(key)) throw new Error(`frontmatter のキーに使えない: ${key}`);

    if (typeof value === 'string') {
      lines.push(`${key}: ${emitScalar(value)}`);
      continue;
    }
    if (isPlain(value)) {
      const raw = value[PLAIN];
      if (breaksParsing(raw)) throw new Error(`引用符なしで書けない値: ${key}: ${raw}`);
      lines.push(`${key}: ${raw}`);
      continue;
    }
    if (Array.isArray(value)) {
      if (value.length === 0) continue;
      lines.push(`${key}:`);
      for (const item of value as readonly string[]) lines.push(`  - ${emitScalar(item)}`);
      continue;
    }

    const map = value as Readonly<Record<string, string>>;
    const keys = Object.keys(map);
    if (keys.length === 0) continue;
    lines.push(`${key}:`);
    for (const name of keys) lines.push(`  ${emitScalar(name)}: ${emitScalar(map[name] as string)}`);
  }

  lines.push(DELIMITER, '');
  return lines.join('\n') + body;
}

function isPlain(value: FmValue | FmPlain): value is FmPlain {
  return typeof value === 'object' && value !== null && PLAIN in value;
}

/**
 * 引用符を付けるか。
 *
 * **このパーサが読めるかどうかだけでは決めない。** 標準の YAML パーサが真偽値や
 * 数値として読んでしまう文字列も引用する (export した Markdown は他の道具にも
 * 読まれうるので、型が変わって見えないようにする)。
 */
function needsQuote(value: string): boolean {
  if (breaksParsing(value)) return true;
  // 標準の YAML では `#` から行末までがコメントになる (行頭でも、空白の後でも)。
  // こちらは本文として読むので、引用しないと道具によって値が変わってしまう。
  if (value.startsWith('#') || /\s#/.test(value)) return true;
  if (/^(true|false|null|~|yes|no|on|off)$/i.test(value)) return true;
  if (/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(value)) return true;
  if (/^0[xob][0-9a-fA-F_]+$/i.test(value)) return true;
  return false;
}

/** このパーサが元の値として読み戻せなくなる形。 */
function breaksParsing(value: string): boolean {
  if (value === '') return true;
  if (value !== value.trim()) return true;
  if (INDICATORS.test(value)) return true;
  // 引用符で始まる値をそのまま書くと、読み戻すときに引用符ごと剥がれる。
  if (value.startsWith("'") || value.startsWith('"')) return true;
  if (/^[-?:](\s|$)/.test(value)) return true;
  if (/[\u0000-\u001F\u007F]/.test(value)) return true;
  if (value.includes(': ') || value.endsWith(':')) return true;
  return false;
}

function emitScalar(value: string): string {
  if (!needsQuote(value)) return value;
  // 改行や制御文字が入るときだけ二重引用符 (エスケープが要る)。
  if (/[\u0000-\u001F\u007F]/.test(value)) {
    const escaped = value
      .replace(/\\/g, '\\\\')
      .replace(/"/g, '\\"')
      .replace(/\n/g, '\\n')
      .replace(/\r/g, '\\r')
      .replace(/\t/g, '\\t')
      // 残りの制御文字は \uXXXX に落とす
      .replace(/[\u0000-\u001F\u007F]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);
    return `"${escaped}"`;
  }
  return `'${value.replace(/'/g, "''")}'`;
}

function chomp(line: string): string {
  return line.endsWith('\r') ? line.slice(0, -1) : line;
}

function indentOf(line: string): number {
  return (/^\s*/.exec(line)?.[0] ?? '').length;
}

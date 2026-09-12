/**
 * コードハイライト。
 *
 * **`defaultColor: false` を維持する。** Shiki に色を直接書かせず
 * `--shiki-light` / `--shiki-dark` だけを出させて、CSS の `light-dark()` に渡す。
 * 他の色とまったく同じ扱いになるので、`[data-theme]` とメディアクエリのブロックが
 * 要らない (`!important` も要らない)。`'light'` に変えると Shiki がインラインの
 * `color` を書くようになり、CSS を殴るので `!important` が必要になる。
 *
 * 代償としてフィードでは変数をベタの色に展開する必要があるが、それを承知で選んでいる。
 */
import { createHighlighterCore } from 'shiki/core';
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript';
import type { HighlighterGeneric } from 'shiki';

import githubLight from '@shikijs/themes/github-light';
import githubDark from '@shikijs/themes/github-dark';

import bash from '@shikijs/langs/bash';
import css from '@shikijs/langs/css';
import diff from '@shikijs/langs/diff';
import go from '@shikijs/langs/go';
import html from '@shikijs/langs/html';
import ini from '@shikijs/langs/ini';
import javascript from '@shikijs/langs/javascript';
import json from '@shikijs/langs/json';
import jsonc from '@shikijs/langs/jsonc';
import markdown from '@shikijs/langs/markdown';
import perl from '@shikijs/langs/perl';
import python from '@shikijs/langs/python';
import sql from '@shikijs/langs/sql';
import toml from '@shikijs/langs/toml';
import typescript from '@shikijs/langs/typescript';
import vue from '@shikijs/langs/vue';
import xml from '@shikijs/langs/xml';
import yaml from '@shikijs/langs/yaml';

/**
 * 載せる言語。**バンドルに入るので、書かない言語は入れない。**
 *
 * 知らない言語のフェンスは `text` にフォールバックする (`renderMarkdown` の
 * `fallbackLanguage`)。ハイライトが素になるだけで、ビルドも描画も落ちない。
 */
const LANGS = [
  bash, css, diff, go, html, ini, javascript, json, jsonc, markdown,
  perl, python, sql, toml, typescript, vue, xml, yaml,
];

export const THEMES = { light: 'github-light', dark: 'github-dark' } as const;

/**
 * `createHighlighterCore` は `HighlighterGeneric<never, never>` を返すが、
 * `@shikijs/rehype` は `HighlighterGeneric<any, any>` を要求する (言語名を
 * 文字列で受け取るため)。ここで 1 度だけ広げて、外へは緩い型で出す。
 */
export type Highlighter = HighlighterGeneric<string, string>;

let cached: Promise<Highlighter> | undefined;

/**
 * isolate ごとに 1 つ作って使い回す。文法の読み込みはそれなりに高いので、
 * リクエストのたびに作らない。
 *
 * **失敗した promise は捨てる。** 保持したままだと、一度でも作成に失敗した
 * isolate は生きているあいだ全リクエストが同じエラーで落ち続け、自分では
 * 直らない。
 */
export function getHighlighter(): Promise<Highlighter> {
  cached ??= build().catch((error: unknown) => {
    cached = undefined;
    throw error;
  });
  return cached;
}

function build(): Promise<Highlighter> {
  return createHighlighterCore({
    themes: [githubLight, githubDark],
    langs: LANGS,
    // WASM (oniguruma) ではなく JS の正規表現エンジンを使う。Workers に .wasm を
    // 持ち込まずに済み、バンドルも小さくなる。
    engine: createJavaScriptRegexEngine(),
  }) as Promise<Highlighter>;
}

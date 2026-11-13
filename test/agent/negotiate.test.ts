import { describe, expect, it } from 'vitest';
import { pageFormat } from '../../src/core/agent/negotiate.ts';

describe('pageFormat', () => {
  it('Accept が無い・空なら HTML', () => {
    expect(pageFormat(undefined)).toBe('html');
    expect(pageFormat(null)).toBe('html');
    expect(pageFormat('')).toBe('html');
  });

  it('text/markdown だけを求められたら Markdown', () => {
    expect(pageFormat('text/markdown')).toBe('markdown');
    expect(pageFormat('Text/Markdown; charset=utf-8')).toBe('markdown');
  });

  it('ブラウザの Accept は HTML', () => {
    expect(
      pageFormat('text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'),
    ).toBe('html');
  });

  it('*/* だけ（curl や素の fetch）は HTML', () => {
    expect(pageFormat('*/*')).toBe('html');
  });

  it('HTML の方が重ければ HTML、Markdown の方が重ければ Markdown', () => {
    expect(pageFormat('text/html, text/markdown;q=0.9')).toBe('html');
    expect(pageFormat('text/markdown, text/html;q=0.9')).toBe('markdown');
    expect(pageFormat('text/markdown, */*;q=0.1')).toBe('markdown');
  });

  it('同じ重さなら HTML に倒す', () => {
    expect(pageFormat('text/html, text/markdown')).toBe('html');
    expect(pageFormat('text/markdown, text/*')).toBe('html');
  });

  it('一番具体的な range の q を採る', () => {
    // text/markdown;q=0 は「要らない」。*/* があっても Markdown にしない
    expect(pageFormat('text/markdown;q=0, */*')).toBe('html');
    // text/html;q=0 なら、*/* より具体的な指定が HTML を退ける
    expect(pageFormat('text/html;q=0, text/markdown;q=0.5')).toBe('markdown');
  });

  it('どちらも受けない Accept にも HTML を返す（406 にしない）', () => {
    expect(pageFormat('application/json')).toBe('html');
  });

  it('読めない q は 0 とみなす', () => {
    expect(pageFormat('text/markdown;q=abc')).toBe('html');
  });
});

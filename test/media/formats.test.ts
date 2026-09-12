import { describe, expect, it } from 'vitest';
import { extensionForMime, mimeForFilename } from '../../src/core/media/formats.ts';

/**
 * `extensionForMime` は `MIME_BY_EXTENSION` から組んでいる。**往復して同じ形式に
 * 戻ること**を見張るので、逆引きだけ更新し忘れる余地が残らない。
 */
describe('MIME と拡張子の往復', () => {
  it('受け付ける形式は、拡張子 → MIME → 拡張子 で同じ形式に戻る', () => {
    for (const filename of ['a.png', 'a.jpg', 'a.gif', 'a.webp', 'a.avif']) {
      const mime = mimeForFilename(filename);
      expect(mime, filename).toBeDefined();
      expect(mimeForFilename(`a.${extensionForMime(mime!)}`), filename).toBe(mime);
    }
  });

  it('同じ MIME に 2 つ拡張子があるときは先に書いてある方', () => {
    // `jpg` と `jpeg` はどちらも image/jpeg。名前が 2 通りに散らない。
    expect(extensionForMime('image/jpeg')).toBe('jpg');
  });

  it('SVG は取り込まない', () => {
    // 添付としては受け付ける（拡張子で通る）が、よそから取ってきたものは入れない。
    expect(mimeForFilename('a.svg')).toBe('image/svg+xml');
    expect(extensionForMime('image/svg+xml')).toBeUndefined();
  });

  it('パラメータ付き・大文字の Content-Type も読む', () => {
    expect(extensionForMime('IMAGE/PNG')).toBe('png');
    expect(extensionForMime('image/webp; charset=binary')).toBe('webp');
  });

  it('知らない形式は undefined', () => {
    expect(extensionForMime('application/pdf')).toBeUndefined();
    expect(extensionForMime('')).toBeUndefined();
  });
});

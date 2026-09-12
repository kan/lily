import { describe, expect, it } from 'vitest';
import { hashPreviewToken, newPreviewToken } from '../src/core/tokens.ts';

describe('プレビュートークン', () => {
  it('URL に置ける形で、毎回違う', () => {
    const a = newPreviewToken();
    const b = newPreviewToken();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(encodeURIComponent(a)).toBe(a);
  });

  it('ハッシュは同じ入力で同じ、違う入力で違う', async () => {
    const token = newPreviewToken();
    expect(await hashPreviewToken(token)).toBe(await hashPreviewToken(token));
    expect(await hashPreviewToken(token)).not.toBe(await hashPreviewToken(newPreviewToken()));
  });

  it('ハッシュから生トークンは復元できない形 (64 桁の hex)', async () => {
    const hash = await hashPreviewToken('secret');
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toContain('secret');
  });
});

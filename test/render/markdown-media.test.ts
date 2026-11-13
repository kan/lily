import { describe, expect, it } from 'vitest';
import { createPaths } from '../../src/core/paths.ts';
import { absolutizeMediaReferences } from '../../src/core/render/markdown-media.ts';

const { urls } = createPaths({ site: { url: 'https://example.test' }, mountPath: '/blog' });
const media = [
  { public_id: 'm1', filename: 'sample.png' },
  { public_id: 'm2', filename: 'my photo (1).png' },
];
// **URL の組み方は本体から取る。** 写すと、組み方を変えた日にテストが何も見なくなる。
const sample = urls.media(media[0]!, { absolute: true });
const photo = urls.media(media[1]!, { absolute: true });

const run = (markdown: string): string => absolutizeMediaReferences(markdown, media, urls);

describe('absolutizeMediaReferences', () => {
  it('画像記法の相対参照を添付の絶対 URL にする', () => {
    expect(run('![図](./sample.png)\n')).toBe(`![図](<${sample}>)\n`);
    expect(run('![図](sample.png "題")\n')).toBe(`![図](<${sample}> "題")\n`);
  });

  it('空白や括弧のあるファイル名も行き先として読める形にする', () => {
    expect(run('![](<./my photo (1).png>)\n')).toBe(`![](<${photo}>)\n`);
    expect(run('![](./my%20photo%20(1).png)\n')).toBe(`![](<${photo}>)\n`);
  });

  it('リンクと参照の定義も直す', () => {
    expect(run('[原寸](./sample.png)\n')).toBe(`[原寸](<${sample}>)\n`);
    expect(run('![図][a]\n\n[a]: ./sample.png "題"\n')).toBe(
      `![図][a]\n\n[a]: <${sample}> "題"\n`,
    );
  });

  it('リンクの中の画像は、両方の行き先を直す', () => {
    expect(run('[![図](./sample.png)](./sample.png)\n')).toBe(
      `[![図](<${sample}>)](<${sample}>)\n`,
    );
  });

  it('title やラベルに `](` があっても、行き先だけを直す', () => {
    expect(run('![x](./sample.png "see ](z")\n')).toBe(`![x](<${sample}> "see ](z")\n`);
    expect(run('[a](./sample.png "](z")\n')).toBe(`[a](<${sample}> "](z")\n`);
    expect(run('![`]`](./sample.png)\n')).toBe(`![\`]\`](<${sample}>)\n`);
    expect(run('[\\]](./sample.png)\n')).toBe(`[\\]](<${sample}>)\n`);
  });

  it('生 HTML の src / href も直す', () => {
    expect(run('<img src="./sample.png" alt="図">\n')).toBe(`<img src="${sample}" alt="図">\n`);
  });

  it('コードブロックと inline code の中は触らない', () => {
    const code = '```\n![図](./sample.png)\n<img src="./sample.png">\n```\n\n`![図](./sample.png)`\n';
    expect(run(code)).toBe(code);
  });

  it('添付に無い参照・外への URL・記事間のリンクはそのまま', () => {
    const body = '![無い](./missing.png) [外](https://example.com/a.png) [前の記事](../old/)\n';
    expect(run(body)).toBe(body);
  });

  it('参照以外の字は 1 バイトも変えない', () => {
    const body = '# 見出し\n\n*強調*  と   空白\n\n- 項目\n\n![図](./sample.png)\n\n末尾';
    expect(run(body)).toBe(body.replace('./sample.png', `<${sample}>`));
  });
});

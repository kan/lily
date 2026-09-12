import { beforeEach, expect, it } from 'vitest';
import { createPost, setRenderedHtml } from '../../src/core/db/posts.ts';
import { RENDERER_VERSION, renderMarkdown } from '../../src/core/render/index.ts';
import { db, paths, resetDb } from '../db/helpers.ts';

beforeEach(resetDb);

it('描画結果は renderer_version と一緒に保存できる (CHECK を満たす)', async () => {
  // body_html は派生データで、renderer を更新したら作り直す。DB は
  // 「body_html があるなら renderer_version もある」を CHECK で守っているので、
  // 描画側と保存側が噛み合っていることをここで確かめる。
  const created = await createPost(db, paths, { title: 'x', bodyMd: '## 見出し' });
  expect(created.ok).toBe(true);
  if (!created.ok) return;

  const { html } = await renderMarkdown(created.value.body_md);
  await setRenderedHtml(db, created.value.id, html, RENDERER_VERSION);

  const row = await db
    .prepare('SELECT body_html, renderer_version FROM posts WHERE id = ?1')
    .bind(created.value.id)
    .first<{ body_html: string; renderer_version: string }>();
  expect(row?.body_html).toContain('<h2>見出し</h2>');
  expect(row?.renderer_version).toBe(RENDERER_VERSION);
});

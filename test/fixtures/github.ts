/**
 * GitHub の上流（API・アバター・OG バナー・リポジトリのページ）のスタブ。
 * **本物へは取りに行かない。**
 *
 * `test/link-github.test.ts`（API から何を読むか）と `test/api/link-card.test.ts`
 * （カードとして組み上がる形と、取り込む添付）が同じ応答を見るので、ここに 1 本
 * だけ置く。別々に持つと、片方の応答を直した日にもう片方が古い形のまま通る
 * （`fixtures/bluesky.ts` と同じ理由）。
 */
import { pngHeader } from './png.ts';

export const REPO_URL = 'https://github.com/kan/wema';
export const REPO_API = 'https://api.github.com/repos/kan/wema';
export const AVATAR_URL = 'https://avatars.githubusercontent.com/u/41794?v=4';

/** GitHub が OG に出す絵。**アバターと同じ image/png** なのが名前の衝突の元。 */
export const BANNER_URL = 'https://opengraph.githubassets.com/1/kan/wema';

export const REPO_JSON = {
  full_name: 'kan/wema',
  html_url: REPO_URL,
  description: 'Web上に付箋を絵馬のように貼るライブラリ',
  stargazers_count: 12,
  forks_count: 1,
  language: 'TypeScript',
  archived: false,
  owner: { avatar_url: AVATAR_URL },
};

/**
 * GitHub 一式の応答。知らない宛先は null（呼び出し側が決める）。
 *
 * `api` は API の応答を差し替える（レート上限の 403 など）。ページ自身は汎用
 * カードの材料なので、API が枯れたときの受け皿として `og:*` を持たせてある。
 */
export function githubResponse(url: string, api?: ResponseInit): Response | null {
  if (url.startsWith('https://api.github.com/')) {
    return new Response(JSON.stringify(REPO_JSON), api);
  }
  if (url.startsWith('https://avatars.githubusercontent.com/')) {
    return new Response(pngHeader(200, 200), { headers: { 'Content-Type': 'image/png' } });
  }
  if (url.startsWith('https://opengraph.githubassets.com/')) {
    return new Response(pngHeader(1200, 630), { headers: { 'Content-Type': 'image/png' } });
  }
  if (url.startsWith(REPO_URL)) {
    return new Response(
      `<html><head><title>GitHub - kan/wema: 付箋</title>
       <meta property="og:site_name" content="GitHub">
       <meta property="og:image" content="${BANNER_URL}"></head><body>x</body></html>`,
      { headers: { 'Content-Type': 'text/html; charset=utf-8' } },
    );
  }
  return null;
}

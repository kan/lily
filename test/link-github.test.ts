import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchGithubRepo, githubRepoPath, githubStats } from '../src/core/link-github.ts';
import { AVATAR_URL, REPO_API, REPO_JSON, REPO_URL } from './fixtures/github.ts';

/**
 * GitHub のリポジトリを見分けるところと、API から取った値の読み方。
 *
 * カードとして組み上がる形は `test/api/link-card.test.ts`（添付の取り込みまで
 * 通す）で見ている。ここは**外へ出さずに済む部分**だけ。
 */

const UA = 'lily-test';

const repoPath = (url: string) => githubRepoPath(new URL(url));

describe('リポジトリの URL を見分ける', () => {
  it('github.com/<owner>/<repo> を拾う', () => {
    expect(repoPath('https://github.com/kan/wema')).toEqual({ owner: 'kan', repo: 'wema' });
    expect(repoPath('https://github.com/kan/wema/')).toEqual({ owner: 'kan', repo: 'wema' });
    expect(repoPath('https://www.github.com/kan/wema')).toEqual({ owner: 'kan', repo: 'wema' });
    // クエリや fragment が付いていても同じリポジトリ。
    expect(repoPath('https://github.com/kan/wema?tab=readme-ov-file#readme')).toEqual({
      owner: 'kan',
      repo: 'wema',
    });
    // `git clone` からそのまま貼られる形。
    expect(repoPath('https://github.com/kan/wema.git')).toEqual({ owner: 'kan', repo: 'wema' });
  });

  it('リポジトリより深いパスは拾わない', () => {
    // 貼った人が指したのは issue や 1 ファイルであって、リポジトリではない。
    expect(repoPath('https://github.com/kan/wema/issues/1')).toBeNull();
    expect(repoPath('https://github.com/kan/wema/blob/main/README.md')).toBeNull();
    expect(repoPath('https://github.com/kan')).toBeNull();
    expect(repoPath('https://github.com/')).toBeNull();
  });

  it('よその host は拾わない', () => {
    expect(repoPath('https://gist.github.com/kan/1234')).toBeNull();
    expect(repoPath('https://github.io/kan/wema')).toBeNull();
    expect(repoPath('https://github.com.example.com/kan/wema')).toBeNull();
  });
});

describe('統計の行', () => {
  const repo = { stars: 0, forks: 0, language: null, archived: false };

  it('star は 0 でも出す。fork は 0 なら出さない', () => {
    expect(githubStats(repo)).toBe('★ 0');
    expect(githubStats({ ...repo, stars: 1234, forks: 56 })).toBe('★ 1,234 · Fork 56');
  });

  it('言語とアーカイブ済みが後ろに並ぶ', () => {
    expect(githubStats({ ...repo, stars: 12, language: 'TypeScript', archived: true })).toBe(
      '★ 12 · TypeScript · Archived',
    );
  });
});

describe('API から取る', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function stubApi(body: unknown, init: ResponseInit = {}) {
    const requested: string[] = [];
    vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
      requested.push(String(input instanceof Request ? input.url : input));
      return new Response(typeof body === 'string' ? body : JSON.stringify(body), init);
    });
    return requested;
  }

  it('必要な値だけ取り出す。アバターは大きさを指定して取りに行く', async () => {
    const requested = stubApi(REPO_JSON);

    const repo = await fetchGithubRepo({ owner: 'kan', repo: 'wema' }, UA);
    expect(requested).toEqual([REPO_API]);
    expect(repo).toEqual({
      url: new URL(REPO_URL),
      fullName: REPO_JSON.full_name,
      description: REPO_JSON.description,
      stars: 12,
      forks: 1,
      language: 'TypeScript',
      archived: false,
      avatarUrl: `${AVATAR_URL}&s=200`,
    });
  });

  it('改名されたリポジトリは html_url の側を指す', async () => {
    // API は古い名前でも引けて、新しい名前を返す。カードは新しい方へ張る。
    stubApi(REPO_JSON);
    const repo = await fetchGithubRepo({ owner: 'kan', repo: 'ema' }, UA);
    expect(repo?.url.href).toBe(REPO_URL);
    expect(repo?.fullName).toBe('kan/wema');
  });

  it('欠けている値は既定に落とす', async () => {
    stubApi({ html_url: REPO_URL, description: '', stargazers_count: null });
    const repo = await fetchGithubRepo({ owner: 'kan', repo: 'wema' }, UA);
    expect(repo).toMatchObject({
      fullName: 'kan/wema',
      description: null,
      stars: 0,
      language: null,
      archived: false,
      avatarUrl: null,
    });
  });

  it('取れなければ null（呼び出し側が汎用のカードへ落とせるように）', async () => {
    // レート上限・404・落ちている、のどれでも同じ扱い。
    stubApi({ message: 'API rate limit exceeded' }, { status: 403 });
    expect(await fetchGithubRepo({ owner: 'kan', repo: 'wema' }, UA)).toBeNull();

    stubApi('<html>まさかの HTML</html>');
    expect(await fetchGithubRepo({ owner: 'kan', repo: 'wema' }, UA)).toBeNull();

    // 200 でも html_url が無ければ諦める（リポジトリだと分かる材料が無い）。
    stubApi({ full_name: 'kan/wema' });
    expect(await fetchGithubRepo({ owner: 'kan', repo: 'wema' }, UA)).toBeNull();
  });
});

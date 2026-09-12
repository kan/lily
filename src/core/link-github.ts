/**
 * GitHub のリポジトリを、star 数などの付いたカードにするためのアダプタ。
 *
 * **汎用の OGP では足りないので API を叩く。** リポジトリのページの `og:title` は
 * `GitHub - owner/repo: 説明`、`og:description` は説明の後ろに
 * 「Contribute to owner/repo development by creating an account on GitHub.」が
 * 付いた形で、どちらもカードに出すには冗長。star 数・fork 数・言語に至っては
 * `og:*` に無く、OG 画像（`opengraph.githubassets.com` が描く絵）の中にしかない。
 *
 * **取れなければ黙って汎用のカードに落ちる。** 未認証の api.github.com は
 * 60 回/時で、Cloudflare の出口 IP は他所と共有なので枯れることがある（本体
 * サイトの `/api/github` が実際に 403 を踏んでいる）。カードを組むのは書き手が
 * 「カードにする」を押したときだけなので、枯れた日は OGP のカードになれば足りる。
 * 資格情報を持たせていないのはこのため（secret が 1 つ増える割に、守るものが
 * 「その日のカードが少し貧しくなる」しかない）。
 *
 * 外へ取りに行くのは `link-preview.ts` の `fetchExternal()` 経由。**関門は
 * 1 本**という約束を守るため、宛先の検査・リダイレクトの追い方・時間の上限を
 * ここで作り直さない。
 */
import { fetchExternal, httpUrl, readCapped } from './link-preview.ts';

const API_ACCEPT = 'application/vnd.github+json';

/** 読む上限。リポジトリ 1 件の JSON は 10KB 前後なので、これで足りる。 */
const MAX_BYTES = 64 * 1024;

/**
 * アバターに要求する大きさ（px）。カードでは 4rem = 64px で出すので、
 * 高解像度の画面でも足りる。既定（460px）のまま取り込むと添付が無駄に太る。
 */
const AVATAR_SIZE = 200;

/**
 * owner と repo に使える文字。**逆は言えない**（`/features/copilot` のような案内
 * ページも同じ形をしている）ので、リポジトリでないと分かるのは API に聞いてから。
 * 予約セグメントの一覧は GitHub 側で増えるので、こちらに写しを持たない。
 */
const NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export type GithubRepoPath = { readonly owner: string; readonly repo: string };

export type GithubRepo = {
  /** `html_url`。**リンク先はこちらにする**（改名されたリポジトリは新しい名前に飛ぶ）。 */
  readonly url: URL;
  readonly fullName: string;
  readonly description: string | null;
  readonly stars: number;
  readonly forks: number;
  readonly language: string | null;
  readonly archived: boolean;
  /** owner のアバター。カードのサムネにする。取れなければ null。 */
  readonly avatarUrl: string | null;
};

/**
 * `github.com/<owner>/<repo>` だけを拾う。**それより深いパスは null**（issue や
 * PR、ファイルへのリンクをリポジトリのカードにすると、貼った人が指したものと
 * 違うものが出る）。
 */
export function githubRepoPath(url: URL): GithubRepoPath | null {
  // `hostname` は URL が小文字に正規化して返すので、こちらで畳む必要はない。
  const host = url.hostname;
  if (host !== 'github.com' && host !== 'www.github.com') return null;

  const segments = url.pathname.split('/').filter((segment) => segment !== '');
  if (segments.length !== 2) return null;

  const owner = segments[0] ?? '';
  // `git clone` からそのまま貼られることがある。同じリポジトリなので受ける。
  const repo = (segments[1] ?? '').replace(/\.git$/, '');
  if (!NAME.test(owner) || !NAME.test(repo)) return null;
  return { owner, repo };
}

/** 題の下に出す 1 行。**star が 0 でも出す**（数字が無いと星の無さが伝わらない）。 */
export function githubStats(
  repo: Pick<GithubRepo, 'stars' | 'forks' | 'language' | 'archived'>,
): string {
  const parts = [`★ ${repo.stars.toLocaleString('en-US')}`];
  if (repo.forks > 0) parts.push(`Fork ${repo.forks.toLocaleString('en-US')}`);
  if (repo.language !== null) parts.push(repo.language);
  if (repo.archived) parts.push('Archived');
  return parts.join(' · ');
}

/**
 * リポジトリの素性を取る。**取れなければ null**（404・レート上限・JSON が読めない、
 * のどれであっても呼び出し側は「汎用のカードにする」としか扱わない）。
 */
export async function fetchGithubRepo(
  path: GithubRepoPath,
  userAgent: string,
): Promise<GithubRepo | null> {
  const api = `https://api.github.com/repos/${encodeURIComponent(path.owner)}/${encodeURIComponent(path.repo)}`;

  const fetched = await fetchExternal(api, API_ACCEPT, userAgent);
  if (fetched === null) return null;

  const body = await readCapped(fetched.response, MAX_BYTES);
  if (body === null) return null;

  let json: unknown;
  try {
    json = JSON.parse(new TextDecoder().decode(body));
  } catch {
    return null;
  }

  const repo = record(json);
  if (repo === null) return null;

  // **形は当てにしない。** 相手が返す JSON は仕様の外で変わりうる。読めた分だけ
  // 使い、`html_url` が無ければ諦める（`github.com/<a>/<b>` の形をしていても、
  // リポジトリでない URL が 200 を返すことはある）。
  const url = httpUrl(text(repo['html_url']));
  if (url === null) return null;

  return {
    url,
    fullName: text(repo['full_name']) ?? `${path.owner}/${path.repo}`,
    description: text(repo['description']),
    stars: nonNegativeInt(repo['stargazers_count']),
    forks: nonNegativeInt(repo['forks_count']),
    language: text(repo['language']),
    archived: repo['archived'] === true,
    avatarUrl: avatar(record(repo['owner'])?.['avatar_url']),
  };
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** 空文字は無いものとして扱う（`description: ""` を書くリポジトリがある）。 */
function text(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

function nonNegativeInt(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.trunc(value) : 0;
}

/**
 * アバターの URL に大きさを指定する。`?s=` は avatars.githubusercontent.com の
 * 作法だが、**知らない相手に付いても無害なクエリ**なので host で分岐しない
 * （GitHub Enterprise のように別 host で同じ絵を配る構成がある）。
 */
function avatar(value: unknown): string | null {
  const url = httpUrl(text(value));
  if (url === null) return null;
  url.searchParams.set('s', String(AVATAR_SIZE));
  return url.href;
}

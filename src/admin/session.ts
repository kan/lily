/**
 * セッション切れの受け止め。
 *
 * Cloudflare Access の JWT には期限がある。切れたあとの API 呼び出しは 403 で
 * 返ってきて、画面には「forbidden」とだけ出る。**押し直しても直らない**
 * （直す手立てはトップレベルのナビゲーションで Access に通り直すことだけ）ので、
 * 気付いたら読み込み直す。
 *
 * 読み込み直すと書きかけが消えるので、**消える前に退避して戻ってきたら復元する**。
 * 置き場所は sessionStorage で、タブを閉じれば一緒に消える（記事の正は D1 で、
 * これは事故のときだけ使う控え）。
 */

/** 読み込み直した回数。**繰り返しを止めるための印。** */
const ATTEMPT_KEY = 'lily:reload-attempt';

/**
 * 読み込み直しても直らなかったと見なすまでの回数。
 *
 * **時間で測ってはいけない。** Access のログイン（ID/パスワードと MFA）に何十秒
 * かかるかは人と環境で変わるので、「n 秒以内なら 2 度目」という判定はその往復で
 * 簡単に失効し、直らない拒否（ポリシーから外れた・AUD 設定違い）で延々と
 * 読み込み直すことになる。**通った時点で数え直す**（`sessionRestored`）ので、
 * 正しくログインし直せたなら次に切れたときもまた 1 回目から始まる。
 */
const MAX_ATTEMPTS = 1;

/** リロード前に開いていた画面。Access のリダイレクトでフラグメントが落ちるため。 */
const ROUTE_KEY = 'lily:route';

type Rescue = () => void;

let rescue: Rescue | null = null;
let leaving = false;

/**
 * 「画面が消える前に退避したいもの」を預ける。返るのは取り消しの関数。
 *
 * 画面は同時に 1 つしか出ないので 1 つだけ持つ。
 */
export function onSessionLost(save: Rescue): () => void {
  rescue = save;
  return () => {
    if (rescue === save) rescue = null;
  };
}

/**
 * セッションが切れたときの後始末。退避してから読み込み直す。
 *
 * **直前にも読み込み直していたら何もしない。** リロードで直らない拒否
 * （AUD の設定違い等）だと、そのまま無限に読み込み直すことになる。呼び出し側は
 * 403 のレスポンスをそのまま受け取るので、画面にはエラーが出る。
 */
export function sessionLost(): void {
  if (leaving || attempts() >= MAX_ATTEMPTS) return;
  leaving = true;

  rescue?.();
  write(ROUTE_KEY, location.hash.slice(1) || '/');
  write(ATTEMPT_KEY, String(attempts() + 1));
  location.reload();
}

/** 認証が通ったので数え直す。**API が 1 つでも通れば切れていない。** */
export function sessionRestored(): void {
  if (read(ATTEMPT_KEY) !== null) remove(ATTEMPT_KEY);
}

/**
 * 退避したものを置く。JSON にできるものだけ。
 *
 * **まだ回収されていない退避は上書きしない。** 読み込み直した直後は画面がまだ
 * 空で、その状態で 2 度目に切れると、書きかけを空文字で塗り潰すことになる。
 */
export function stash(key: string, value: unknown): void {
  if (read(key) !== null) return;
  write(key, JSON.stringify(value));
}

/** 退避したものを取り出す。**読んだら消す**（同じものを二度復元しない）。 */
export function unstash<T>(key: string): T | null {
  const raw = read(key);
  if (raw === null) return null;
  remove(key);
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/** 読み込み直す前に開いていた画面。**読んだら消す。** */
export function takeStashedRoute(): string | null {
  const path = read(ROUTE_KEY);
  if (path !== null) remove(ROUTE_KEY);
  return path;
}

function attempts(): number {
  const count = Number(read(ATTEMPT_KEY));
  return Number.isInteger(count) && count > 0 ? count : 0;
}

/**
 * sessionStorage は**プライベートモードで throw する**ので必ず包む。
 * 退避できない環境でも、リロード自体は動いてほしい。
 */
function write(key: string, value: string): void {
  try {
    sessionStorage.setItem(key, value);
  } catch {
    // 退避できないだけ。処理は続ける。
  }
}

function read(key: string): string | null {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function remove(key: string): void {
  try {
    sessionStorage.removeItem(key);
  } catch {
    // 消せなくても次の復元で JSON として読めれば実害はない。
  }
}

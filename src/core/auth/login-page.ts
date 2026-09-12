/**
 * ログイン画面。**core が持つ唯一の「書いた」HTML。**
 *
 * テーマではなく core に置くのは、ログインが見た目の話ではなく認証の経路その
 * ものだから。テーマに持たせると、自前のテーマを書いた deployment が全部これを
 * 実装しない限り管理画面に入れなくなる（テーマは公開ページのためのもので、
 * 管理画面の中身は既に core が配っている）。
 *
 * **色トークンも JS も持ち込まない。** 入力欄 1 つの画面なので、`color-scheme`
 * と数十行の CSS で足りる。
 */
import { html, raw } from 'hono/html';

export type LoginPageOptions = {
  readonly siteName: string;
  /** form の送り先。 */
  readonly action: string;
  /**
   * 画面に出す文。**なぜ弾いたかは書かない**（どこまで合っていたかは、
   * 当てにいく手掛かりになる）。
   */
  readonly message?: string;
  /**
   * パスワードが使えない deployment。**入力欄を出さない。**
   *
   * これは認証の失敗ではなく設定の不足なので、運用者に何をすればよいか出す。
   * **`unset` と `tooShort` を分ける。** 一緒くたに「設定してください」と出すと、
   * 短いパスワードを入れた運用者は同じ secret を入れ直す無限ループに入る
   * （設定したつもりのものが拒否されている、と画面から読み取れない）。
   */
  readonly unusable?: 'unset' | 'tooShort';
  /**
   * パスワードを渡している secret の名前（`ADMIN_PASSWORD` など）。
   * **分かっているときだけ**出す。core は deployment が何という名前で secret を
   * 持っているか知らないので、`passwordAuth` に渡されなければ名前を出さない。
   */
  readonly secretName?: string;
  /** 受け付ける最短の長さ。`tooShort` の案内に出す。 */
  readonly minLength: number;
};

const STYLE = `
:root { color-scheme: light dark; }
* { box-sizing: border-box; }
body {
  margin: 0;
  min-height: 100dvh;
  display: grid;
  place-items: center;
  padding: 1.5rem;
  font-family: system-ui, sans-serif;
  background: light-dark(#f6f6f7, #16161a);
  color: light-dark(#1a1a1e, #e8e8ea);
}
main {
  width: min(22rem, 100%);
  padding: 1.5rem;
  border: 1px solid light-dark(#dcdce0, #35353c);
  border-radius: 10px;
  background: light-dark(#fff, #1e1e23);
}
h1 { margin: 0; font-size: 1.1rem; }
p { margin: 0.4rem 0 0; font-size: 0.85rem; }
p.sub { color: light-dark(#5c5c66, #a0a0aa); }
p.error { color: light-dark(#b3261e, #f2b8b5); }
form { margin-top: 1.2rem; }
label { display: block; font-size: 0.85rem; }
input, button {
  width: 100%;
  margin-top: 0.35rem;
  padding: 0.5rem 0.7rem;
  font: inherit;
  border-radius: 6px;
  border: 1px solid light-dark(#c9c9d0, #45454e);
}
input { background: light-dark(#fff, #16161a); color: inherit; }
button {
  margin-top: 1rem;
  border-color: transparent;
  background: light-dark(#1f5eff, #4d7dff);
  color: #fff;
  cursor: pointer;
}
`;

/** 入力欄。**使える設定があるときだけ出す。** */
function form(options: LoginPageOptions) {
  return html`<form method="post" action="${options.action}">
    <label for="password">パスワード</label>
    <input
      id="password"
      name="password"
      type="password"
      autocomplete="current-password"
      required
      autofocus
    />
    <button type="submit">ログイン</button>
  </form>`;
}

/** 設定が足りないときの案内。**運用者向け**で、認証の失敗とは別物。 */
function setupNotice(options: LoginPageOptions, unusable: 'unset' | 'tooShort') {
  // 名前が分かっていれば添える。分からないときに `ADMIN_PASSWORD` と決め打つと、
  // 別の名前で渡している deployment の運用者に嘘の案内をすることになる。
  const secret = options.secretName
    ? html`パスワードの secret（<code>${options.secretName}</code>）`
    : html`パスワードの secret`;

  return unusable === 'tooShort'
    ? html`<p class="error">
        設定されたパスワードが短すぎるので、管理画面を開けません。
        ${secret}を ${options.minLength} 文字以上にして、デプロイし直してください。
      </p>`
    : html`<p class="error">
        この deployment はまだ設定されていません。管理者は${secret}を設定してください。
      </p>`;
}

export function renderLoginPage(options: LoginPageOptions): string {
  return String(html`<!doctype html>
    <html lang="ja">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="color-scheme" content="light dark" />
        <meta name="robots" content="noindex" />
        <title>ログイン | ${options.siteName}</title>
        <style>
          ${raw(STYLE)}
        </style>
      </head>
      <body>
        <main>
          <h1>${options.siteName}</h1>
          <p class="sub">管理画面</p>
          ${options.message ? html`<p class="error">${options.message}</p>` : ''}
          ${options.unusable ? setupNotice(options, options.unusable) : form(options)}
        </main>
      </body>
    </html>`);
}

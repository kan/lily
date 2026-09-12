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
 *
 * **文言は `SiteConfig.uiLang`（無ければ `lang`）で選ぶ。** 標準テーマと同じ規則で、
 * 決めるのは `core/locale.ts` の `siteLocale()`。表に無い言語は英語に落ちるので、
 * どの deployment でも画面は出る。
 */
import { html, raw } from 'hono/html';
import { renderHtml } from '../html.ts';
import type { Locale } from '../locale.ts';

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
  /**
   * 文言の言語。**`AuthContext` が運んでくる**（決めるのは `core/locale.ts` の
   * `siteLocale()` で、標準テーマと同じ規則）。
   */
  readonly locale: Locale;
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

/**
 * 画面に出る文言。**表は言語ごとに同じ形**なので、片方だけ足したものは
 * コンパイルが通らない。
 */
type LoginText = {
  readonly title: string;
  readonly password: string;
  readonly signIn: string;
  /**
   * secret の呼び方と直し方。**名前は分かっているときだけ受ける** —— core は
   * deployment が何という名前で持っているか知らないので、`passwordAuth` に
   * 渡されなければ名前を出さない。
   */
  readonly secret: (name?: string) => string;
  readonly how: (name?: string) => string;
  readonly tooShort: (secret: string, minLength: number, how: string) => string;
  readonly unset: (secret: string, minLength: number, how: string) => string;
};

const TEXTS: Record<Locale, LoginText> = {
  en: {
    title: 'Sign in',
    password: 'Password',
    signIn: 'Sign in',
    secret: (name) =>
      name === undefined ? 'the password secret' : `the password secret (<code>${name}</code>)`,
    how: (name) =>
      'in the Cloudflare dashboard under Settings → Variables and Secrets, or with ' +
      `<code>npx wrangler secret put${name === undefined ? '' : ` ${name}`}</code>`,
    tooShort: (secret, minLength, how) =>
      `The password that is set is too short, so the admin UI cannot be opened. Replace ${secret} ` +
      `with one of ${minLength} characters or more — ${how} — and deploy again. Saving the secret ` +
      'is not enough on its own: the Worker that is running keeps the old value until the next ' +
      'deployment.',
    unset: (secret, minLength, how) =>
      `This deployment is not configured yet. The administrator has to set ${secret} to a ` +
      `password of ${minLength} characters or more — ${how} — and deploy again.`,
  },
  ja: {
    title: 'ログイン',
    password: 'パスワード',
    signIn: 'ログイン',
    secret: (name) =>
      name === undefined ? 'パスワードの secret' : `パスワードの secret（<code>${name}</code>）`,
    how: (name) =>
      'Cloudflare の dashboard なら Settings → Variables and Secrets、手元からなら ' +
      `<code>npx wrangler secret put${name === undefined ? '' : ` ${name}`}</code>`,
    tooShort: (secret, minLength, how) =>
      `設定されたパスワードが短すぎるので、管理画面を開けません。${secret}を ${minLength} ` +
      `文字以上のものに入れ替えて（${how}）、デプロイし直してください。保存するだけでは` +
      '足りません。動いている Worker は次のデプロイまで古い値のままです。',
    unset: (secret, minLength, how) =>
      `この deployment はまだ設定されていません。管理者が${secret}に ${minLength} ` +
      `文字以上のパスワードを設定し（${how}）、デプロイし直してください。`,
  },
};

/** 入力欄。**使える設定があるときだけ出す。** */
function form(options: LoginPageOptions, text: LoginText) {
  return html`<form method="post" action="${options.action}">
    <label for="password">${text.password}</label>
    <input
      id="password"
      name="password"
      type="password"
      autocomplete="current-password"
      required
      autofocus
    />
    <button type="submit">${text.signIn}</button>
  </form>`;
}

/**
 * 設定が足りないときの案内。**運用者向け**で、認証の失敗とは別物。
 *
 * **直し方まで書く。** ここを読んでいる人は、たいてい「値は入れたのに開かない」
 * 状態にいる（Deploy to Cloudflare の画面は短いパスワードもそのまま受け取る）。
 * どこで入れ直すのかと、**入れ直すだけでは足りない**ことの両方を出す ——
 * dashboard で secret を保存しても、動いている Worker は次のデプロイまで古い値の
 * ままだった（#4 で踏んだ）。
 */
function setupNotice(options: LoginPageOptions, text: LoginText, unusable: 'unset' | 'tooShort') {
  // **`<code>` を含むので `raw()` で出す。** 差し込むのは core が持つ文言と
  // `secretName`（`passwordAuth` に渡された設定の値）だけで、外から来た文字列は
  // 1 つも混ざらない。
  const secret = text.secret(options.secretName);
  const how = text.how(options.secretName);
  const notice =
    unusable === 'tooShort'
      ? text.tooShort(secret, options.minLength, how)
      : text.unset(secret, options.minLength, how);

  return html`<p class="error">${raw(notice)}</p>`;
}

export function renderLoginPage(options: LoginPageOptions): string {
  const text = TEXTS[options.locale];
  return renderHtml(html`<!doctype html>
    <html lang="${options.locale}">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="color-scheme" content="light dark" />
        <meta name="robots" content="noindex" />
        <title>${text.title} | ${options.siteName}</title>
        <style>
          ${raw(STYLE)}
        </style>
      </head>
      <body>
        <main>
          <h1>${options.siteName}</h1>
          <p class="sub">${text.title}</p>
          ${options.message ? html`<p class="error">${options.message}</p>` : ''}
          ${options.unusable
            ? setupNotice(options, text, options.unusable)
            : form(options, text)}
        </main>
      </body>
    </html>`);
}

/**
 * This blog's configuration. **Everything site-specific is here.**
 *
 * lily (`@kanf/lily`) is the CMS; it knows neither the name nor the URL of the site it
 * serves. What you pass here is what shows up on the public pages, in the feeds, in the
 * OGP tags and in the admin UI.
 */
import { createLily, localhostOnly, passwordAuth } from '@kanf/lily';
import { defaultTheme } from '@kanf/lily/theme';

/** The admin password. **Shorter than 12 characters is refused.** */
const PASSWORD_SECRET = 'ADMIN_PASSWORD';

/**
 * The Worker's secrets. **They are not in `wrangler.jsonc`**, which is the whole point
 * of a secret, so `wrangler types` does not know about them until you have a `.dev.vars`.
 * Declaring the shape here keeps the types honest either way.
 */
type Secrets = {
  readonly ADMIN_PASSWORD?: string;
  readonly BLUESKY_IDENTIFIER?: string;
  readonly BLUESKY_APP_PASSWORD?: string;
};

export const lily = createLily<Env & Secrets>({
  site: {
    // Change this to the URL you actually serve from (your domain, or the *.workers.dev
    // one). **It is the origin every absolute URL is built from**, so getting it wrong
    // shows up in the feeds and in `<link rel="canonical">`.
    url: 'https://example.com',
    name: 'My blog',
    description: 'A blog running on lily',
    author: 'Someone',
    // The language of what you publish, and the time zone days are cut on. **Neither has
    // a default**: if lily picked one, a blog in another language or another region would
    // quietly be served as Japanese, in JST.
    lang: 'en',
    timeZone: 'UTC',
    // The site-wide OGP image, used for posts that have not chosen their own.
    // **An absolute URL** — it can live in `public/`, or on another domain entirely.
    ogImage: { url: 'https://example.com/ogp.png', width: 1200, height: 630 },
  },

  // Serve at the root. Use '/blog' to put the whole thing under a subpath instead —
  // lily builds every URL, so the theme and the tests follow along.
  mountPath: '/',

  // The theme that ships with lily. To make it your own, copy
  // `node_modules/@kanf/lily/dist/lib/theme` into `src/theme/` and change it there
  // (four functions and one stylesheet).
  theme: defaultTheme,

  // Files served at the mount root, i.e. what you put in `public/`.
  // **A name listed here is reserved as a post path.**
  assets: [],

  /**
   * What guards the admin UI and the admin API.
   *
   * **Running without the secret is a local thing.** Leave it out of `.dev.vars` and you
   * fall through to `localhostOnly`, which only passes when the host is `localhost` or
   * `127.0.0.1`. **Forgetting the secret in production does not open the door**: neither
   * adapter lets anyone in.
   */
  auth: (env) =>
    env.ADMIN_PASSWORD
      ? passwordAuth({ password: env.ADMIN_PASSWORD, secretName: PASSWORD_SECRET })
      : localhostOnly(),

  // Announcing posts on Bluesky (optional), used only when both credentials are set.
  // Without them the announce button reports "not configured" and nothing else changes.
  bluesky: (env) =>
    env.BLUESKY_IDENTIFIER && env.BLUESKY_APP_PASSWORD
      ? { identifier: env.BLUESKY_IDENTIFIER, appPassword: env.BLUESKY_APP_PASSWORD }
      : null,
});

# Configuration

[lily](../README.md) → Configuration

`createLily(config)` takes one object. Everything site-specific lives there; `core/` knows
these types and nothing else.

| Key | What |
|---|---|
| `site.url` | The origin you serve from. Absolute URLs in feeds and `<link rel=canonical>` start here |
| `site.name` / `site.description` / `site.author` | Shown in `<title>`, OGP and the feeds |
| `site.lang` | BCP 47 language of the content. **No default in core** — a site in another language must not be quietly served as Japanese |
| `site.timeZone` | IANA name used to cut dates into days. **No default either**: falling back to the runtime's zone changes a post's date between the Worker and the browser |
| `site.ogImage` | One image for the whole site, used when a post has not chosen its own. Absolute URL; width and height only when you know them |
| `site.favicon` | Absolute URL. Omit it and the theme emits no `<link rel="icon">` |
| `mountPath` | `'/'` or `'/blog'`. A first-class setting, not a rewrite |
| `theme` | A `Theme` implementation. `defaultTheme` from `@kanf/lily/theme`, or your own |
| `assets` | Filenames served at the mount root (`favicon.ico`, …). **Listing one reserves it as a post path** — serve it without reserving it and a post with that name becomes unreachable |
| `ogImageAsset` | The asset holding `site.ogImage`, used only for the Bluesky card thumbnail (a Worker cannot fetch a URL in its own zone, so this is read through `ASSETS` instead) |
| `media.images` | Convert images at delivery time through Cloudflare Images. Without the `IMAGES` binding, `true` still serves originals |
| `auth` | `(env) => AuthAdapter`. A function because team names and passwords belong in `env`, not in the repository |
| `bluesky` | `(env) => BlueskyCredentials \| null`. Omit it and the announce endpoint reports "not configured" rather than disappearing |

## The URLs it serves

Everything is relative to `mountPath`.

| Path | What |
|---|---|
| `/`, `/page/2/` | Index, paginated |
| `/<post-path>/` | A post. Former paths 308 to the current one |
| `/tags/<slug>/`, `/tags/<slug>/page/2/` | Tag pages |
| `/rss.xml`, `/atom.xml` | Full-text feeds |
| `/sitemap-index.xml`, `/sitemap-0.xml` | Sitemap |
| `/posts.json` | Recent posts as JSON (`?limit=`), for another site to list them |
| `/styles.css` | The theme's stylesheet |
| `/preview/<token>` | Draft preview |
| `/media/<public-id>/<filename>` | Attachments |
| `/404` | Not found |
| `/admin/*`, `/api/*` | Admin UI and admin API. **Behind the `AuthAdapter`** |

The first segment of a post path cannot collide with any of these: the route names, the URL
builder and the path validator all read the same table (`core/routes/fixed.ts`), so "the URL
can be generated but is not reserved" cannot quietly become true.

## Public API

Only what `src/index.ts` exports. Do not reach into `src/core/`.

| Entry point | What |
|---|---|
| `@kanf/lily` | `createLily` / config and theme types / auth adapters / `runBackup` / `createPaths` / `createDateFormat` / the admin-link contract / zip |
| `@kanf/lily/theme` | The default theme (`defaultTheme`). Separate because it carries a stylesheet |
| `@kanf/lily/paths` | URL construction and post-path rules. **Uses no Workers types**, so Node can import it |
| `@kanf/lily/zip` | Reading and writing the portable archive. Same, which is what makes it usable from an E2E fixture loader |
| `@kanf/lily/test-support` | Runs the migrations inside a consumer's Vitest. **Imports `cloudflare:test`**, so production code must not touch it |

**What ships is `tsc` output — `.js` + `.d.ts` (`dist/lib`); `src/` is not in the package.**
Shipping sources would apply *your* tsconfig to lily's code, so anyone stricter than lily
(`exactOptionalPropertyTypes`, say) would fail to compile it — `skipLibCheck` only covers
`.d.ts`.


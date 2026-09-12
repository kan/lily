# lily

A small CMS for Cloudflare Workers, with D1 as the source of truth. Published on npm as
`@kanf/lily`.

**It runs on a Worker, D1 and R2 alone.** Writing posts, Markdown rendering, image upload,
image delivery and a portable export all work with nothing else. Cloudflare Images is an
optional layer that improves delivery when it happens to be there — lily never assumes it,
and never stores an Images-specific URL.

**Your posts stay readable without lily.** Import and export speak the same format: a zip of
`posts/<path>/index.md` plus the attachments next to it, with relative image references left
exactly as you wrote them. That archive is also what the daily backup puts in R2. Drop lily
and the Markdown is still there.

lily is a library, not a deployment. You bring a Worker and a config file; lily brings the
routes, the database schema, a prebuilt admin UI and a default theme.

- **Why things are the way they are: [`DESIGN.md`](./DESIGN.md)** — the design record. It is
  written in Japanese, is not shipped in the npm package, and goes deeper than this page:
  rendering, link cards, the admin API and UI, announcements, production wiring, test policy.
- **Working on lily itself: [`CONTRIBUTING.md`](./CONTRIBUTING.md)** — commands, layout, how
  the two builds fit together.
- **Found a security hole: [`SECURITY.md`](./SECURITY.md)** — report it privately, not as an
  issue. That file also says what lily does and does not claim to protect.

## Starting a blog with it

```bash
npx @kanf/lily init
```

**Asks what the blog is** — its name, description, author, URL, language, time zone, and
whether it lives at the root or under a path — and writes a directory with those answers
already in `src/config.ts`. It also offers to pick the admin password there and then, so the
length rule is something you hear before you type rather than after you deploy. From there it
is `npm run dev` locally and `npm run deploy:first` to Cloudflare.

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/kan/lily/tree/main/template)

The button is the other way in: it copies [`template/`](./template) into a repository of your
own, creates the D1 database and the R2 bucket, asks for an admin password, and deploys. **A
Cloudflare account is all it takes** — nothing to create beforehand, and no resource ID ever
pasted into a config file. The trade is that the blog comes up with the defaults (`My blog`,
`https://example.com`) until you edit the repository, so it is the better path for *trying
lily*, and `init` is the better one for *keeping* a blog.

Copying the directory means creating a repository, so the button asks to install Cloudflare's
GitHub app — wider than the one repository you end up with, because that repository does not
exist yet to be picked from a list. It can be narrowed to the blog afterwards, or skipped
entirely by deploying from your machine;
[`template/README.md`](./template/README.md#what-the-button-asks-of-your-github-account) says
how.

Either way you end up with that same directory, and the rest of this page explains what is in
it.

## What you get

**Posts.** Stable identity (an immutable `public_id`) separate from the URL, so a URL can be
changed later and the old one keeps working as a 308 alias. Drafts with a shareable preview
URL, a publication date and time you set yourself, and tags.

**Markdown.** CommonMark + GFM, syntax highlighting via Shiki, and relative image references
(`./sample.png`) resolved when the page is rendered rather than baked into the stored text.
Descriptions are generated from the opening of the body when you have not written one.

**A public site, server-rendered.** Index with paging, post pages, tag pages, a 404, RSS 2.0
and Atom (both full text), a sitemap, and `posts.json` for another site that wants to list
your recent posts.

**An admin UI, shipped prebuilt.** List, edit, preview, drag-and-drop images, change paths,
publication date and time, tag completion, paging, filtering by tag or keyword, a page that
shows the effective configuration, and recovery when the session expires. It is a Vue app,
already built — **consumers need no Vue toolchain.**

**Authentication that is on before there is anything behind it.** `<mount>/api/*` and
`<mount>/admin/*` never resolve without passing an `AuthAdapter`, so a route added later
cannot forget to be protected. Three adapters ship with lily; writing a fourth is one
function.

**Images.** R2 holds the original; Cloudflare Images, when enabled, is a delivery-time
conversion that falls back to the original on any failure. `<img>` gets `width`, `height`,
`loading` and `decoding` from the stored dimensions.

**Portable import and export**, the same format in both directions, plus a daily backup to a
separate R2 bucket driven by a Cron Trigger.

**Themes.** A default theme that knows nothing about any particular site, and a `Theme`
interface small enough (four functions and one stylesheet) that copying it is the cheapest
way to get your own.

**Announcements to Bluesky** from the admin UI, with double-posting prevented by the stored
post URI.

## Requirements

A Cloudflare Worker with D1 (`DB`), R2 (`MEDIA`) and static assets (`ASSETS`) bound. An
`IMAGES` binding is optional, and so is a second R2 bucket if you want the daily backup.
Node 24 is what lily is built and tested on.

## Getting started

```bash
npm install @kanf/lily
```

```ts
// src/config.ts
import { createLily, localhostOnly, passwordAuth } from '@kanf/lily';
import { defaultTheme } from '@kanf/lily/theme';

export const lily = createLily<Env>({
  site: {
    url: 'https://example.com',
    name: 'My blog',
    description: 'Something about it',
    author: 'Someone',
    lang: 'en',
    timeZone: 'UTC',
    ogImage: { url: 'https://example.com/ogp.png', width: 1200, height: 630 },
  },
  mountPath: '/',
  theme: defaultTheme,
  // No secret means local only (leave it out of `.dev.vars` and you fall through to
  // localhost). **Forgetting the secret in production does not open the door**: neither
  // adapter lets anyone in.
  auth: (env) =>
    env.ADMIN_PASSWORD
      ? passwordAuth({ password: env.ADMIN_PASSWORD, secretName: 'ADMIN_PASSWORD' })
      : localhostOnly(),
});
```

That is the shape, abridged. **The version that runs is
[`template/src/config.ts`](./template/src/config.ts)** — same file with the Bluesky
credentials and the type for the secrets, which `wrangler types` cannot know about because
they are not in `wrangler.jsonc`.

Your `wrangler.jsonc` needs these entries.

```jsonc
{
  // lily owns the schema. **Do not copy the migrations** — point at the directory.
  // No resource IDs: `wrangler deploy` creates what the bindings name.
  "d1_databases": [{
    "binding": "DB", "database_name": "my-blog",
    "migrations_dir": "./node_modules/@kanf/lily/migrations"
  }],
  "r2_buckets": [{ "binding": "MEDIA", "bucket_name": "..." }],
  // Where the admin UI and your static assets are served from; merge lily's dist/admin here.
  "assets": { "binding": "ASSETS", "directory": "./dist", "run_worker_first": true },
  // Theme CSS is bundled as a string. **Keep `fallthrough`** — without it, wrangler's
  // default rules are disabled wholesale.
  "rules": [{ "type": "Text", "globs": ["**/*.css"], "fallthrough": true }]
}
```

Again, the whole file — with the optional backup bucket and Images binding written out as
comments — is [`template/wrangler.jsonc`](./template/wrangler.jsonc).

The admin UI is **shipped prebuilt**, so there is no Vue toolchain on your side. Merging it
with your own static files is one command, which comes with the package:

```jsonc
// package.json — puts public/ and lily's admin UI into dist/
"build": "lily-assets dist public"
```

`lily-assets` lives in lily because lily is what knows where its admin build is, whether that
build is complete, and whether it is stale — copy that logic into every consumer and it goes
out of date the day lily changes shape.

Then apply the migrations and set the password:

```bash
npx wrangler d1 migrations apply DB --remote
npx wrangler secret put ADMIN_PASSWORD
```

## Configuration

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

## URLs it serves

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

## Themes

**`core` does not contain one byte of the HTML it serves.** Pages are assembled by whatever
implements `Theme`; core hands it the data for the page (`PageContext` and the view types)
and nothing else.

```ts
interface Theme {
  readonly stylesheet: string;
  index(context, posts, pagination): Promise<string>;
  post(context, post): Promise<string>;
  tag(context, tag, posts, pagination): Promise<string>;
  notFound(context): Promise<string>;
}
```

The one exception is the **login page** (`core/auth/login-page.ts`). That is not a look, it
is the authentication path itself: leaving it to themes would mean nobody with a custom theme
could reach the admin UI until they implemented it. The admin UI is served by core for the
same reason.

Write your own by copying `src/theme/` — four functions and one stylesheet is little enough
that copying beats configuring. What the default theme guarantees, and what yours should keep
if you want the same properties:

- Name, description, author, language, time zone, OGP image and tab icon all come from
  `SiteConfig`.
- It does not know the mount point. URLs are built by `context.urls`.
- **It does not know the filenames of static assets.** What you serve is up to
  `PageConfig.assets`, so `<link rel="icon">` appears only when `SiteConfig.favicon` is set —
  the same shape as `ogImage`, with core involved in neither serving the image nor building
  its URL.
- **It makes no outbound requests** (no webfonts). A theme distributed on npm should not
  decide a site's CSP and privacy posture for it.
- All user-visible strings are in one file. **There is no translation mechanism** — a site in
  another language copies the theme.

Dates are formatted by passing `SiteConfig.timeZone` to `core/date.ts`, and the reader-facing
form is left to `Intl` via `SiteConfig.lang`. `<time datetime>` stays ISO 8601, so machines
are unaffected by the display format.

## Authentication

`<mount>/api/*` and `<mount>/admin/*` are unreachable without passing the `AuthAdapter`.

**Core knows no authentication method.** Three adapters ship with lily, and `auth: (env) =>
...` picks one — it takes `env` so that deployment-specific values such as a team name or a
password are not baked into the repository.

| Adapter | What | Needs |
|---|---|---|
| `passwordAuth` | **The default setup.** One password | One secret |
| `cloudflareAccess` | Verifies the JWT Access puts on the request | A Zero Trust configuration |
| `localhostOnly` | The local-development escape hatch. **Structurally unreachable in production** | Nothing |

- A rejection does not say why it was rejected: how close an attempt got is exactly the clue
  worth having if you are the one guessing.
- **Authentication alone is not enough.** Sessions are cookies in either scheme, so they ride
  along on requests sent from other sites. The endpoints that read no body (`unpublish`,
  `rerender`) and the multipart one (`media`) can be reached from a plain HTML form, so
  `csrf()` checks the origin.

### `passwordAuth`

The password lives in a Worker secret; a successful login gets an HMAC-signed cookie. **There
is nothing to store** — no D1 table, no migration.

```ts
auth: (env) =>
  env.ADMIN_PASSWORD
    ? passwordAuth({ password: env.ADMIN_PASSWORD, secretName: 'ADMIN_PASSWORD' })
    : localhostOnly(),
```

```bash
npx wrangler secret put ADMIN_PASSWORD
```

- **No password hash in D1.** The Workers free plan gives a request 10ms of CPU, and the
  OWASP-recommended 600,000 PBKDF2 iterations do not fit. That leaves "the standard setup
  does not run on the free plan" or "weaken the hash". Comparing against a secret needs no
  KDF at all — **there is no hash in a database that needs stretching to protect it.**
- **No first-run setup screen**, because that opens a window where anyone can become the
  administrator while the user table is empty. The secret is already in place at deploy time.
- Passwords are compared **after hashing both sides with SHA-256**, so neither the length nor
  how many characters matched shows up in the timing.
- **The session key is the password itself.** Replace the secret and every cookie already
  handed out is void. A separate `SESSION_SECRET` would remove that property: changing the
  password would leave a stolen cookie alive.
- The cookie is `HttpOnly`, `SameSite=Lax`, `Path=<mount>/`, and `Secure` only over https
  (local development and E2E run on http, where `Secure` would make login impossible). It
  lasts 30 days by default and is **not extended**.
- The only defence against brute force is **a delay on failure** (500ms by default; it costs
  no CPU, so it works on the free plan). That is why passwords shorter than 12 characters are
  refused — **a short password should not feel protected.**
- **"Not set" and "too short" stay distinct all the way to the screen.** Collapse them and an
  operator who set a short secret is told to set one, and re-enters the same value forever.
  The secret's name appears on screen only if you pass `secretName`: **core does not know
  what your deployment calls it.**
- Login is at `<mount>/admin/login` and logout at `<mount>/admin/logout` (POST only — a GET
  logout gets triggered by prefetches and image loads). **Both sit in front of
  authentication.**
- Logging out also clears the marker cookie that reveals the admin link on public pages.
  There is no reason for an "Admin" link to linger on a shared machine.
- **The password cannot be changed from the UI** (change the secret instead). If you need
  several users or a change-password screen, write your own `AuthAdapter`.

### `cloudflareAccess`

- Access stops the request before the Worker, so verifying here is **a second line**: it
  keeps the admin UI shut on paths that bypass Access (a missing route rule, a direct request
  to another hostname).
- The team name and AUD go in `vars` — not secret, but per-deployment. Access is used **only
  when both are present**; if either is missing, lily falls back to `localhostOnly`, which
  means production stays closed. Half-configured Access is the dangerous state, so which mode
  was chosen is decided in one place and logged once at startup.
- **After the JWT expires the API keeps returning 403.** The only way back is a top-level
  navigation through Access, so the admin UI reloads itself when it sees a 401 or 403.
- **Session length is Access's setting**, not something this repository can change.
- **No logout button appears in the admin UI.** The session is held outside the Worker, so
  the button would do nothing. It follows automatically from the adapter having no `handle`.

### `localhostOnly`

The escape hatch that keeps you from being locked out of your own machine. **It cannot pass
in production**: the decision is made on the request host alone, and anything other than
`localhost` or `127.0.0.1` is refused. Cloudflare routes by host, so a request arriving at a
real domain or `*.workers.dev` never satisfies it.

### Writing your own adapter

An `AuthAdapter` is a `name` and an `authenticate(request)`; that is the whole requirement.
The one optional member, `handle`, is what declares "this method can be logged into from a
screen", and core derives three things from its presence:

| What core decides | From |
|---|---|
| Whether `<mount>/admin/login` and `/logout` are handed to the adapter | `handle` |
| Whether an unauthenticated browser navigation goes to the login page instead of 403 | same |
| Whether the admin UI shows a logout button | same |

Core also decides *how* to refuse: browser navigations go to the login page, while `/api/*`
stays a 403 (redirecting it would make the admin UI parse login HTML as JSON). The adapter
only ever sees requests to those two paths — handing it everything would run adapter logic
for every admin asset and push "reject the paths I don't own" onto every adapter author.

## Images

Cloudflare Images is **an optional layer**. Three rules keep it optional:

- **The delivery URL is the same whether Images is on or off.** No Images-specific URL is
  stored in the Markdown or in `body_html`, so toggling it, hitting a plan limit or moving to
  something else never requires rewriting posts.
- **On failure, serve the original.** Unconfigured, unavailable, out of quota, conversion
  error — none of them make a post's images disappear. **The fallback is the specification,**
  not a shortcut.
- SVG is left alone (it is vector). So is GIF (don't flatten something that moves).

AVIF or WebP is chosen from the request's `Accept`. **Cloudflare's edge ignores every `Vary`
except `Accept-Encoding`**, so converted responses are kept out of shared caches:

| Response | `Cache-Control` | `ETag` |
|---|---|---|
| Original (not converted, or conversion failed) | `public, max-age=31536000, immutable` | R2's `httpEtag` |
| Converted | `private, max-age=86400` | `httpEtag` plus `-webp` / `-avif` |

`Vary: Accept` goes on **every negotiated response**, originals included — leaving it off the
unconverted ones teaches caches that the URL does not negotiate. `ETag` differs per format
because the same URL returns different bytes; sharing one would answer `If-None-Match` with a
**304 for the other format**.

Because converted responses are `private`, they miss Cloudflare's cache and hit Images every
time. If that ever becomes a problem, put them in `caches.default` under a key that includes
the format — not before.

## Portable import and export

**The shape you can import is the shape you export.**

```
posts/<canonical-path>/index.md    frontmatter + body (relative references intact)
posts/<canonical-path>/sample.png  attachment
```

This is not a D1 dump. A dump depends on D1 and R2 being the storage; this is Markdown and
images, so **the posts outlive lily.**

The endpoints are `GET <mount>/api/export` (returns the zip) and `POST <mount>/api/import`
(multipart `file`). Both are admin API, so both are inside the `AuthAdapter`.

### frontmatter

| Key | Export | Import | What |
|---|---|---|---|
| `title` | always | required | |
| `date` | if published | required if published | Publication time, UTC ISO 8601 |
| `updated` | always | optional | `updated_at` |
| `description` | if set | optional | |
| `tags` | if any | optional | Tag names |
| `draft` | if a draft | optional | Published by default |
| `public_id` | **always** | optional (assigned) | Immutable identity |
| `paths` | always | optional | Canonical + aliases |
| `media` | if any | optional | Filename → attachment `public_id` |
| `ogp` | if chosen | optional | **Filename** of the attachment used for OGP |

- **Never drop `public_id`.** Re-importing without it changes the post's identity, which
  breaks both the URL and sameness for anyone subscribed. `media` exists for the same reason:
  without it, `<mount>/media/<public_id>/…` changes across a round trip.
- **`public_id` is validated by the same rules as a post path.** Let it through unchecked and
  `public_id: admin` lands in `post_paths` and eats a route.
- **The directory name is the canonical path**; `paths` is every path the post has. Rename
  the directory and the old canonical stays behind as an alias.
- `created_at` and `bluesky_uri` are **not carried**. The first is not displayed, and the
  second belongs to the D1 dump — lily-specific state does not belong in portable Markdown.
- **`ogp` is carried.** Unlike "has this been announced", which image is a post's face is
  information about the post, meaningful to another generator too. It names a **filename**,
  not a `public_id`, so it survives without `media`.
- A file with `public_id`, `paths` and `media` omitted reads fine. **That is the migration
  path** from a static-site generator's post directory.

### YAML is read and written here, not by a library

No general-purpose YAML parser is involved. This format *is* lily's contract, and lily writes
it too, so round-tripping has to be guaranteed rather than assumed. Scalars, quoted strings,
block and flow sequences, and a single level of mapping are supported; **anything else is
rejected rather than silently interpreted as something else** (the doc comment in
`src/core/transfer/frontmatter.ts` is the table). If a real YAML document ever becomes
necessary, one file gets replaced.

The writer does not decide quoting by "can my own parser read this back". **A string that a
standard YAML parser would read as a boolean or a number gets quoted** (`#tag`, `true`,
`0.5`, anything starting with a quote): exported Markdown will be read by other tools.

### Archives are written stored, and read deflated too

Writing is fixed to stored (no compression) because **the same content then produces the same
bytes.** Compressor output is implementation-defined, which would make "does it round-trip to
an identical archive" untestable. Posts are small and attachments are already-compressed
images, so it costs almost nothing.

Timestamps come from the data for the same reason (`updated_at` for posts, `created_at` for
attachments). **Never put the wall clock in.** Note that MS-DOS timestamps have 2-second
granularity, so "export twice and compare" passes even when the clock leaked in.

Deflate is accepted when reading so that **an archive you zipped by hand imports**. The CRC
is verified every time; silently importing a corrupt archive means noticing a missing post
much later. Zip64 is not supported.

### How an import behaves

- **Each post is imported independently, and only the failures come back.** One broken
  frontmatter must not reject the whole archive — that happens during every migration, and
  it hides which post was at fault.
- **An existing `public_id` is never overwritten.** "Overwrite" could mean the body, or the
  paths, or the attachments that disappeared, and picking wrong corrupts the post. Restoring
  into an empty database and migrating are both served without it.
- Attachments go in before rendering. The other order leaves `./sample.png` unresolved and
  the image silently missing from the published page.
- An archive carries no content types, so **attachment formats come from the extension** (the
  same set the admin API accepts). Anything else is a warning; the post still imports.
- A directory without `index.md` is not a post, and files nested below a post are not
  attachments.
- **`__proto__` in frontmatter is refused at the door.** Assigning it to a plain object
  creates no key, so it would slip through the "unknown keys are rejected" net unnoticed.

### Limits

The archive is held **entirely in memory**. Import is capped at 50MB, but the Worker's 128MB
and the subrequest limit (one R2 read per attachment) arrive sooner. Past a few hundred
posts, exporting in ranges becomes necessary.

## Backups

`runBackup` writes a portable archive to a second R2 bucket. Wire it to a Cron Trigger:

```jsonc
// wrangler.jsonc
"r2_buckets": [
  { "binding": "MEDIA", "bucket_name": "my-blog-media" },
  { "binding": "BACKUP", "bucket_name": "my-blog-backup" }
],
"triggers": { "crons": ["30 18 * * *"] }
```

```ts
import { runBackup } from '@kanf/lily';
import { lily } from './config';

export default {
  fetch: lily.fetch,
  async scheduled(_controller, env: Env) {
    // **await it.** Handing it to waitUntil makes the handler succeed regardless, and a
    // failure is then only visible in the logs.
    await runBackup(env.DB, env.MEDIA, env.BACKUP, { keep: 30 });
  },
} satisfies ExportedHandler<Env>;
```

- **The archive is the one `<mount>/api/export` returns.** No second implementation sits in
  the backup path, so the round-trip tests cover the backups too.
- **A separate bucket, not a prefix.** Put the backups beside the attachments and one
  mistaken bucket deletion or lifecycle rule takes the original and the copy together. The
  point of a backup is being somewhere else.
- **Generations are counted, not days.** "Delete anything older than n days" deletes
  *everything* after the cron has been down long enough. Counting keeps the last one that was
  taken.
- Keys are `archives/lily-<UTC ISO 8601 without separators>.zip`, so lexical order is
  chronological order and picking generations needs no date parsing (R2 lists keys ascending).
  Only keys with that prefix are counted, so an archive you upload by hand does not consume a
  generation.
- What is inside is recorded in `customMetadata` (`posts`, `media`, `warnings`), readable
  from an R2 listing without opening the zip.
- It runs **outside Cloudflare Access**, reading D1 and R2 directly from the Worker. Opening
  a machine-usable hole in the admin API would be one more hole than this.

**What this archive does not hold**: `bluesky_uri` and `created_at` — the portable format
does not carry them. Restore from the archive alone and "has this been announced" is gone
with it, so the double-post guard stops working. Keep a D1 dump as well if you want that
back:

```bash
# Fetch a backup. **`--remote` is required.** The r2 object commands default to the local
# simulated storage, and without it you are told the key does not exist instead of being
# pointed at the real bucket (`r2 bucket list`, asymmetrically, defaults to remote).
npx wrangler r2 object get my-blog-backup/archives/lily-<stamp>.zip \
  --remote --file /tmp/restore.zip

# The operational D1 dump (includes bluesky_uri and created_at)
npx wrangler d1 export DB --remote --output <file>
```

Cron triggers cannot be fired by hand, so check the morning after the first one that the
archive count went up (`npx wrangler r2 object list <bucket> --remote --prefix archives/`).
To test the wiring locally, `npx wrangler dev --test-scheduled` and hit `/__scheduled`.

## Three things that will not change

Changing these later would move data or break URLs, so they were settled first.

1. **Identity and URL are separate.** Identity is an immutable `public_id` (uuid v4); the URL
   lives in `post_paths`. URLs can be changed afterwards, and the old ones remain as aliases.
2. **Markdown does not know about the deployment.** No `/blog/...` is embedded in a body.
   Images stay as `./sample.png`, and the public URL is resolved at render time.
3. **`mountPath` is a first-class setting.** Mounting at `/blog` and at the root are equally
   supported, and exactly one module (`core/paths.ts`) builds URLs.

## License

ISC. See [`LICENSE`](./LICENSE).

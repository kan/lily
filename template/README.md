# my-blog

A blog on Cloudflare Workers, running [lily](https://github.com/kan/lily) (`@kanf/lily`).

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/kan/lily/tree/main/template)

**A Worker, a D1 database and an R2 bucket is the whole stack.** Posts live in D1, images
live in R2, and the admin UI ships prebuilt inside the package — there is no build step for
it, and no Vue toolchain on your side.

## Deploying with the button

The button copies this directory into a repository of your own, creates the D1 database and
the R2 bucket from the bindings in `wrangler.jsonc`, asks for the secrets listed in
`.dev.vars.example` (that is where the `ADMIN_PASSWORD` field comes from), and runs
`npm run deploy` — which applies lily's migrations and then deploys.

**A Cloudflare account is all it needs.** Nothing has to be created beforehand, and no
resource ID is ever pasted into the repository: the bindings are referenced by name.

Afterwards, set `site.url` in `src/config.ts` to the URL you are actually serving from (your
domain, or the `*.workers.dev` one) and push — it is the origin every absolute URL in the
feeds and `<link rel="canonical">` is built from.

## Running it locally

```bash
npm install
cp .dev.vars.example .dev.vars   # put a password in ADMIN_PASSWORD (12 characters or more)
npm run db:migrate:local         # create the tables in the local D1
npm run dev                      # http://localhost:8787
```

The admin UI is at `/admin/`. Without a password in `.dev.vars` it still opens locally: lily
falls back to the `localhostOnly` adapter, which only lets a request through when the host is
`localhost` or `127.0.0.1`. **That fallback cannot pass in production**, so forgetting the
secret does not leave the door open — it leaves it shut.

## Deploying from your machine

Without the button, the same thing by hand:

```bash
npx wrangler login
npm run deploy:first                      # the first time only (see below)
npx wrangler secret put ADMIN_PASSWORD    # 12 characters or more
```

Every deploy after that is `npm run deploy`.

**The two are not the same order, on purpose.** The D1 database and the R2 bucket are created
during the first `wrangler deploy`, from the bindings in `wrangler.jsonc`, so on the first run
there is nothing to migrate yet and the deploy has to come first. From then on the migrations
run **before** the deploy, so new code never meets an old schema.

## What is where

| Path | What |
|---|---|
| `src/config.ts` | **Everything site-specific**: name, URL, language, time zone, OGP image, which auth adapter, Bluesky |
| `src/index.ts` | The Worker entry point. Two lines, unless you add a scheduled backup |
| `public/` | Files served at the site root (`favicon.ico`, `ogp.png`, …). Create it if you need it, and list the names in `assets` in `src/config.ts` |
| `wrangler.jsonc` | Bindings, the assets directory, and the Text rule the theme's CSS needs |
| `.dev.vars.example` | The secrets this blog takes. Also what the *Deploy to Cloudflare* screen asks for |

`npm run build` merges `public/` and lily's prebuilt admin UI into `dist/`, which is what
`wrangler.jsonc` serves. It is a single command (`lily-assets`) that ships with lily, because
lily is what knows where its admin build lives.

## Writing posts

Everything happens in the admin UI: writing, drag-and-drop images, tags, scheduling the
publication time, changing a post's URL (the old one keeps working), previewing a draft
through a shareable link.

**Nothing about a post lives in this repository.** The source of truth is D1, so writing a
post means no commit and no deploy. To take your posts out — or to move them in from a static
site generator — use the export and import in the admin UI: a zip of
`posts/<path>/index.md` plus the images next to it, readable without lily.

## Backups (optional)

A daily copy of that same portable archive, in a second R2 bucket:

1. Add the bucket and a cron trigger in `wrangler.jsonc` (the commented block at the bottom).
2. Turn `src/index.ts` into a handler with a `scheduled` function:

```ts
import { runBackup } from '@kanf/lily';
import { lily } from './config';

export default {
  fetch: lily.fetch,
  async scheduled(_controller, env: Env) {
    // await it: handing this to waitUntil would make the handler succeed either way.
    await runBackup(env.DB, env.MEDIA, env.BACKUP, { keep: 30 });
  },
} satisfies ExportedHandler<Env>;
```

Generations are counted, not dated — 30 archives are kept, so the last one taken survives
however long the cron was down.

## Images through Cloudflare Images (optional)

Add `"images": { "binding": "IMAGES" }` to `wrangler.jsonc` and `media: { images: true }` to
the config. Attachments are then converted to AVIF or WebP at delivery time, **and fall back
to the original** on any failure. The URLs do not change either way, so turning it off later
rewrites nothing.

## Making it look different

`theme: defaultTheme` is a `Theme` implementation — four functions and one stylesheet. Copy
`node_modules/@kanf/lily/dist/lib/theme` into your own `src/theme/`, change what you want, and
pass yours instead. The theme receives the data for a page and nothing else; URLs are built
for it, so a copied theme keeps working if you move the blog to a subpath.

## Documentation

- [lily's README](https://github.com/kan/lily#readme) — the configuration reference, the
  public API, the auth adapters, the portable format
- [`DESIGN.md`](https://github.com/kan/lily/blob/main/DESIGN.md) — why lily is built the way
  it is (in Japanese)

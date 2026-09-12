# lily

[![npm](https://img.shields.io/npm/v/@kanf/lily.svg)](https://www.npmjs.com/package/@kanf/lily)
[![CI](https://github.com/kan/lily/actions/workflows/ci.yml/badge.svg)](https://github.com/kan/lily/actions/workflows/ci.yml)
[![License](https://img.shields.io/npm/l/@kanf/lily.svg)](./LICENSE)

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

Both paths leave you with the same directory, described below.

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

**A Cloudflare account, and nothing created inside it beforehand.** The D1 database and the R2
bucket come from the bindings (`DB`, `MEDIA`) on the first deploy, and no resource ID ever
goes in the repository. An `IMAGES` binding is optional, and so is a second R2 bucket for the
daily backup. Node 24 is what lily is built and tested on.

## The directory you end up with

Six files. **Everything about your blog is in one of them**, and none of them is generated
code you are expected to leave alone.

```
src/config.ts        the whole blog: name, URL, language, theme, auth, Bluesky
src/index.ts         the Worker entry. Two lines, until you add backups
wrangler.jsonc       the bindings (DB, MEDIA, ASSETS) and the assets directory
package.json         the commands below
.dev.vars.example    the secrets this blog takes, and what the deploy screen asks for
tsconfig.json
```

`src/config.ts` is where `init` puts your answers:

```ts
export const lily = createLily<Env & Secrets>({
  site: {
    url: 'https://example.com',
    name: 'My blog',
    description: 'A blog running on lily',
    author: 'Someone',
    lang: 'en',
    timeZone: 'UTC',
    ogImage: { url: 'https://example.com/ogp.png', width: 1200, height: 630 },
  },
  mountPath: '/',
  theme: defaultTheme,
  assets: [],
  // No secret means local only (leave it out of `.dev.vars` and you fall through to
  // localhost). **Forgetting the secret in production does not open the door**: neither
  // adapter lets anyone in.
  auth: (env) =>
    env.ADMIN_PASSWORD
      ? passwordAuth({ password: env.ADMIN_PASSWORD, secretName: 'ADMIN_PASSWORD' })
      : localhostOnly(),
});
```

The full file, comments and all, is
[`template/src/config.ts`](./template/src/config.ts); every field is in
[Configuration](./docs/configuration.md).

| Command | What it does |
|---|---|
| `npm run dev` | Builds the assets, applies the migrations to a local D1, serves on `localhost:8787` |
| `npm run deploy:first` | The first deploy: creates the D1 database and the R2 bucket, then migrates |
| `npm run deploy` | Every deploy after that: migrates, *then* deploys, so new code never meets an old schema |
| `npm run db:migrate` | Applies lily's migrations to the remote D1 by itself |
| `npm run typecheck` | `wrangler types` and `tsc` |

Writing happens in the admin UI at `/admin/`, so **a post is never a commit**. Locally it
opens without a password (lily falls back to the `localhostOnly` adapter); in production it
takes `npx wrangler secret put ADMIN_PASSWORD`, 12 characters or more.

## The rest

| | |
|---|---|
| [Configuration](./docs/configuration.md) | Every field of `createLily`, the URLs lily serves, and what the package exports |
| [Authentication](./docs/authentication.md) | The three adapters, what `passwordAuth` does and does not store, and how to write your own |
| [Themes](./docs/themes.md) | The `Theme` interface, and what the default theme promises so that a copy of it keeps the same properties |
| [Images](./docs/images.md) | R2 as the original, Cloudflare Images as an optional layer, and the caching that follows from it |
| [Import, export and backups](./docs/portable.md) | The archive format, the frontmatter contract, how an import behaves, and the daily copy to a second bucket |
| [Adding lily to an existing Worker](./docs/existing-worker.md) | The bindings, the assets rule and the build command, for a project that already exists |

Three more that are not about using it: [`DESIGN.md`](./DESIGN.md) for why lily is built this
way — the design record, in Japanese, and deeper than any page here;
[`CONTRIBUTING.md`](./CONTRIBUTING.md) for working on lily itself; and
[`SECURITY.md`](./SECURITY.md) for reporting a hole privately, which also says what lily does
and does not claim to protect.

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

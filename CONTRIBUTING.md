# Contributing

This is the page for working **on** lily. Using it is [`README.md`](./README.md) and
[`docs/`](./docs); why it is
shaped the way it is, in Japanese, is [`DESIGN.md`](./DESIGN.md).

**lily is an npm package, not a deployment.** The `wrangler.jsonc` at the root exists so that
Vitest can start a real workerd with the right bindings, and so `wrangler types` can generate
`Env`. This Worker is never deployed.

## Commands

```bash
npm install
npm test          # Vitest, on a real workerd with a real D1
npm run typecheck # wrangler types → tsc (two projects: src, and the admin UI)
npm run lint      # ESLint (type-aware; wrangler types runs first)
npm run build     # build both of the things that ship (below)
npm run db:migrate:local  # apply the migrations to the local D1 used by tests
```

`npm run build` has two halves, and both end up in the package:

| | What | With |
|---|---|---|
| `build:admin` | The admin UI (Vue) into `dist/admin` | vite |
| `build:lib` | The CMS itself into `dist/lib` (`.js` + `.d.ts` + the default theme's `.css`) | `tsc -p tsconfig.build.json` + `scripts/copy-lib-assets.mjs` |

## Things that will bite you

**`exports` points at `dist/lib`.** From a consumer linked with `file:`, editing `src/` sends
them nothing at all. While going back and forth, run `npm run build:lib:watch` alongside —
and note that `tsc --watch` ignores `.css`, so editing the default theme's `style.css` needs
a plain `npm run build:lib`.

**Vitest does not run without a build**, because the test `wrangler.jsonc` points
`assets.directory` at `dist/`. `npm test` handles it through `pretest`, which builds
`dist/admin` and runs `scripts/test-assets.mjs` for the test-only static assets (a favicon
and an OGP image). **`pretest` does not build `dist/lib`** — lily's own tests read `src/`
directly. Those test assets are **not in the package**: what to serve is the consumer's
decision via `PageConfig.assets`, so lily ships no images at all.

**The migrations are the only definition of the schema.** Consumers point
`migrations_dir` at `node_modules/@kanf/lily/migrations`, so a migration that lands in a
release is a migration someone else will run.

**`src/index.ts` is the boundary.** Anything not exported from it is free to move; anything
exported from it needs a thought about who is importing it.

## Layout

```
migrations/   D1 migrations, plain SQL. The only definition of the schema
bin/          **Ships.** lily: `npx @kanf/lily init` writes a new blog from template/.
              lily-assets: merges a consumer's public/ and the prebuilt admin UI into one
              directory. Plain .mjs because they run on Node, unlike dist/lib
template/     A minimal consumer project. **Ships too** (init copies it from the package,
              so a scaffolded blog matches the lily that made it), except its
              package-lock.json — that one is committed for the Deploy to Cloudflare
              button, which installs with npm ci from GitHub
src/
  index.ts    The public API. Consumers import nothing else
  core/       The CMS itself (knows nothing site-specific)
    db/       Row types and queries. SQL does not leave this directory
    paths.ts  mountPath and URL construction, normalizePostPath / normalizeSegment
    slug.ts   Tag name → slug (ends up in normalizeSegment)
    api/      The admin API, mounted at <mount>/api without knowing the mount
    auth/     The AuthAdapter type, the three adapters and the login page
    feed/     RSS 2.0 and Atom. Both full text
    media/    Optional image optimisation, accepted formats, dimensions from headers
    render/   Markdown → HTML, in two stages: one when storing, one when serving
    transfer/ Portable import/export: frontmatter, zip, round-trip rules
    routes/   fixed.ts is the canonical list of core's route names. public.ts is
              for humans, feeds.ts for machines (and static assets), media.ts for
              attachments, api.ts is the protection boundary (require-auth.ts inside)
    admin-hint.ts The cookie marking a browser that has opened the admin UI; the
              code that sets it and the code that clears it, side by side
    theme.ts  What a theme implements. core serves no page HTML of its own
              (one exception: auth/login-page.ts)
    date.ts   Date formatting parts. core does not use them; themes and the admin
              UI do, passing in the configured timeZone
  theme/      The default theme. A Theme implementation with no site-specific value
  admin/      The Vue admin UI. Built separately (vite) into dist/admin
scripts/      **None of these ship.** test-assets.mjs (test images), clean-lib.mjs /
              copy-lib-assets.mjs (cleaning dist/lib and carrying the .css),
              check-fresh.mjs (is dist/lib older than src? consumers call it)
test/         Vitest. Must pass knowing nothing about any consumer
.github/      CI (typecheck + emit + test on push/PR), publish (on v* tags), dependabot
tsconfig.json        Type checking (src + test). tsconfig.admin.json is the admin UI
tsconfig.build.json  The emit that ships (dist/lib). Extends the above
```

## Lint

**The linter only looks at what the type checker cannot.** `tsconfig.json` already runs
`strict`, `noUnusedLocals`, `noUnusedParameters` and `noUncheckedIndexedAccess`, so ESLint
adds the type-aware rules on top of that — missing `await`, floating promises, `any`
spreading out of an untyped boundary, pointless type assertions — plus the Vue template
rules, which live outside `tsc` entirely. `npm run lint -- --fix` applies what is
auto-fixable; check the result, since `no-unnecessary-type-assertion` can be wrong about an
assertion that is feeding a generic like `Response.json<T>()`.

**There is no formatter**, and therefore no formatting rules: `eslint-plugin-vue` is used at
`flat/essential`, not `flat/recommended`, because most of the difference is "how many
attributes per line". Rules that are turned off are turned off with the reason written next
to them in `eslint.config.js`; keep it that way.

Type information comes from two different tsconfigs, so the admin UI (`src/admin/`, including
`.vue`) is linted with syntax-only rules — its types are checked by `vue-tsc` instead. The
reasoning is in the file's doc comment.

## Tests

Tests run on a real workerd with a real D1 (`@cloudflare/vitest-plugin`), not a mock.

**The test suite must not know about any consumer.** Before lily was extracted, core's own
tests imported fushihara.net's theme — tests meant to prove that core had no `/blog` baked
into it. Nothing under `test/` sees a consumer now, and that is worth keeping.

**E2E lives on the consumer side**, not here. That the public URLs and feeds did not change
is judged by a browser against a real site; a consumer's E2E still passing after swapping
lily in is the evidence that the outward contract held.

## CI and releases

CI runs `typecheck`, then `lint`, then `build:lib`, then `test`. **The emit runs separately from the type
check** because `typecheck` is `--noEmit` and would pass on a state where only the emit is
broken — and the emit is what ships.

Publishing happens **on a `v*` tag**, from `.github/workflows/publish.yml`, via npm Trusted
Publishing (OIDC), so no token sits in the repository secrets. The workflow refuses to
publish when the tag and `package.json`'s `version` disagree: a mismatch would otherwise
publish the wrong version, or fail with a message that cannot be traced back to the tag.

The same run then **creates the GitHub Release** for that tag, with notes generated from the
commits since the previous release. It runs after `npm publish`, so a release never exists
for a version that failed to publish.

Bumping the version and tagging are deliberately two steps: deciding to release is not the
same decision as changing the code. After a release, point the template at what you just
published — `cd template && npm install @kanf/lily@latest --package-lock-only` — which moves
both the range and the lock. **The range matters on a minor bump**: `^0.3.0` does not accept
`0.4.0`, so `npm update` alone would leave the button's copy a minor behind.

**One thing lives outside the repository**: on npmjs.com, the trusted publisher for this
package must allow *direct* publishing. New trusted-publisher configurations default to
staged publishes only, and `npm publish` then fails with `403 OIDC permission denied`.

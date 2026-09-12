# Adding lily to a Worker you already have

[lily](../README.md) → Adding lily to a Worker you already have

`init` writes a new project. To put lily inside an existing one instead:

```bash
npm install @kanf/lily
```

```jsonc
// wrangler.jsonc
{
  // lily owns the schema. **Do not copy the migrations** — point at the directory.
  // No resource IDs: `wrangler deploy` creates what the bindings name.
  "d1_databases": [{
    "binding": "DB", "database_name": "my-blog",
    "migrations_dir": "./node_modules/@kanf/lily/migrations"
  }],
  "r2_buckets": [{ "binding": "MEDIA", "bucket_name": "my-blog-media" }],
  // Where the admin UI and your static assets are served from.
  "assets": { "binding": "ASSETS", "directory": "./dist", "run_worker_first": true },
  // Theme CSS is bundled as a string. **Keep `fallthrough`** — without it, wrangler's
  // default rules are disabled wholesale.
  "rules": [{ "type": "Text", "globs": ["**/*.css"], "fallthrough": true }]
}
```

The admin UI is **shipped prebuilt**, so there is no Vue toolchain on your side. Merging it
with your own static files is one command, which comes with the package:

```jsonc
// package.json — puts public/ and lily's admin UI into dist/
"build": "lily-assets dist public"
```

`lily-assets` lives in lily because lily is what knows where its admin build is, whether that
build is complete, and whether it is stale — copy that logic into every consumer and it goes
out of date the day lily changes shape.

Then `createLily(...)` as above, export the app from your Worker, and apply the migrations:

```bash
npx wrangler d1 migrations apply DB --remote
npx wrangler secret put ADMIN_PASSWORD
```


# Portable import and export, and backups

[lily](../README.md) → Portable import and export

## The format

**The shape you can import is the shape you export.**

```
posts/<canonical-path>/index.md    frontmatter + body (relative references intact)
posts/<canonical-path>/sample.png  attachment
```

This is not a D1 dump. A dump depends on D1 and R2 being the storage; this is Markdown and
images, so **the posts outlive lily.**

The endpoints are `GET <mount>/api/export` (returns the zip) and `POST <mount>/api/import`
(multipart `file`). Both are admin API, so both are inside the `AuthAdapter`.

## frontmatter

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

## YAML is read and written here, not by a library

No general-purpose YAML parser is involved. This format *is* lily's contract, and lily writes
it too, so round-tripping has to be guaranteed rather than assumed. Scalars, quoted strings,
block and flow sequences, and a single level of mapping are supported; **anything else is
rejected rather than silently interpreted as something else** (the doc comment in
`src/core/transfer/frontmatter.ts` is the table). If a real YAML document ever becomes
necessary, one file gets replaced.

The writer does not decide quoting by "can my own parser read this back". **A string that a
standard YAML parser would read as a boolean or a number gets quoted** (`#tag`, `true`,
`0.5`, anything starting with a quote): exported Markdown will be read by other tools.

## Archives are written stored, and read deflated too

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

## How an import behaves

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

## Limits

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


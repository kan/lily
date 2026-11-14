# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
Versions up to 0.5.2 are listed on the
[GitHub Releases](https://github.com/kan/lily/releases) page.

## [Unreleased]

### Added

- `<mount>/search.json?q=` searches the published posts and answers JSON in the shape
  `posts.json` uses, newest first, with `next` for the following page. It needs no
  authentication and never sees drafts. Words are matched as substrings, so a word in the
  middle of a Japanese sentence is found. See [AI agents](docs/agents.md#search).
- Migration `0004_posts_fts.sql` adds the search index: an FTS5 table that triggers keep in
  step with the posts, filled with the published posts when it is applied. **Run the
  migrations before deploying**, as with every release.

### Changed

- **`search.json` is now a reserved path.** A post whose path starts with that segment can
  no longer be created; an existing one would be shadowed by the search endpoint.
- **`wrangler d1 export` no longer works as it stands**: D1 refuses to export a database with
  a virtual table, and the search index is one. The portable export and the R2 backups are
  not affected. The steps to take a D1 dump anyway are in
  [Portable and backups](docs/portable.md#exporting-d1-with-the-search-index).

### Fixed

- Writing frontmatter no longer slows down on a long run of digits that does not end
  as a number (for example a title of many `0`s followed by a letter). The check that
  decides whether a value looks like a number took quadratic time on such input. It
  runs on export and on the Markdown answer to AI agents.

## [0.6.0] - 2026-11-13

### Added

- Public pages now answer AI agents. A request with `Accept: text/markdown` to the
  index, a tag page or a post gets Markdown at the same URL: a post is its stored
  Markdown with a frontmatter block and absolute attachment URLs, and a list page is
  a list of links with `prev` / `next`. The 404 answers in Markdown too, still with
  status 404. Browsers and `curl` keep getting HTML. See
  [AI agents](docs/agents.md).
- These responses carry `Vary: Accept` and a `Link` header pointing to the other
  form, the sitemap and the RSS feed. The Markdown is never put in a shared cache
  (`private`), so a browser cannot be served it from the edge.
- The HTML of the index, tag pages and posts carries JSON-LD (`Blog`,
  `CollectionPage`, `BlogPosting`). The new optional `site.authorUrl` and
  `site.sameAs` settings add a URL and other profiles to the author.
- `PageContext` has a new optional `jsonLd` field: the JSON-LD for the page,
  already escaped for a `<script>` element, or `null`. The default theme emits
  it; a custom theme keeps working without it and can add one line to emit it
  ([Themes](docs/themes.md)). Code that builds a `PageContext` by hand still
  compiles.

## [0.5.4] - 2026-11-06

### Security

- lily now requires hono 4.13.16 or later. That release fixes
  [GHSA-46wx-v44x-9hh2](https://github.com/advisories/GHSA-46wx-v44x-9hh2): a
  POST with the content type `text/ping` (sent by Chromium's `<a ping>`) was
  not checked by `csrf()`, which lily puts in front of the admin API. Before
  this release, a blog could keep an older hono from its own lockfile even
  after upgrading lily. The template's lockfile is moved to the fixed version
  too.

## [0.5.3] - 2026-11-04

### Internal

- Releases are prepared by [tagpr](https://github.com/Songmu/tagpr): a release
  pull request carries the version bump and this file's section, and merging it
  tags the release and publishes it to npm. The GitHub release notes are now
  this file's section for the version instead of a list of commits.

[0.6.0]: https://github.com/kan/lily/releases/tag/v0.6.0
[0.5.4]: https://github.com/kan/lily/releases/tag/v0.5.4
[0.5.3]: https://github.com/kan/lily/releases/tag/v0.5.3

# Themes

[lily](../README.md) → Themes

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
- All user-visible strings are in one file, one table per language. **Which table is used
  comes from the configuration** (`site.uiLang`, falling back to `site.lang`), never from the
  reader's `Accept-Language`: public pages sit in shared caches, and Cloudflare's edge ignores
  every `Vary` except `Accept-Encoding`, so the language returned to one reader is the one
  served to the next. A language with no table falls back to English, so the page always
  renders. `resolveLocale` and `siteLocale` are exported for a theme that keeps the same rule.

Dates are formatted by passing `SiteConfig.timeZone` to `core/date.ts`, and the reader-facing
form is left to `Intl` via `SiteConfig.lang`. `<time datetime>` stays ISO 8601, so machines
are unaffected by the display format.


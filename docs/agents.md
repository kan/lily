# AI agents

[lily](../README.md) → AI agents

An agent that reads your blog does not need the header, the theme toggle or the stylesheet.
lily serves it the post itself, at the same URL, and tells it where everything else is.
Nothing here needs configuring; `site.authorUrl` and `site.sameAs` only add to the JSON-LD
([Configuration](./configuration.md)).

**Search and the MCP server can be turned off**, and both are on by default:

| Setting | What goes away |
|---|---|
| `search: false` | `search.json`, the `search_posts` tool (MCP and WebMCP), and their entries in the API Catalog |
| `mcp: false` | `<mount>/mcp`, its Server Card, the AI Catalog, and the MCP entry in the API Catalog |

**The paths stay reserved either way**, so turning a feature on later never takes a URL from
an existing post.

## Markdown at the same URL

Send `Accept: text/markdown` to the index, a page of it, a tag page or a post, and the
response is `text/markdown; charset=utf-8` instead of HTML.

- **A post is its stored Markdown**, not a conversion of the HTML, so it reads the way it
  was written. A YAML frontmatter block comes first (`title`, `description`, `url`,
  `published`, `updated`, `tags`, `lang`), then `# <title>`, then the body.
- **Relative attachment references become absolute media URLs** in the response
  (`./sample.png` → `https://…/media/<id>/sample.png`), matched by the same rule the HTML
  renderer uses. The stored body keeps its relative references, and code blocks are left
  untouched.
- **The index and tag pages are a list of links** to the posts, newest first. The next and
  previous pages are in the frontmatter as `prev` and `next`, as absolute URLs.
- **The 404 is Markdown too, and still a 404.** It holds a heading and links to the top page
  and the sitemap.
- The Markdown carries no words of lily's own. Headings are the site name, the post title or
  the tag name — the words lily puts on screen live in three files, and this is not a fourth.

Markdown is chosen only when the request ranks `text/markdown` **above** `text/html`,
wildcards included. A browser, `curl` and a plain `fetch` all get HTML; a tie goes to HTML;
nothing is ever answered with `406`. Draft previews are HTML only.

## Search

`GET <mount>/search.json?q=<words>` searches the published posts and answers JSON. It needs
no authentication and only reads: drafts are never in the index it searches.

```json
{
  "query": "full text",
  "posts": [
    {
      "id": "…",
      "title": "…",
      "url": "https://example.com/blog/my-post/",
      "published_at": "2026-11-14T00:00:00.000Z",
      "description": "…",
      "tags": ["dev"]
    }
  ],
  "next": "https://example.com/blog/search.json?q=full+text&limit=10&offset=10"
}
```

- **A post matches when it contains every word**, in its title, description or body.
  Words are separated by spaces (a full-width space counts). Matching is by substring, so a
  word in the middle of a Japanese sentence is found; ASCII letters match regardless of case.
- **Newest first**, the same order as `posts.json` — not ranked by relevance. Each entry has
  the shape `posts.json` uses. The body is not included: fetch the post's `url` with
  `Accept: text/markdown`.
- `limit` defaults to 10 and is capped at 20. `next` is the next page as an absolute URL, or
  `null` when there is none. **`offset` goes up to 1000**: `next` never points past it, and a
  larger `offset` is refused rather than clamped, so a client counting pages itself is not
  handed the same page again.
- **`q` is limited to 100 characters and 5 words.** An empty, too long or too wordy `q`, or
  an `offset` over 1000, answers `400` with
  `{ "error": "empty" | "too-long" | "too-many-terms" | "offset-too-large", "message": … }`.
  Quotes, `*`, `AND` and the like are searched as text, not read as query syntax. The words
  are not Unicode-normalized: they are matched against the text as it was saved.
- Responses carry `s-maxage=60`, like `posts.json`. Each query is a different URL, so the
  edge absorbs repeats of the same query only. **lily does not rate-limit the endpoint.** If
  you need to, put a Cloudflare rate limiting rule on the path.

The index is a D1 FTS5 table (`posts_fts`, trigram tokenizer) that triggers keep in step
with `posts`. Words shorter than three characters cannot use a trigram index and are
matched by scanning the indexed posts instead. **The table stops `wrangler d1 export` from
working** — see [Portable and backups](./portable.md#exporting-d1-with-the-search-index).

## MCP

`<mount>/mcp` is an MCP server (Streamable HTTP) with three read-only tools. It needs no
authentication and has no tool that writes, so nothing it serves is more than the public
pages already show.

| Tool | Arguments | Returns |
|---|---|---|
| `search_posts` | `query`, `limit` (1–20), `offset` (0–1000) | The [search](#search) results, in the same shape, as `structuredContent` and as JSON text. `next_offset` instead of `next` |
| `get_post` | `url` | The post as Markdown, the same text `Accept: text/markdown` returns. `url` may also be a path under the site or the post's id. A draft, a post that does not exist and a URL on another origin all answer "No published post" |
| `list_tags` | none | Tags that have published posts, with their URL and post count, most used first |

- **Both protocol eras are served**: 2026-07-28 (no handshake; `server/discover`) and the
  revisions before it (`initialize`). The server is stateless: nothing is kept between
  requests, `GET` and `DELETE` answer `405`. The protocol is handled by
  `@modelcontextprotocol/server`.
- Every tool is annotated `readOnlyHint: true`, `idempotentHint: true`, `openWorldHint: false`.
- A query the search refuses (too long, too many words, `offset` over 1000) comes back as a
  tool result with `isError: true` and an explanation, not as a protocol error.
- **A request with an `Origin` header is served only when it is the site's own origin**
  (otherwise `403`), as the specification requires against DNS rebinding. Requests without
  one — MCP clients running on a server — are served. lily sends no CORS headers.
- Responses carry `Cache-Control: no-store`. A request body over 64 KiB is refused with
  `413`. As with search, **lily does not rate-limit it**.

To connect a client, give it `https://<your site><mount>/mcp`.

## `posts.json`

`GET <mount>/posts.json?limit=<n>` lists the newest published posts in the shape search
uses (`limit` defaults to 5, capped at 20). It was made for another site to show your
latest posts, and it is listed in the API Catalog.

## Discovery

lily publishes where its machine-readable endpoints are, so an agent does not have to
guess:

| Path | Format | What |
|---|---|---|
| `<mount>/.well-known/api-catalog` | `application/linkset+json` ([RFC 9727](https://www.rfc-editor.org/rfc/rfc9727)) | `posts.json`, `search.json` and the MCP server, each with a link to its documentation. `HEAD` answers with `Link: rel="api-catalog"`, as the RFC requires |
| `<mount>/mcp/server-card` | `application/mcp-server-card+json` ([SEP-2127](https://modelcontextprotocol.io/seps/2127-mcp-server-cards)) | The MCP server's name, description and URL. The name is the host reversed plus the mount (`com.example/blog`; `com.example/lily` at the root; characters the name cannot hold become `_XX` UTF-8 bytes, so `/日記` and `/写真` stay distinct). Tools are not listed — the proposal leaves them to `tools/list` |
| `<mount>/.well-known/ai-catalog.json` | `application/ai-catalog+json` (same proposal) | Points to the Server Card. The entry and the `host` carry `displayName` (the site name): the AI Catalog spec suggests leaving it out, but [ARD](https://agenticresourcediscovery.org/spec/) requires it, and isitagentready checks against ARD |

- Every public page's `Link` header points to the API Catalog (`rel="api-catalog"`), so it
  can be found from any page, wherever it lives.
- All three carry `Access-Control-Allow-Origin: *`, `Cache-Control: public, max-age=3600`
  and an `ETag`. They are built from the configuration alone and change only on deploy.
- The Server Card and the AI Catalog are drafts of the MCP project, not part of the
  2026-07-28 specification. lily follows them as they stand and will change with them.

**`/.well-known/` belongs at the root of the site.** With `mountPath: '/'` these are the
real well-known documents. With a mount like `/blog`, they are at
`/blog/.well-known/…`, and the root ones are yours to serve: redirect
`/.well-known/api-catalog` and `/.well-known/ai-catalog.json` to the mounted ones (RFC 9727
recommends a redirect for this), or answer them from whatever serves your root. lily does
not reach outside its mount.

## WebMCP

Every page that has its own URL (index, tag pages, posts) carries a small script that
registers two tools through [WebMCP](https://webmcp.org/) (`document.modelContext`), so an
agent running in the browser can use them on the page it is looking at:

| Tool | What it does |
|---|---|
| `search_posts` | Calls `search.json` and returns its JSON. Not registered with `search: false` |
| `get_post` | Fetches the post's URL with `Accept: text/markdown` and returns the Markdown. Only URLs on this site under the mount are fetched, and only a post is returned — the index, a tag page or a JSON endpoint answers "No published post", as the MCP tool does |

- The names, descriptions and arguments are those of the MCP tools. No new endpoint is
  involved: the script calls what the page could already reach.
- **A failure is thrown, not returned**: a refused search (with the `message` from
  `search.json`), "No published post", or a failed request. That is how WebMCP tells the
  agent a call failed, as `isError` does in MCP.
- **In a browser without WebMCP the script does nothing**, and a refused registration
  (the `tools` Permissions Policy turned off) does not break the page.
- Requests go to the page's own origin, so a page opened on a preview host does not call
  production. `get_post` given a URL on `site.url` (as search results carry) fetches it from
  the page's origin; the search results themselves are returned unchanged.
- WebMCP is a W3C Community Group draft, behind an origin trial in Chrome and Edge. Like
  the Server Card, it may change.

Core builds the script; the theme places it (`PageContext.webMcp`, the same split as the
JSON-LD below). The standard theme puts it in `<head>`. **A theme of your own has to place it
too**, or the tools do not exist on its pages ([Themes](./themes.md)).

## Caching

Both forms carry `Vary: Accept`. **Only the HTML may sit in a shared cache**
(`s-maxage=60`, as before); the Markdown is `private, max-age=0, must-revalidate`.
Cloudflare's edge ignores every `Vary` except `Accept-Encoding`, so a cached Markdown
response would be served to the next reader who opens the page in a browser. Keeping the
shared cache HTML-only is the same rule lily follows for images converted per `Accept`
([Images](./images.md)).

The other direction is left to you. Cloudflare does not cache HTML unless a Cache Rule
tells it to, so by default every agent reaches lily. **If you cache HTML at the edge**
(Cache Everything), a request for Markdown that lands within those 60 seconds gets the cached
HTML instead — readable, just not the Markdown. lily keeps the HTML cacheable because that is
what readers load.

## `Link` headers

Every one of those responses carries an RFC 8288 `Link` header, so an agent can find the
other forms without parsing HTML:

| Relation | Points to |
|---|---|
| `rel="alternate"; type="text/markdown"` (on HTML) / `type="text/html"` (on Markdown) | The same URL in the other form. Not sent on the 404, which has no URL of its own |
| `rel="sitemap"` | The sitemap index |
| `rel="alternate"; type="application/rss+xml"` | The RSS feed |
| `rel="api-catalog"` | The [API Catalog](#discovery): search, `posts.json` and the MCP server |

## JSON-LD

The HTML of the index, tag pages and posts carries schema.org data in
`<script type="application/ld+json">`:

| Page | Type | What it says |
|---|---|---|
| Index | `Blog` | Name, description, URL, language, author |
| Tag | `CollectionPage` | Tag name, URL, language, and the `Blog` it belongs to |
| Post | `BlogPosting` | Headline, description, URL, dates, language, image (the post's own OGP image, or the site's), tags as `keywords`, author, and the `Blog` it belongs to |

The author is a `Person` named `site.author`. Its `url` and `sameAs` appear only when
`site.authorUrl` and `site.sameAs` are set — lily does not know which accounts are yours.

Core builds the data; the theme only places it ([Themes](./themes.md)). A title containing
`</script>` cannot close the element: `<`, `>` and `&` are escaped as `<` and so on,
which a JSON parser reads back as the same characters.

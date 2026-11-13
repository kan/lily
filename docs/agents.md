# AI agents

[lily](../README.md) → AI agents

An agent that reads your blog does not need the header, the theme toggle or the stylesheet.
lily serves it the post itself, at the same URL, and tells it where everything else is.
Nothing here needs configuring; `site.authorUrl` and `site.sameAs` only add to the JSON-LD
([Configuration](./configuration.md)).

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

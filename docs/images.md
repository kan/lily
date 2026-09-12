# Images

[lily](../README.md) → Images

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


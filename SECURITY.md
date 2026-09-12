# Security Policy

## Supported versions

lily is pre-1.0. **Only the latest published version is fixed** — there are no maintenance
branches for older ones. If you are running something older, updating is the fix.

## Reporting a vulnerability

Use GitHub's private vulnerability reporting: the
[Security tab](https://github.com/kan/lily/security) → *Report a vulnerability*.

**Do not open an issue.** Issues here are public, so filing one is the disclosure.

Useful to include:

- The version of `@kanf/lily`, and which auth adapter the deployment uses
- What an attacker can reach or change that they should not be able to
- The steps to get there, ideally against a local `wrangler dev`

This is maintained by one person, so expect a first reply within about a week rather than
the same day. How fast a fix ships depends on what it lets an attacker do; anything that
gets past the protection boundary is handled before other work.

## What is in scope

The parts where lily makes a security claim, and therefore can break one:

- **The protection boundary.** Anything at `<mount>/api/*` or `<mount>/admin/*` that resolves
  without passing the configured `AuthAdapter`.
- **The adapters themselves**: forging or extending a `passwordAuth` session cookie,
  accepting a `cloudflareAccess` JWT that Access did not issue (wrong AUD, wrong team, wrong
  signer, empty `sub`), or making `localhostOnly` pass on a request that did not come from
  localhost.
- **CSRF.** The endpoints that read no body (`unpublish`, `rerender`) and the multipart one
  (`media`) are reachable from a plain HTML form, so they check the origin. A way around that
  check is in scope.
- **Route shadowing.** A post path, attachment `public_id`, or imported `public_id` that
  takes over a reserved route (`admin`, `api`, `media`, a served static asset…).
- **Import.** Anything in an uploaded archive that escapes the post it belongs to — an entry
  that lands outside its own `posts/<path>/` directory, a frontmatter key that reaches
  `Object.prototype`, an attachment that takes over another post's media.
- **Injection in what gets served.** Markdown rendering, link cards, feeds and the login page
  all produce HTML or XML; a stored payload that executes in a reader's browser is in scope.
- **Attachment delivery.** Serving something other than the attachment the URL names, or
  poisoning a shared cache through the `Accept` negotiation.

## What is not in scope

- **A deployment's own configuration.** A missing `ADMIN_PASSWORD` (lily then falls through
  to `localhostOnly`, which cannot pass in production), Cloudflare Access session settings,
  R2 bucket policies, who holds the Cloudflare account. These are the operator's, not lily's.
- **`localhostOnly` being permissive.** That is what it is for. It is only reachable when the
  request host is `localhost` or `127.0.0.1`.
- **Resource exhaustion behind authentication**, such as a 50MB import filling the Worker's
  memory. The limits are documented in
  [`docs/portable.md`](./docs/portable.md#limits); if you find a way to trigger that work
  *without* authentication, that is in scope.
- **Bugs in Cloudflare's platform or in dependencies.** Report those upstream. Dependabot
  watches this repository's dependencies and its advisories.

## Notes for deployments

The choices lily makes that an operator should know about, all covered in more depth in
[`docs/authentication.md`](./docs/authentication.md):

- The admin password lives in a Worker secret and is **never stored in D1**. Rotating it means
  replacing the secret, which also invalidates every session cookie already handed out — the
  session key *is* the password.
- Passwords shorter than 12 characters are refused, because the only defence against brute
  force is a delay on failure.
- Cookies are `HttpOnly`, `SameSite=Lax`, scoped to the mount path, and `Secure` over https.
  They last 30 days and are not extended.
- With `cloudflareAccess`, lily verifies the JWT even though Access already stopped the
  request. Both the team name and the AUD must be set; with either missing, lily refuses to
  use Access rather than half-using it.

## Disclosure

Fix first, advisory after. Security advisories are published through GitHub once a fixed
version is out, and reporters are credited unless they would rather not be.

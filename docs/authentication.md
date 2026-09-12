# Authentication

[lily](../README.md) → Authentication

`<mount>/api/*` and `<mount>/admin/*` are unreachable without passing the `AuthAdapter`.

**Core knows no authentication method.** Three adapters ship with lily, and `auth: (env) =>
...` picks one — it takes `env` so that deployment-specific values such as a team name or a
password are not baked into the repository.

| Adapter | What | Needs |
|---|---|---|
| `passwordAuth` | **The default setup.** One password | One secret |
| `cloudflareAccess` | Verifies the JWT Access puts on the request | A Zero Trust configuration |
| `localhostOnly` | The local-development escape hatch. **Structurally unreachable in production** | Nothing |

- A rejection does not say why it was rejected: how close an attempt got is exactly the clue
  worth having if you are the one guessing.
- **Authentication alone is not enough.** Sessions are cookies in either scheme, so they ride
  along on requests sent from other sites. The endpoints that read no body (`unpublish`,
  `rerender`) and the multipart one (`media`) can be reached from a plain HTML form, so
  `csrf()` checks the origin.

## `passwordAuth`

The password lives in a Worker secret; a successful login gets an HMAC-signed cookie. **There
is nothing to store** — no D1 table, no migration.

```ts
auth: (env) =>
  env.ADMIN_PASSWORD
    ? passwordAuth({ password: env.ADMIN_PASSWORD, secretName: 'ADMIN_PASSWORD' })
    : localhostOnly(),
```

```bash
npx wrangler secret put ADMIN_PASSWORD
```

- **No password hash in D1.** The Workers free plan gives a request 10ms of CPU, and the
  OWASP-recommended 600,000 PBKDF2 iterations do not fit. That leaves "the standard setup
  does not run on the free plan" or "weaken the hash". Comparing against a secret needs no
  KDF at all — **there is no hash in a database that needs stretching to protect it.**
- **No first-run setup screen**, because that opens a window where anyone can become the
  administrator while the user table is empty. The secret is already in place at deploy time.
- Passwords are compared **after hashing both sides with SHA-256**, so neither the length nor
  how many characters matched shows up in the timing.
- **The session key is the password itself.** Replace the secret and every cookie already
  handed out is void. A separate `SESSION_SECRET` would remove that property: changing the
  password would leave a stolen cookie alive.
- The cookie is `HttpOnly`, `SameSite=Lax`, `Path=<mount>/`, and `Secure` only over https
  (local development and E2E run on http, where `Secure` would make login impossible). It
  lasts 30 days by default and is **not extended**.
- The only defence against brute force is **a delay on failure** (500ms by default; it costs
  no CPU, so it works on the free plan). That is why passwords shorter than 12 characters are
  refused — **a short password should not feel protected.**
- **"Not set" and "too short" stay distinct all the way to the screen.** Collapse them and an
  operator who set a short secret is told to set one, and re-enters the same value forever.
  The secret's name appears on screen only if you pass `secretName`: **core does not know
  what your deployment calls it.**
- Login is at `<mount>/admin/login` and logout at `<mount>/admin/logout` (POST only — a GET
  logout gets triggered by prefetches and image loads). **Both sit in front of
  authentication.**
- Logging out also clears the marker cookie that reveals the admin link on public pages.
  There is no reason for an "Admin" link to linger on a shared machine.
- **The password cannot be changed from the UI** (change the secret instead). If you need
  several users or a change-password screen, write your own `AuthAdapter`.

## `cloudflareAccess`

- Access stops the request before the Worker, so verifying here is **a second line**: it
  keeps the admin UI shut on paths that bypass Access (a missing route rule, a direct request
  to another hostname).
- The team name and AUD go in `vars` — not secret, but per-deployment. Access is used **only
  when both are present**; if either is missing, lily falls back to `localhostOnly`, which
  means production stays closed. Half-configured Access is the dangerous state, so which mode
  was chosen is decided in one place and logged once at startup.
- **After the JWT expires the API keeps returning 403.** The only way back is a top-level
  navigation through Access, so the admin UI reloads itself when it sees a 401 or 403.
- **Session length is Access's setting**, not something this repository can change.
- **No logout button appears in the admin UI.** The session is held outside the Worker, so
  the button would do nothing. It follows automatically from the adapter having no `handle`.

## `localhostOnly`

The escape hatch that keeps you from being locked out of your own machine. **It cannot pass
in production**: the decision is made on the request host alone, and anything other than
`localhost` or `127.0.0.1` is refused. Cloudflare routes by host, so a request arriving at a
real domain or `*.workers.dev` never satisfies it.

## Writing your own adapter

An `AuthAdapter` is a `name` and an `authenticate(request)`; that is the whole requirement.
The one optional member, `handle`, is what declares "this method can be logged into from a
screen", and core derives three things from its presence:

| What core decides | From |
|---|---|
| Whether `<mount>/admin/login` and `/logout` are handed to the adapter | `handle` |
| Whether an unauthenticated browser navigation goes to the login page instead of 403 | same |
| Whether the admin UI shows a logout button | same |

Core also decides *how* to refuse: browser navigations go to the login page, while `/api/*`
stays a 403 (redirecting it would make the admin UI parse login HTML as JSON). The adapter
only ever sees requests to those two paths — handing it everything would run adapter logic
for every admin asset and push "reject the paths I don't own" onto every adapter author.


# Security & Privacy

## Threat model

Assets worth protecting, in order:

1. **Customers' faces.** The most sensitive thing here. A leak is unrecoverable for the person.
2. **API credentials.** `DECART_API_KEY` and `STRIPE_SECRET_KEY` are directly monetisable.
3. **Revenue integrity.** Free AI sessions, or refunds issued by the wrong person.
4. **The admin dashboard.** Sales data and the controls behind it.

### Adversaries

| Adversary | Capability | Primary defence |
| --- | --- | --- |
| **Curious customer** | Full physical access to an unattended iPad, browser devtools | Server-authoritative state; no secret in the browser; Guided Access |
| **Opportunist on the network** | Sees traffic, can replay requests | HTTPS everywhere; signed webhooks; single-use state transitions |
| **Someone with a delivery link** | Has one QR / URL | 256-bit token, 24h expiry, hashed at rest, no enumeration |
| **Malicious/compromised staff account** | Valid staff session | Role-scoped permissions checked server-side; append-only audit |
| **Automated scanner** | Hits every endpoint | Rate limits; deny-by-default RLS; no admin surface without auth |
| **Stolen iPad** | Owns the device | Session cookies are HttpOnly and short-lived; no credential on device; remote wipe via Find My |

### Explicitly out of scope

Physical theft of the iPad, a compromised Stripe or Decart account, a hostile hosting provider, and
targeted attacks on the owner's personal devices.

---

## Secret handling

**Every secret is server-only. There is no `NEXT_PUBLIC_*` variable in this codebase.**

The browser receives exactly one typed object, `PublicKioskConfig` (`src/lib/public-config.ts`),
assembled by a server component. That is the only door, which makes "no secrets in the bundle" a
property of the architecture rather than a review checklist item.

### Verified, not assumed

The build was run with canary values in every secret variable and all client-served assets grepped
for those values:

```
APP_SECRET                 ✅ absent from .next/static
DATABASE_URL password      ✅ absent
DATABASE_URL username      ✅ absent
STRIPE_SECRET_KEY          ✅ absent
STRIPE_WEBHOOK_SECRET      ✅ absent
DECART_API_KEY             ✅ absent
SUPABASE_SERVICE_ROLE_KEY  ✅ absent
source maps served         ✅ none (0 .map files)
```

> **Note on a false positive.** The literal string `"DECART_API_KEY"` *does* appear in the client
> bundle. It is inside the vendored `@decartai/sdk`, which falls back to reading that environment
> variable when no `apiKey` is passed. It is the variable *name*, never a value, and `process.env`
> is not populated in the browser. We always pass an explicit token, so the fallback is unreachable.
> Anyone re-running this scan will hit the same string; check for **values**, not names.

### Where each secret lives

| Secret | Read in | Reaches browser |
| --- | --- | --- |
| `DECART_API_KEY` | `src/lib/ai/decart.server.ts` only | Never — only scoped short-lived tokens |
| `STRIPE_SECRET_KEY` | `src/lib/payments/stripe.server.ts` only | Never |
| `STRIPE_WEBHOOK_SECRET` | webhook verification only | Never |
| `APP_SECRET` | session cookies, demo webhook HMAC | Never |
| `DATABASE_URL` | `src/lib/db/client.ts` only | Never |
| `SUPABASE_SERVICE_ROLE_KEY` | `src/lib/storage/index.server.ts` only | Never |

Server-only modules import `server-only`, so importing one from a client component is a build error.

### Rotation

Change the value in the host's environment settings and redeploy. There is no UI to view or edit a
credential — deliberately. The admin settings page states this in place of a masked field, because a
masked field is still a field someone can be socially engineered into revealing.

---

## Webhook verification

`/api/webhooks/stripe`, in strict order:

1. Read the **raw** body. Stripe signs bytes; parsing first breaks verification.
2. `stripe.webhooks.constructEventAsync(rawBody, signature, secret)`. Failure ⇒ **400**, and nothing
   else happens — no logging of the body, no order lookup.
3. Hand the verified event to fulfilment.

**Idempotency, twice over:**

1. `webhook_events` has `UNIQUE (provider, event_id)`. A duplicate loses the `INSERT` and returns.
2. The transition is a compare-and-set. `payment_pending → paid` cannot run twice.

**Amount verification.** `amount_total` is compared against the order's `price_cents`; a mismatch
fails the order with `PAYMENT_AMOUNT_MISMATCH` rather than fulfilling it.

**`payment_status` is what counts.** A `checkout.session.completed` event with
`payment_status: "unpaid"` (delayed payment methods) does **not** unlock anything.

Unexpected errors after verification return 500 so Stripe retries — losing a paid event silently is
far worse than processing it twice, which fulfilment is built to absorb.

---

## AI token handling

The permanent Decart key never leaves the server. Per session it mints a token scoped four ways:

| Scope | Value | Enforced by |
| --- | --- | --- |
| `allowedModels` | the one model for this experience | Decart |
| `allowedOrigins` | `APP_BASE_URL` origin | Decart (WebSocket `Origin`) |
| `expiresIn` | session length + 45s | Decart |
| `constraints.realtime.maxSessionDuration` | ≤ 15s | Decart |

A token lifted from a compromised browser is worth at most one ~15-second session, of one style,
from one origin, within about a minute. `maxSessionDuration` matters most: it is enforced by Decart,
not by our UI timer, so a tampered client cannot stream longer than was sold.

**Gates before a token is minted** (`src/app/api/ai/session/route.ts`):

1. Rate limit
2. Order exists
3. `mayRequestAiSession(status)` — only `generation_authorized` or `captured`
4. Retake allowance — `retake_used` is claimed *before* minting, so a double-tap cannot race
5. Kiosk daily AI seconds budget

All five are covered by integration tests that call the real route against a real database.

---

## Authorization

**Kiosk (public).** No authentication — it is a public terminal. Authorization is *order state*: a
request can only do what the order's server-side status permits.

**Admin.** A random 32-byte token in an HttpOnly, SameSite=Lax, Secure cookie; only its SHA-256 is
stored. There is no JWT and no client-readable claim: the role is read from the database on every
request, so deactivating a staff member takes effect immediately rather than at token expiry.

Three layers, only the third of which is the real boundary:

1. **Middleware** — bounces `/admin/*` without a session cookie. A convenience redirect; it only
   sees that a cookie exists, not whether it is valid.
2. **Route structure + layout** — every authenticated page lives in the `(dashboard)` route group,
   whose layout does a database-backed identity check. `/admin/login` sits outside the group, so
   there is no condition deciding when to skip the check.
3. **Server actions** — every action begins with `requirePermission(...)`. This is the boundary.
   Hiding a button is not access control; a denied attempt is logged and audited.

| Capability | Owner | Staff |
| --- | --- | --- |
| View orders, assist, retry delivery, regenerate QR, mark helped | ✅ | ✅ |
| Delete a customer's photo on request | ✅ | ✅ |
| Request refund | ✅ | ✅ |
| Reset kiosk | ✅ | ✅ |
| **Complete refund** | ✅ | ❌ |
| **View revenue** | ✅ | ❌ |
| **Change price / limits / expiry** | ✅ | ❌ |
| **Enable/disable styles** | ✅ | ❌ |
| **View audit log** | ✅ | ❌ |
| **Manage staff accounts** | ✅ | ❌ |
| **View credentials** | ❌ | ❌ |
| **Delete audit history** | ❌ | ❌ |

The last two rows are ❌ for *everyone*: there is no code path that renders a credential or deletes
an audit row, for any role.

**Login hardening.** Four layers:

- 8 attempts per 5 minutes per client, plus a global 60 per 5 minutes that survives IP rotation.
- Password verification runs through a 2-slot concurrency gate, so a flood cannot exhaust memory or
  the libuv threadpool that also serves photo downloads. A login flood must not become an outage.
- scrypt at N=2^15/r=8/p=3 (~32 MiB): memory-hard enough to make offline cracking impractical,
  cheap enough that it cannot be amplified into a denial of service.
- Identical response for unknown email, wrong password and deactivated account, with a decoy hash
  burning equivalent CPU when the email doesn't exist — so timing is not an enumeration oracle.

**Self-lockout prevention.** A user cannot deactivate their own account.

---

## Delivery links

- **256-bit** random token (`randomBytes(32)`, base64url). Not derived from an order id, not
  sequential, not enumerable.
- **Only SHA-256 stored.** A database dump cannot reconstruct a working link.
- **Shape-checked before any query** — malformed tokens 404 without touching the database.
- **Identical 404** for unknown, expired and deleted. No oracle distinguishes them.
- **Regenerating rotates** the token, invalidating the previous link. A link displayed on a shop
  screen should stop working once reissued.
- **`Content-Disposition` filename is a server constant.** Nothing from the request reaches the
  header, so there is no response-splitting or filename-injection surface.
- Served with `Cache-Control: private, no-store`, `X-Content-Type-Options: nosniff` and
  `Referrer-Policy: no-referrer`, so the token doesn't leak to whatever the customer taps next.

---

## Data retention

| Data | Retained | Deleted by |
| --- | --- | --- |
| **Raw camera frames** | **Never persisted** | Exist only as a browser `MediaStream` |
| Approved final image | 24h (configurable 1–168h) | `npm run jobs:expire` |
| Order metadata | Indefinitely (operational/tax) | Manual |
| Generation sessions | Indefinitely (usage/billing) | Manual |
| Audit events | Indefinitely (append-only) | Never automatically |
| Admin sessions | 12h | Expiry + `purgeExpiredSessions()` |

**What is never collected:** customer names, emails, phone numbers, accounts, payment card data
(Stripe holds it), face embeddings, biometric templates. There is no face recognition, no public
gallery, and no permanent face database.

> **The expiry job is not optional.** "24-hour retention" is only true if something deletes.
> `vercel.json` ships an hourly cron hitting `/api/jobs/expire-assets`; on other hosts, schedule
> `npm run jobs:expire`. The route requires `CRON_SECRET` in production and fails closed without it.
> Without a scheduler, photos persist indefinitely and the notice shown to customers becomes false.

**Deletion on request.** Owner *and* staff have a **Delete photo** button on the order detail page.
It deletes the bytes, then tombstones the row, then audits — in that order, so a crash between steps
leaves a retryable state rather than a row claiming a deletion that did not happen. The privacy
notice promises this to every customer, so it has to be a button someone can press, not a job that
runs later.

---

## Input validation

Every client input is parsed with Zod server-side before use.

- **SQL:** every query is parameterised (`$1`, `$2`). No string interpolation of user data anywhere
  in `src/lib/`.
- **Image upload:** declared `Content-Type` allow-list **and** magic-byte verification, plus a 12 MB
  cap checked on both the header and the actual buffer. The client filename is discarded entirely.
- **Storage keys:** built from server-generated UUIDs, then validated against a character allow-list
  and a path-containment check before any filesystem call.
- **Prompts:** never accepted from a client. The request carries a slug; the server looks up the
  prompt.
- **IDs:** UUID-validated before use.

---

## Headers and CSP

Set in `next.config.ts` for every route:

| Header | Value |
| --- | --- |
| `Content-Security-Policy` | Self-only, plus `blob:`/`data:` for media and QR, plus Decart hosts on `connect-src`. `frame-src 'none'`, `frame-ancestors 'none'`, `object-src 'none'` |
| `X-Frame-Options` | `DENY` |
| `X-Content-Type-Options` | `nosniff` |
| `Referrer-Policy` | `strict-origin-when-cross-origin` |
| `Permissions-Policy` | `camera=(self)`, everything else denied |
| `Cross-Origin-Opener-Policy` | `same-origin` |
| `Strict-Transport-Security` | 2 years, `includeSubDomains`, `preload` |

Clickjacking is blocked twice (`frame-ancestors` + `X-Frame-Options`). Stripe Checkout is a redirect,
not an iframe, so nothing needs framing permission.

`'unsafe-inline'` is required on `script-src` for Next's bootstrap; `'unsafe-eval'` is
**development-only** (React Refresh). Extra Decart hosts can be added via `CSP_EXTRA_CONNECT_SRC`
without loosening anything else.

`'wasm-unsafe-eval'` is also on `script-src`, for demo mode's on-device vision (MediaPipe).
Despite the name it permits **WebAssembly compilation only** — it does not re-enable `eval()`
for JavaScript, and it is the narrowest directive that allows WASM at all.

### The CSP catches MediaPipe phoning home

MediaPipe attempts a telemetry `POST` to `https://odml.pa.googleapis.com/v1/log` on startup.
`connect-src` does not list that host, so the request is refused by the browser and **no data
leaves the device**; the failure is logged to the console and the library carries on normally.

This is worth stating plainly because it is exactly the class of thing a privacy notice can be
wrong about by accident: a third-party library added for a visual feature quietly opening a
network call. The models themselves are vendored under `public/` and are never fetched from a
CDN, so segmentation and face tracking run entirely offline — the only reason the telemetry call
exists is that the library makes it unconditionally. If the CSP were ever loosened, this call
would start succeeding; that is a reason to keep `connect-src` tight rather than a reason to
allow it.

---

## Database

Row Level Security is **enabled on every table with no permissive policy**, so the Supabase `anon`
and `authenticated` roles reach nothing — a leaked publishable key is inert. The application
connects as the owner/service role, which bypasses RLS by design.

`FORCE ROW LEVEL SECURITY` is deliberately **not** used: with zero policies it would lock out the
owner role too and take the application down.

The browser never holds a database credential of any kind.

---

## Logging

`src/lib/log.ts` emits one redacted JSON object per line.

- Keys matching `api_key|secret|token|password|authorization|cookie|signature` → `[redacted]`
- **Values** starting `sk_`, `rk_`, `whsec_`, `ek_`, `eyJ` → `[redacted]`, catching bare credentials
  that arrive as values rather than under a suspicious key name
- Recursive to depth 4; strings truncated
- Error stacks are dropped from log context

`src/lib/audit.ts` applies the same treatment plus `email` and `phone` before anything is persisted,
because the audit log is read on screen in a shop and pasted into support threads.

Unit tests assert that a `sk_live_…` value planted at the top level and nested four deep is absent
from the output.

---

## Known risks

| # | Risk | Severity | Mitigation / plan |
| --- | --- | --- | --- |
| 1 | **Rate limiting is per-process.** Degrades on a multi-instance deploy | Medium | Expensive operations are additionally gated by server-side order state and the daily budget, so a bypass still cannot obtain a paid session. Move to a shared store if the kiosk ever scales past one instance |
| 2 | **`CRON_SECRET` must be set in production** or the expiry route refuses to run | Medium | It fails closed (500), and `npm run jobs:expire` still works from a shell. Verify after deploy: `SELECT count(*) FROM assets WHERE expires_at < now() AND deleted_at IS NULL` should trend to 0 |
| 3 | **The kiosk is unauthenticated by design** | Accepted | It is a public terminal. Authorization is order state; it holds no secret and can create only unpaid orders |
| 4 | **`'unsafe-inline'` on `script-src`** | Low | Required by Next's bootstrap, so the CSP would not stop an XSS if one existed. No reachable sink today: no `dangerouslySetInnerHTML` anywhere, and every reflected value goes through JSX escaping. Upgrade path is a per-request nonce emitted from middleware with `'strict-dynamic'` — **not yet implemented** |
| 5 | **Delivery link is bearer-only** | Accepted | Anyone with the URL sees the photo. Mitigated by 256-bit entropy, 24h expiry and rotation. Adding a PIN would hurt the experience more than it helps at this scale |
| 6 | **AI cost estimate is a configurable constant**, not billing data | Low | Labelled "estimate" in the UI. Reconcile against the first real Decart invoice and correct `DEFAULT_AI_COST_PER_SECOND_CENTS` |
| 7 | **No CSRF token on admin server actions** | Low | Next.js server actions verify Origin, and the session cookie is `SameSite=Lax`. Add explicit tokens if the admin is ever exposed more broadly |
| 10 | **Order-scoped routes authorize on knowledge of the order UUID.** No per-order capability token | Low | The UUID is v4 (not guessable remotely) and the kiosk now strips it from the URL on reset, so it is not left in the address bar for the next customer. A per-order HttpOnly capability cookie is the upgrade path — **not yet implemented** |
| 11 | **Login rate limiting shares one bucket** unless `TRUST_PROXY_HEADERS=true` | Low | Deliberate: honouring a client-supplied `X-Forwarded-For` is worse (it hands out a fresh bucket per request). The global ceiling and the concurrency gate bound the damage either way. Set `TRUST_PROXY_HEADERS=true` only behind a proxy that overwrites the header |
| 8 | **Battery-based session blocking is best-effort** | Low | Safari does not implement the Battery Status API; the guard simply never fires there. Staff procedure in the runbook is the real control |
| 9 | **Physical access to the iPad** | Accepted | Guided Access, anti-theft stand, supervision. No credential is stored on the device |

---

## External review

An independent security review was run against this codebase before release,
covering credential exposure, payment integrity, authorization boundaries,
delivery links, retention, headers and input validation. It confirmed the
payment path, delivery-token design, SQL parameterisation, secret handling and
role checks, and found nine defects that have since been fixed:

| Finding | Severity | Fix |
| --- | --- | --- |
| `X-Forwarded-For` accepted verbatim — a spoofed header minted a fresh rate-limit bucket per request, removing the limiter (and the brute-force ceiling) from every endpoint | **Critical** | `clientKey` ignores the header unless `TRUST_PROXY_HEADERS=true`; login also carries a global ceiling |
| `/api/admin/login` was a 128 MiB / ~560 ms scrypt amplifier — a few dozen concurrent requests exhausted memory and the libuv threadpool, taking the kiosk down | **Critical** | scrypt lowered to N=2^15/r=8/p=3 (~32 MiB) and password verification serialised through a 2-slot concurrency gate |
| No on-demand photo deletion, despite the privacy notice promising it three times | **High** | `deletePhotoAction` (owner + staff), surfaced on the order detail page |
| The expiry job had no scheduler shipped, so "24-hour retention" depended on someone running a script | **High** | `/api/jobs/expire-assets` + `vercel.json` hourly cron, guarded by `CRON_SECRET` |
| Owner-configurable link expiry was written and read back but never applied to new links | **High** | `resolveTtlHours()` is now the single source for both new and regenerated links |
| `generating -> generating` self-transition made the compare-and-set a no-op, so two concurrent retake requests could each mint an AI token for one payment | Medium | Self-transition removed; a unit test now asserts *no* status may transition to itself |
| `billableSeconds` was client-supplied and unchecked — reporting 0 escaped the daily AI budget, reporting 600 exhausted it | Medium | Clamped server-side against elapsed time since `generation_started_at`, plus an absolute ceiling |
| Upload size check read `Content-Length`, which a chunked request omits — an unbounded body reached `formData()` | Medium | Body is read through a byte-counting reader that aborts past the limit before anything is parsed |
| `env.ts`, `audit.ts` and `orders/repository.ts` claimed a `server-only` guard they did not have | Medium | `import "server-only"` added to all three |
| Admin auth skipped its check based on a request header (`x-pathname`) | Low | Login moved outside the authenticated route group; the gate is structural and the header is gone |
| Operator emails written to `actor_label`, bypassing the redaction the audit page advertises | Low | Actions record the role plus `actor_user_id` instead |

## Reporting

Found something? Email the owner directly. Please don't open a public issue for a security defect in
a system that handles customers' faces.

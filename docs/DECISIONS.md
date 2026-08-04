# Decisions

Significant choices, what they cost, and what was rejected. Newest last.

---

## 1. Server-authoritative order state, enforced by the database

**Decision.** Every meaningful step is a row transition applied inside a transaction with
`SELECT … FOR UPDATE` followed by `UPDATE … WHERE status = <observed>`.

**Why.** The kiosk browser is unattended in a shop. It can be reloaded, driven by devtools, or
replayed. Any design where the client asserts "I paid" is wrong. The compare-and-set also gives
webhook idempotency for free: a duplicate delivery loses the race and is acknowledged rather than
double-fulfilled.

**Rejected.** Optimistic client state with server reconciliation — simpler to write, but the failure
mode is a customer getting an AI session they didn't pay for, which is exactly the failure this
product cannot afford.

---

## 2. PostgreSQL only, no in-memory or SQLite fallback

**Decision.** One database implementation. Dev, test, CI and production all run real Postgres.

**Why.** The safety of the state machine *is* row locking. A stub that passes the same tests while
lacking `FOR UPDATE` would give false confidence in precisely the mechanism that protects payments.
Supabase is plain Postgres, so the migrations run unchanged in production.

**Cost.** Contributors need Postgres locally. Accepted — `createdb && npm run db:migrate`.

---

## 3. Stripe Checkout Sessions, and no Stripe Price object

**Decision.** Hosted Checkout via redirect. Line items built server-side with `price_data` from the
`experiences` row, not a pre-created Price.

**Why Checkout.** Apple Pay and Google Pay work on iPadOS Safari with no extra integration, Stripe
hosts the card fields so no card data touches this app, and the return is a plain URL with no SDK in
the customer's path. For a supervised kiosk that is strictly better than Elements.

**Why no Price object.** The owner can change the price in the admin and it takes effect on the next
customer, with no Stripe dashboard visit and no drift between "what the kiosk shows" and "what
Stripe charges". The webhook additionally verifies `amount_total` against the order and fails the
order on a mismatch.

---

## 4. `lucy-restyle-2` as the default model

**Decision.** Per-experience `modelPreference`, defaulting to `lucy-restyle-2`.

**Why.** Verified against `@decartai/sdk` 0.1.17 (published 2026-07-29), whose realtime models are
`lucy-2.1`, `lucy-2.5`, `lucy-vton-2`, `lucy-vton-3`, `lucy-restyle-2`. The SDK's own realtime
example uses `lucy-restyle-2`, and restyling a live portrait is exactly what all four experiences
do. Virtual try-on models are wrong for this. It is configuration, not a hard-coded constant — one
edit per experience to change.

**Note.** The repository's earlier single-file prototype used `lucy-2.5`. That was not carried over
blind; the model list was re-read from the shipped SDK types rather than assumed.

---

## 5. Short-lived client tokens, scoped four ways

**Decision.** `client.tokens.create({ expiresIn, allowedModels, allowedOrigins, constraints:
{ realtime: { maxSessionDuration } } })`.

**Why.** The brief requires that the permanent key never reach the browser. Merely proxying WebRTC
through our server would be worse (cost, latency, complexity) and no safer. Decart's own token API
supports scoping on all four axes, so a token lifted from a compromised browser is worth at most one
~15-second session, of one style, from one origin, within about a minute.

**`maxSessionDuration` matters most.** It is enforced by Decart, not by our UI timer, so a tampered
client cannot stream longer than was sold.

---

## 6. Prompts in code, switches in the database

**Decision.** `experiences.ts` holds prompts, negative constraints, model and audience. The
`experiences` table holds only `active`, `featured`, `price_cents`, `sort_order`.

**Why.** A prompt is the product's safety boundary. Making it editable from a web form means a
compromised admin session, or a rushed owner, can turn a family-friendly kiosk into something else
with no review. Prompts change through a pull request; operational switches change with a tap.

---

## 7. Demo mode goes through the real webhook

**Decision.** The demo checkout page posts an HMAC-signed body to the real `/api/webhooks/stripe`,
which verifies it and drives the real state machine.

**Why.** A demo mode that shortcuts the state machine tests nothing and rots. This way every demo
run exercises signature verification, event dedupe and the real transitions. The HMAC uses
`APP_SECRET`, not a Stripe key, so a demo webhook can never validate against a live deployment.

**Guard.** Env validation refuses `DEMO_MODE` under `NODE_ENV=production` unless
`ALLOW_DEMO_MODE_IN_PRODUCTION=true` is deliberately set.

---

## 8. scrypt from `node:crypto` rather than argon2 or bcrypt

**Decision.** Password hashing with `node:crypto`'s scrypt at N=2^15, r=8, p=3 (~32 MiB).

**Why.** The entire user base is one owner and a handful of boutique staff. Adding a native-binary
dependency — with its build toolchain and platform matrix — to hash four passwords is not a trade
worth making. scrypt is memory-hard and in the standard library.

**Why not the 2^17 variant.** It was, until a security review measured it: 128 MiB and ~560 ms per
verification, on the libuv threadpool that also serves photo downloads. A few dozen concurrent login
attempts exhausted memory and starved the event loop — a login flood became a kiosk outage. 32 MiB
still makes offline cracking impractical for this threat model, and password verification now runs
through a 2-slot concurrency gate so the cost cannot be amplified at all. Existing hashes keep
working: `verifyPassword` reads N/r/p from the stored string.

---

## 9. In-process rate limiting, with the real guard elsewhere

**Decision.** A fixed-window limiter in `src/lib/security/rate-limit.ts`, per process.

**Why.** The deployment is one supervised iPad behind one origin. A Redis dependency for that is
overengineering. Crucially, the limiter is an outer wall, not the actual protection: an attacker who
bypasses it still cannot obtain an AI session, because that is gated by server-side order state and
the kiosk's daily seconds budget.

**Known limitation.** State is per-process, so it degrades on a multi-instance deploy. Recorded in
`docs/SECURITY.md` with the upgrade path rather than papered over.

**Calibration.** Limits were raised for `/api/checkout` (30/min) and `/api/ai/session` (20/min) after
the E2E suite tripped them: the whole kiosk is a single IP, so a ceiling tuned for per-user traffic
throttles legitimate use.

---

## 10. Delivery tokens hashed, and links rotated on regeneration

**Decision.** 256-bit random token in the QR; only SHA-256 stored. "Regenerate QR" mints a new token
and invalidates the old one.

**Why hashed.** A database dump, or a support engineer reading rows, must not be able to open a
customer's photo.

**Why rotate.** A link that was displayed on a screen in a shop should stop working once reissued.
The cost — a customer who scanned the first code loses it — is the right trade for a link that
carries someone's face.

---

## 11. SVG preview art, clearly labelled as placeholder

**Decision.** The four style cards use hand-authored SVG illustrations in `public/previews/`.

**Why.** They are self-contained (no CDN, no CSP hole), sharp at any size, tiny, and they set the
palette and energy the references establish. Each file carries a comment saying it is illustrative
and should be replaced with a real consented sample once the pilot produces one.

**Honest limitation.** They are stylised, not photographic, so they under-sell the actual output.
Replacing them with real transformations — with the subject's written consent — is the single
highest-value visual improvement after launch.

---

## 12. Consent immediately authorizes generation

**Decision.** `POST /api/orders/:id/consent` performs `paid → consented → generation_authorized` in
one request.

**Why.** Consent is the last precondition, so a separate authorize call would be a state with no
decision in it. Keeping `generation_authorized` as a distinct status still matters: it means the
route that mints AI tokens tests exactly one status, so there is one code path to review and no
second way in.

**Found by testing.** The first implementation left `generation_authorized` unreachable — consent
set `consented` and the AI route required `generation_authorized`, so the flow deadlocked. Caught by
running the real journey in a browser, not by unit tests, which is why the screenshot loop exists.

---

## 13. The kiosk reports its own failures to the server

**Decision.** `POST /api/orders/:id/fail` — the browser tells the server when a *paid* session died
on its side.

**Why.** Without it, a failure occurring before an AI session exists (token request 502s, camera
denied after consent, network drop) left the order sitting in `generation_authorized`. The customer
saw the right apology, but the order never reached the admin's failures list — so a customer who paid
and got nothing was invisible to staff. That is precisely the scenario the brief calls out.

Only post-payment orders can be failed through this route, so it cannot be used to poison orders that
were never charged.

**Found by testing.** The E2E admin test "a paid order whose AI failed reaches Needs attention"
failed on an empty table. The customer-facing screen had looked correct throughout.

---

## 14. Loopback exempt from the production HTTPS requirement

**Decision.** Env validation refuses `http://` under `NODE_ENV=production` — except for `localhost`
and `127.0.0.1`.

**Why.** iPadOS grants camera access only in a secure context, so an HTTP production deploy would
fail at the camera step in front of a paying customer. Refusing to boot is the right response. But
browsers treat loopback as secure, and a local production build is a legitimate thing to run (E2E
suites, smoke tests before deploying). The original rule blocked that with no security benefit.

---

## 15. The original `index.html` prototype was retired, not extended

**Decision.** The repository's single-file `index.html` prototype is removed from the root. Its
history is intact in git.

**Why.** It was a useful reference — it is where the Decart realtime shape was first sketched — but
it shares no code with the shipped app, has no payment, consent, retention or admin story, and a
stray `index.html` beside a Next.js app is exactly the kind of thing that gets deployed by accident.
The model id it used (`lucy-2.5`) was re-checked against the shipped SDK rather than carried over
(see decision 4).

---

## 16. Playwright signs in once per run

**Decision.** An `auth.setup.ts` project stores the owner session; admin specs reuse it. Specs
testing the gate itself opt out.

**Why.** `/api/admin/login` is rate limited to 8 attempts per five minutes per IP. A suite that signs
in per test trips its own brute-force protection — which is the limiter working correctly. Signing in
once also matches reality: staff sign in at the start of a shift.

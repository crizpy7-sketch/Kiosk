# Wild Frame AI

**STEP IN. BECOME ANYTHING.** — a paid AI selfie-transformation kiosk that runs on one iPad.

Powered by [Decart Lucy](https://platform.decart.ai/). One product: **AI Transformation + Digital
Photo, $5.99**. Four styles. Two languages. A QR code that expires in 24 hours.

---

## What this is (and isn't)

The physical product is deliberately, permanently small:

- A 13-inch iPad Pro in **portrait**, in a black anti-theft floor stand
- A hidden charging cable or power bank
- Placed beside Shia Baby Boutique, supervised by the owner or boutique staff

That's it. No cabinet, no photobooth enclosure, no lighting rig, no printer, no external camera, no
payment terminal, no second computer. The software's job is to make that setup feel premium.

**Goal of this pilot: 25 paid, delivered transformations.** See
[`docs/VALIDATION-METRICS.md`](docs/VALIDATION-METRICS.md).

---

## The customer journey

1. **Attract** — wordmark, price, both languages, one enormous START button. No camera, no AI.
2. **Choose style** — four cards: Slime Star, Anime Power-Up, Royal Fantasy, Become a Baby (NEW).
3. **Purchase** — Stripe Checkout. Apple Pay / Google Pay / card.
4. **Consent** — six plain sentences. The camera does not open until they agree.
5. **Camera** — front camera, mirrored, with a head-and-shoulders framing guide.
6. **Transform** — 3-second countdown, then ~15 seconds of live Lucy transformation.
7. **Reveal** — the payoff. I LOVE IT, or RETAKE ONCE (exactly once).
8. **Delivery** — a big QR code to an unguessable link that dies in 24 hours.
9. **Reset** — camera off, AI session closed, customer state wiped, back to attract.

Screens are captured in [`screenshots/`](screenshots/) at 1024×1366 (13" iPad Pro portrait).

To regenerate them, or to record a video of the whole journey for someone who wants to see the
product before setting up any accounts:

```bash
npm run dev                              # in one terminal
npx tsx scripts/screenshot.ts            # → screenshots/
npm run walkthrough                      # → walkthrough/*.webm
```

Both drive the real app in demo mode, so what they capture is the product, not a mockup.

---

## Architecture at a glance

| Layer | Choice | Why |
| --- | --- | --- |
| Framework | Next.js 15 (App Router), React 19, TypeScript strict | Server components keep secrets server-side structurally |
| Styling | Tailwind CSS v4 | Design tokens in `src/app/globals.css` |
| Database | PostgreSQL 14+ (Supabase works unchanged) | Real row locking — the order state machine depends on it |
| Payments | Stripe Checkout Sessions + webhooks | Wallets for free; no card data touches this app |
| AI | `@decartai/sdk` realtime (Lucy) | Backend-minted short-lived client tokens |
| Storage | Private filesystem or Supabase Storage | Never public; one authorised read route |
| Validation | Zod | Every client input, and the environment itself |
| Tests | Vitest + Playwright | Real Postgres, real browser, real iPad viewport |

Full detail: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

### The rule everything else follows

> **The browser is untrusted. The server owns the truth.**

Reaching the Stripe success URL grants nothing. Only a signature-verified webhook marks an order
paid. Only a paid *and* consented *and* server-authorized order can obtain an AI token. Every
transition is a compare-and-set against the row's current status, so a reloaded, replayed or
tampered client cannot skip a step.

---

## Local setup

**Prerequisites:** Node.js 20.9+, PostgreSQL 14+.

```bash
git clone <this repo> && cd Kiosk
npm install

cp .env.example .env.local
# Generate APP_SECRET and paste it into .env.local:
openssl rand -base64 48

createdb wildframe_dev
npm run db:migrate
npm run db:seed          # prints a generated owner password — save it

npm run dev
```

Open **http://localhost:3000/kiosk**. `DEMO_MODE=true` by default, so no card is charged and no
Decart credits are spent.

The admin dashboard is at **http://localhost:3000/admin**.

---

## Environment variables

Every variable is server-only. **Nothing is prefixed `NEXT_PUBLIC_`, by design** — the browser
receives exactly the fields in `PublicKioskConfig` (`src/lib/public-config.ts`) and nothing else.
`src/lib/env.ts` validates the whole set at boot and refuses to start on a bad config.

| Variable | Required | Default | Notes |
| --- | --- | --- | --- |
| `APP_BASE_URL` | yes | `http://localhost:3000` | Must be HTTPS in production (except loopback) — iPadOS blocks the camera on insecure origins |
| `NODE_ENV` | yes | `development` | |
| `APP_SECRET` | yes | — | 32+ random bytes. Signs admin cookies and demo webhooks |
| `DEMO_MODE` | no | `false` | Simulates payment and AI. **Refused in production** unless `ALLOW_DEMO_MODE_IN_PRODUCTION=true` |
| `ALLOW_DEMO_MODE_IN_PRODUCTION` | no | `false` | Only for a deliberate on-stage demo build |
| `DATABASE_URL` | yes | — | PostgreSQL connection string |
| `STRIPE_SECRET_KEY` | when live | — | |
| `STRIPE_PUBLISHABLE_KEY` | no | — | Not currently used — Checkout is a redirect, not an embed |
| `STRIPE_WEBHOOK_SECRET` | when live | — | |
| `DECART_API_KEY` | when live | — | **Never reaches the browser.** Short-lived scoped tokens are minted from it |
| `STORAGE_DRIVER` | no | `filesystem` | `filesystem` or `supabase` |
| `STORAGE_BUCKET` | no | `wildframe-private` | Supabase driver only. Bucket must be **private** |
| `STORAGE_LOCAL_DIR` | no | `.data/assets` | Filesystem driver. Keep outside `public/` |
| `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` | when `STORAGE_DRIVER=supabase` | — | |
| `SUPABASE_ANON_KEY` | no | — | Unused by the app; RLS denies it everything anyway |
| `DOWNLOAD_LINK_TTL_HOURS` | no | `24` | 1–168 |
| `SESSION_MAX_SECONDS` | no | `15` | Hard cap; also enforced by Decart |
| `COUNTDOWN_SECONDS` | no | `3` | |
| `ATTRACT_TIMEOUT_SECONDS` | no | `90` | Inactivity before returning to attract |
| `KIOSK_ID` | no | `kiosk-shia-baby-01` | Must match a row in `kiosks` |
| `DEFAULT_LANGUAGE` | no | `en` | `en` or `es` |
| `CSP_EXTRA_CONNECT_SRC` | no | — | Extra hosts for regional/self-hosted Decart endpoints |
| `CRON_SECRET` | in production | — | Bearer token the scheduled expiry route requires. **Without it the expiry job refuses to run and photos are never deleted** |
| `TRUST_PROXY_HEADERS` | no | `false` | Set to `true` only behind a proxy that overwrites `X-Forwarded-For`. Left off, rate limits share one bucket rather than trusting a spoofable header |

---

## Database setup

Schema and migrations live in [`migrations/`](migrations/). The runner is forward-only.

```bash
npm run db:migrate            # apply pending migrations
npm run db:reset              # drop, rebuild, reseed (refuses in production)
npm run db:seed               # kiosk + experiences + first owner (idempotent)
```

Row Level Security is enabled on every table with **no permissive policy**, so a leaked Supabase
publishable key reaches nothing. The app connects as the owner/service role, which bypasses RLS by
design; the browser never holds a database credential.

Tables: `users`, `kiosks`, `experiences`, `orders`, `generation_sessions`, `assets`, `audit_events`,
`webhook_events`, `app_settings`, `admin_sessions`.

---

## Stripe setup

1. Create a Stripe account and grab the **test** keys.
2. Set `STRIPE_SECRET_KEY` and `DEMO_MODE=false`.
3. Register a webhook endpoint at `https://YOUR-DOMAIN/api/webhooks/stripe` for these events:
   - `checkout.session.completed`
   - `checkout.session.async_payment_succeeded`
   - `checkout.session.async_payment_failed`
   - `checkout.session.expired`
   - `payment_intent.payment_failed`
   - `charge.refunded`
4. Copy the signing secret into `STRIPE_WEBHOOK_SECRET`.

Locally: `stripe listen --forward-to localhost:3000/api/webhooks/stripe`.

There is **no Stripe Price object** — the amount is built server-side from the `experiences` row on
every session, so changing the price in the admin takes effect immediately and the browser has no
say in what is charged.

Test cards: `4242 4242 4242 4242` succeeds, `4000 0000 0000 0002` declines.

---

## Decart setup

1. Get an API key from [platform.decart.ai](https://platform.decart.ai/).
2. Set `DECART_API_KEY` and `DEMO_MODE=false`.

The permanent key is read in exactly one file (`src/lib/ai/decart.server.ts`) and used only to mint
per-session client tokens scoped to:

- **one model** (`allowedModels`)
- **one origin** (`allowedOrigins`)
- **a short expiry** (`expiresIn` = session length + 45s)
- **a hard session cap** (`constraints.realtime.maxSessionDuration`) that Decart enforces server-side

Model preference is per-experience in `src/lib/config/experiences.ts` (currently `lucy-restyle-2`).
See [`docs/DECISIONS.md`](docs/DECISIONS.md) for why.

---

## Running tests

```bash
npm run typecheck     # app + tests + scripts
npm test              # unit + integration (needs Postgres)
npm run test:e2e      # Playwright, 13" iPad Pro portrait
npm run test:all      # everything
```

Integration tests need a database; they use `TEST_DATABASE_URL`, or derive `wildframe_test` from
`DATABASE_URL`. The suite resets and reseeds it on every run.

E2E builds the app and serves it in production mode with `DEMO_MODE=true`, then drives a real
Chromium with a synthetic camera.

CI (`.github/workflows/ci.yml`) runs all of the above on every pull request against a real
PostgreSQL service, plus a canary-secret scan that fails the build if any credential value reaches
a client-served asset.

---

## Demo mode

`DEMO_MODE=true` swaps two adapters and nothing else:

- **Payment** → a local checkout page that posts an HMAC-signed webhook to the *real* webhook route,
  which verifies the signature and drives the *real* state machine.
- **AI** → a canvas filter over the live camera, watermarked `DEMO MODE — SIMULATED AI`.

No Stripe charge, no Decart credits, no frame leaves the device. A green **DEMO — NO CHARGE** badge
sits at the top of every kiosk screen so staff can never mistake it for live. Env validation refuses
`DEMO_MODE` under `NODE_ENV=production` unless someone deliberately sets
`ALLOW_DEMO_MODE_IN_PRODUCTION=true`.

---

## Deployment

Any Node host that can run `next start`. Vercel + Supabase is the shortest path.

> **This app cannot be served by GitHub Pages.** The repository previously hosted a static
> `index.html` prototype there. This is a server-rendered application with a database, webhook
> endpoints and secrets — it needs a Node runtime. Merging this removes the root `index.html`, so
> the existing Pages site will 404 until Pages is disabled or pointed elsewhere.

1. Provision Postgres (Supabase project or managed Postgres).
2. Run `npm run db:migrate` and `npm run db:seed` against it.
3. Set every environment variable above. **`DEMO_MODE=false`.**
4. Deploy. Verify `npm run build` passes first.
5. Register the Stripe webhook against the deployed URL.
6. If `STORAGE_DRIVER=supabase`, create the bucket and confirm it is **private**.
7. Schedule the expiry job — this is what makes "24-hour retention" true.
   On Vercel: set `CRON_SECRET`; `vercel.json` already registers an hourly cron against
   `/api/jobs/expire-assets`. Elsewhere:
   ```
   0 * * * *  cd /path/to/app && npm run jobs:expire
   ```
   Verify after the first day: `SELECT count(*) FROM assets WHERE expires_at < now() AND
   deleted_at IS NULL` should trend to zero.
8. Smoke-test one real transaction end to end before opening.

---

## iPad setup

1. Charge to 100%. Plug in through the stand, or attach the power bank.
2. **Settings → Display & Brightness → Auto-Lock → Never.**
3. **Settings → Safari → Advanced → Website Data** — clear before opening.
4. Open `https://YOUR-DOMAIN/kiosk` in Safari.
5. **Share → Add to Home Screen.** Launch from that icon: full-screen, no address bar.
6. Grant camera permission on the first run.
7. Rotate to **portrait** and lock rotation in Control Centre.

### Guided Access (strongly recommended)

Guided Access is what stops a customer wandering out of the app.

1. **Settings → Accessibility → Guided Access → On.**
2. Set a passcode staff know and customers don't.
3. Turn on **Accessibility Shortcut**.
4. Open the kiosk, then triple-click the top button → **Start**.
5. Triple-click and enter the passcode to exit.

Wake Lock also runs while the kiosk is open, but Guided Access plus Auto-Lock Never is the reliable
combination on iPadOS.

---

## Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| App refuses to start, env error | A required variable is missing or invalid | Read the error — it names each field. Check `.env.local` |
| "Production must be served over HTTPS" | `APP_BASE_URL` is `http://` on a non-loopback host | iPadOS blocks the camera on insecure origins. Serve over TLS |
| Camera never opens | Permission denied for the site | Safari → Settings for This Website → Camera → Allow. Then reload |
| Customer stuck on "Confirming your payment…" | Webhook not arriving | Check the Stripe dashboard's webhook delivery log and `STRIPE_WEBHOOK_SECRET` |
| Paid but no photo | AI session failed | Admin → Orders → **Needs attention**. Re-authorize or refund |
| QR won't scan | Screen glare, or an expired link | Admin → the order → **Regenerate QR** |
| Photo link dead early | Expiry job ran, or the link was regenerated | Regenerating invalidates the previous link, deliberately |
| Battery warning on the dashboard | On battery power | Plug in. Below 10% the kiosk stops taking new paid sessions |
| Styles missing at the kiosk | Disabled in the admin | Admin → Styles → enable |
| `DAILY_LIMIT_REACHED` | Daily AI budget spent | Admin → Settings → Daily AI limit |

Staff-facing procedures: [`docs/STAFF-RUNBOOK.md`](docs/STAFF-RUNBOOK.md).

---

## Documentation

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — system diagram, trust boundaries, state machine, storage lifecycle
- [`docs/SECURITY.md`](docs/SECURITY.md) — threat model, secret handling, retention, known risks
- [`docs/STAFF-RUNBOOK.md`](docs/STAFF-RUNBOOK.md) — opening, helping, recovering, closing
- [`docs/DECISIONS.md`](docs/DECISIONS.md) — what was chosen, what was rejected, and why
- [`docs/VALIDATION-METRICS.md`](docs/VALIDATION-METRICS.md) — how the first 25 transformations are measured

---

## Scope limits

Deliberately **not** in version one: printers, customer accounts, subscriptions, a social network or
public gallery, franchise/multi-venue management, event booking, open text prompts, celebrity
transformations, physical payment terminals, external cameras, loyalty schemes, marketplaces,
long-form video, or unattended remote operation.

Extension points exist (the `AiProvider`, `PaymentProvider` and `StorageDriver` interfaces). The
features do not.

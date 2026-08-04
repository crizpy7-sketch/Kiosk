# Architecture

## System diagram

```
                        ┌───────────────────────────────────────┐
                        │  iPad Pro 13" — portrait, Safari       │
                        │  Guided Access, Home Screen app        │
                        │                                        │
                        │  KioskApp (client)                     │
                        │   • renders 9 states                   │
                        │   • owns camera + WebRTC lifecycle     │
                        │   • holds NO secret, NO price, NO      │
                        │     authority over its own progress    │
                        └───────┬────────────────────┬───────────┘
                                │ HTTPS              │ WebRTC (media)
                                │                    │
        ════════════════════════╪════════════════════╪════════════════
             TRUST BOUNDARY     │                    │
        ════════════════════════╪════════════════════╪════════════════
                                │                    │
                        ┌───────▼────────────────┐   │
                        │  Next.js server         │   │
                        │                         │   │
                        │  Server components ─────┼───┼──► PublicKioskConfig
                        │  Route handlers         │   │    (the only door to
                        │  Server actions         │   │     the browser)
                        │                         │   │
                        │  Holds: DECART_API_KEY  │   │
                        │         STRIPE_SECRET   │   │
                        │         APP_SECRET      │   │
                        └──┬────────┬─────────┬───┘   │
                           │        │         │       │
              ┌────────────▼──┐  ┌──▼──────┐  │  ┌────▼──────────────┐
              │  PostgreSQL   │  │ Storage │  │  │  Decart Lucy      │
              │  (Supabase)   │  │ private │  │  │  realtime         │
              │               │  │ bucket  │  │  │                   │
              │  RLS: deny    │  │         │  │  │  short-lived      │
              │  all policies │  └─────────┘  │  │  scoped token     │
              └───────────────┘               │  └───────────────────┘
                                              │
                                    ┌─────────▼──────────┐
                                    │  Stripe Checkout   │
                                    │  + signed webhook  │
                                    └────────────────────┘

                        ┌───────────────────────────────────────┐
                        │  Customer's phone                      │
                        │  scans QR → /d/<256-bit token>         │
                        │  → /api/download/<token> → bytes       │
                        │  link dies after 24h, then deleted     │
                        └───────────────────────────────────────┘
```

## Trust boundaries

There are four, and every security property of this system sits on one of them.

### 1. Browser → server

The kiosk browser is **fully untrusted**. It runs in a shop, unattended between customers, on a
device anyone can pick up. Therefore:

- It never receives a secret. The only data crossing to it is `PublicKioskConfig`
  (`src/lib/public-config.ts`) — style names, preview paths, the price to *display*, timings. There
  is no `NEXT_PUBLIC_*` variable in this codebase.
- It never decides anything. It renders whatever state the server says the order is in.
- It cannot set the price. `/api/orders` reads the amount from the `experiences` row; the request
  body carries only a slug and a language.
- It cannot skip a step. Every transition is validated against an explicit allow-list.

### 2. Payment provider → server

Only `/api/webhooks/stripe` may mark an order paid, and only after
`stripe.webhooks.constructEventAsync` verifies the signature over the **raw** body. The customer's
browser landing on the success URL is treated as decorative: `/kiosk/return` just normalises the URL
and the kiosk goes on polling until the server says `paid`.

Two independent idempotency guards, because Stripe delivers at-least-once:

1. `webhook_events` has `UNIQUE (provider, event_id)`. A duplicate loses the `INSERT` and returns
   early.
2. The transition itself is a compare-and-set. Even if guard 1 were bypassed,
   `payment_pending -> paid` cannot run twice.

### 3. Server → AI provider

`DECART_API_KEY` exists in one file: `src/lib/ai/decart.server.ts`. It is used only to mint a client
token via `client.tokens.create()`, scoped on four axes:

| Scope | Value | Enforced by |
| --- | --- | --- |
| `allowedModels` | the one model this experience uses | Decart |
| `allowedOrigins` | `APP_BASE_URL`'s origin | Decart (WebSocket `Origin`) |
| `expiresIn` | session length + 45s | Decart |
| `constraints.realtime.maxSessionDuration` | ≤ 15s | Decart |

So even a token extracted from a compromised browser is worth at most one short session, of one
style, from one origin, within about a minute.

### 4. Server → customer's phone

The delivery link is a 256-bit random token. Only its SHA-256 is stored, so a database dump cannot
reconstruct a working link. Expired, deleted and unknown tokens all return an identical 404 — there
is no oracle that distinguishes them.

## Order state machine

Defined in `src/lib/orders/state-machine.ts`, enforced in `src/lib/orders/repository.ts`.

```
                    created
                       │
              ┌────────┴────────┐
              ▼                 ▼
       payment_pending       expired ──► deleted
              │                 ▲
      ┌───────┴───────┐         │
      ▼               ▼         │
    paid           failed ──────┤
      │               │         │
      ▼               │         │
  consented           │         │
      │               │         │
      ▼               │         │
generation_authorized ◄─────────┤ (staff retry — no second charge)
      │               │         │
      ▼               │         │
  generating ─────────┤         │
      │      ▲        │         │
      ▼      │ retake │         │
   captured ─┘        │         │
      │               │         │
      ▼               │         │
  completed ──────────┤         │
      │               │         │
      ▼               │         │
  delivered ──────────┴─────────┘
      │
      ▼
refund_pending ──► refunded ──► deleted
```

**The gate that protects AI credits** is `mayRequestAiSession(status)`, which returns true for
exactly two statuses: `generation_authorized` and `captured` (the latter only for the one retake).
`generation_authorized` is reachable only from `consented`, which is reachable only from `paid`,
which is reachable only from a verified webhook. There is no other path.

Transitions are applied inside a transaction that does `SELECT … FOR UPDATE`, then an `UPDATE …
WHERE status = <observed>`. Two concurrent callers cannot both succeed; the loser gets an
`InvalidTransitionError` naming the status that actually won.

## Provider abstraction

Three ports, each with a real implementation and a demo one:

| Port | File | Live | Demo |
| --- | --- | --- | --- |
| `AiProvider` (server) | `src/lib/ai/provider.ts` | `decart.server.ts` | `mock.server.ts` |
| `RealtimeSession` (browser) | `src/lib/ai/provider.ts` | `realtime/decart.ts` | `realtime/mock.ts` |
| `PaymentProvider` | `src/lib/payments/provider.ts` | `stripe.server.ts` | `mock.server.ts` |
| `StorageDriver` | `src/lib/storage/index.server.ts` | `filesystem` / `supabase` | filesystem |

The AI port is split deliberately: the **server** half mints credentials and normalises errors; the
**browser** half owns the WebRTC lifecycle and never sees an account key. Swapping providers means
writing one file on each side, not touching the flow.

Provider errors are normalised to a stable code set (`AI_CONNECT_TIMEOUT`, `AI_INVALID_CREDENTIALS`,
…) in `src/lib/ai/errors.ts`, so the UI, the database and the admin all speak one vocabulary
regardless of who is behind it.

## Storage and deletion lifecycle

```
  customer taps I LOVE IT
        │
        ▼
  POST /api/orders/:id/capture      (only from `captured`)
        │  • validate content-type AND magic bytes
        │  • cap at 12 MB
        │  • discard the client filename entirely
        ▼
  storage.put("orders/<date>/<orderId>/<uuid>.jpg")   ← key is 100% server-generated
        │
        ▼
  assets row:  download_token_hash = sha256(token)
               expires_at = now() + DOWNLOAD_LINK_TTL_HOURS
        │
        ▼
  QR rendered server-side as a data: URI  ← no third party learns the URL
        │
        ▼
  ── up to 24 hours ──────────────────────────────────
        │
        ▼
  npm run jobs:expire   (hourly cron)
        │  • storage.delete(path)      ← bytes go first
        │  • assets.deleted_at = now() ← then the tombstone
        ▼
  link 404s; bytes are gone
```

**What is never stored:** raw camera frames. They exist only as a `MediaStream` in the browser and
as pixels inside a `<canvas>` during capture. The only bytes that reach a server are the single
transformed image the customer explicitly approved.

If the expiry job dies between the two steps, the next run retries the delete. The failure mode is a
repeated delete, never a photo that outlives its expiry.

## Request lifecycle: one complete transaction

| # | Actor | Call | Server-side effect |
| --- | --- | --- | --- |
| 1 | kiosk | `POST /api/orders` | `created`; price read from DB |
| 2 | kiosk | `POST /api/checkout` | `created → payment_pending`; Stripe session |
| 3 | customer | pays on Stripe | — |
| 4 | Stripe | `POST /api/webhooks/stripe` | verify → dedupe → `payment_pending → paid` |
| 5 | kiosk | `GET /api/orders/:id/status` (poll) | reads status |
| 6 | kiosk | `POST /api/orders/:id/consent` | `paid → consented → generation_authorized` |
| 7 | kiosk | `POST /api/ai/session` | gates, then `→ generating`; mints scoped token |
| 8 | browser | WebRTC to Decart | media only; never touches our server |
| 9 | kiosk | `POST /api/orders/:id/captured` | `generating → captured` |
| 10 | kiosk | `POST /api/ai/session/:sid/end` | books billable seconds (also via `sendBeacon`) |
| 11 | kiosk | `POST /api/orders/:id/capture` | `captured → completed → delivered`; QR |
| 12 | phone | `GET /d/<token>` → `/api/download/<token>` | token hash lookup, expiry check, bytes |
| 13 | cron | `npm run jobs:expire` | delete bytes, tombstone row |

Any failure after step 4 that cannot be recovered calls `POST /api/orders/:id/fail`, which puts the
order on the admin's **Needs attention** list with a refund button beside it.

## Kiosk runtime behaviour

| Concern | Mechanism | Fallback where unsupported |
| --- | --- | --- |
| Screen stays awake | Screen Wake Lock, re-acquired on visibility change | Guided Access + Auto-Lock Never |
| Battery monitoring | Battery Status API | Dashboard shows "Unknown" — never a fabricated number |
| Offline | `navigator.onLine` → offline screen | — |
| Idle reset | 90s of no touch → attract | — |
| Animation cost | Paused via `body[data-visible="false"]` when hidden | — |
| Camera release | `disconnect()` stops every track, idempotent, also on `pagehide` | — |
| Usage booking | `navigator.sendBeacon` on teardown | `fetch(keepalive)` |

# Validation Metrics

How the first **25 paid, delivered transformations** get measured, and what would make us stop.

The pilot exists to answer one question: **will people beside a boutique pay $5.99 for an AI selfie,
and can one iPad deliver it reliably?** Everything here serves that question. Nothing else gets
instrumented until it is answered.

---

## The primary metric

**25 paid, delivered, un-refunded transformations.**

Shown on the dashboard as `N / 25 delivered`. The SQL behind it:

```sql
SELECT COUNT(*) FROM orders
 WHERE kiosk_id = $1
   AND delivered_at IS NOT NULL
   AND refunded_at IS NULL;
```

A transformation counts only when the customer paid, approved a result, and a QR was issued. A paid
order that failed does not count. A refunded one does not count. This is deliberately the strictest
reading — it is the number that means "someone got what they bought".

---

## Supporting metrics

All are derivable from the existing schema. No analytics service, no tracking pixel, no third party.

| Metric | Definition | Target | Where |
| --- | --- | --- | --- |
| **Completion rate** | `delivered / paid` | **≥ 90%** | Dashboard: Deliveries ÷ Paid sessions |
| **Failure rate** | `failed / paid` | **≤ 10%** | Dashboard: Failed sessions |
| **Refund rate** | `refunded / paid` | **≤ 5%** | Dashboard: Refunds |
| **Retake rate** | `orders.retake_used = true` ÷ paid | ~20–40% | Query below |
| **Download rate** | `assets.downloaded_at IS NOT NULL` ÷ delivered | **≥ 70%** | Query below |
| **Time to delivery** | `delivered_at − created_at`, median | **≤ 3 min** | Query below |
| **AI cost per delivery** | billable seconds × rate ÷ deliveries | **≤ $0.40** | Dashboard: Est. AI cost |
| **Gross margin per sale** | `$5.99 − Stripe fee − AI cost` | **≥ $4.90** | Computed below |
| **Style mix** | deliveries grouped by `experience_id` | — | Query below |
| **Language mix** | deliveries grouped by `orders.language` | — | Query below |

### Queries

```sql
-- Completion, failure and refund rates
SELECT COUNT(*) FILTER (WHERE paid_at IS NOT NULL)                            AS paid,
       COUNT(*) FILTER (WHERE delivered_at IS NOT NULL)                       AS delivered,
       COUNT(*) FILTER (WHERE status = 'failed')                              AS failed,
       COUNT(*) FILTER (WHERE refunded_at IS NOT NULL)                        AS refunded,
       ROUND(100.0 * COUNT(*) FILTER (WHERE delivered_at IS NOT NULL)
                   / NULLIF(COUNT(*) FILTER (WHERE paid_at IS NOT NULL), 0), 1) AS completion_pct
  FROM orders;

-- Retake and download behaviour
SELECT ROUND(100.0 * COUNT(*) FILTER (WHERE o.retake_used)
            / NULLIF(COUNT(*) FILTER (WHERE o.paid_at IS NOT NULL), 0), 1) AS retake_pct,
       ROUND(100.0 * COUNT(*) FILTER (WHERE a.downloaded_at IS NOT NULL)
            / NULLIF(COUNT(*) FILTER (WHERE o.delivered_at IS NOT NULL), 0), 1) AS download_pct
  FROM orders o LEFT JOIN assets a ON a.order_id = o.id;

-- Median time from first tap to QR on screen
SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY delivered_at - created_at) AS median_time
  FROM orders WHERE delivered_at IS NOT NULL;

-- Which styles actually sell
SELECT experience_id, COUNT(*) AS delivered
  FROM orders WHERE delivered_at IS NOT NULL
 GROUP BY experience_id ORDER BY delivered DESC;

-- Does the Spanish option get used? (Decides whether it stays.)
SELECT language, COUNT(*) FROM orders WHERE delivered_at IS NOT NULL GROUP BY language;

-- Where failures actually cluster — this drives what gets fixed next
SELECT error_code, COUNT(*) FROM orders
 WHERE status = 'failed' GROUP BY error_code ORDER BY 2 DESC;

-- AI seconds per delivered photo
SELECT ROUND(SUM(gs.billable_seconds_estimate)
           / NULLIF(COUNT(DISTINCT o.id) FILTER (WHERE o.delivered_at IS NOT NULL), 0), 1) AS seconds_per_delivery
  FROM generation_sessions gs JOIN orders o ON o.id = gs.order_id;
```

---

## Unit economics

Per successful $5.99 transformation:

| Line | Amount | Source |
| --- | --- | --- |
| Revenue | **$5.99** | |
| Stripe fee (2.9% + $0.30) | −$0.47 | Stripe pricing |
| Decart, ~15s + retakes | −$0.10 to −$0.40 | Dashboard estimate; confirm against the real invoice |
| Hosting, amortised | −$0.05 | Vercel + Supabase, ÷ monthly volume |
| **Contribution** | **≈ $5.07–$5.37** | |

Fixed costs are effectively zero: the iPad already exists, the stand is a one-off, and power is
negligible. **Break-even on the stand is roughly 10–15 transformations.**

> The AI figure is the number to verify first. The dashboard's "Est. AI cost" uses a configurable
> rate in `src/lib/admin/metrics.ts` and is explicitly labelled an estimate. Reconcile it against the
> first real Decart invoice and correct the constant.

---

## Qualitative signals worth more than the numbers

At 25 transformations the statistics are thin. Watch the room:

1. **Do people stop unprompted?** Or does staff have to sell every single one? An attract screen
   that doesn't stop anyone is a positioning or placement problem, not a software one.
2. **Where do they hesitate?** Style choice, or the price screen? Hesitation at price means the
   value isn't landing before the ask.
3. **Do they show someone the result?** A reveal that produces a laugh and a "look at this" is the
   product working. A polite nod is not.
4. **Which style do they pick first?** First glance, before reading anything.
5. **Do they actually download it?** A delivered photo nobody saves is a delivered photo that
   generated no word of mouth. Track `download_rate`.
6. **What do they ask?** Repeated questions are missing copy. Log them in the staff notes.
7. **Do any come back, or bring a friend?** The single strongest signal available at this scale.

---

## Review cadence

**Daily** (owner, 2 minutes): dashboard — revenue, deliveries, failures, refunds, battery. Resolve
anything in **Needs attention** before closing.

**At 10 transformations:** first real read. Is completion above 90%? Is any one `error_code`
dominating? Is one style being ignored? Fix the biggest failure cluster before continuing.

**At 25 transformations:** the decision point.

---

## The decision at 25

**Continue and expand** if all hold:

- ✅ Completion rate **≥ 90%**
- ✅ Refund rate **≤ 5%**
- ✅ Contribution **≥ $4.90** per sale
- ✅ At least a few customers showed the result to someone unprompted
- ✅ Staff can run it without the owner present

**Fix, then re-run 25** if:

- Completion is 70–90% → the failures are concentrated; fix that cluster
- One style is never chosen → replace it rather than keeping four for symmetry
- Customers hesitate at price → try the value framing before touching the price

**Stop** if:

- Fewer than 10 sales in two weeks of decent footfall → the demand isn't there at this location
- Completion below 70% after one fix round → the technology isn't reliable enough to charge for
- Refund rate above 15% → people don't like what they get
- Contribution below $3.00 → the margin doesn't justify the attention

---

## What is deliberately not measured

No customer accounts, no email capture, no analytics SDK, no session recording, no funnel tool, no
A/B framework, no cohort retention, no NPS survey.

Every number above comes from rows the transaction already had to write. Adding a tracking dependency
to a product whose main promise is *"we don't keep your photos"* would undermine the thing that makes
customers comfortable standing in front of it.

# Staff Runbook — Wild Frame AI

For whoever is watching the kiosk today. Keep this at the counter.

**The one thing to remember:** if a customer paid and something went wrong, their money is safe and
you can fix it from the dashboard. Never tell a customer to "try again" without checking their order
first — they may have already been charged.

---

## Opening checklist (5 minutes)

- [ ] iPad is charged **above 50%**, or plugged in through the stand
- [ ] Stand is stable; cable is hidden and not a trip hazard
- [ ] iPad is in **portrait** and rotation is locked (Control Centre)
- [ ] Open the kiosk from the Home Screen icon (not Safari with an address bar)
- [ ] You see the **WILD FRAME AI** attract screen with **START • $5.99**
- [ ] Turn on Guided Access: triple-click the top button → **Start**
- [ ] Open `/admin` on your phone and confirm the kiosk shows **Online**
- [ ] Confirm there is **no green DEMO — NO CHARGE badge** (a badge means it is not taking real money)
- [ ] Place the "STAND HERE" floor marker about 2–3 feet from the screen

### Testing the camera before the first customer

1. Tap START → pick any style → **Continue**
2. On the purchase screen, tap **BACK**, then **BACK** again to return to attract

That confirms the flow is alive without spending anything. To test the camera itself, run one real
$5.99 transaction on yourself at the start of the day — it is the only way to be sure, and it
becomes your first delivered photo.

---

## Checking battery and power

The dashboard shows battery when the browser reports it (Safari often doesn't — it will say
**Unknown**, which is normal, not a fault).

| Level | What to do |
| --- | --- |
| Above 30% | Fine |
| Below 30% | Plug in now |
| Below 15% | Plug in and don't start new customers until it's charging |
| Below 10% | The kiosk **refuses new sessions** automatically. Plug in |

A session already in progress is always allowed to finish.

---

## Helping a customer

### "How does it work?"

> Tap START, pick a style, pay $5.99, then look at the camera and smile. Your photo comes to your
> phone by QR code.

### "Please delete my photo"

Do it, right away — you don't need the owner.

1. `/admin` → **Orders** → find their reference → **Open**
2. **Delete photo** → confirm
3. Tell them it's gone and the link no longer works

Then let the owner know it happened.

### "Is my photo saved anywhere?"

> No. We don't keep the camera photos at all. Only the final picture you approve, on a private link
> that expires in 24 hours — then it's deleted. No gallery, no account, no face recognition.

Tap **PRIVACY** on the attract screen to show them the full notice.

### "Can I do it in Spanish?"

Tap **ESPAÑOL** at the bottom of the attract screen. The whole flow switches.

### "Will Become a Baby show me my actual future child?"

> No — it's a fun AI effect, not a prediction. It just makes a cute baby-styled version of you.

### Positioning

Most bad photos are framing, not AI. Ask them to:
- Stand on the floor marker (about 2–3 feet back)
- Fit their head and shoulders inside the green corner guides
- Look at the **camera**, not at themselves on screen
- Hold still for the countdown

### The retake

Everyone gets **one** retake, free. Once it's used the button disappears. That's deliberate — if
they're unhappy after the retake, offer a refund rather than another session.

---

## Recovering a failed order

**Symptom:** the customer sees *"Something went wrong. Please ask a boutique team member for help.
Your payment is protected."*

1. **Read the reference off the screen** — it looks like `WF-K7M2QX4P`. Write it down.
2. On your phone: `/admin` → **Orders** → **Needs attention**.
3. Find the reference. Tap **Open**.
4. Look at **Failure** at the top:

| Error code | What happened | Do this |
| --- | --- | --- |
| `AI_CONNECT_FAILED` / `AI_CONNECT_TIMEOUT` | Network or Decart problem | Check WiFi, then **Re-authorize retry** |
| `AI_DISCONNECTED` | Connection dropped mid-session | **Re-authorize retry** |
| `CAMERA_PERMISSION_DENIED` | Camera blocked in Safari | Fix in Settings, then **Re-authorize retry** |
| `UPLOAD_FAILED` | Photo didn't upload | **Re-authorize retry** |
| `PAYMENT_FAILED` | Card declined | Nothing was charged. Ask them to start again |
| `PAYMENT_AMOUNT_MISMATCH` | Amount didn't match — tell the owner | **Request refund** |
| `DAILY_LIMIT_REACHED` | Day's AI budget spent | Tell the owner; they can raise it |

5. **Re-authorize retry** lets them run the transformation again **at no extra charge**. Send them
   back to the kiosk and tap START — it will pick up their paid order.
6. If it fails a second time, don't try a third. **Request refund** and apologise.
7. Fill in the **Staff note** with what happened, then **Mark customer helped**.

---

## Regenerating a QR code

Use when the code won't scan, the customer's phone died, or they lost the link (within 24 hours).

1. `/admin` → **Orders** → find the reference → **Open**
2. **Regenerate QR** → confirm
3. Show the new code on your phone for them to scan

**The old link stops working immediately.** That's on purpose — only one live link per photo.

If the photo has already expired (past 24 hours) there is nothing to regenerate; it has been
deleted. Apologise and offer a refund if they never received it.

---

## Handling a refund request

**Staff can request a refund. Only the owner can complete one.** That's deliberate.

**To request:**
1. `/admin` → **Orders** → find the order → **Open**
2. Type why in **Staff note**
3. Tap **Request refund**
4. Tell the customer: *"That's submitted — the refund will be back on your card in a few business
   days."*

**Owner, to complete:**
1. **Orders** → **Needs attention** → open the order
2. **Complete refund** → confirm
3. Status becomes **refunded**

Refund when: they paid and got no photo; the AI failed twice; they're genuinely unhappy with a
result they can't retake. Use judgement — this is a pilot and goodwill is worth more than $5.99.

---

## Resetting the kiosk

**Soft reset** (most problems): tap **BACK** to the attract screen, or just wait — 90 seconds of
inactivity returns it automatically.

**Hard reset:**
1. Exit Guided Access (triple-click, enter passcode)
2. Swipe up to close the app
3. Reopen from the Home Screen icon
4. Restart Guided Access

A hard reset **never** loses a paid order. When the customer taps START again the server picks their
order back up where it was.

**If the screen is frozen:** hold the top button + volume up to restart the iPad. Reopen and check
the dashboard for any order left in progress.

---

## Closing checklist

- [ ] No orders sitting in **Needs attention** (resolve or refund them)
- [ ] Check **Today's revenue** and **Deliveries** against what you remember
- [ ] Exit Guided Access
- [ ] Return the kiosk to the attract screen
- [ ] Plug in to charge overnight
- [ ] Move the stand somewhere secure if the shop front is exposed
- [ ] Note anything odd for the owner

---

## Escalate to the owner immediately if…

- A customer says they were **charged twice**
- The dashboard shows revenue that doesn't match the day
- `PAYMENT_AMOUNT_MISMATCH` appears on any order
- The kiosk shows **Offline** while the iPad is plainly online
- Anyone asks for their photo to be deleted (delete it yourself first, then tell the owner)
- Anyone asks how the AI works in a way that feels like probing security
- The iPad is damaged, or someone tries to remove it from the stand

---

## What staff cannot do (and why)

You can view orders, help customers, retry deliveries, regenerate QR codes, delete a customer's
photo on request, request refunds and reset the kiosk.

You **cannot** complete refunds, change the price, change AI limits, turn styles on or off, read the
audit log, or manage accounts. Those are the owner's, so that money and configuration always have a
single accountable owner. It isn't about trust — it's about a clean record of who changed what.

You will never see an API key or password anywhere in the dashboard. They aren't there to see.

# Plan: Real-time Offer Analysis with OpenRouter Free Tier Rate Limiting

## Problem

Offers are currently analyzed only in a daily batch job (`scheduler/index.js`).
New offers sit as `pending` for up to 24 hours before the user is notified.
OpenRouter free tier enforces hard limits (~20 req/min, ~200 req/day depending on model).
Naively firing analysis on every `insertOffer` would blow the rate limit within minutes.

## Goal

- Analyze each offer as soon as it arrives (best-effort, low latency).
- Respect OpenRouter free-tier rate limits without dropping requests.
- Notify the user immediately when a relevant offer is found (confidence >= threshold).
- Keep the daily batch job as a fallback for any offers missed by real-time analysis.

---

## Rate Limit Model

OpenRouter free models typical limits:

- `20 req/min` (sliding window)
- `200 req/day` (varies by model; check `x-ratelimit-limit-requests` response header)

Configurable via constants:

```
OPENROUTER_RPM_LIMIT      = 20          # requests per minute
OPENROUTER_RPD_LIMIT      = 200         # requests per day (0 = unlimited)
OPENROUTER_RPM_WINDOW_MS  = 60000       # 1 minute window
```

---

## Architecture

### 1. Event-driven trigger

`db.insertOffer()` already exists. Rather than modifying DB internals, use a lightweight **EventEmitter** on the `OfferRadar` orchestrator:

```
UserBotClient.processMessage()
  → db.insertOffer()
  → emits 'offer:inserted' event (offerId, offer)
  → AnalysisQueue.enqueue(offerId)
```

`OfferRadar` wires the event after both components are initialized.

### 2. AnalysisQueue (new file: `src/analysis/queue.js`)

Wraps `OpenRouterAnalyzer` with a proper rate limiter.

**Responsibilities:**

- Hold a queue of `{ offerId, priority }` objects
- Enforce sliding-window rate limit (token bucket or timestamp array)
- Process queue items sequentially with correct spacing
- On success: update offer in DB + send immediate Telegram notification if matched
- On failure (429): back off and re-enqueue
- On hard failure (3 retries): mark offer `pending` (let batch job retry it)

**Rate limiter design — sliding window:**

```js
// Keep array of timestamps of the last N requests (N = RPM_LIMIT)
// Before each request: drop timestamps older than 60s
// If timestamps.length >= RPM_LIMIT → wait until oldest + 60s
// After request: push Date.now()
```

This is simpler and more accurate than a fixed token bucket for small N.

**Priority:**

- `high` = just arrived (real-time)
- `low` = retry from failed attempt

### 3. Immediate notification

After analysis, if `confidence_score >= CONFIDENCE_THRESHOLD`:

```
db.updateOffer(id, { status: 'processed', ... })
→ bot.sendInstantAlert(userId, offer)
```

New bot method `sendInstantAlert` sends a single-offer card immediately.
The daily digest still runs, but skips offers already marked `processed` to avoid duplicates.

### 4. Daily limit guard

Track `requestsToday` counter (reset at midnight via cron).
If `requestsToday >= OPENROUTER_RPD_LIMIT`:

- Stop real-time analysis
- Log warning
- Defer all remaining offers to night batch (Plan 02)

Counter lives in memory (resets on restart, acceptable — worst case we send a few extra requests).
Alternatively: persist in a lightweight `rate_limit_state` table.

---

## Key Changes

| File                     | Change                                                         |
| ------------------------ | -------------------------------------------------------------- |
| `src/analysis/queue.js`  | **NEW** — AnalysisQueue class with sliding-window rate limiter |
| `src/index.js`           | Wire `offer:inserted` event from DB → AnalysisQueue            |
| `src/db/index.js`        | `insertOffer()` emits event (or `OfferRadar` wraps the call)   |
| `src/bot/index.js`       | Add `sendInstantAlert(userId, offerData)` method               |
| `src/scheduler/index.js` | Skip `processed` offers in batch; only process `pending`       |
| `config/constants.js`    | Add `OPENROUTER_RPM_LIMIT`, `OPENROUTER_RPD_LIMIT`             |

---

## Implementation Steps

1. Add rate limit constants to `config/constants.js`.
2. Create `src/analysis/queue.js`:
   - `constructor(llm, db, botSender)`
   - `enqueue(offerId)` — add to queue, trigger `_processNext()`
   - `_processNext()` — sliding-window check → call LLM → update DB → notify
   - `_waitForRateLimit()` — returns a Promise that resolves when a slot is free
3. In `src/index.js`, after DB and LLM init: `this.analysisQueue = new AnalysisQueue(this.llm, this.db, botSender)`.
4. Wrap `db.insertOffer()` call in `userbot/client.js` (or intercept in OfferRadar) to call `analysisQueue.enqueue(result.id)`.
5. Add `sendInstantAlert` to `src/bot/index.js`.
6. Update `scheduler/index.js` to only fetch `status = 'pending'` (already does this) and skip sending if 0 offers remain.

---

## Trade-offs

| Option                          | Pro              | Con                        |
| ------------------------------- | ---------------- | -------------------------- |
| Event emitter on DB             | Clean separation | Extra wiring in OfferRadar |
| Callback in insertOffer         | Simple           | Couples DB to LLM logic    |
| Polling loop (cron every 1 min) | Simplest         | 1-min delay, extra queries |

**Recommendation:** EventEmitter on OfferRadar — insert wraps the DB call and emits locally. No changes to DB class.

---

## Open Questions

- Should instant alerts use a different message format than the daily digest? (Yes — single-offer card vs grouped summary)
- Should the daily limit counter persist across restarts? (Start with in-memory; add persistence if needed)
- What happens if LLM is disabled (`this.llm = null`)? Queue should be a no-op, offers stay `pending` for batch.

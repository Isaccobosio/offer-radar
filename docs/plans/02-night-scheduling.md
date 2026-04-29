# Plan: Night Scheduling for Offer Analysis

## Problem

OpenRouter free tier has a daily request cap (~200 req/day).
Italian deal channels publish most offers between 09:00–23:00.
Real-time analysis during active hours burns the daily quota fast.
At night (23:00–07:00) channels are silent — ideal time to drain the backlog
without competing with real-time events, and without wasting daytime quota.

## Goal

- Reserve a configurable portion of the daily quota for nighttime batch analysis.
- Drain all `pending` offers during the night window at full rate-limit speed.
- During the day: analyze real-time but throttle to preserve quota for night.
- Keep behavior simple: no complex ML scheduling, just time-window-aware throttling.

---

## Night Window Definition

```
NIGHT_START_HOUR  = 23     # 23:00 local time
NIGHT_END_HOUR    = 7      # 07:00 local time
NIGHT_RPM_LIMIT   = 20     # full rate during night (same as free tier max)
DAY_RPM_LIMIT     = 5      # conservative rate during day (preserve quota)
```

"Night window" wraps midnight: active when `currentHour >= 23 OR currentHour < 7`.

---

## Architecture

### 1. Time-aware rate limit in AnalysisQueue (from Plan 01)

`AnalysisQueue._getRPMLimit()` returns `NIGHT_RPM_LIMIT` or `DAY_RPM_LIMIT` based on current hour.
The sliding-window rate limiter already uses a configurable limit — just make it dynamic:

```js
_getRPMLimit() {
  const h = new Date().getHours();
  return (h >= config.NIGHT_START_HOUR || h < config.NIGHT_END_HOUR)
    ? config.NIGHT_RPM_LIMIT
    : config.DAY_RPM_LIMIT;
}
```

The queue self-adjusts. No separate code path needed.

### 2. Night drain cron job

A dedicated cron runs at `NIGHT_START_HOUR:05` (5 minutes after night starts) to:
1. Fetch all `pending` offers
2. Enqueue them all with `priority = 'low'`
3. AnalysisQueue drains at `NIGHT_RPM_LIMIT` speed

This is a safety net for offers that arrived when:
- LLM was disabled
- App was restarted and queue was cleared
- Real-time analysis failed all retries

New cron schedule in `config/constants.js`:
```
NIGHT_DRAIN_SCHEDULE = '5 23 * * *'   # 23:05 every night
```

### 3. Daily quota reset

At `00:00` (midnight), reset `analysisQueue.requestsToday = 0`.
New cron: `QUOTA_RESET_SCHEDULE = '0 0 * * *'`

Or: store `lastResetDate` and check on each request if the date changed.
The date-check approach survives restarts cleanly:

```js
_checkDailyReset() {
  const today = new Date().toDateString();
  if (this.lastResetDate !== today) {
    this.requestsToday = 0;
    this.lastResetDate = today;
  }
}
```

### 4. Quota budget split (optional, advanced)

If `OPENROUTER_RPD_LIMIT` is set:
- Daytime budget: `Math.floor(RPD_LIMIT * DAY_BUDGET_FRACTION)` (default 30%)
- Night budget: remaining 70%

When daytime budget exhausted → pause real-time analysis, queue everything for night.
When night budget exhausted → mark all remaining `pending` (will retry next day).

Simple implementation: track `daytimeBudget` and `nighttimeBudget` separately in `AnalysisQueue`.

---

## Key Changes

| File | Change |
|------|--------|
| `src/analysis/queue.js` | `_getRPMLimit()` method; `_checkDailyReset()` on each request |
| `src/scheduler/index.js` | Add `startNightDrain()` cron + `drainPendingOffers()` method |
| `config/constants.js` | Add `NIGHT_START_HOUR`, `NIGHT_END_HOUR`, `NIGHT_RPM_LIMIT`, `DAY_RPM_LIMIT`, `NIGHT_DRAIN_SCHEDULE` |

---

## Implementation Steps

1. Add night constants to `config/constants.js`.
2. Update `AnalysisQueue._waitForRateLimit()` to call `_getRPMLimit()` dynamically.
3. Add `_checkDailyReset()` call at the top of `_processNext()`.
4. In `BatchProcessor.startJobs()`, add night drain cron:
   ```js
   cron.schedule(config.NIGHT_DRAIN_SCHEDULE, async () => {
     const pending = await this.db.getPendingOffers();
     for (const offer of pending) {
       this.analysisQueue.enqueue(offer.id, 'low');
     }
     logger.info(`Night drain: queued ${pending.length} pending offers`);
   });
   ```
5. Pass `analysisQueue` reference to `BatchProcessor` constructor.
6. After night drain completes (all processed), send a single daily digest if any offers matched.

---

## Interaction with Daily Digest (Plan 01)

After night drain:
- Offers analyzed → `processed` or `rejected` in DB
- Daily digest cron (10:00) runs → finds 0 `pending` → gracefully exits
- OR: daily digest uses `WHERE status = 'processed' AND processed_at > yesterday` 
  to report yesterday's night results in the morning

**Recommendation:** Change the 10:00 digest to query `processed` offers from last 24h,
not `pending` offers. This way night drain + morning digest = clean pipeline.

---

## Night Drain Send Strategy

Option A: Night drain silently analyzes, morning digest sends report. (Recommended)
- User gets one summary at 10:00 with everything from the past 24h.
- Simpler, no overnight notifications.

Option B: Night drain sends instant alerts for high-confidence offers.
- User might prefer waking up to already-delivered notifications.
- Can cause notification flood if many offers pass threshold.

Option C: Configurable (`NIGHT_SEND_INSTANT_ALERTS = false`).

Default: **Option A**. User can opt in to B via config.

---

## Trade-offs

| Approach | Pro | Con |
|----------|-----|-----|
| Time-aware RPM in queue | Single code path | RPM check adds complexity |
| Separate night processor | Cleaner isolation | Duplicate batch logic |
| Cron-only night drain | Simple, stateless | 1-min gap before drain starts |

**Recommendation:** Time-aware RPM in `AnalysisQueue` + night drain cron as safety net.
Minimal new code, maximum effect.

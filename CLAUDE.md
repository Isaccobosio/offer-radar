# OfferRadar

Telegram bot that monitors Italian deal channels and delivers filtered offer summaries to the owner.

## Stack

- **GramJS** (`telegram` npm) — MTProto client for reading channel history with a burner account
- **Telegraf** — Bot API for sending messages/commands to the owner
- **SQLite** (`better-sqlite3`) — Stores offers, channels, interests at `./data/offers.db`
- **Groq** (mixtral-8x7b-32768) — LLM scoring/filtering (optional; app runs without it)
- **node-cron** — Daily digest at 10 AM, cleanup at 11 PM, backfill every 5 min

## Architecture

```
Telegram channels → GramJS (burner MTProto) → SQLite → Groq LLM → Telegraf bot → Owner
```

## Key files

| File | Purpose |
|------|---------|
| `src/index.js` | Main orchestrator (`OfferRadar` class) |
| `src/userbot/history.js` | Backfiller: paginates channel history via MTProto |
| `src/userbot/client.js` | Live GramJS listener |
| `src/bot/` | Telegraf commands and handlers |
| `src/scheduler/` | Batch processor (daily digest) |
| `config/constants.js` | All tuneable constants |

## Gotchas

### GramJS dates are Unix seconds
`msg.date` from GramJS is a Unix timestamp in **seconds**, not milliseconds.
- Always use `new Date(msg.date * 1000)` — never `new Date(msg.date)`
- Always compare against a seconds-based limit: `const dateLimitSec = Math.floor(Date.now() / 1000 - days * 86400)`

### Bot API channel IDs need the -100 prefix stripped
Channels in the DB have Bot API IDs like `-1001063843030`. GramJS `getEntity()` needs the bare ID `1063843030`.
Strip with: `parseInt(Math.abs(id).toString().replace(/^100/, ''), 10)`

### Pagination must break the outer loop
When paginating with `getMessages`, set a `reachedOldMessages` flag inside the inner `for` loop and check it in the outer `while` condition — a bare `break` only exits the inner loop.

## Environment variables

```
API_ID, API_HASH, BURNER_PHONE   # Telegram MTProto (from my.telegram.org)
TELEGRAM_SESSION                 # GramJS session string (from npm run setup:session)
BOT_TOKEN                        # Telegraf bot token (from @BotFather)
MAIN_ACCOUNT_ID                  # Owner's Telegram user ID
GROQ_API_KEY                     # Optional — LLM disabled if absent
```

## Commands

```bash
npm start               # Production
npm run dev             # Dev with nodemon
npm run setup:session   # Authenticate burner account (one-time)
```

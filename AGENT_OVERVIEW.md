# OfferRadar — Agent Overview

Generated: 2026-04-26
Purpose: A concise, machine- and human-readable overview for autonomous agents or new engineers to understand, run, test, and modify this repository.

---

## Quick facts
- Language/runtime: Node.js (official Docker image: node:18-alpine)
- Entry point: `src/index.js`
- Package manager: npm (package.json present)
- Key scripts (package.json):
  - `start` -> node src/index.js
  - `setup:session` -> node src/setup.js
  - `dev` -> nodemon src/index.js
  - `test` -> jest
  - `create:session` -> node src/userbot/create_session.js
- Main dependencies: telegram client libraries, `groq-sdk` (LLM), `sqlite3` (storage), `node-cron`, `winston`, `axios`, `dotenv`
- Docker: `Dockerfile` (healthcheck hits `http://localhost:8080/health`) and `docker-compose.yml` exist

---

## One-line description
Telegram UserBot that collects forwarded offers from monitored channels, analyzes them with Groq LLM, filters by user interests, stores results in SQLite, and delivers daily summaries to the user's main account.

---

## High-level architecture
1. Burner (user) account subscribes to channels and forwards messages to the UserBot.
2. UserBot (GramJS/telegram module) receives forwarded messages and stores raw offers in SQLite (`data/offers.db`).
3. Scheduler (daily cron) batches pending offers and calls the Groq LLM via `groq-sdk` to analyze, classify, and score them.
4. Processed offers that pass confidence thresholds are summarized and sent to the user's MAIN account via a Telegram bot token.
5. DB tables hold interests, offers, channels, processed messages, and feedback.

(See README.md architecture diagram for ASCII view.)

---

## Project structure (important files/dirs)
- `src/`
  - `index.js` — main entrypoint and orchestrator
  - `setup.js` — interactive session setup and auth
  - `userbot/` — userbot client code and session creation
  - `bot/` — command handlers and bot-facing logic (commands: /start, /add_interest, /add_channel, /search, /stats, /my_interests, etc.)
  - `llm/` — Groq LLM adapter and prompt logic
  - `db/` — SQLite helpers and schema interaction
  - `scheduler/` — cron job(s) for daily processing (10:00 UTC by default)
  - `utils/` — logger, delay/humanization, error helpers
- `config/constants.js` — configuration values and defaults
- `data/` — persistent SQLite DB (`offers.db`) (persisted in docker volumes)
- `logs/` — `combined.log`, `error.log`
- `.env.example` — environment template
- `Dockerfile` / `docker-compose.yml` — containerization and resources
- Docs: `README.md`, `QUICK_SETUP.md`, `STEP_BY_STEP.md`, `SETUP_CHECKLIST.md`, `GUIDES_INDEX.md`, `WHAT_DO_I_NEED.md` — strong onboarding docs already present

---

## Environment variables (from .env.example / README)
- BURNER_PHONE (optional)
- API_ID (from my.telegram.org)
- API_HASH (from my.telegram.org)
- TELEGRAM_SESSION (string session for userbot; set after `npm run setup:session`)
- GROQ_API_KEY (Groq LLM API key, starts with `gsk_`)
- BOT_TOKEN (BotFather token for the bot interface)
- MAIN_ACCOUNT_ID (numeric user id to receive summaries)
- LOG_LEVEL (info by default)
- DATABASE_PATH (default `./data/offers.db`)

Important: `.env` must never be committed.

---

## Database schema (conceptual)
- `interests` — id, keyword, category, confidence_threshold, created_at
- `offers` — id, message_id, channel_id, channel_name, raw_text, summary, confidence_score, category, matched_interests, status, created_at, processed_at
- `processed_messages` — id, message_id, channel_id, processed_at
- `channels` — id, channel_id, channel_name, subscribed_at
- `feedback` — id, offer_id, rating, created_at

Common queries in README show how to inspect and prune old offers.

---

## Bot commands (user-facing)
- `/start` — interactive menu (inline keyboard)
- `/add_channel <name>` — register a channel to monitor
- `/channels` — list monitored channels
- `/add_interest <keyword> <category>` — add new interest
- `/my_interests` — list interests
- `/remove_interest <keyword>` — remove interest
- `/search <keyword>` — search past offers
- `/stats` — show processed counts and metadata
- `/help` — command list

Handlers live in `src/bot/*` and likely map commands to DB updates and replies.

---

## How to run (developer / agent checklist)
1. Read `.env.example` and fill `.env` with credentials (API_ID, API_HASH, BOT_TOKEN, MAIN_ACCOUNT_ID, GROQ_API_KEY).
2. Install: `npm ci` (or `npm install` for dev).
3. Create userbot session: `npm run setup:session` and follow prompts; set `TELEGRAM_SESSION` in `.env` if prompted.
4. Start in dev: `npm run dev` (nodemon). Production: `npm start`.
5. Check logs: `tail -f combined.log` and `error.log`.
6. To run tests: `npm test` (uses jest).

Docker:
- Build: `docker build -t offer-radar .`
- Run (compose): `docker-compose up -d` — docker-compose passes env vars from host `.env` and mounts `./data` and `./logs`.

Note: Dockerfile HEALTHCHECK calls `http://localhost:8080/health` — confirm a health endpoint is implemented in `src/index.js` or add one, otherwise healthcheck will fail.

---

## Common runtime issues & quick fixes
- `FLOOD_WAIT` (Telegram rate limit): backoff is implemented; check logs and reduce request rate.
- `AUTH_KEY_UNREGISTERED`: session expired — remove `TELEGRAM_SESSION` and re-run `npm run setup:session`.
- `GROQ_API_KEY` errors: verify key in .env and console.groq.com usage limits.
- Bot not sending messages: verify `BOT_TOKEN` and `MAIN_ACCOUNT_ID` are correct; ensure bot is running and network connectivity is available.
- No offers at daily run: ensure channels are registered (`/add_channel`) and that offers were forwarded.

---

## Onboarding checklist for an autonomous agent (or new engineer)
1. Verify Node version (>=16/18 preferred). Check Dockerfile uses node:18.
2. Inspect `package.json` scripts and dependencies.
3. Run `npm ci` to install production deps.
4. Copy `.env.example` -> `.env` and populate required keys (do not commit).
5. Run `npm run setup:session` to generate session for the burner account (if not using TELEGRAM_SESSION).
6. Start the app: `npm start` and watch `combined.log` for startup messages.
7. Add a monitored channel: call `/add_channel` from app UI (or edit DB and restart if needed).
8. Forward one example message to the bot and confirm it is stored in `data/offers.db` (sqlite3 or DB helper in `src/db`).
9. Trigger analysis manually (if scheduler supports it) or wait for daily job at 10:00 UTC.
10. Search with `/search <keyword>` and validate responses.

---

## Recommended immediate improvements (low-effort, high-value)
- Verify or add HTTP health endpoint (`/health`) to satisfy Dockerfile healthcheck.
- Add integration tests that simulate forwarding a message and verifying DB storage and analysis pipeline.
- Add CI job to run `npm test` and a lint step.
- Add DB migration/versioning (small SQL migration files) so schema changes are controlled.
- Add explicit graceful shutdown handling for Node process to avoid DB corruption.
- Consider adding simple metrics (counts) and an endpoint to view readiness/liveness.

---

## Where to look in code (quick pointers)
- `src/index.js` — startup & top-level orchestration
- `src/setup.js` — session creation
- `src/userbot/` — userbot client and session helpers
- `src/bot/` — command handlers and message dispatch
- `src/llm/` — Groq API wrapper and prompt templates
- `src/db/` — sqlite access patterns and queries
- `src/scheduler/` — cron logic for daily processing
- `config/constants.js` — default configuration values
- `logs/` and `data/` — runtime artifacts

---

## Final notes for autonomous agents
- This file is intended to give you the context to run, test, and extend OfferRadar without manual hand-holding. When making code changes that affect behavior (scheduling, DB schema, message formats), update this file and `README.md` to keep onboarding in sync.
- If you detect missing pieces (for example, health endpoint referenced by Dockerfile but not present), either implement small adapters in `src/index.js` (express/fastify tiny server) or update Dockerfile/compose to remove the healthcheck.

---

Reference docs: `README.md`, `QUICK_SETUP.md`, `STEP_BY_STEP.md`, `SETUP_CHECKLIST.md`, `GUIDES_INDEX.md`, `WHAT_DO_I_NEED.md` (already in repo).

Generated by: Senior SW Engineer assistant (agent-oriented overview).

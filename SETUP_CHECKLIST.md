# OfferRadar Setup Checklist 📋

Complete this checklist to gather all the information you need to set up OfferRadar.

---

## Step 1: Telegram API Credentials 🔐

### Get API_ID and API_HASH

**Where to go:** https://my.telegram.org

**Steps:**
1. Open https://my.telegram.org in your browser
2. Log in with your **main Telegram account** (the one you use daily)
3. Click on "API development tools"
4. If prompted, accept the terms and create an app
5. Fill in the form:
   - App name: `OfferRadar`
   - Short name: `offerradar`
   - URL: (leave blank)
6. Click "Create application"
7. You'll see two important numbers:
   - **api_id** (e.g., `12345678`)
   - **api_hash** (e.g., `abcdef1234567890abcdef1234567890`)

**Save these:**
```
API_ID: _______________
API_HASH: _______________
```

---

## Step 2: Telegram Bot Token 🤖

### Create a Bot with BotFather

**Steps:**
1. Open Telegram and search for `@BotFather`
2. Send `/newbot`
3. BotFather asks for a name (anything you want):
   - Name: `OfferRadarBot` (or any name)
4. BotFather asks for a username (must be unique, ends with "bot"):
   - Username: `myofferradarbot` (or similar - must be unique)
5. BotFather gives you a token that looks like:
   ```
   123456789:ABCdefGHIjklMNOpqrsTUVwxyz1234567890
   ```

**Save this:**
```
BOT_TOKEN: _______________
```

---

## Step 3: Your Telegram User ID 👤

### Get Your User ID

**Option A: Quick way (recommended)**
1. Search for `@userinfobot` on Telegram
2. Send `/start`
3. It shows your User ID (e.g., `987654321`)

**Option B: Alternative way**
1. Open any chat in Telegram
2. Search for `@useridbot`
3. Send `/start`
4. It shows your ID

**Save this:**
```
MAIN_ACCOUNT_ID: _______________
```

---

## Step 4: Groq API Key 🧠

### Get Free Groq API Key

**Where to go:** https://console.groq.com

**Steps:**
1. Go to https://console.groq.com
2. Click "Sign up" (or sign in if you have account)
3. Create account with email
4. Verify email
5. Go to "API Keys" section
6. Click "Create API Key"
7. Copy your key (looks like: `gsk_1234567890abcdefghijklmnopqrst`)

**Limits (Free tier):**
- 30 requests/minute (plenty for our use case)
- 100% free

**Save this:**
```
GROQ_API_KEY: _______________
```

---

## Summary: Your .env File 📝

Once you have all the info above, fill in your `.env` file:

```bash
cd /Users/isaccobosio/Documents/lavoro/repo/offer-radar
cp .env.example .env
nano .env
```

Fill in these values:

```bash
# Burner Account (UserBot)
BURNER_PHONE=+1234567890          # ← OPTIONAL - leave for now
API_ID=12345678                    # ← From my.telegram.org
API_HASH=abcdef123456789           # ← From my.telegram.org
TELEGRAM_SESSION=                  # ← Leave empty

# LLM
GROQ_API_KEY=gsk_1234567890        # ← From console.groq.com

# Your Main Account (Bot Interface)
BOT_TOKEN=123456789:ABCdefGHI      # ← From BotFather
MAIN_ACCOUNT_ID=987654321          # ← From @userinfobot

# Optional - leave as defaults
LOG_LEVEL=info
DATABASE_PATH=./data/offers.db
```

---

## Verification Checklist ✅

Before you start, make sure you have:

- [ ] **API_ID** (number from my.telegram.org)
- [ ] **API_HASH** (long string from my.telegram.org)
- [ ] **BOT_TOKEN** (from @BotFather, has colon in it)
- [ ] **MAIN_ACCOUNT_ID** (your Telegram user ID)
- [ ] **GROQ_API_KEY** (starts with `gsk_`)
- [ ] `.env` file filled in with all values
- [ ] npm packages installed (`npm install` already done ✅)

---

## Troubleshooting Setup

### "API_ID is empty" error
→ Make sure you copied from my.telegram.org correctly
→ Try logging out and back in to my.telegram.org

### "Invalid bot token" error
→ Make sure it includes the colon (e.g., `123:ABC`)
→ Did you send `/newbot` to @BotFather and not another bot?

### "Unknown chat ID" error
→ Make sure MAIN_ACCOUNT_ID is correct from @userinfobot
→ Try again - sometimes it's your numeric ID, not username

---

## Ready to Start? 🚀

Once your `.env` is filled in, run:

```bash
npm start
```

Then:
1. Send `/add_interest airpods electronics` to your bot
2. Add a few more interests
3. Check logs: `tail -f combined.log`

All set! 🎉

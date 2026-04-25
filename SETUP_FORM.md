# OfferRadar Setup Information Form

Print this out or save it to keep track of your credentials!

---

## Your Setup Information

**Date Started:** _______________

### 1. Telegram API Credentials
From: https://my.telegram.org

| Field | Value | Obtained | Verified |
|-------|-------|----------|----------|
| API_ID | _________________ | ☐ | ☐ |
| API_HASH | _________________ | ☐ | ☐ |

### 2. Telegram Bot
From: @BotFather (send /newbot)

| Field | Value | Obtained | Verified |
|-------|-------|----------|----------|
| Bot Username | _________________ | ☐ | ☐ |
| BOT_TOKEN | _________________ | ☐ | ☐ |

**Note:** Token should look like: `123456789:ABCdefGHI...`

### 3. Your Telegram ID
From: @userinfobot (send /start)

| Field | Value | Obtained | Verified |
|-------|-------|----------|----------|
| MAIN_ACCOUNT_ID | _________________ | ☐ | ☐ |

**Note:** Should be just numbers, like `987654321`

### 4. Groq API Key
From: https://console.groq.com

| Field | Value | Obtained | Verified |
|-------|-------|----------|----------|
| GROQ_API_KEY | _________________ | ☐ | ☐ |

**Note:** Should start with `gsk_` and be ~45 characters long

---

## Quick Reference

### Have you completed each step?

- [ ] **Step 1:** Went to my.telegram.org and got API_ID & API_HASH
- [ ] **Step 2:** Created bot with @BotFather and got BOT_TOKEN
- [ ] **Step 3:** Got your user ID from @userinfobot
- [ ] **Step 4:** Created Groq account and got API key
- [ ] **Step 5:** Filled in .env file with all values
- [ ] **Step 6:** Ran `npm start` successfully
- [ ] **Step 7:** Bot is running and responding to commands

---

## .env File Contents

Once you have all the info above, your `.env` file should look like:

```bash
# Telegram API
BURNER_PHONE=+1234567890
API_ID=YOUR_API_ID_HERE
API_HASH=YOUR_API_HASH_HERE
TELEGRAM_SESSION=

# LLM
GROQ_API_KEY=YOUR_GROQ_KEY_HERE

# Bot
BOT_TOKEN=YOUR_BOT_TOKEN_HERE
MAIN_ACCOUNT_ID=YOUR_USER_ID_HERE

# Defaults (can leave as-is)
LOG_LEVEL=info
DATABASE_PATH=./data/offers.db
```

---

## Troubleshooting Checklist

If something doesn't work, check:

### "API credentials not found"
- [ ] Logged in to my.telegram.org with YOUR main account (not burner)
- [ ] Copied both API_ID and API_HASH correctly
- [ ] No extra spaces before/after in .env file

### "Bot not responding"
- [ ] BOT_TOKEN copied correctly from BotFather (includes the colon)
- [ ] MAIN_ACCOUNT_ID is your user ID (not username, just numbers)
- [ ] Sent `/start` to your bot in Telegram

### "LLM not working"
- [ ] GROQ_API_KEY is correct and starts with `gsk_`
- [ ] Key is from https://console.groq.com (not other Groq pages)
- [ ] Have internet connection

---

## Support Resources

1. **Full Setup Guide:** STEP_BY_STEP.md
2. **Quick Reference:** QUICK_SETUP.md
3. **Detailed README:** README.md
4. **Troubleshooting:** See README.md troubleshooting section

---

**Status:** 
- [ ] Not started
- [ ] In progress
- [ ] Waiting on credentials
- [ ] Ready to start
- [ ] Running successfully ✅

**Completion Date:** _______________

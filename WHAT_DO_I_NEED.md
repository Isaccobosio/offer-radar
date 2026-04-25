# What Do I Actually Need? 🤔

Here's what you need to set up OfferRadar and WHY:

---

## The 4 Things You Need

```
┌─────────────────────────────────────────────────────────┐
│                                                         │
│  1. Telegram API Credentials                            │
│     ├─ API_ID                                           │
│     └─ API_HASH                                         │
│                                                         │
│     WHY? To let your app connect to Telegram            │
│     WHERE? https://my.telegram.org                      │
│     TIME: 5 minutes                                     │
│                                                         │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  2. Telegram Bot Token                                  │
│     └─ BOT_TOKEN                                        │
│                                                         │
│     WHY? So you can send/receive messages on Telegram   │
│     WHERE? @BotFather (send /newbot)                    │
│     TIME: 2 minutes                                     │
│                                                         │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  3. Your Telegram User ID                               │
│     └─ MAIN_ACCOUNT_ID                                  │
│                                                         │
│     WHY? So the bot knows who to send summaries to      │
│     WHERE? @userinfobot (send /start)                   │
│     TIME: 1 minute                                      │
│                                                         │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  4. Groq API Key                                        │
│     └─ GROQ_API_KEY                                     │
│                                                         │
│     WHY? To use the AI (LLM) to filter offers           │
│     WHERE? https://console.groq.com                     │
│     TIME: 3 minutes (free account)                      │
│                                                         │
└─────────────────────────────────────────────────────────┘

TOTAL TIME: ~15 minutes
TOTAL COST: $0 (everything is free)
```

---

## Detailed Explanation of Each

### 1️⃣ Telegram API Credentials (API_ID + API_HASH)

**What is it?**
- These are authentication tokens for YOUR app to talk to Telegram servers
- Think of it like a username/password pair for your application

**Why do I need it?**
- So OfferRadar can connect to Telegram and receive messages
- Without it, your app is just a regular program with no Telegram access

**Where to get it?**
- Go to https://my.telegram.org
- Log in with YOUR MAIN account
- Click "API development tools"
- You'll see API_ID (a number) and API_HASH (a long string)

**Is it safe?**
- ✅ Yes, these are like a username/password - keep them secret
- Don't share these with anyone
- Don't put them on GitHub (only in .env which is ignored)

---

### 2️⃣ Telegram Bot Token

**What is it?**
- This is your bot's identity on Telegram
- It's like a special key that proves "I am this bot"

**Why do I need it?**
- So Telegram knows it's YOU running the bot
- So the bot can send you messages and receive commands
- Without it, Telegram won't accept messages from your bot

**Where to get it?**
- Open Telegram
- Search for @BotFather
- Send `/newbot`
- Follow the questions (name for bot, unique username)
- BotFather gives you a token like: `123456789:ABCdefGHI...`

**Is it safe?**
- ⚠️ Somewhat - anyone with this token can control your bot
- Keep it secret like a password
- Don't share it

---

### 3️⃣ Your Telegram User ID (MAIN_ACCOUNT_ID)

**What is it?**
- This is your unique Telegram account number
- Like a phone number, but for Telegram
- It's just numbers (e.g., `987654321`)

**Why do I need it?**
- So the bot knows WHERE to send your daily summaries
- It's like your mailing address for the bot
- Without it, the bot wouldn't know who to message

**Where to get it?**
- Open Telegram
- Search for @userinfobot
- Send `/start`
- It shows your ID in the first line
- Copy just the number part

**Is it safe?**
- ✅ Yes, it's not secret
- Your user ID is somewhat public
- But combined with your BOT_TOKEN, keep both safe

---

### 4️⃣ Groq API Key

**What is it?**
- This is a key to use Groq's AI (Large Language Model)
- Like borrowing someone's smart brain to help filter offers
- Groq is a FREE AI service

**Why do I need it?**
- To use AI to intelligently filter offers
- Without it, OfferRadar can't understand what offers match your interests
- It's what makes OfferRadar "smart"

**Where to get it?**
- Go to https://console.groq.com
- Sign up (free with email)
- Go to "API Keys" section
- Click "Create API Key"
- Copy the key (starts with `gsk_`)

**Is it safe?**
- ✅ Yes for personal use
- Groq monitors for abuse
- Free tier has limits but more than enough for you

**How much does it cost?**
- ✅ FREE tier is available
- Limit: 30 requests/minute (plenty)
- Unlimited for basic use

---

## The 5-Minute Process

```
1. Open https://my.telegram.org
   → Log in → Copy API_ID and API_HASH              [2 min]

2. Open Telegram → @BotFather → /newbot
   → Copy BOT_TOKEN                                 [2 min]

3. Open Telegram → @userinfobot → /start
   → Copy MAIN_ACCOUNT_ID                           [1 min]

4. Open https://console.groq.com
   → Sign up → Get GROQ_API_KEY                     [3 min]

5. Edit .env file and paste all 4                   [2 min]
   → Done! ✅

Total: ~10-15 minutes
```

---

## What These Enable

Once you have all 4, OfferRadar can:

✅ **Connect to Telegram** (API_ID + API_HASH)
✅ **Receive messages** (BOT_TOKEN)
✅ **Know who you are** (MAIN_ACCOUNT_ID)
✅ **Understand offers with AI** (GROQ_API_KEY)
✅ **Send you summaries** (all 4 together)

---

## Important Notes

### Don't Need Right Now
- ❌ Burner phone number (optional for advanced setup)
- ❌ Telegram StringSession (auto-generated)
- ❌ Other environment variables (already have defaults)

### Need Right Now
- ✅ Main Telegram account (the one you use daily)
- ✅ Internet connection
- ✅ 15 minutes

### Keep Safe
- 🔒 Never share API credentials
- 🔒 Never commit .env to GitHub
- 🔒 Never give BOT_TOKEN to anyone

---

## Quick FAQ

**Q: Do I need a different Telegram account?**
A: No, use your main account. Use the same account you use daily.

**Q: Is Groq really free?**
A: Yes, free tier is available. 30 requests/minute is more than enough.

**Q: Can I change these later?**
A: Yes! Edit .env file and restart.

**Q: What if I lose one of these?**
A: You can get new ones - they're not permanent.

**Q: Are these the only things I need?**
A: For basic setup, yes! You don't need anything else.

---

## Ready? 

👉 **Start with:** STEP_BY_STEP.md (detailed walkthrough with every click)

or

👉 **Use:** SETUP_FORM.md (keep track as you gather info)

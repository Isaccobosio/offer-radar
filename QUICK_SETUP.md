# Quick Setup Reference 🚀

Copy-paste this checklist to keep track of what you need:

```
═══════════════════════════════════════════════════════════════
                    OFFER RADAR SETUP INFO
═══════════════════════════════════════════════════════════════

1. TELEGRAM API (from https://my.telegram.org)
   ─────────────────────────────────────────────
   API_ID:        [ _________________ ]
   API_HASH:      [ _________________ ]

2. TELEGRAM BOT (from @BotFather)
   ─────────────────────────────────────────────
   BOT_TOKEN:     [ _________________ ]

3. YOUR USER ID (from @userinfobot)
   ─────────────────────────────────────────────
   MAIN_ACCOUNT_ID: [ _________________ ]

4. GROQ API (from https://console.groq.com)
   ─────────────────────────────────────────────
   GROQ_API_KEY:  [ _________________ ]

═══════════════════════════════════════════════════════════════
```

---

## Where to Get Each ↓

| Info | Where | Link |
|------|-------|------|
| **API_ID & API_HASH** | My Telegram | https://my.telegram.org |
| **BOT_TOKEN** | @BotFather | https://t.me/botfather (send `/newbot`) |
| **MAIN_ACCOUNT_ID** | @userinfobot | https://t.me/userinfobot (send `/start`) |
| **GROQ_API_KEY** | Groq Console | https://console.groq.com |

---

## Quick Steps

### Step 1: Get API Credentials (5 min)
```bash
→ Go to https://my.telegram.org
→ Log in with your main account
→ Click "API development tools"
→ Create app → Copy api_id and api_hash
```

### Step 2: Create Telegram Bot (2 min)
```bash
→ Open Telegram
→ Search @BotFather
→ Send /newbot
→ Follow prompts
→ Copy the token
```

### Step 3: Get Your User ID (1 min)
```bash
→ Search @userinfobot
→ Send /start
→ Copy your ID
```

### Step 4: Get Groq API Key (3 min)
```bash
→ Go to https://console.groq.com
→ Sign up (free)
→ Go to API Keys
→ Create key
→ Copy it
```

### Step 5: Fill .env File (2 min)
```bash
cd /Users/isaccobosio/Documents/lavoro/repo/offer-radar
nano .env
```

Paste your values:
```bash
API_ID=YOUR_API_ID_HERE
API_HASH=YOUR_API_HASH_HERE
BOT_TOKEN=YOUR_BOT_TOKEN_HERE
MAIN_ACCOUNT_ID=YOUR_USER_ID_HERE
GROQ_API_KEY=YOUR_GROQ_KEY_HERE
```

### Step 6: Start! (1 min)
```bash
npm start
```

---

**Total time: ~15 minutes ⏱️**

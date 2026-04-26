# Step-by-Step Setup Guide 📖

Follow these steps in order to get all the information you need.

---

## ✅ Step 1: Get Telegram API Credentials (5 minutes)

### Where: https://my.telegram.org

**1.1. Open the website**
- Go to: https://my.telegram.org
- You should see a page asking you to log in

**1.2. Log in with ANY Telegram account**
- You can use your main account OR your burner account
- These are **application-level** credentials (not account-specific)
- Either one works the same
- You'll get a code sent to Telegram
- Enter the code

**1.3. Click "API development tools"**
- You'll see this option on the left sidebar
- Click it

**1.4. Create application (if needed)**
- If you see "Accept", click "Accept"
- Fill in the form:
  - **App name**: `OfferRadar`
  - **Short name**: `offerradar`
  - **URL**: (leave blank)
  - Click "Create application"

**1.5. Copy your credentials**
You'll see a box with:
```
App api_id:   123456  ← COPY THIS (just the number)
App api_hash: abcdef... ← COPY THIS (the long string)
```

**Save:**
```
API_ID = _______________
API_HASH = _______________
```

---

## ✅ Step 2: Create Telegram Bot (2 minutes)

### Where: Telegram app → @BotFather

**2.1. Open Telegram**
- On your phone or desktop app

**2.2. Search for @BotFather**
- Search for "BotFather" (official Telegram bot creator)
- Click on the verified one

**2.3. Send /newbot**
- Type: `/newbot` and send

**2.4. Follow the prompts**
- BotFather asks: "How should your new bot be called?"
  - Answer: `OfferRadarBot` (or any name you like)
  
- BotFather asks: "Give your bot a username"
  - Answer: `myofferradarbot` (must end with `bot`, must be unique on Telegram)

**2.5. Copy your token**
BotFather sends you something like:
```
Done! Congratulations on your new bot. You will find it at 
t.me/myofferradarbot. You can now add a description, about 
section and profile picture for your bot, see /help for a 
list of commands. By the way, when you've finished creating 
your bot and learn its going to change the world, read this 
article about Bot API manteinance.

Use this token to access the HTTP API:
123456789:ABCdefGHIjklMNOpqrsTUVwxyz1234567890
```

**The token is the long string starting with numbers and colon.**

**Save:**
```
BOT_TOKEN = _______________
```

---

## ✅ Step 3: Get Your Telegram User ID (1 minute)

### Where: Telegram app → @userinfobot

**3.1. Open Telegram on your MAIN account**
- This is the account you use daily
- This is where you'll RECEIVE the bot summaries
- NOT the burner account

**3.2. Search for @userinfobot**
- Search for "userinfobot"

**3.3. Send /start**
- Type: `/start` and send

**3.4. Copy your ID**
Bot replies with something like:
```
Id: 987654321
Is bot: False
First name: YourName
Username: @yourusername
...
```

Copy the **Id** number (just the numbers, not the word "Id")

**Save:**
```
MAIN_ACCOUNT_ID = _______________
```

---

## ✅ Step 4: Get Groq API Key (3 minutes)

### Where: https://console.groq.com

**4.1. Open the website**
- Go to: https://console.groq.com

**4.2. Sign up (if needed)**
- Click "Sign up"
- Use your email
- Verify email

**4.3. Log in**
- Enter your email and password

**4.4. Go to API Keys**
- Look for "API Keys" or "Keys" section
- Or click your profile → API Keys

**4.5. Create a new key**
- Click "+ Create API Key" or "New Key"
- Give it a name: `OfferRadar`
- Click "Create"

**4.6. Copy your key**
You'll see something like:
```
gsk_1234567890abcdefghijklmnopqrstuvwxyz
```

Copy the entire string (including the `gsk_` part)

**Save:**
```
GROQ_API_KEY = _______________
```

---

## ✅ Step 5: Fill in Your .env File (2 minutes)

**5.1. Open your terminal**
```bash
cd /Users/isaccobosio/Documents/lavoro/repo/offer-radar
```

**5.2. Edit .env file**
```bash
nano .env
```

**5.3. Find and fill in these lines:**

Look for:
```bash
API_ID=123456
```
Replace `123456` with your actual API_ID from Step 1

Look for:
```bash
API_HASH=abc123xyz
```
Replace with your actual API_HASH from Step 1

Look for:
```bash
BOT_TOKEN=6123456:ABC
```
Replace with your actual BOT_TOKEN from Step 2

Look for:
```bash
MAIN_ACCOUNT_ID=12345
```
Replace with your actual MAIN_ACCOUNT_ID from Step 3

Look for:
```bash
GROQ_API_KEY=gsk_
```
Replace with your actual GROQ_API_KEY from Step 4

**5.4. Save and exit**
- Press `Ctrl+X`
- Press `Y` (to confirm save)
- Press `Enter`

---

## ✅ Step 6: Start OfferRadar! 🚀

```bash
npm start
```

You should see:
```
🚀 Starting OfferRadar...
✅ UserBot initialized successfully!
✅ Bot connected as @myofferradarbot
💡 Everything is running. Listening for offers...
```

---

## ✅ Step 7: Add Your First Interests

Open Telegram and message your bot:

```
/add_interest airpods electronics
/add_interest anker battery
/add_interest iphone smartphone
```

---

## ✅ Test It Works

**Option 1: Forward a message**
- Find a Telegram channel with offers
- Forward any message to your bot
- Check logs: `tail -f combined.log`

**Option 2: Check your interests**
- Send `/my_interests` to your bot
- Should list what you added

**Option 3: Get stats**
- Send `/stats` to your bot
- Should show database info

---

## 🎉 All Done!

Your OfferRadar is now running and will:
- ✅ Listen for forwarded messages from channels
- ✅ Analyze them with AI
- ✅ Filter for your interests
- ✅ Send you daily summaries at 10 AM

### Pro Tips
- 💡 Start small with 3-5 interests
- 💡 Forward messages regularly to train the system
- 💡 Check logs if something seems off: `tail -f combined.log`
- 💡 Use `/search [keyword]` to find past offers

---

**Need help? Check the README.md for troubleshooting**

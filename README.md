# OfferRadar 📦

> Intelligent Telegram bot that monitors channels and sends you only the valuable offers you care about.

## Overview

OfferRadar is a **Telegram UserBot** that:
- 🤖 Listens to all your subscribed channels 24/7
- 🧠 Uses AI (Groq LLM) to intelligently filter offers
- ✨ Sends daily summaries of high-value products
- 🎯 Tracks custom keywords and categories
- 🔍 Lets you search historical offers anytime
- 🛡️ Uses anti-detection patterns to avoid account bans

## Architecture

```
Telegram Channels (5+)
    ↓ (Messages)
    ↓
UserBot (GramJS)
    ↓ (Raw offers)
    ↓
SQLite Database
    ↓ (Pending offers)
    ↓
Groq LLM API
    ↓ (Analysis)
    ↓
Your Main Bot
    ↓ (Daily summary)
    ↓
You (Main Account)
```

## Prerequisites

### Required
- **Node.js** 16+ ([Download](https://nodejs.org/))
- **npm** (comes with Node.js)
- **Telegram** account (main) + phone number for burner account
- **Home server** or VPS to run on (or Proxmox LXC container)

### API Keys Needed
1. **Telegram API** - Get from https://my.telegram.org
   - `API_ID`
   - `API_HASH`

2. **Groq API** - Get from https://console.groq.com
   - `GROQ_API_KEY` (free tier available)

3. **Telegram Bot Token** - Create bot with [@BotFather](https://t.me/botfather)
   - `BOT_TOKEN`

### Phone Numbers
- **Main account phone**: Your regular Telegram number
- **Burner account phone**: Virtual number (see Setup section)

---

## Setup Guide

### Step 1: Get a Virtual Phone Number

For the burner Telegram account, get a virtual phone number:

**Option A: Google Voice (Free, US only)**
- Go to https://voice.google.com
- Sign in with Google account
- Reserve a number

**Option B: Twilio (Recommended, ~$1/month, worldwide)**
- Sign up at https://www.twilio.com
- Add payment method
- Get a phone number (~$1/month)
- Use it for Telegram only

**Option C: Physical SIM Card (Most reliable)**
- Buy a prepaid SIM card locally
- Insert in any phone or phone adapter
- Use for Telegram registration

### Step 2: Clone Repository

```bash
cd ~/Documents/lavoro/repo
git clone https://github.com/Isaccobosio/offer-radar.git
cd offer-radar
```

### Step 3: Install Dependencies

```bash
npm install
```

### Step 4: Get Telegram API Credentials

1. Go to https://my.telegram.org
2. Log in with your **main account**
3. Click "API development tools"
4. Create an app:
   - App name: "OfferRadar"
   - Accept terms and click "Create"
5. Copy `api_id` and `api_hash` (you'll need these)

### Step 5: Create Telegram Bot

1. Open [@BotFather](https://t.me/botfather) on Telegram
2. Send `/newbot`
3. Choose a name for your bot
4. BotFather gives you a token (starts with `123456:ABC...`)
5. Get your user ID by sending `/start` to [@userinfobot](https://t.me/userinfobot)

### Step 6: Create .env File

```bash
cp .env.example .env
```

Edit `.env` with your credentials:

```bash
# Burner Account (UserBot)
BURNER_PHONE=+1234567890          # Your virtual number
API_ID=123456                      # From my.telegram.org
API_HASH=abc123xyz                 # From my.telegram.org
TELEGRAM_SESSION=                  # Auto-generated (leave empty)

# LLM
GROQ_API_KEY=gsk_...              # From console.groq.com

# Your Main Account (Bot Interface)
BOT_TOKEN=123456:ABC              # From BotFather
MAIN_ACCOUNT_ID=987654321         # Your user ID

# Optional
LOG_LEVEL=info
```

### Step 7: Initial Authentication

Run the setup script to authenticate the burner account:

```bash
npm run setup:session
```

Follow the prompts:
1. Telegram will send a code to your burner phone
2. Enter the code when prompted
3. The script saves your session token

**Save the session string!** If prompted, copy it and add to `.env`:
```bash
TELEGRAM_SESSION=<long-string-here>
```

### Step 8: Add Channels to Monitor

The burner account needs to be a member of the channels you want to monitor. To add channels:

**Option A: Join channels manually**
1. Switch to the burner account
2. Join all the offer channels you care about
3. They'll be automatically detected

**Option B: Use the database directly**
```bash
sqlite3 data/offers.db
INSERT INTO channels (channel_id, channel_name) VALUES (-1001234567890, 'channel_name');
```

### Step 9: Add Your First Interests

Send your bot the command:

```
/add_interest airpods electronics
/add_interest anker battery
/add_interest iphone smartphone
```

---

## Running OfferRadar

### Development Mode (with auto-restart)

```bash
npm run dev
```

### Production Mode

```bash
npm start
```

### Check Logs

```bash
tail -f combined.log
```

---

## Bot Commands

Use these commands to interact with OfferRadar:

### Interest Management
```
/add_interest [keyword] [category]
  Add what to track
  Example: /add_interest "airpods pro" electronics

/my_interests
  List all tracked keywords

/remove_interest [keyword]
  Stop tracking something
```

### Search & Info
```
/search [keyword]
  Find past offers by keyword
  
/stats
  View statistics

/help
  Show all commands
```

### Daily Summaries
- Sent automatically at **10:00 AM** UTC
- Grouped by category
- Shows confidence score and channel source
- Maximum 14-day history by default

---

## Deployment on Home Server (Proxmox LXC)

### Option 1: Direct on Proxmox Host

```bash
# SSH into Proxmox
ssh root@proxmox-ip

# Install Node.js
curl -sL https://deb.nodesource.com/setup_18.x | sudo bash -
apt install -y nodejs

# Clone and setup
cd /opt
git clone https://github.com/Isaccobosio/offer-radar.git
cd offer-radar
npm install
npm run setup:session

# Start with PM2
npm install -g pm2
pm2 start src/index.js --name offer-radar
pm2 save
pm2 startup
```

### Option 2: LXC Container (Recommended)

```bash
# On Proxmox host
lxc launch ubuntu:22.04 offer-radar
lxc exec offer-radar -- bash

# Inside container
apt update && apt upgrade -y
apt install -y nodejs npm git sqlite3 curl

# Clone repo
cd /opt
git clone https://github.com/Isaccobosio/offer-radar.git
cd offer-radar

# Copy .env
nano .env
# Paste your environment variables

# Setup
npm install
npm run setup:session

# Run
npm start
```

### Option 3: Docker

```bash
# Build image
docker build -t offer-radar .

# Run container
docker run -d \
  --name offer-radar \
  --restart unless-stopped \
  -v ./data:/app/data \
  -e BURNER_PHONE=$BURNER_PHONE \
  -e API_ID=$API_ID \
  -e API_HASH=$API_HASH \
  -e GROQ_API_KEY=$GROQ_API_KEY \
  -e BOT_TOKEN=$BOT_TOKEN \
  -e MAIN_ACCOUNT_ID=$MAIN_ACCOUNT_ID \
  offer-radar
```

---

## Database Schema

### Tables

**interests** - Keywords you're tracking
```sql
id, keyword, category, confidence_threshold, created_at
```

**offers** - Collected offers from channels
```sql
id, message_id, channel_id, channel_name, raw_text, summary, 
confidence_score, category, matched_interests, status, 
created_at, processed_at
```

**processed_messages** - Deduplication index
```sql
id, message_id, channel_id, processed_at
```

**feedback** - Your ratings (useful/spam)
```sql
id, offer_id, rating, created_at
```

**channels** - Monitored channels
```sql
id, channel_id, channel_name, subscribed_at
```

### Query Examples

```bash
sqlite3 data/offers.db

# See all interests
SELECT * FROM interests;

# Count offers per category
SELECT category, COUNT(*) FROM offers WHERE status='processed' GROUP BY category;

# Search for specific offer
SELECT * FROM offers WHERE raw_text LIKE '%airpods%';

# Delete old offers
DELETE FROM offers WHERE created_at < datetime('now', '-14 days');
```

---

## Monitoring & Logs

### Log Files

- `combined.log` - All logs
- `error.log` - Errors only
- Console output - Real-time

### Check Status

```bash
# If using PM2
pm2 status

# View logs
pm2 logs offer-radar

# Restart
pm2 restart offer-radar
```

### Memory Usage

OfferRadar should use <100MB normally. If memory grows:

```bash
# Check process
ps aux | grep node

# Restart
npm start
# or
pm2 restart offer-radar
```

---

## Troubleshooting

### "FLOOD_WAIT" Error
**Problem**: Telegram rate limiting detected
**Solution**: Bot automatically retries with delays. Check logs for details.

### "AUTH_KEY_UNREGISTERED"
**Problem**: Session expired
**Solution**: Delete session string from .env and run `npm run setup:session` again

### Bot Not Sending Messages
**Problem**: Messages not arriving
**Solution**: 
- Check `BOT_TOKEN` is correct
- Verify `MAIN_ACCOUNT_ID` matches your Telegram ID
- Send `/start` to the bot to activate it

### No Offers Being Found
**Problem**: No summaries sent
**Solution**:
- Check interests with `/my_interests`
- Verify burner account is in channels
- Check logs for LLM errors
- Lower confidence threshold temporarily

### "GROQ_API_KEY" Error
**Problem**: LLM not working
**Solution**:
- Get key from https://console.groq.com
- Make sure it's in .env: `GROQ_API_KEY=gsk_...`

---

## Performance Tips

1. **Batch Processing**: Only runs once daily (10 AM) - very efficient
2. **Rate Limiting**: Built-in delays prevent Telegram bans
3. **Database**: SQLite auto-indexes for fast searches
4. **Memory**: Cleans up old offers every 14 days
5. **Proxy** (Optional): Add proxy to .env for extra privacy

---

## Security Best Practices

✅ **Do:**
- Use a separate burner account
- Keep `.env` file secure (never commit)
- Enable 2FA on burner account
- Rotate session tokens monthly
- Use a VPS/home server you control

❌ **Don't:**
- Commit `.env` file to git
- Share API keys
- Use with main Telegram account
- Run on untrusted servers
- Disable TLS/SSL proxies

---

## Project Structure

```
offer-radar/
├── src/
│   ├── userbot/client.js          # GramJS UserBot
│   ├── llm/index.js               # Groq LLM analyzer
│   ├── db/index.js                # SQLite database
│   ├── bot/index.js               # Telegram bot interface
│   ├── scheduler/index.js         # Cron batch jobs
│   ├── utils/
│   │   ├── logger.js              # Logging
│   │   ├── delays.js              # Human-like delays
│   │   └── errors.js              # Error handling
│   ├── index.js                   # Main entry point
│   └── setup.js                   # One-time setup
├── config/constants.js            # Configuration
├── data/offers.db                 # SQLite database
├── .env.example                   # Environment template
├── package.json
└── README.md
```

---

## Contributing

Ideas and improvements welcome! Feel free to:
- 🐛 Report bugs
- ✨ Suggest features
- 🔧 Submit pull requests

---

## License

MIT License - See LICENSE file

---

## Support & Community

- 📖 Check the logs: `tail -f combined.log`
- 🆘 Stuck? Check Troubleshooting section above
- 💬 Questions? Review the code comments
- 🚀 Want more features? Customize it!

---

## Roadmap

- [ ] Web dashboard for stats
- [ ] Export offers to CSV
- [ ] Mobile app notification
- [ ] Custom AI model support
- [ ] Multi-user support
- [ ] Discord integration
- [ ] Price history tracking
- [ ] Deal recommendations

---

Made with ❤️ for deal hunters everywhere

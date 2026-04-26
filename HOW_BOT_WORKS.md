# How OfferRadar Bot Works 🤖

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                                                             │
│  BURNER ACCOUNT (Channels monitoring)                       │
│  ├─ Joins offer channels                                    │
│  └─ Forwards interesting messages to the bot               │
│                                                             │
└─────────────────────────────────────────────────────────────┘
              ↓ (Forward messages)
┌─────────────────────────────────────────────────────────────┐
│                                                             │
│  TELEGRAM BOT (OfferRadar)                                  │
│  ├─ Receives forwarded messages                            │
│  ├─ Stores them in database                                │
│  └─ Processes daily at 10 AM                               │
│                                                             │
└─────────────────────────────────────────────────────────────┘
              ↓ (Analyze with AI)
┌─────────────────────────────────────────────────────────────┐
│                                                             │
│  GROQ AI (Analysis Engine)                                  │
│  ├─ Matches offers to your interests                        │
│  ├─ Assigns confidence scores                              │
│  └─ Returns summaries                                       │
│                                                             │
└─────────────────────────────────────────────────────────────┘
              ↓ (Send summary)
┌─────────────────────────────────────────────────────────────┐
│                                                             │
│  MAIN ACCOUNT (You)                                         │
│  ├─ Receives daily summaries at 10 AM                       │
│  ├─ Can search offers anytime                               │
│  └─ Manage interests/channels                               │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## What You Need to Do

### Step 1: Set Up Channels (One-time setup)

1. **On your burner account**, go to a channel with offers
2. **In OfferRadar chat**, send: `/add_channel offers_electronics`
   - Replace "offers_electronics" with actual channel name
3. The bot confirms the channel is registered
4. **Repeat for each channel** you want to monitor

**Example channels to add:**
```
/add_channel offers_tech
/add_channel discounts_fashion
/add_channel electronics_deals
```

### Step 2: Add Your Interests (One-time or ongoing)

1. **In OfferRadar chat**, send: `/add_interest airpods electronics`
   - Format: `/add_interest [keyword] [category]`
2. The bot confirms the interest is saved
3. **The AI now matches offers** against your interests
4. **Repeat for each keyword** you want to track

**Example interests to add:**
```
/add_interest iphone electronics
/add_interest airpods electronics
/add_interest macbook computers
/add_interest battery power_tools
/add_interest discount home_appliances
```

### Step 3: Forward Offers to the Bot

1. **On your burner account**, when you see a good offer:
   - Long-press the message
   - Tap "Forward"
   - Select the OfferRadar bot
   - Send
2. The bot stores it in the database
3. **Every day at 10 AM**, the bot:
   - Analyzes all pending offers
   - Checks them against your interests
   - Sends you a summary of valuable ones

## Bot Commands & Features

### 📋 Manage Interests

**Add Interest:**
```
/add_interest [keyword] [category]
```
Example: `/add_interest airpods electronics`

**View Your Interests:**
```
/my_interests
```
Shows all keywords organized by category

**Remove Interest:**
```
/remove_interest [keyword]
```
Example: `/remove_interest airpods`

### 📡 Manage Channels

**Add Channel:**
```
/add_channel [channel_name]
```
Example: `/add_channel offers_electronics`

**View Monitored Channels:**
```
/channels
```
Shows all channels you're monitoring

### 🔍 Search Offers

**Search past offers:**
```
/search [keyword]
```
Example: `/search airpods`

Shows up to 10 recent offers matching that keyword

### 📊 View Statistics

**See summary stats:**
```
/stats
```

Shows:
- Total offers analyzed
- Approved offers (high confidence)
- Pending offers (waiting to analyze)
- Tracked interests count
- Categories you're tracking

### ❓ Help & Commands

**View all commands:**
```
/help
```

## Daily Workflow

### Morning (10 AM)

1. ✅ Bot analyzes all pending offers
2. ✅ Matches them against your interests
3. ✅ Sends you summary of valuable offers
4. ✅ Groups by category for easy reading

### Anytime

1. 🔍 Search past offers: `/search keyword`
2. 📊 Check progress: `/stats`
3. ➕ Add new interests: `/add_interest keyword category`
4. ❌ Remove old interests: `/remove_interest keyword`

## How Offers Are Matched

The AI looks for:

✅ **Keyword matching** - Does the offer mention your keyword?
✅ **Semantic similarity** - Is it related to what you're looking for?
✅ **Typo tolerance** - Matches "airpods", "air pods", "AirPods"
✅ **Partial matches** - Looking for "battery" matches "10000mAh battery"
✅ **Price detection** - Extracts price when available

### Confidence Score

- **0-70%**: Low confidence (rejected)
- **70-85%**: Medium confidence (borderline)
- **85-100%**: High confidence (sent to you)

## Troubleshooting

### "No offers found at 10 AM"

**Possible causes:**

1. ❌ **No channels registered**
   - Fix: Use `/add_channel` to register channels

2. ❌ **No offers forwarded**
   - Fix: Go to burner account, find offers, forward them to bot

3. ❌ **No interests configured**
   - Fix: Use `/add_interest` to add keywords to match

4. ❌ **Offers don't match interests**
   - The AI might think they're not relevant
   - Try `/search` to see what was stored

### Commands not working

**Solution:**

1. Make sure you're using your **main account** (MAIN_ACCOUNT_ID in .env)
2. Commands are case-insensitive: `/ADD_INTEREST` = `/add_interest`
3. Use `/help` to see all commands
4. Check logs: `tail -f combined.log`

### Bot not responding

**Solution:**

1. Check if bot is running: `npm start`
2. Verify BOT_TOKEN is correct in .env
3. Make sure you have internet connection
4. Check logs for errors

## Tips for Best Results

### ✅ Do This

- **Be specific** with keywords: "macbook pro 14" instead of "computer"
- **Add multiple categories**: Track same keyword in different contexts
- **Use buttons** in the main menu (easier than typing)
- **Check /stats** regularly to see what's working
- **Forward actively** - The more offers you forward, the better the AI learns

### ❌ Don't Do This

- Don't use very generic keywords like "product" or "offer"
- Don't expect results before forwarding messages
- Don't share the BOT_TOKEN with anyone
- Don't modify the database directly

## Daily Example

```
Morning (You):
1. Send: /add_channel offers_electronics
   Bot: ✅ Channel registered

2. Send: /add_interest iphone electronics
   Bot: ✅ Interest added

3. (On burner account) Forward an iPhone offer message

Afternoon (Automatic at 10 AM):
Bot: Analyzes the forwarded offer
Bot: Checks against "iphone" interest
Bot: Sends you: "🥇 iPhone 15 Pro - $999 with discount"

Later (You):
4. Send: /stats
   Bot: Shows 1 processed offer, 1 tracked interest

5. Send: /search iphone
   Bot: Shows the iPhone offer from today
```

## Need Help?

- **Full guide**: Check `SETUP_CHECKLIST.md`
- **Step-by-step setup**: Read `STEP_BY_STEP.md`
- **Environment setup**: See `WHAT_DO_I_NEED.md`
- **Commands**: Type `/help` in the bot chat

---

**Key Concept:**
The bot is like a smart assistant that:
1. Listens to channels through your burner account
2. You tell it what to look for (interests)
3. Every day at 10 AM it sends you a summary
4. You can search anytime with /search

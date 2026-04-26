const TelegramBot = require('node-telegram-bot-api');
const logger = require('../utils/logger');
const config = require('../../config/constants');

class BotInterface {
  constructor(database) {
    this.db = database;
    this.bot = null;
    this.mainAccountId = config.MAIN_ACCOUNT_ID;
  }

  /**
   * Initialize bot with polling
   */
  initialize() {
    try {
      this.bot = new TelegramBot(config.BOT_TOKEN, {
        polling: {
          interval: 300,
          autoStart: true,
        },
      });

      this.setupHandlers();
      this.registerCommands();
      logger.info('✅ Bot interface initialized');
      return this.bot;
    } catch (err) {
      logger.error('Failed to initialize bot:', err.message);
      throw err;
    }
  }

  /**
   * Setup command and message handlers
   */
  setupHandlers() {
    const handlers = require('./handlers');
    handlers.attachHandlers(this);
  }

  /**
   * Register bot commands with Telegram for autocomplete
   */
  async registerCommands() {
    const handlers = require('./handlers');
    await handlers.registerCommands(this);
  }

  /**
   * Check if message is from main account
   */
  isFromMainAccount(msg) {
    return msg.from.id === this.mainAccountId;
  }

  /**
   * Attach a BatchProcessor instance for manual triggers
   */
  setProcessor(processor) {
    this.processor = processor;
  }

  /**
   * Attach a Backfiller instance to allow on-demand backfills
   */
  setBackfiller(backfiller) {
    this.backfiller = backfiller;
  }

  /**
   * Handle forwarded messages from channels
   */
  async handleForwardedMessage(msg) {
    try {
      const channelName = msg.forward_from_chat?.title || 'Forwarded';
      const channelId = msg.forward_from_chat?.id || 0;
      const text = msg.text || msg.caption || '';

      // Auto-register channel if available (register even if message is short)
      if (channelId !== 0) {
        try {
          const channelUsername = msg.forward_from_chat?.username || null;
          await this.db.run(
            'INSERT OR IGNORE INTO channels (channel_id, channel_name, channel_username) VALUES (?, ?, ?)',
            [channelId, channelName, channelUsername]
          );
          logger.info(`📡 Auto-registered channel: ${channelName}${channelUsername ? ' (@' + channelUsername + ')' : ''}`);
        } catch (err) {
          logger.debug(`Channel ${channelName} already registered`);
        }
      }

      if (!text || text.length < config.MIN_MESSAGE_LENGTH) {
        logger.debug(`Message too short, skipping; channel ${channelName} registered`);
        return;
      }

      logger.info(`📨 Processing forwarded message from ${channelName}`);

      // Store the forwarded offer in the database
      const offer = {
        message_id: msg.message_id,
        channel_id: channelId,
        channel_name: channelName,
        raw_text: text,
        created_at: new Date(),
      };

      // Check if already processed
      const isProcessed = await this.db.isProcessed(offer.message_id);
      if (isProcessed) {
        logger.debug(`Message ${offer.message_id} already processed`);
        return;
      }

      // Store the offer
      await this.db.insertOffer(offer);
      await this.db.markProcessed(offer.message_id, offer.channel_id);

      logger.info(`✅ Offer stored: "${text.substring(0, 60)}..."`);

      // Send confirmation to user
      await this.bot.sendMessage(
        this.mainAccountId,
        `✅ Received offer from *${channelName}*\n\nWill analyze in next batch 📊`
      );
    } catch (err) {
      logger.error('Error handling forwarded message:', err.message);
    }
  }

  /**
   * Send message to main account
   */
  async sendMessage(text) {
    try {
      await this.bot.sendMessage(this.mainAccountId, text, {
        parse_mode: 'Markdown',
      });
      logger.debug('Message sent to main account');
    } catch (err) {
      logger.error('Failed to send message:', err.message);
      throw err;
    }
  }

  /**
   * Reply to message
   */
  async reply(msg, text) {
    try {
      await this.bot.sendMessage(msg.chat.id, text, {
        parse_mode: 'Markdown',
        reply_to_message_id: msg.message_id,
      });
    } catch (err) {
      logger.error('Failed to reply:', err.message);
    }
  }

  // ===== Command Handlers =====

  async handleStart(msg) {
    if (!this.isFromMainAccount(msg)) {
      await this.reply(msg, '❌ You are not authorized to use this bot.');
      return;
    }

    const text = `👋 Welcome to *OfferRadar*!

I'm monitoring your Telegram channels for valuable offers.

📖 *How it works:*
1️⃣ Add channels you want to monitor
2️⃣ Add keywords/interests you care about
3️⃣ I'll analyze offers and send summaries

🚀 *Quick Start:*
Tap the buttons below or use commands:`;

    const keyboard = {
      inline_keyboard: [
        [
          { text: '➕ Add Channel', callback_data: 'add_channel' },
          { text: '➕ Add Interest', callback_data: 'add_interest' }
        ],
        [
          { text: '📋 My Interests', callback_data: 'my_interests' },
          { text: '📡 My Channels', callback_data: 'channels' }
        ],
        [
          { text: '🔍 Search', callback_data: 'search' },
          { text: '📊 Stats', callback_data: 'stats' }
        ],
        [
          { text: '📖 Help', callback_data: 'help' }
        ]
      ]
    };

    try {
      await this.bot.sendMessage(msg.chat.id, text, {
        parse_mode: 'Markdown',
        reply_markup: keyboard
      });
    } catch (err) {
      logger.error('Failed to send start message:', err.message);
    }
  }

  async handleAddInterest(msg, match) {
    if (!this.isFromMainAccount(msg)) {
      await this.reply(msg, '❌ Unauthorized');
      return;
    }

    const args = (match[1] || '').trim().split(/\s+/);

    if (!args[0]) {
      await this.reply(
        msg,
        `❌ Need at least a keyword!\n\nFormats:\n` +
        `/add_interest AirPods\n` +
        `/add_interest AirPods electronics\n\n` +
        `If you don't specify a category, I'll use "General"`
      );
      return;
    }

    const keyword = args[0];
    // If only keyword provided, use "General" as category
    const category = args.length > 1 ? args.slice(1).join(' ') : 'General';

    try {
      await this.db.insertInterest(keyword, category);
      const categoryText = args.length > 1 ? `→ ${category}` : '(General category)';
      await this.reply(
        msg,
        `✅ Added interest:\n\n${keyword} ${categoryText}\n\nI'll now track this for you!`
      );
      logger.info(`Added interest: ${keyword} → ${category}`);
    } catch (err) {
      if (err.message.includes('UNIQUE')) {
        await this.reply(msg, `⚠️ Interest "${keyword}" already exists.`);
      } else {
        await this.reply(msg, `❌ Error: ${err.message}`);
      }
    }
  }

  async handleMyInterests(msg) {
    if (!this.isFromMainAccount(msg)) {
      await this.reply(msg, '❌ Unauthorized');
      return;
    }

    try {
      const interests = await this.db.getAllInterests();

      if (interests.length === 0) {
        const keyboard = {
          inline_keyboard: [
            [{ text: '➕ Add Interest', callback_data: 'add_interest' }]
          ]
        };

        await this.bot.sendMessage(
          msg.chat.id,
          '📋 You have no tracked interests yet.\n\nTap the button below to add one:',
          {
            parse_mode: 'Markdown',
            reply_markup: keyboard,
            reply_to_message_id: msg.message_id
          }
        );
        return;
      }

      // Group by category
      const grouped = {};
      for (const interest of interests) {
        if (!grouped[interest.category]) {
          grouped[interest.category] = [];
        }
        grouped[interest.category].push(interest.keyword);
      }

      let text = `📋 Your Tracked Interests (${interests.length} total)\n\n`;
      for (const [category, keywords] of Object.entries(grouped)) {
        text += `${category}\n`;
        keywords.forEach(kw => {
          text += `  • ${kw}\n`;
        });
        text += '\n';
      }

      await this.bot.sendMessage(msg.chat.id, text, {
        reply_to_message_id: msg.message_id
      });
    } catch (err) {
      await this.reply(msg, `❌ Error: ${err.message}`);
    }
  }

  async handleRemoveInterest(msg, match) {
    if (!this.isFromMainAccount(msg)) {
      await this.reply(msg, '❌ Unauthorized');
      return;
    }

    const keyword = (match[1] || '').trim();

    if (!keyword) {
      await this.reply(msg, `❌ Need keyword!\n\nFormat: /remove_interest [keyword]\n\nExample:\n/remove_interest AirPods`);
      return;
    }

    try {
      await this.db.removeInterest(keyword);
      await this.reply(msg, `✅ Removed interest: *${keyword}*`);
      logger.info(`Removed interest: ${keyword}`);
    } catch (err) {
      await this.reply(msg, `❌ Error: ${err.message}`);
    }
  }

  async handleSearch(msg, match) {
    if (!this.isFromMainAccount(msg)) {
      await this.reply(msg, '❌ Unauthorized');
      return;
    }

    const query = (match[1] || '').trim();

    if (!query) {
      await this.reply(msg, `❌ Need search keyword!\n\nFormat: /search [keyword]\n\nExamples:\n/search AirPods\n/search iPhone\n/search discount`);
      return;
    }

    try {
      const results = await this.db.searchOffers(query);

      if (results.length === 0) {
        await this.reply(msg, `🔍 No offers found matching "${query}"`);
        return;
      }

      let text = `🔍 *Search Results for "${query}"* (${results.length} found)\n\n`;

      results.slice(0, 10).forEach((offer, idx) => {
        text += `${idx + 1}. *${offer.channel_name}*\n`;
        text += `   ${offer.summary || offer.raw_text.substring(0, 100)}\n`;
        text += `   Confidence: ${offer.confidence_score || 'N/A'}%\n`;
        text += `   Date: ${new Date(offer.created_at).toLocaleDateString()}\n\n`;
      });

      if (results.length > 10) {
        text += `... and ${results.length - 10} more results`;
      }

      await this.reply(msg, text);
    } catch (err) {
      await this.reply(msg, `❌ Error: ${err.message}`);
    }
  }

  async handleStats(msg) {
    if (!this.isFromMainAccount(msg)) {
      await this.reply(msg, '❌ Unauthorized');
      return;
    }

    try {
      const stats = await this.db.getStats();

      let text = `📊 Statistics\n\n`;
      text += `Total offers analyzed: ${stats.total_offers.count}\n`;
      text += `Approved offers: ${stats.processed_offers.count}\n`;
      text += `Pending offers: ${stats.pending_offers.count}\n`;
      text += `Tracked interests: ${stats.interests_count.count}\n\n`;

      if (stats.categories.length > 0) {
        text += `Categories tracking:\n`;
        stats.categories.forEach(cat => {
          text += `  • ${cat.category}\n`;
        });
      }

      await this.bot.sendMessage(msg.chat.id, text, {
        reply_to_message_id: msg.message_id
      });
    } catch (err) {
      await this.reply(msg, `❌ Error: ${err.message}`);
    }
  }

  async handleOffers(msg) {
    if (!this.isFromMainAccount(msg)) {
      await this.reply(msg, '❌ Unauthorized');
      return;
    }

    try {
      const offers = await this.db.all(`
        SELECT id, channel_name, raw_text, confidence_score, status, created_at 
        FROM offers 
        ORDER BY created_at DESC 
        LIMIT 20
      `);

      if (offers.length === 0) {
        await this.reply(msg, `📭 No offers found yet. Forward messages from your channels to start!`);
        return;
      }

      let text = `📬 Recent Offers (${offers.length} total)\n\n`;
      
      offers.forEach((offer, idx) => {
        const date = new Date(offer.created_at).toLocaleDateString();
        const status = offer.status === 'processed' ? '✅' : offer.status === 'pending' ? '⏳' : '❌';
        const confidence = offer.confidence_score ? `${offer.confidence_score}%` : 'N/A';
        
        text += `${idx + 1}. ${status} ${offer.channel_name}\n`;
        text += `   ${offer.raw_text.substring(0, 80)}${offer.raw_text.length > 80 ? '...' : ''}\n`;
        text += `   Confidence: ${confidence} | ${date}\n\n`;
      });

      await this.bot.sendMessage(msg.chat.id, text, {
        reply_to_message_id: msg.message_id
      });
    } catch (err) {
      await this.reply(msg, `❌ Error: ${err.message}`);
    }
  }

  async handleHelp(msg) {
    if (!this.isFromMainAccount(msg)) {
      await this.reply(msg, '❌ Unauthorized');
      return;
    }

    const text = `📖 Available Commands

Interest Management:
Interest Management:
/add_interest [keyword]
  Add a keyword to track (category is optional, defaults to "General")
  Examples:
  /add_interest AirPods
  /add_interest AirPods electronics

/my_interests
  List all tracked keywords

/remove_interest [keyword]
  Stop tracking a keyword

Channel Management:
📡 Channels are auto-registered when you forward messages!
   Just forward offers from your channels - they'll be added automatically.

/channels
  List all monitored channels

Searching:
/search [keyword]
  Search past offers by keyword

/offers
  View recent offers (last 20 found)

Information:
/stats
  View statistics and summary
  
/help
  Show this help message

How it works:
1️⃣ Just forward messages from your channels (auto-registers!)
2️⃣ Add interests: /add_interest AirPods
3️⃣ Every day at 10 AM, I analyze offers
4️⃣ Only valuable offers are sent to you

💡 Tips:
• Check /offers to see recent messages your bot has received
• Use /search to find specific offers
• Forward actively - more offers = better learning
• Be specific with keywords for better matches
• Check /stats regularly to see progress`;

    await this.bot.sendMessage(msg.chat.id, text, {
      reply_to_message_id: msg.message_id
    });
  }

  async handleAddChannel(msg, match) {
    if (!this.isFromMainAccount(msg)) {
      await this.reply(msg, '❌ Unauthorized');
      return;
    }

    const channelName = (match[1] || '').trim();

    if (!channelName) {
      await this.reply(
        msg,
        `❌ Need channel name!\n\nFormat: /add_channel [channel_name]\n\nExamples:\n` +
        `/add_channel offers_electronics\n` +
        `/add_channel discounts_deals\n` +
        `/add_channel tech_offers`
      );
      return;
    }

    try {
      // Generate a channel ID (using hash of channel name for uniqueness)
      const crypto = require('crypto');
      const channelId = parseInt(crypto.createHash('md5').update(channelName).digest('hex').substring(0, 8), 16);

      await this.db.run(
        'INSERT OR IGNORE INTO channels (channel_id, channel_name, channel_username) VALUES (?, ?, ?)',
        [channelId, channelName, null]
      );

      await this.reply(
        msg,
        `✅ Channel Added: *${channelName}*\n\nNow:\n1. Go to your burner account\n2. Join the channel if not already\n3. Forward messages from this channel to this bot\n\nI'll analyze them automatically! 🎯`
      );
      logger.info(`Added channel: ${channelName}`);

      // Trigger backfill for newly added channel (if available)
      if (this.backfiller) {
        try {
          await this.bot.sendMessage(msg.chat.id, '🔁 Attempting to backfill recent offers for this channel...', { reply_to_message_id: msg.message_id });
          await this.backfiller.backfillChannel({ channel_id: channelId, channel_name: channelName }, config.OFFER_RETENTION_DAYS, this.db);
          await this.bot.sendMessage(msg.chat.id, '✅ Backfill completed', { reply_to_message_id: msg.message_id });
        } catch (err) {
          logger.warn('Backfill for new channel failed:', err.message || err);
        }
      }
    } catch (err) {
      if (err.message.includes('UNIQUE')) {
        await this.reply(msg, `⚠️ Channel "${channelName}" already registered.`);
      } else {
        await this.reply(msg, `❌ Error: ${err.message}`);
      }
    }
  }

  async handleChannels(msg) {
    if (!this.isFromMainAccount(msg)) {
      await this.reply(msg, '❌ Unauthorized');
      return;
    }

    try {
      const channels = await this.db.all('SELECT channel_name FROM channels');

      if (channels.length === 0) {
        const keyboard = {
          inline_keyboard: [
            [{ text: '➕ Add Channel', callback_data: 'add_channel' }]
          ]
        };

        await this.bot.sendMessage(
          msg.chat.id,
          '📡 You have no monitored channels yet.\n\nTap the button below to add one:',
          {
            reply_markup: keyboard,
            reply_to_message_id: msg.message_id
          }
        );
        return;
      }

      let text = `📡 Monitored Channels (${channels.length} total)\n\n`;
      channels.forEach((ch, idx) => {
        text += `${idx + 1}. ${ch.channel_name}\n`;
      });
      text += `\n💡 Forward messages from these channels to get them analyzed`;

      await this.bot.sendMessage(msg.chat.id, text, {
        reply_to_message_id: msg.message_id
      });
    } catch (err) {
      await this.reply(msg, `❌ Error: ${err.message}`);
    }
  }

  async handleCallbackQuery(query) {
    const msg = query.message;
    const action = query.data;

    // Verify it's from the main account
    if (query.from.id !== this.mainAccountId) {
      await this.bot.answerCallbackQuery(query.id, { text: '❌ Unauthorized', show_alert: true });
      return;
    }

    try {
      // Create a temporary msg object for other handlers
      const tmpMsg = {
        chat: msg.chat,
        from: query.from,
        message_id: msg.message_id,
        text: '/' + action
      };

      switch (action) {
        case 'add_interest':
          await this.bot.answerCallbackQuery(query.id);
          await this.bot.sendMessage(
            msg.chat.id,
            '📝 Send me: /add_interest [keyword]\n\nExamples:\n/add_interest AirPods\n/add_interest "iPhone 15"\n\n(Category is optional - defaults to "General")'
          );
          break;

        case 'add_channel':
          await this.bot.answerCallbackQuery(query.id);
          await this.bot.sendMessage(
            msg.chat.id,
            '📝 Just forward a message from the channel you want to monitor!\nChannels are auto-registered. 📡'
          );
          break;

        case 'my_interests':
          await this.bot.answerCallbackQuery(query.id);
          await this.handleMyInterests(tmpMsg);
          break;

        case 'channels':
          await this.bot.answerCallbackQuery(query.id);
          await this.handleChannels(tmpMsg);
          break;

        case 'search':
          await this.bot.answerCallbackQuery(query.id);
          await this.bot.sendMessage(
            msg.chat.id,
            '🔍 Send me: /search [keyword]\n\nExample:\n/search airpods'
          );
          break;

        case 'stats':
          await this.bot.answerCallbackQuery(query.id);
          await this.handleStats(tmpMsg);
          break;

        case 'help':
          await this.bot.answerCallbackQuery(query.id);
          await this.handleHelp(tmpMsg);
          break;

        default:
          await this.bot.answerCallbackQuery(query.id, { text: 'Unknown action', show_alert: true });
      }
    } catch (err) {
      logger.error('Error handling callback query:', err.message);
      await this.bot.answerCallbackQuery(query.id, { text: 'Error occurred', show_alert: true });
    }
  }

  /**
   * Test bot connection
   */
  async test() {
    try {
      logger.info('Testing bot connection...');
      const me = await this.bot.getMe();
      logger.info(`✅ Bot connected as @${me.username}`);
      return true;
    } catch (err) {
      logger.error('❌ Bot connection failed:', err.message);
      throw err;
    }
  }

  /**
   * Stop polling
   */
  stop() {
    if (this.bot) {
      this.bot.stopPolling();
      logger.info('Bot polling stopped');
    }
  }
}

module.exports = BotInterface;

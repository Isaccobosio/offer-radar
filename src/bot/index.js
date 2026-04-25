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
    // /start command
    this.bot.onText(/\/start/, (msg) => {
      this.handleStart(msg);
    });

    // /add_interest command
    this.bot.onText(/\/add_interest(.*)/, (msg, match) => {
      this.handleAddInterest(msg, match);
    });

    // /my_interests command
    this.bot.onText(/\/my_interests/, (msg) => {
      this.handleMyInterests(msg);
    });

    // /remove_interest command
    this.bot.onText(/\/remove_interest(.*)/, (msg, match) => {
      this.handleRemoveInterest(msg, match);
    });

    // /search command
    this.bot.onText(/\/search(.*)/, (msg, match) => {
      this.handleSearch(msg, match);
    });

    // /stats command
    this.bot.onText(/\/stats/, (msg) => {
      this.handleStats(msg);
    });

    // /help command
    this.bot.onText(/\/help/, (msg) => {
      this.handleHelp(msg);
    });

    // Handle forwarded messages from channels
    this.bot.on('message', (msg) => {
      // Only process forwarded messages
      if (msg.forward_from_chat && msg.text) {
        this.handleForwardedMessage(msg);
      }
    });

    logger.info('Bot handlers registered');
  }

  /**
   * Check if message is from main account
   */
  isFromMainAccount(msg) {
    return msg.from.id === this.mainAccountId;
  }

  /**
   * Handle forwarded messages from channels
   */
  async handleForwardedMessage(msg) {
    try {
      const channelName = msg.forward_from_chat?.title || 'Channel';
      const text = msg.text;

      if (!text || text.length < 20) {
        // Message too short, skip
        return;
      }

      logger.info(`📨 Processing forwarded message from ${channelName}`);

      // This will be handled by the UserBot in index.js
      // which will pass it to the LLM processor
      this.lastForwardedMessage = {
        text,
        channel: channelName,
        timestamp: new Date(),
      };
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

    const text = `
👋 Welcome to **OfferRadar**!

I'm monitoring your Telegram channels for valuable offers.

📝 *Quick Start:*
• /add_interest [keyword] [category] - Add what to track
• /my_interests - View tracked items
• /search [keyword] - Find past offers
• /stats - View summary statistics
• /help - See all commands
    `;

    await this.reply(msg, text);
  }

  async handleAddInterest(msg, match) {
    if (!this.isFromMainAccount(msg)) {
      await this.reply(msg, '❌ Unauthorized');
      return;
    }

    const args = (match[1] || '').trim().split(/\s+/);

    if (args.length < 2 || !args[0]) {
      await this.reply(
        msg,
        `❌ Usage: /add_interest [keyword] [category]\n\nExample:\n/add_interest airpods electronics`
      );
      return;
    }

    const keyword = args[0];
    const category = args.slice(1).join(' ');

    try {
      await this.db.insertInterest(keyword, category);
      await this.reply(
        msg,
        `✅ Added interest:\n\n*${keyword}* → *${category}*\n\nI'll now track this for you!`
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
        await this.reply(msg, `📋 You have no tracked interests yet.\n\nUse /add_interest to add one!`);
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

      let text = `📋 *Your Tracked Interests* (${interests.length} total)\n\n`;
      for (const [category, keywords] of Object.entries(grouped)) {
        text += `*${category}*\n`;
        keywords.forEach(kw => {
          text += `  • ${kw}\n`;
        });
        text += '\n';
      }

      await this.reply(msg, text);
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
      await this.reply(msg, `❌ Usage: /remove_interest [keyword]\n\nExample:\n/remove_interest airpods`);
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
      await this.reply(msg, `❌ Usage: /search [keyword]\n\nExample:\n/search airpods`);
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

      let text = `📊 *Statistics*\n\n`;
      text += `Total offers analyzed: *${stats.total_offers.count}*\n`;
      text += `Approved offers: *${stats.processed_offers.count}*\n`;
      text += `Pending offers: *${stats.pending_offers.count}*\n`;
      text += `Tracked interests: *${stats.interests_count.count}*\n\n`;

      if (stats.categories.length > 0) {
        text += `*Categories tracking:*\n`;
        stats.categories.forEach(cat => {
          text += `  • ${cat.category}\n`;
        });
      }

      await this.reply(msg, text);
    } catch (err) {
      await this.reply(msg, `❌ Error: ${err.message}`);
    }
  }

  async handleHelp(msg) {
    if (!this.isFromMainAccount(msg)) {
      await this.reply(msg, '❌ Unauthorized');
      return;
    }

    const text = `
📖 *Available Commands*

*Interest Management:*
/add_interest [keyword] [category]
  Add a new keyword to track
  Example: /add_interest "airpods pro" electronics

/my_interests
  List all tracked keywords

/remove_interest [keyword]
  Stop tracking a keyword

*Searching:*
/search [keyword]
  Search past offers by keyword

*Information:*
/stats
  View statistics and summary
  
/help
  Show this help message

*How it works:*
1️⃣ I listen to your channels 24/7
2️⃣ Every day at 10 AM, I analyze offers
3️⃣ Only valuable offers are sent to you
4️⃣ You can search and manage interests anytime

💡 *Tips:*
• Add multiple keywords in one category
• Be specific with keywords for better matches
• Check /stats regularly to see what's working
    `;

    await this.reply(msg, text);
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

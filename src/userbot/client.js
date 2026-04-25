/**
 * UserBot Client - Simplified Implementation
 * 
 * This version listens for messages forwarded to the bot from channels
 * The user sets up channel subscriptions by forwarding messages
 */

const logger = require('../utils/logger');
const { humanLikeDelay } = require('../utils/delays');
const config = require('../../config/constants');

class UserBotClient {
  constructor(database, bot) {
    this.db = database;
    this.bot = bot;
    this.connected = false;
    this.channelIds = [];
  }

  /**
   * Connect and start listening (simplified for Bot API)
   */
  async connect() {
    try {
      logger.info('✅ UserBot mode: Bot API with forwarded messages');
      logger.info('📝 How to use:');
      logger.info('  1. Join channels with your main account');
      logger.info('  2. Forward messages from channels to this bot');
      logger.info('  3. Bot will analyze and filter them');
      this.connected = true;
      return this;
    } catch (err) {
      logger.error('Failed to initialize:', err.message);
      throw err;
    }
  }

  /**
   * Start listening for forwarded messages
   */
  async startListening(channelIds = []) {
    if (!this.connected) {
      throw new Error('UserBot not connected. Call connect() first.');
    }

    this.channelIds = channelIds;
    logger.info(`👂 Ready to receive messages from ${channelIds.length || 'any'} channels`);
    logger.info('💡 Forward messages from channels to process them');
  }

  /**
   * Process a forwarded message
   */
  async processMessage(text, channelName = 'Forwarded', messageId = null) {
    try {
      // Human-like delay
      await humanLikeDelay();

      // Pre-filter spam
      if (this.isSpam(text)) {
        logger.debug('Message filtered as spam');
        return false;
      }

      const offer = {
        message_id: messageId || Math.floor(Math.random() * 1000000),
        channel_id: 0,
        channel_name: channelName,
        raw_text: text,
        created_at: new Date(),
      };

      // Check deduplication
      const isProcessed = await this.db.isProcessed(offer.message_id);
      if (isProcessed) {
        logger.debug(`Message ${offer.message_id} already processed`);
        return false;
      }

      // Store raw offer
      await this.db.insertOffer(offer);
      await this.db.markProcessed(offer.message_id, offer.channel_id);

      logger.info(`📨 New offer from ${channelName}: "${text.substring(0, 50)}..."`);
      return true;
    } catch (err) {
      logger.error('Error processing message:', err.message);
      return false;
    }
  }

  /**
   * Quick spam filter
   */
  isSpam(text) {
    if (!text || text.length < config.MIN_MESSAGE_LENGTH) return true;

    // Skip if only emojis
    if (/^[\p{Emoji}\s]+$/u.test(text)) return true;

    // Skip if contains spam keywords
    const lowerText = text.toLowerCase();
    for (const keyword of config.SPAM_KEYWORDS) {
      if (lowerText.includes(keyword)) return true;
    }

    return false;
  }

  /**
   * Disconnect
   */
  async disconnect() {
    this.connected = false;
    logger.info('✅ UserBot disconnected');
  }

  /**
   * Check connection status
   */
  isConnected() {
    return this.connected;
  }
}

module.exports = UserBotClient;

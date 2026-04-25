require('dotenv').config();
const logger = require('./utils/logger');
const config = require('../config/constants');

// Import modules
const Database = require('./db');
const UserBotClient = require('./userbot/client');
const GroqAnalyzer = require('./llm');
const BatchProcessor = require('./scheduler');
const BotInterface = require('./bot');

class OfferRadar {
  constructor() {
    this.db = null;
    this.userbot = null;
    this.llm = null;
    this.processor = null;
    this.bot = null;
    this.channelIds = [];
  }

  /**
   * Initialize all components
   */
  async initialize() {
    try {
      logger.info('🚀 Starting OfferRadar...');
      logger.info('═'.repeat(50));

      // Validate environment
      await this.validateEnvironment();

      // Initialize database
      logger.info('\n📦 Initializing database...');
      this.db = new Database(config.DATABASE_PATH);
      await this.db.initialize();

      // Initialize UserBot
      logger.info('🤖 Initializing UserBot client...');
      this.userbot = new UserBotClient(this.db);
      await this.userbot.connect();

      // Initialize LLM
      logger.info('🧠 Initializing Groq analyzer...');
      this.llm = new GroqAnalyzer();
      await this.llm.test();

      // Initialize Bot Interface
      logger.info('🤝 Initializing bot interface...');
      this.bot = new BotInterface(this.db);
      this.bot.initialize();
      await this.bot.test();

      // Initialize Batch Processor
      logger.info('⚙️  Initializing batch processor...');
      this.processor = new BatchProcessor(this.llm, this.db, {
        sendMessage: (msg) => this.bot.sendMessage(msg),
      });
      this.processor.startJobs();

      logger.info('\n✅ OfferRadar initialized successfully!');
      logger.info('═'.repeat(50));

      // Load channels from database (if any)
      await this.loadChannels();

      // Start listening
      await this.startListening();
    } catch (err) {
      logger.error('Initialization failed:', err.message);
      await this.cleanup();
      throw err;
    }
  }

  /**
   * Validate environment variables
   */
  async validateEnvironment() {
    const required = ['API_ID', 'API_HASH', 'BURNER_PHONE'];
    const warnings = [];

    for (const key of required) {
      if (!process.env[key]) {
        throw new Error(`Missing required environment variable: ${key}`);
      }
    }

    if (!process.env.GROQ_API_KEY) {
      warnings.push('GROQ_API_KEY not found - LLM features disabled');
    }

    if (!process.env.BOT_TOKEN) {
      warnings.push('BOT_TOKEN not found - Bot commands disabled');
    }

    if (warnings.length > 0) {
      logger.warn('⚠️  Environment warnings:');
      warnings.forEach(w => logger.warn(`   • ${w}`));
    }
  }

  /**
   * Load channels from database
   */
  async loadChannels() {
    try {
      const channels = await this.db.all('SELECT channel_id FROM channels');
      this.channelIds = channels.map(c => c.channel_id);
      logger.info(`📡 Loaded ${this.channelIds.length} tracked channels`);
    } catch (err) {
      logger.debug('No channels in database yet');
      this.channelIds = [];
    }
  }

  /**
   * Start listening to channels
   */
  async startListening() {
    try {
      if (this.channelIds.length === 0) {
        logger.warn(
          '⚠️  No channels to monitor. Add channels with the bot interface.'
        );
        return;
      }

      await this.userbot.startListening(this.channelIds);
      logger.info(`✅ Now listening to ${this.channelIds.length} channels`);
    } catch (err) {
      logger.error('Failed to start listening:', err.message);
      throw err;
    }
  }

  /**
   * Add a channel to monitor
   */
  async addChannel(channelId, channelName) {
    try {
      await this.db.run(
        'INSERT OR IGNORE INTO channels (channel_id, channel_name) VALUES (?, ?)',
        [channelId, channelName]
      );

      if (!this.channelIds.includes(channelId)) {
        this.channelIds.push(channelId);
      }

      logger.info(`✅ Added channel: ${channelName} (${channelId})`);
    } catch (err) {
      logger.error('Failed to add channel:', err.message);
      throw err;
    }
  }

  /**
   * Graceful shutdown
   */
  async cleanup() {
    logger.info('\n🛑 Shutting down OfferRadar...');

    try {
      if (this.bot) this.bot.stop();
      if (this.userbot) await this.userbot.disconnect();
      if (this.db) await this.db.close();
      logger.info('✅ Cleanup complete');
    } catch (err) {
      logger.error('Error during cleanup:', err.message);
    }
  }
}

/**
 * Main entry point
 */
async function main() {
  const app = new OfferRadar();

  // Handle graceful shutdown
  const shutdown = async (signal) => {
    logger.info(`\n📬 Received ${signal}, shutting down...`);
    await app.cleanup();
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  try {
    await app.initialize();
    logger.info('\n💡 Everything is running. Listening for offers...');
  } catch (err) {
    logger.error('Fatal error:', err.message);
    await app.cleanup();
    process.exit(1);
  }
}

// Start if this is main module
if (require.main === module) {
  main();
}

module.exports = OfferRadar;

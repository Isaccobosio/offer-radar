require('dotenv').config();
const logger = require('./utils/logger');
const config = require('../config/constants');

// Import modules
const Database = require('./db');
const UserBotClient = require('./userbot/client');
const GroqAnalyzer = require('./llm');
const BatchProcessor = require('./scheduler');
const cron = require('node-cron');
const BotInterface = require('./bot');
const Backfiller = require('./userbot/history');

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

      // Initialize LLM (only if API key provided)
      if (process.env.GROQ_API_KEY) {
        logger.info('🧠 Initializing Groq analyzer...');
        this.llm = new GroqAnalyzer();
        try {
          await this.llm.test();
        } catch (err) {
          // If Groq is inaccessible or the key is invalid, don't abort the whole app.
          logger.warn('GROQ initialization failed — continuing with LLM disabled');
          logger.debug(err.message || err);
          this.llm = null;
        }
      } else {
        logger.warn('GROQ_API_KEY not set — LLM features disabled');
        this.llm = null;
      }

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
      // Expose processor to bot for manual trigger
      if (this.bot && typeof this.bot.setProcessor === 'function') {
        this.bot.setProcessor(this.processor);
      }
      this.processor.startJobs();

      // Initialize optional backfiller (MTProto) if session is available
      try {
        this.backfiller = new Backfiller();
        if (process.env.TELEGRAM_SESSION) {
          await this.backfiller.init();
          if (this.bot && typeof this.bot.setBackfiller === 'function') {
            this.bot.setBackfiller(this.backfiller);
          }
        }
      } catch (err) {
        logger.warn('Backfiller initialization failed:', err.message || err);
        this.backfiller = null;
      }

      logger.info('\n✅ OfferRadar initialized successfully!');
      logger.info('═'.repeat(50));

      // Load channels from database (if any)
      await this.loadChannels();

      // Run initial backfill for all channels (last N days) if backfiller available
      if (this.backfiller) {
        try {
          const channels = await this.db.all('SELECT channel_id, channel_name FROM channels');
          if (channels.length > 0) {
            await this.backfiller.backfillChannels(channels, config.OFFER_RETENTION_DAYS, this.db);
          }
        } catch (err) {
          logger.warn('Initial backfill failed:', err.message || err);
        }
      }

      // Start listening
      await this.startListening();

      // Schedule periodic backfill (if MTProto backfiller available)
      if (this.backfiller) {
        try {
          cron.schedule(config.BACKFILL_SCHEDULE, async () => {
            try {
              const channels = await this.db.all('SELECT channel_id, channel_name FROM channels');
              if (channels && channels.length > 0) {
                logger.info('🔁 Periodic backfill started');
                await this.backfiller.backfillChannels(channels, config.OFFER_RETENTION_DAYS, this.db);
                logger.info('🔁 Periodic backfill completed');
              } else {
                logger.debug('Periodic backfill: no channels configured');
              }
            } catch (err) {
              logger.error('Periodic backfill failed:', err.message || err);
            }
          });
          logger.info(`🔁 Periodic backfill scheduled: ${config.BACKFILL_SCHEDULE}`);
        } catch (err) {
          logger.warn('Failed to schedule periodic backfill:', err.message || err);
        }
      }
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

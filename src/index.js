require('dotenv').config();
const logger = require('./utils/logger');
const config = require('../config/constants');

// Import modules
const Database = require('./db');
const WorkerBridge = require('./userbot/workerBridge');
const AnalyzerClass = require('./llm');
const AnalysisQueue = require('./analysis/queue');
const BatchProcessor = require('./scheduler');
const cron = require('node-cron');
const BotInterface = require('./bot');
const Backfiller = require('./userbot/history');

class OfferRadar {
  constructor() {
    this.db = null;
    this.workerBridge = null;
    this.llm = null;
    this.analysisQueue = null;
    this.processor = null;
    this.bot = null;
    this.backfiller = null;
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

      // Initialize WorkerBridge (GramJS runs in worker thread)
      logger.info('🤖 Initializing GramJS worker bridge...');
      this.workerBridge = new WorkerBridge(this.db, (offerId) => {
        if (this.analysisQueue) this.analysisQueue.enqueue(offerId);
      });

      // Initialize LLM
      if (process.env.OPEN_ROUTER_API_KEY) {
        logger.info('🧠 OpenRouter analyzer ready (skipping startup test to preserve quota)');
        this.llm = new AnalyzerClass();
      } else {
        logger.warn('OPEN_ROUTER_API_KEY not set — LLM features disabled');
        this.llm = null;
      }

      // Initialize Bot Interface
      logger.info('🤝 Initializing bot interface...');
      this.bot = new BotInterface(this.db);
      this.bot.initialize();
      await this.bot.test();

      // Initialize real-time analysis queue
      this.analysisQueue = new AnalysisQueue(this.llm, this.db, {
        sendRichCard: (id, offer, analysis) => this.bot.sendRichCard(id, offer, analysis),
        sendInstantAlert: (id, offer, analysis) => this.bot.sendRichCard(id, offer, analysis),
      });
      if (this.llm) {
        logger.info('⚡ Real-time analysis queue ready');
      }

      // Initialize Batch Processor
      logger.info('⚙️  Initializing batch processor...');
      this.processor = new BatchProcessor(this.llm, this.db, {
        bot: this.bot.bot,
        sendMessage: (msg) => this.bot.sendMessage(msg),
        sendMessageToUser: (id, msg) => this.bot.sendMessageToUser(id, msg),
      });
      // Expose processor to bot for manual trigger
      if (this.bot && typeof this.bot.setProcessor === 'function') {
        this.bot.setProcessor(this.processor);
      }
      if (this.bot && this.llm && typeof this.bot.setLlm === 'function') {
        this.bot.setLlm(this.llm);
      }
      this.processor.startJobs();

      // Initialize optional backfiller (MTProto) if session is available
      // Set TELEGRAM_SESSION to empty string in .env to disable backfilling
      try {
        this.backfiller = null;
        if (process.env.TELEGRAM_SESSION && process.env.TELEGRAM_SESSION.trim() !== '') {
          this.backfiller = new Backfiller();
          await this.backfiller.init();
          if (this.bot && typeof this.bot.setBackfiller === 'function') {
            this.bot.setBackfiller(this.backfiller);
          }
          logger.info('✅ Backfiller enabled');
        } else {
          logger.info('📝 Backfiller disabled - set TELEGRAM_SESSION in .env to enable');
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
          let channels = this.db.all('SELECT channel_id, channel_name, channel_username FROM channels');

          if (channels && channels.length > 0 && this.bot && this.bot.bot && typeof this.bot.bot.getChat === 'function') {
            for (const ch of channels) {
              if (!ch.channel_username) {
                try {
                  const chatInfo = await this.bot.bot.getChat(ch.channel_id);
                  if (chatInfo && chatInfo.username) {
                    this.db.run('UPDATE channels SET channel_username = ? WHERE channel_id = ?', [chatInfo.username, ch.channel_id]);
                    ch.channel_username = chatInfo.username;
                    logger.info(`🔁 Populated username for channel ${ch.channel_name}: @${chatInfo.username}`);
                  }
                } catch (err) {
                  logger.debug(`Bot cannot getChat(${ch.channel_id}): ${err.message}`);
                }
              }
            }
          }

          if (channels.length > 0) {
            await this.backfiller.backfillChannels(channels, config.OFFER_RETENTION_DAYS, this.db, this.analysisQueue);
          }
        } catch (err) {
          logger.warn('Initial backfill failed:', err.message || err);
        }

        // Disconnect before starting live worker — same session cannot have two simultaneous connections
        await this.backfiller.disconnect();
      }

      // Start listening
      await this.startListening();

      // Schedule periodic backfill (if MTProto backfiller available)
      if (this.backfiller) {
        try {
          cron.schedule(config.BACKFILL_SCHEDULE, async () => {
            try {
              let channels = this.db.all('SELECT channel_id, channel_name, channel_username FROM channels');
              if (!channels || channels.length === 0) {
                logger.debug('Periodic backfill: no channels configured');
                return;
              }

              // Stop live worker so only one MTProto session is active at a time
              if (this.workerBridge) this.workerBridge.stop();

              try {
                await this.backfiller.init();

                if (this.bot && this.bot.bot && typeof this.bot.bot.getChat === 'function') {
                  for (const ch of channels) {
                    if (!ch.channel_username) {
                      try {
                        const chatInfo = await this.bot.bot.getChat(ch.channel_id);
                        if (chatInfo && chatInfo.username) {
                          this.db.run('UPDATE channels SET channel_username = ? WHERE channel_id = ?', [chatInfo.username, ch.channel_id]);
                          ch.channel_username = chatInfo.username;
                        }
                      } catch (_) {}
                    }
                  }
                }

                logger.info('🔁 Periodic backfill started');
                await this.backfiller.backfillChannels(channels, config.OFFER_RETENTION_DAYS, this.db, this.analysisQueue);
                logger.info('🔁 Periodic backfill completed');
              } finally {
                await this.backfiller.disconnect();
                // Resume live worker
                if (this.workerBridge) {
                  this.workerBridge.start(channels.map(c => c.channel_id));
                }
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

    if (!process.env.OPEN_ROUTER_API_KEY) {
      warnings.push('OPEN_ROUTER_API_KEY not found — LLM features disabled');
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
      const channels = this.db.all('SELECT channel_id FROM channels');
      this.channelIds = channels.map(c => c.channel_id);
      logger.info(`📡 Loaded ${this.channelIds.length} tracked channels`);
    } catch (err) {
      logger.debug('No channels in database yet');
      this.channelIds = [];
    }
  }

  async startListening() {
    try {
      if (process.env.TELEGRAM_SESSION && process.env.TELEGRAM_SESSION.trim() !== '') {
        this.workerBridge.start(this.channelIds);
        logger.info(`✅ GramJS worker started, watching ${this.channelIds.length} channels`);
      } else {
        logger.info('📝 GramJS worker disabled — set TELEGRAM_SESSION to enable live listening');
      }
    } catch (err) {
      logger.error('Failed to start worker bridge:', err.message);
    }
  }

  /**
   * Add a channel to monitor
   */
  async addChannel(channelId, channelName) {
    try {
      this.db.run(
        'INSERT OR IGNORE INTO channels (channel_id, channel_name, channel_username) VALUES (?, ?, ?)',
        [channelId, channelName, null]
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
      if (this.workerBridge) this.workerBridge.stop();
      if (this.db) this.db.close();
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

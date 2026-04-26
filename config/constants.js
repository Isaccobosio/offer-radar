require('dotenv').config();

module.exports = {
  // Telegram API
  BURNER_PHONE: process.env.BURNER_PHONE,
  API_ID: parseInt(process.env.API_ID),
  API_HASH: process.env.API_HASH,
  TELEGRAM_SESSION: process.env.TELEGRAM_SESSION || '',

  // LLM
  GROQ_API_KEY: process.env.GROQ_API_KEY,
  GROQ_MODEL: 'mixtral-8x7b-32768',

  // Bot
  BOT_TOKEN: process.env.BOT_TOKEN,
  MAIN_ACCOUNT_ID: parseInt(process.env.MAIN_ACCOUNT_ID),

  // Database
  DATABASE_PATH: process.env.DATABASE_PATH || './data/offers.db',
  OFFER_RETENTION_DAYS: 14,
  CONFIDENCE_THRESHOLD: 70,

  // Logging
  LOG_LEVEL: process.env.LOG_LEVEL || 'info',

  // Schedules
  BATCH_SCHEDULE: process.env.BATCH_SCHEDULE || '0 10 * * *',
  CLEANUP_SCHEDULE: process.env.CLEANUP_SCHEDULE || '0 23 * * *',
  BACKFILL_SCHEDULE: process.env.BACKFILL_SCHEDULE || '*/5 * * * *',

  // Rate Limiting
  GROQ_REQUEST_DELAY_MS: 1000, // 1 second between Groq requests
  TELEGRAM_ACTION_DELAY_MIN_MS: 500,
  TELEGRAM_ACTION_DELAY_MAX_MS: 3000,

  // Connection Settings
  CONNECTION_RETRIES: 5,
  REQUEST_RETRIES: 3,
  PROXY_URL: process.env.PROXY_URL || null,

  // Memory Management
  MAX_MEMORY_MB: 500,
  MEMORY_CHECK_INTERVAL_MS: 60000, // Check every minute

  // Message Filters
  MIN_MESSAGE_LENGTH: 20,
  SPAM_KEYWORDS: ['vote', 'like', 'share', 'subscribe'],
};

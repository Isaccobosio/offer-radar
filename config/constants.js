require('dotenv').config();

module.exports = {
  // Telegram API
  BURNER_PHONE: process.env.BURNER_PHONE,
  API_ID: parseInt(process.env.API_ID),
  API_HASH: process.env.API_HASH,
  TELEGRAM_SESSION: process.env.TELEGRAM_SESSION || '',

  // LLM provider chain (comma-separated, order = fallback priority)
  LLM_PROVIDERS: (process.env.LLM_PROVIDERS || 'groq,gemini,openrouter').split(',').map(s => s.trim()),

  // Groq (primary — ~14k RPD free, llama-3.3-70b)
  GROQ_API_KEY: process.env.GROQ_API_KEY,
  GROQ_MODEL: process.env.GROQ_MODEL || 'llama-3.3-70b-versatile',
  GROQ_SEARCH_MODEL: process.env.GROQ_SEARCH_MODEL || 'llama-3.1-8b-instant',
  GROQ_RPD_LIMIT: parseInt(process.env.GROQ_RPD_LIMIT || '14400', 10),

  // Gemini via Google AI Studio (secondary — 1500 RPD free)
  GEMINI_API_KEY: process.env.GEMINI_API_KEY,
  GEMINI_MODEL: process.env.GEMINI_MODEL || 'gemini-2.0-flash',
  GEMINI_SEARCH_MODEL: process.env.GEMINI_SEARCH_MODEL || 'gemini-2.0-flash',
  GEMINI_RPD_LIMIT: parseInt(process.env.GEMINI_RPD_LIMIT || '1500', 10),

  // OpenRouter (fallback — 50 RPD free)
  OPEN_ROUTER_API_KEY: process.env.OPEN_ROUTER_API_KEY,
  OPEN_ROUTER_MODEL: process.env.OPEN_ROUTER_MODEL || 'openai/gpt-oss-120b:free',
  OPEN_ROUTER_SEARCH_MODEL: process.env.OPEN_ROUTER_SEARCH_MODEL || 'openai/gpt-4o-mini',
  OPEN_ROUTER_ENDPOINT: 'https://openrouter.ai/api/v1/chat/completions',
  OPEN_ROUTER_REQUEST_DELAY_MS: process.env.OPEN_ROUTER_REQUEST_DELAY_MS ? parseInt(process.env.OPEN_ROUTER_REQUEST_DELAY_MS, 10) : 1000,
  SLUG_DEDUP_TTL_SECONDS: parseInt(process.env.SLUG_DEDUP_TTL_SECONDS || '86400', 10),
  SEARCH_PARSE_CACHE_SIZE: 100,
  SEARCH_PARSE_CACHE_TTL_MS: 3600000,

  // Bot
  BOT_TOKEN: process.env.BOT_TOKEN,
  MAIN_ACCOUNT_ID: parseInt(process.env.MAIN_ACCOUNT_ID),

  // Database
  DATABASE_PATH: process.env.DATABASE_PATH || './data/offers.db',
  OFFER_RETENTION_DAYS: parseInt(process.env.OFFER_RETENTION_DAYS || '7', 10),
  CONFIDENCE_THRESHOLD: 50,

  // Scoring tiers
  SCORE_INSTANT:    parseInt(process.env.SCORE_INSTANT    || '80', 10),
  SCORE_DIGEST_MIN: parseInt(process.env.SCORE_DIGEST_MIN || '50', 10),

  // Worker bridge
  PENDING_REVIEW_POLL_MS: parseInt(process.env.PENDING_REVIEW_POLL_MS || '5000', 10),

  // Smart batching (10 min window)
  BATCH_BUFFER_WINDOW_MS: parseInt(process.env.BATCH_BUFFER_WINDOW_MS || '600000', 10),

  // Logging
  LOG_LEVEL: process.env.LOG_LEVEL || 'info',

  // Schedules
  BATCH_SCHEDULE: process.env.BATCH_SCHEDULE || '0 */2 * * *',
  CLEANUP_SCHEDULE: process.env.CLEANUP_SCHEDULE || '0 23 * * *',
  BACKFILL_SCHEDULE: process.env.BACKFILL_SCHEDULE || '0 * * * *',

  // OpenRouter rate limits (override via env)
  OPENROUTER_RPM_LIMIT: parseInt(process.env.OPENROUTER_RPM_LIMIT || '20', 10),
  OPENROUTER_RPD_LIMIT: parseInt(process.env.OPENROUTER_RPD_LIMIT || '50', 10),
  OPENROUTER_RPM_WINDOW_MS: 60000,

  // Digest
  DIGEST_CARDS_MAX: parseInt(process.env.DIGEST_CARDS_MAX || '5', 10),
  DIGEST_CANDIDATE_FETCH_MAX: parseInt(process.env.DIGEST_CANDIDATE_FETCH_MAX || '50', 10),
  DISMISS_WEIGHT_STEP: parseInt(process.env.DISMISS_WEIGHT_STEP || '20', 10),

  // Rate Limiting
  TELEGRAM_ACTION_DELAY_MIN_MS: 500,
  TELEGRAM_ACTION_DELAY_MAX_MS: 3000,

  // Analysis queue
  ANALYSIS_QUEUE_MAX: parseInt(process.env.ANALYSIS_QUEUE_MAX || '2000', 10),
  ANALYSIS_BATCH_SIZE: parseInt(process.env.ANALYSIS_BATCH_SIZE || '10', 10),
  ANALYSIS_BATCH_RUN_MAX: parseInt(process.env.ANALYSIS_BATCH_RUN_MAX || '200', 10),

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

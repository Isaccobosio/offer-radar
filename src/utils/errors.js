const logger = require('./logger');

class TelegramRateLimitError extends Error {
  constructor(waitSeconds) {
    super(`FLOOD_WAIT: Must wait ${waitSeconds}s before retrying`);
    this.waitSeconds = waitSeconds;
    this.name = 'TelegramRateLimitError';
  }
}

class TelegramAuthError extends Error {
  constructor(message = 'Authentication failed') {
    super(message);
    this.name = 'TelegramAuthError';
  }
}

class GroqRateLimitError extends Error {
  constructor(message = 'Groq API rate limited') {
    super(message);
    this.name = 'GroqRateLimitError';
  }
}

/**
 * Handle Telegram errors and determine if retry is possible
 */
async function handleTelegramError(err, attemptNumber = 1, maxAttempts = 5) {
  logger.error(`Telegram Error (Attempt ${attemptNumber}/${maxAttempts}):`, err.message);

  // FLOOD_WAIT - rate limit
  if (err.message?.includes('FLOOD_WAIT')) {
    const match = err.message.match(/(\d+)/);
    const waitTime = match ? parseInt(match[1]) : 60;
    
    logger.warn(`⚠️  Rate limited by Telegram. Must wait ${waitTime}s`);
    throw new TelegramRateLimitError(waitTime);
  }

  // AUTH_KEY_UNREGISTERED - session expired
  if (err.message?.includes('AUTH_KEY_UNREGISTERED')) {
    logger.error('❌ Session expired or invalid. Need to re-authenticate.');
    throw new TelegramAuthError('Session needs refresh');
  }

  // CONNECTION_APP_TOO_MANY - too many connections
  if (err.message?.includes('CONNECTION_APP_TOO_MANY')) {
    logger.warn('Too many connections. Will retry with delay.');
    return attemptNumber < maxAttempts;
  }

  // Generic connection error
  if (err.message?.includes('Connection') || err.message?.includes('ECONNREFUSED')) {
    logger.warn('Connection error. Will retry...');
    return attemptNumber < maxAttempts;
  }

  throw err;
}

/**
 * Handle Groq API errors
 */
async function handleGroqError(err, attemptNumber = 1, maxAttempts = 3) {
  logger.error(`Groq Error (Attempt ${attemptNumber}/${maxAttempts}):`, err.message);

  // Rate limited (429)
  if (err.status === 429) {
    logger.warn(`⚠️  Groq API rate limited. Retry attempt ${attemptNumber}/${maxAttempts}`);
    throw new GroqRateLimitError();
  }

  // Server error (5xx)
  if (err.status >= 500) {
    logger.warn(`Server error (${err.status}). Will retry...`);
    return attemptNumber < maxAttempts;
  }

  // Authentication error
  if (err.status === 401) {
    logger.error('❌ Groq API authentication failed. Check GROQ_API_KEY');
    throw err;
  }

  throw err;
}

module.exports = {
  TelegramRateLimitError,
  TelegramAuthError,
  GroqRateLimitError,
  handleTelegramError,
  handleGroqError,
};

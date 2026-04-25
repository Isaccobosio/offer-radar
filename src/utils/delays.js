const config = require('../../config/constants');

/**
 * Sleep for a specified number of milliseconds
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Generate random delay between min and max milliseconds
 */
function randomDelay(minMs = config.TELEGRAM_ACTION_DELAY_MIN_MS, maxMs = config.TELEGRAM_ACTION_DELAY_MAX_MS) {
  return Math.random() * (maxMs - minMs) + minMs;
}

/**
 * Sleep for a random human-like delay
 */
async function humanLikeDelay(minMs, maxMs) {
  const delay = randomDelay(minMs, maxMs);
  return sleep(delay);
}

/**
 * Exponential backoff for retries
 * Attempt 1: 1s, Attempt 2: 2s, Attempt 3: 4s, etc.
 */
async function exponentialBackoff(attemptNumber, baseDelayMs = 1000, maxDelayMs = 60000) {
  const delay = Math.min(baseDelayMs * Math.pow(2, attemptNumber - 1), maxDelayMs);
  return sleep(delay);
}

module.exports = {
  sleep,
  randomDelay,
  humanLikeDelay,
  exponentialBackoff,
};

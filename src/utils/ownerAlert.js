const config = require('../../config/constants');
const logger = require('./logger');

// In-memory debounce: one alert per key per local day
const _fired = new Map();

async function alertOwner(botSender, key, message) {
  const today = new Date().toDateString();
  if (_fired.get(key) === today) return;
  _fired.set(key, today);

  const ownerId = config.MAIN_ACCOUNT_ID;
  if (!ownerId || !botSender) return;

  try {
    await botSender.safeSend(ownerId, `⚠️ OfferRadar: ${message}`);
    logger.info(`Owner alert sent [${key}]`);
  } catch (err) {
    logger.error(`Failed to send owner alert [${key}]:`, err.message);
  }
}

module.exports = { alertOwner };

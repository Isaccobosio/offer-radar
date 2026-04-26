const logger = require('../utils/logger');
const config = require('../../config/constants');

/**
 * Attach all bot handlers to the TelegramBot instance.
 * Receives the BotInterface instance so handlers can call its methods.
 */
function attachHandlers(botInterface) {
  const bot = botInterface.bot;

  // /start
  bot.onText(/^\/start(@\w+)?(\s|$)/i, (msg) => {
    botInterface.handleStart(msg);
  });

  // /add_interest
  bot.onText(/^\/add_interest(@\w+)?\s(.*)$/i, (msg, match) => {
    botInterface.handleAddInterest(msg, { 1: match[2] });
  });

  // /my_interests
  bot.onText(/^\/my_interests(@\w+)?(\s|$)/i, (msg) => {
    botInterface.handleMyInterests(msg);
  });

  // /remove_interest
  bot.onText(/^\/remove_interest(@\w+)?\s(.*)$/i, (msg, match) => {
    botInterface.handleRemoveInterest(msg, { 1: match[2] });
  });

  // /search
  bot.onText(/^\/search(@\w+)?\s(.*)$/i, (msg, match) => {
    botInterface.handleSearch(msg, { 1: match[2] });
  });

  // /analyze (manual trigger)
  bot.onText(/^\/analyze(@\w+)?(\s|$)/i, async (msg) => {
    if (!botInterface.isFromMainAccount(msg)) {
      await botInterface.reply(msg, '❌ Unauthorized');
      return;
    }

    try {
      await botInterface.reply(msg, '🔎 Starting manual analysis...');
      if (!botInterface.processor) {
        await botInterface.reply(msg, '❌ Processor not configured. Analysis unavailable.');
        return;
      }

      await botInterface.processor.processBatch();
      await botInterface.reply(msg, '✅ Analysis completed');
    } catch (err) {
      logger.error('Manual analyze failed:', err.message);
      await botInterface.reply(msg, `❌ Analysis failed: ${err.message}`);
    }
  });

  // /stats
  bot.onText(/^\/stats(@\w+)?(\s|$)/i, (msg) => {
    botInterface.handleStats(msg);
  });

  // /add_channel
  bot.onText(/^\/add_channel(@\w+)?\s(.*)$/i, (msg, match) => {
    botInterface.handleAddChannel(msg, { 1: match[2] });
  });

  // /channels
  bot.onText(/^\/channels(@\w+)?(\s|$)/i, (msg) => {
    botInterface.handleChannels(msg);
  });

  // /help
  bot.onText(/^\/help(@\w+)?(\s|$)/i, (msg) => {
    botInterface.handleHelp(msg);
  });

  // callback_query
  bot.on('callback_query', (query) => {
    botInterface.handleCallbackQuery(query);
  });

  // forwarded messages
  bot.on('message', (msg) => {
    if (msg.forward_from_chat && (msg.text || msg.caption)) {
      botInterface.handleForwardedMessage(msg);
    }
  });

  logger.info('Bot handlers registered');
}

/**
 * Register commands with Telegram for autocomplete.
 * Keeps the command list in one place.
 */
async function registerCommands(botInterface) {
  try {
    const bot = botInterface.bot;
    const commands = [
      { command: 'start', description: 'Show main menu' },
      { command: 'add_channel', description: 'Forward a message to auto-register channel' },
      { command: 'channels', description: 'View monitored channels' },
      { command: 'add_interest', description: 'Add keyword to track (format: /add_interest keyword)' },
      { command: 'my_interests', description: 'View tracked keywords' },
      { command: 'remove_interest', description: 'Stop tracking keyword (format: /remove_interest keyword)' },
      { command: 'search', description: 'Search past offers (format: /search keyword)' },
      { command: 'analyze', description: 'Run manual analysis now (admin only)' },
      { command: 'stats', description: 'View statistics' },
      { command: 'help', description: 'Show all commands' }
    ];

    await bot.setMyCommands(commands);
    logger.info('✅ Bot commands registered with Telegram');
  } catch (err) {
    logger.warn('Failed to register bot commands:', err.message);
  }
}

module.exports = { attachHandlers, registerCommands };

const TelegramBot = require('node-telegram-bot-api');
const logger = require('../utils/logger');
const config = require('../../config/constants');
const interestCmds = require('./commands/interests');
const channelCmds = require('./commands/channels');
const searchCmds = require('./commands/search');

class BotInterface {
  constructor(database) {
    this.db = database;
    this.bot = null;
    this.mainAccountId = config.MAIN_ACCOUNT_ID;
    this.processor = null;
    this.backfiller = null;
  }

  initialize() {
    this.bot = new TelegramBot(config.BOT_TOKEN, {
      polling: { interval: 300, autoStart: true },
    });
    this._attachHandlers();
    this._registerCommands();
    logger.info('Bot handlers registered');
    logger.info('✅ Bot interface initialized');
    return this.bot;
  }

  setProcessor(processor) { this.processor = processor; }
  setBackfiller(backfiller) { this.backfiller = backfiller; }

  isFromMainAccount(msg) {
    return (msg.from || {}).id === this.mainAccountId;
  }

  // Register the user on first interaction and return their telegram_id.
  async getOrCreateUser(msg) {
    const { id, username, first_name } = msg.from || {};
    if (!id) return null;
    try {
      await this.db.upsertUser(id, username, first_name);
    } catch (err) {
      logger.error('Failed to upsert user:', err.message);
    }
    return id;
  }

  async reply(msg, text) {
    try {
      await this.safeSend(msg.chat.id, text, {
        parse_mode: 'Markdown',
        reply_to_message_id: msg.message_id,
      });
    } catch (err) {
      logger.error('Failed to reply:', err.message);
    }
  }

  async sendMessage(text) {
    return this.sendMessageToUser(this.mainAccountId, text);
  }

  async sendMessageToUser(telegramId, text) {
    return this.safeSend(telegramId, text, { parse_mode: 'Markdown' });
  }

  // Helper that retries without parse mode on Telegram entity parsing errors
  async safeSend(chatId, text, options = {}) {
    try {
      return await this.bot.sendMessage(chatId, text, options);
    } catch (err) {
      if (err && err.code === 'ETELEGRAM' && /can't parse entities/i.test(err.message)) {
        logger.warn('Telegram parse error, retrying without parse_mode');
        const opts = Object.assign({}, options);
        delete opts.parse_mode;
        try {
          return await this.bot.sendMessage(chatId, text, opts);
        } catch (err2) {
          logger.error('Retry without parse_mode failed:', err2.message);
          throw err2;
        }
      }
      throw err;
    }
  }

  async test() {
    logger.info('Testing bot connection...');
    const me = await this.bot.getMe();
    logger.info(`✅ Bot connected as @${me.username}`);
    return true;
  }

  stop() {
    if (this.bot) {
      this.bot.stopPolling();
      logger.info('Bot polling stopped');
    }
  }

  // ── Command delegators ──────────────────────────────────────────────────────

  async handleAddInterest(msg, match) { return interestCmds.handleAddInterest(this, msg, match); }
  async handleMyInterests(msg) { return interestCmds.handleMyInterests(this, msg); }
  async handleRemoveInterest(msg, match) { return interestCmds.handleRemoveInterest(this, msg, match); }

  async handleForwardedMessage(msg) { return channelCmds.handleForwardedMessage(this, msg); }
  async handleAddChannel(msg, match) { return channelCmds.handleAddChannel(this, msg, match); }
  async handleChannels(msg) { return channelCmds.handleChannels(this, msg); }

  async handleSearch(msg, match) { return searchCmds.handleSearch(this, msg, match); }
  async handleOffers(msg) { return searchCmds.handleOffers(this, msg); }

  // ── Inline handlers (short enough to stay here) ──────────────────────────

  async handleStart(msg) {
    const isAdmin = this.isFromMainAccount(msg);
    await this.getOrCreateUser(msg);

    if (isAdmin) {
      const text =
        '👋 Ciao! Sono *OfferRadar*, il tuo radar per le offerte Telegram.\n\n' +
        'Monitoro i canali deal che segui e ti invio ogni giorno le offerte più rilevanti in base ai tuoi interessi.\n\n' +
        '🚀 *Come iniziare:*\n' +
        '1️⃣ *Registra un canale* — inoltra un messaggio da qualsiasi canale deal\n' +
        '2️⃣ *Aggiungi un interesse* — `/add_interest AirPods | elettronica | Cuffie wireless, max €150`\n' +
        '3️⃣ *Ogni giorno alle 10:00* ricevi il digest con le offerte migliori per te\n\n' +
        '🔍 Puoi cercare offerte già salvate con `/search keyword`\n' +
        '📖 Tutti i comandi: /help';
      await this.safeSend(msg.chat.id, text, {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [{ text: '➕ Aggiungi interesse', callback_data: 'add_interest' }, { text: '📋 I miei interessi', callback_data: 'my_interests' }],
            [{ text: '📡 Canali', callback_data: 'channels' }, { text: '📊 Statistiche', callback_data: 'stats' }],
            [{ text: '🔍 Cerca', callback_data: 'search' }, { text: '❓ Aiuto', callback_data: 'help' }],
          ],
        },
      });
    } else {
      const text =
        '👋 Ciao! Sono *OfferRadar*.\n\n' +
        'Ti avviso ogni giorno quando escono offerte su ciò che ti interessa, dai canali Telegram monitorati.\n\n' +
        '📋 *Come funziona:*\n' +
        '1️⃣ Aggiungi i tuoi interessi con `/add_interest`\n' +
        '   _es. `/add_interest AirPods | elettronica | max €150`_\n' +
        '2️⃣ Ogni mattina ricevi le offerte che fanno al caso tuo\n' +
        '3️⃣ Cerca offerte passate con `/search keyword`\n\n' +
        '💡 Vuoi aggiungere un canale? Inoltrami un messaggio da quel canale e lo proporrò all\'admin.';
      await this.safeSend(msg.chat.id, text, {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [{ text: '➕ Aggiungi interesse', callback_data: 'add_interest' }, { text: '📋 I miei interessi', callback_data: 'my_interests' }],
            [{ text: '🔍 Cerca offerte', callback_data: 'search' }, { text: '❓ Aiuto', callback_data: 'help' }],
          ],
        },
      });
    }
  }

  async handleStats(msg) {
    if (!this.isFromMainAccount(msg)) {
      await this.reply(msg, '❌ Comando riservato all\'admin.');
      return;
    }
    try {
      const s = await this.db.getStats();
      const total = s.total_offers.count || 0;
      const pct = (n) => total > 0 ? ` (${Math.round(n / total * 100)}%)` : '';

      let text = '📊 *Statistiche OfferRadar*\n\n';
      text += `📦 *Offerte*\n`;
      text += `  Totali:     ${total}\n`;
      text += `  Approvate:  ${s.processed_offers.count}${pct(s.processed_offers.count)}\n`;
      text += `  In attesa:  ${s.pending_offers.count}${pct(s.pending_offers.count)}\n`;
      text += `  Rifiutate:  ${s.rejected_offers.count}${pct(s.rejected_offers.count)}\n\n`;
      text += `📡 Canali monitorati: ${s.channels_count.count}\n`;
      text += `👥 Utenti attivi: ${s.users_count.count}\n`;
      text += `🎯 Interessi totali: ${s.interests_count.count}\n`;
      if (s.categories.length > 0) {
        text += '\n📂 *Categorie:*\n' + s.categories.map(c => `  • ${c.category}`).join('\n');
      }
      await this.safeSend(msg.chat.id, text, { parse_mode: 'Markdown', reply_to_message_id: msg.message_id });
    } catch (err) {
      await this.reply(msg, `❌ Errore: ${err.message}`);
    }
  }

  async handleHelp(msg) {
    await this.getOrCreateUser(msg);
    const isAdmin = this.isFromMainAccount(msg);

    let text =
      '📖 *Comandi OfferRadar*\n\n' +
      '*Interessi*\n' +
      '`/add_interest keyword` — traccia una parola chiave\n' +
      '`/add_interest keyword | categoria | descrizione`\n' +
      '  _es. /add_interest AirPods | elettronica | Cuffie wireless, max €150_\n' +
      '`/my_interests` — vedi i tuoi interessi\n' +
      '`/remove_interest keyword` — rimuovi un interesse\n\n' +
      '*Cerca & Sfoglia*\n' +
      '`/search keyword` — cerca offerte passate\n' +
      '`/offers` — ultime 20 offerte raccolte\n\n' +
      '*Canali*\n' +
      'Inoltra un messaggio da un canale → suggerisce all\'admin di aggiungerlo\n';

    if (isAdmin) {
      text +=
        '\n*Admin*\n' +
        '`/channels` — canali monitorati\n' +
        '`/analyze` — avvia l\'analisi manualmente\n' +
        '`/stats` — statistiche database';
    }

    await this.safeSend(msg.chat.id, text, { parse_mode: 'Markdown', reply_to_message_id: msg.message_id });
  }

  async handleCallbackQuery(query) {
    const msg = query.message;
    await this.bot.answerCallbackQuery(query.id);
    const isAdmin = query.from.id === this.mainAccountId;
    const tmpMsg = { chat: msg.chat, from: query.from, message_id: msg.message_id };

    try {
      // Admin-only: channel approve/reject
      if (query.data.startsWith('cha:') || query.data.startsWith('chr:')) {
        if (!isAdmin) { await this.safeSend(msg.chat.id, '❌ Solo l\'admin può approvare canali.'); return; }
        const [prefix, rawId] = query.data.split(':');
        await channelCmds.handleChannelRequestCallback(this, msg, parseInt(rawId, 10), prefix === 'cha');
        return;
      }

      switch (query.data) {
        case 'add_interest':
          await this.safeSend(msg.chat.id,
            '📝 Invia:\n`/add_interest keyword`\noppure con dettagli:\n`/add_interest keyword | categoria | descrizione`\n\n_es. /add_interest AirPods | elettronica | Cuffie wireless, max €150_',
            { parse_mode: 'Markdown' });
          break;
        case 'my_interests':
          await this.handleMyInterests(tmpMsg);
          break;
        case 'channels':
          if (!isAdmin) { await this.bot.sendMessage(msg.chat.id, '❌ Comando riservato all\'admin.'); return; }
          await this.handleChannels(tmpMsg);
          break;
        case 'stats':
          if (!isAdmin) { await this.bot.sendMessage(msg.chat.id, '❌ Comando riservato all\'admin.'); return; }
          await this.handleStats(tmpMsg);
          break;
        case 'search':
          await this.safeSend(msg.chat.id, '🔍 Invia: `/search keyword`\n\n_es. /search MacBook Pro M4_', { parse_mode: 'Markdown' });
          break;
        case 'help':
          await this.handleHelp(tmpMsg);
          break;
        default:
          await this.bot.answerCallbackQuery(query.id, { text: 'Azione sconosciuta', show_alert: true });
      }
    } catch (err) {
      logger.error('Callback query error:', err.message);
    }
  }

  // ── Private ─────────────────────────────────────────────────────────────────

  _attachHandlers() {
    const b = this.bot;

    b.onText(/^\/start(@\w+)?(\s|$)/i, (msg) => {
      this.handleStart(msg).catch(err => logger.error('handleStart failed:', err && err.message ? err.message : err));
    });
    b.onText(/^\/add_interest(@\w+)?\s(.+)$/i, (msg, m) => {
      this.handleAddInterest(msg, { 1: m[2] }).catch(err => logger.error('handleAddInterest failed:', err && err.message ? err.message : err));
    });
    b.onText(/^\/my_interests(@\w+)?(\s|$)/i, (msg) => {
      this.handleMyInterests(msg).catch(err => logger.error('handleMyInterests failed:', err && err.message ? err.message : err));
    });
    b.onText(/^\/remove_interest(@\w+)?\s(.+)$/i, (msg, m) => {
      this.handleRemoveInterest(msg, { 1: m[2] }).catch(err => logger.error('handleRemoveInterest failed:', err && err.message ? err.message : err));
    });
    b.onText(/^\/search(@\w+)?\s(.+)$/i, (msg, m) => {
      this.handleSearch(msg, { 1: m[2] }).catch(err => logger.error('handleSearch failed:', err && err.message ? err.message : err));
    });
    b.onText(/^\/offers(@\w+)?(\s|$)/i, (msg) => {
      this.handleOffers(msg).catch(err => logger.error('handleOffers failed:', err && err.message ? err.message : err));
    });
    b.onText(/^\/add_channel(@\w+)?\s(.+)$/i, (msg, m) => {
      this.handleAddChannel(msg, { 1: m[2] }).catch(err => logger.error('handleAddChannel failed:', err && err.message ? err.message : err));
    });
    b.onText(/^\/channels(@\w+)?(\s|$)/i, (msg) => {
      this.handleChannels(msg).catch(err => logger.error('handleChannels failed:', err && err.message ? err.message : err));
    });
    b.onText(/^\/stats(@\w+)?(\s|$)/i, (msg) => {
      this.handleStats(msg).catch(err => logger.error('handleStats failed:', err && err.message ? err.message : err));
    });
    b.onText(/^\/help(@\w+)?(\s|$)/i, (msg) => {
      this.handleHelp(msg).catch(err => logger.error('handleHelp failed:', err && err.message ? err.message : err));
    });

    b.onText(/^\/analyze(@\w+)?(\s|$)/i, async (msg) => {
      if (!this.isFromMainAccount(msg)) { await this.reply(msg, '❌ Unauthorized'); return; }
      if (!this.processor) { await this.reply(msg, '❌ Processor not configured.'); return; }
      try {
        await this.reply(msg, '🔎 Starting analysis…');
        await this.processor.processBatch();
        await this.reply(msg, '✅ Analysis complete');
      } catch (err) {
        logger.error('Manual analyze failed:', err.message);
        await this.reply(msg, `❌ Failed: ${err.message}`);
      }
    });

    b.on('callback_query', (q) => {
      this.handleCallbackQuery(q).catch(err => logger.error('handleCallbackQuery failed:', err && err.message ? err.message : err));
    });
    b.on('message', (msg) => {
      if (msg.forward_from_chat && (msg.text || msg.caption)) {
        this.handleForwardedMessage(msg).catch(err => logger.error('handleForwardedMessage failed:', err && err.message ? err.message : err));
      }
    });
  }

  async _registerCommands() {
    try {
      await this.bot.setMyCommands([
        { command: 'start', description: 'Show main menu' },
        { command: 'add_interest', description: 'Track a keyword (e.g. AirPods | electronics | max €150)' },
        { command: 'my_interests', description: 'List tracked keywords' },
        { command: 'remove_interest', description: 'Stop tracking a keyword' },
        { command: 'search', description: 'Search past offers' },
        { command: 'offers', description: 'View recent 20 offers' },
        { command: 'channels', description: 'List monitored channels' },
        { command: 'analyze', description: 'Run analysis now (admin)' },
        { command: 'stats', description: 'Statistics' },
        { command: 'help', description: 'Help' },
      ]);
      logger.info('✅ Bot commands registered with Telegram');
    } catch (err) {
      logger.warn('Failed to register bot commands:', err.message);
    }
  }
}

module.exports = BotInterface;

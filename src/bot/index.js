const TelegramBot = require('node-telegram-bot-api');
const logger = require('../utils/logger');
const config = require('../../config/constants');
const interestCmds = require('./commands/interests');
const channelCmds = require('./commands/channels');
const searchCmds = require('./commands/search');
const { sendRichCard: _sendRichCard } = require('./richCard');
const BatchBuffer = require('./batchBuffer');
const sessionState = require('./sessionState');

function cancelKeyboard() {
  return { inline_keyboard: [[{ text: '❌ Annulla', callback_data: 'flow:cancel' }]] };
}

class BotInterface {
  constructor(database) {
    this.db = database;
    this.bot = null;
    this.llm = null;
    this.mainAccountId = config.MAIN_ACCOUNT_ID;
    this.processor = null;
    this.backfiller = null;
  }

  initialize() {
    this.bot = new TelegramBot(config.BOT_TOKEN, {
      polling: { interval: 300, autoStart: true },
    });
    this.buffer = new BatchBuffer(this.bot, config.BATCH_BUFFER_WINDOW_MS);
    this._attachHandlers();
    this._registerCommands();
    logger.info('Bot handlers registered');
    logger.info('✅ Bot interface initialized');
    return this.bot;
  }

  setProcessor(processor) { this.processor = processor; }
  setBackfiller(backfiller) { this.backfiller = backfiller; }
  setLlm(llm) { this.llm = llm; }

  isFromMainAccount(msg) {
    return (msg.from || {}).id === this.mainAccountId;
  }

  // Register the user on first interaction and return their telegram_id.
  async getOrCreateUser(msg) {
    const { id, username, first_name } = msg.from || {};
    if (!id) return null;
    try {
      this.db.upsertUser(id, username, first_name);
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

  async sendRichCard(telegramId, offer, analysis) {
    this.buffer.add(telegramId, offer, analysis);
  }

  async sendInstantAlert(telegramId, offer, analysis) {
    return this.sendRichCard(telegramId, offer, analysis);
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
    sessionState.stopAll();
    if (this.buffer) this.buffer.stop();
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
        '2️⃣ *Aggiungi un interesse* — tocca il pulsante o usa `/add_interest AirPods`\n' +
        '3️⃣ *Ogni giorno alle 10:00* ricevi il digest con le offerte migliori per te\n\n' +
        '💡 Tocca un pulsante o scrivimi direttamente cosa cerchi — non serve digitare comandi.\n' +
        '📖 Tutti i comandi: /help';
      await this.safeSend(msg.chat.id, text, {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [{ text: '➕ Aggiungi interesse', callback_data: 'add_interest' }, { text: '📋 I miei interessi', callback_data: 'my_interests' }],
            [{ text: '📡 Canali', callback_data: 'channels' }, { text: '📊 Statistiche', callback_data: 'stats' }],
            [{ text: '🔍 Cerca offerta', callback_data: 'search' }, { text: '❓ Aiuto', callback_data: 'help' }],
          ],
        },
      });
    } else {
      const text =
        '👋 Ciao! Sono *OfferRadar*.\n\n' +
        'Ti avviso ogni giorno quando escono offerte su ciò che ti interessa, dai canali Telegram monitorati.\n\n' +
        '📋 *Come funziona:*\n' +
        '1️⃣ Aggiungi i tuoi interessi — tocca il pulsante o scrivimi il nome del prodotto\n' +
        '2️⃣ Ogni mattina ricevi le offerte che fanno al caso tuo\n' +
        '3️⃣ Cerca offerte passate con il pulsante 🔍 o scrivimi direttamente\n\n' +
        '💡 Tocca un pulsante o scrivimi direttamente cosa cerchi — non serve digitare comandi.\n' +
        '📡 Vuoi aggiungere un canale? Inoltrami un messaggio da quel canale.';
      await this.safeSend(msg.chat.id, text, {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [{ text: '➕ Aggiungi interesse', callback_data: 'add_interest' }, { text: '📋 I miei interessi', callback_data: 'my_interests' }],
            [{ text: '🔍 Cerca offerta', callback_data: 'search' }, { text: '❓ Aiuto', callback_data: 'help' }],
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
      const s = this.db.getStats();
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
      if (s.top_categories && s.top_categories.length > 0) {
        text += '\n📂 *Categorie offerte:*\n' +
          s.top_categories.map(c => `  • ${c.name}: ${c.offer_count}`).join('\n');
      }
      if (s.interest_categories && s.interest_categories.length > 0) {
        text += '\n\n🎯 *Interessi per categoria:*\n' +
          s.interest_categories.map(c => `  • ${this.db.categoryMapper.getName(c.category) || c.category}`).join('\n');
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
      '📖 *Aiuto OfferRadar*\n\n' +
      '✨ *Modo facile*\n' +
      'Usa /start e tocca i pulsanti — non servono comandi.\n' +
      'Oppure scrivimi direttamente (es. _AirPods_) e ti chiedo cosa fare.\n\n' +
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
    const isAdmin = query.from.id === this.mainAccountId;
    const tmpMsg = { chat: msg.chat, from: query.from, message_id: msg.message_id };

    try {
      // ⭐ Salva favorite
      if (query.data.startsWith('fav:')) {
        const offerId = parseInt(query.data.slice(4), 10);
        try {
          this.db.addFavorite(query.from.id, offerId);
          await this.bot.answerCallbackQuery(query.id, { text: 'Salvato ⭐', show_alert: false });
        } catch (_) {
          await this.bot.answerCallbackQuery(query.id, { text: 'Già nei preferiti.', show_alert: false });
        }
        return;
      }

      // 👎 Non mi interessa — decrement interest weight for matching brand/category
      if (query.data.startsWith('dismiss:')) {
        const offerId = parseInt(query.data.slice(8), 10);
        try {
          const offer = this.db.get('SELECT brand, category FROM offers WHERE id = ?', [offerId]);
          if (offer) {
            this.db.decrementInterestWeight(
              query.from.id,
              offer.brand,
              offer.category,
              config.DISMISS_WEIGHT_STEP
            );
          }
          await this.bot.answerCallbackQuery(query.id, { text: 'Capito, meno offerte simili.', show_alert: false });
        } catch (_) {
          await this.bot.answerCallbackQuery(query.id, { text: 'Errore.', show_alert: false });
        }
        return;
      }

      // 🔥/🌀 offer feedback
      if (query.data.startsWith('fb_spot:') || query.data.startsWith('fb_no:')) {
        const [prefix, rawId] = query.data.split(':');
        const offerId = parseInt(rawId, 10);
        const rating = prefix === 'fb_spot' ? 'spot_on' : 'not_for_me';
        try {
          this.db.addUserFeedback(offerId, query.from.id, rating);
          const text = rating === 'spot_on'
            ? 'Registrato! Ti trovo offerte simili.'
            : 'Capito, eviterò questo tipo.';
          await this.bot.answerCallbackQuery(query.id, { text, show_alert: false });
        } catch (_) {
          await this.bot.answerCallbackQuery(query.id, { text: 'Già votato.', show_alert: false });
        }
        return;
      }

      await this.bot.answerCallbackQuery(query.id);

      // flow:cancel — clear active state
      if (query.data === 'flow:cancel') {
        sessionState.clear(msg.chat.id);
        await this.bot.editMessageText('Annullato.', { chat_id: msg.chat.id, message_id: msg.message_id })
          .catch(() => this.safeSend(msg.chat.id, 'Annullato.'));
        return;
      }

      // pick:s/i/x:<id> — disambiguation response
      if (query.data.startsWith('pick:')) {
        const parts = query.data.split(':');
        const action = parts[1];
        const id = parts[2];
        const text = sessionState.takePendingText(id);
        if (!text) {
          await this.safeSend(msg.chat.id, '⏱ Scaduto. Scrivi di nuovo cosa cerchi.');
          return;
        }
        if (action === 's') {
          await this.handleSearch(tmpMsg, { 1: text });
        } else if (action === 'i') {
          await this.handleAddInterest(tmpMsg, { 1: text });
        }
        return;
      }

      // Admin-only: channel approve/reject
      if (query.data.startsWith('cha:') || query.data.startsWith('chr:')) {
        if (!isAdmin) { await this.safeSend(msg.chat.id, '❌ Solo l\'admin può approvare canali.'); return; }
        const [prefix, rawId] = query.data.split(':');
        await channelCmds.handleChannelRequestCallback(this, msg, parseInt(rawId, 10), prefix === 'cha');
        return;
      }

      switch (query.data) {
        case 'add_interest':
          sessionState.set(msg.chat.id, 'add_interest');
          await this.safeSend(msg.chat.id,
            '📝 Inviami la parola chiave da tracciare.\n\n' +
            '_Esempio: AirPods Pro_\n\n' +
            'Per dettagli avanzati scrivi `keyword | categoria | descrizione`.',
            { parse_mode: 'Markdown', reply_markup: cancelKeyboard() });
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
          sessionState.set(msg.chat.id, 'search');
          await this.safeSend(msg.chat.id,
            '🔍 Cosa vuoi cercare?\n\n_Esempio: MacBook Pro M4_',
            { parse_mode: 'Markdown', reply_markup: cancelKeyboard() });
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
        return this.handleForwardedMessage(msg).catch(err => logger.error('handleForwardedMessage failed:', err && err.message ? err.message : err));
      }
      const text = msg.text;
      if (!text || text.startsWith('/')) return;

      const intent = sessionState.get(msg.chat.id);
      if (intent === 'search') {
        sessionState.clear(msg.chat.id);
        return this.handleSearch(msg, { 1: text }).catch(err => logger.error('handleSearch (flow) failed:', err && err.message ? err.message : err));
      }
      if (intent === 'add_interest') {
        sessionState.clear(msg.chat.id);
        return this.handleAddInterest(msg, { 1: text }).catch(err => logger.error('handleAddInterest (flow) failed:', err && err.message ? err.message : err));
      }

      this.handleAmbiguousText(msg, text).catch(err => logger.error('handleAmbiguousText failed:', err && err.message ? err.message : err));
    });
  }

  async handleAmbiguousText(msg, text) {
    const id = sessionState.stashPendingText(text);
    const safe = text.length > 50 ? text.slice(0, 50) + '…' : text;
    await this.safeSend(msg.chat.id,
      `Non ho capito 🤔\nVuoi *cercare* «${safe}» tra le offerte o *aggiungerlo* ai tuoi interessi?`,
      {
        parse_mode: 'Markdown',
        reply_to_message_id: msg.message_id,
        reply_markup: {
          inline_keyboard: [
            [
              { text: '🔍 Cerca offerta', callback_data: `pick:s:${id}` },
              { text: '📝 Aggiungi interesse', callback_data: `pick:i:${id}` },
            ],
            [{ text: '❌ Ignora', callback_data: `pick:x:${id}` }],
          ],
        },
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

const logger = require('../utils/logger');
const { sendRichCard, buildCaption, buildInlineKeyboard } = require('./richCard');

class BatchBuffer {
  constructor(bot, windowMs) {
    this.bot = bot;
    this.windowMs = windowMs;
    this.buffers = new Map(); // telegramId → { offers: [], timer }
  }

  add(telegramId, offer, analysis) {
    if (!this.buffers.has(telegramId)) {
      const timer = setTimeout(() => this._flush(telegramId), this.windowMs);
      this.buffers.set(telegramId, { offers: [], timer });
    }
    this.buffers.get(telegramId).offers.push({ offer, analysis });
  }

  async _flush(telegramId) {
    const entry = this.buffers.get(telegramId);
    this.buffers.delete(telegramId);
    if (!entry || entry.offers.length === 0) return;

    if (entry.offers.length === 1) {
      const { offer, analysis } = entry.offers[0];
      await sendRichCard(this.bot, telegramId, offer, analysis);
      return;
    }

    // Multiple offers within the window: send as album
    // sendMediaGroup does not support per-item reply_markup in Bot API.
    // Send album first, then one keyboard message per offer.
    const media = entry.offers.map(({ offer, analysis }) => ({
      type: 'photo',
      // Placeholder image — real product images not available from text-only channels
      media: 'https://via.placeholder.com/400x300/1a1a2e/ffffff.png?text=OfferRadar',
      caption: buildCaption(offer, analysis).slice(0, 900),
      parse_mode: 'Markdown',
    }));

    try {
      await this.bot.sendMediaGroup(telegramId, media);
      for (const { offer } of entry.offers) {
        await this.bot.sendMessage(telegramId, `👆 _${offer.channel_name}_`, {
          parse_mode: 'Markdown',
          reply_markup: buildInlineKeyboard(offer.id),
        });
      }
    } catch (err) {
      logger.warn('sendMediaGroup failed, falling back to individual cards:', err.message);
      for (const { offer, analysis } of entry.offers) {
        await sendRichCard(this.bot, telegramId, offer, analysis);
      }
    }
  }

  stop() {
    for (const [, entry] of this.buffers) {
      clearTimeout(entry.timer);
    }
    this.buffers.clear();
  }
}

module.exports = BatchBuffer;

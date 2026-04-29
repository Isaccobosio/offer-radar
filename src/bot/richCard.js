const logger = require('../utils/logger');

// ── Markdown v1 helpers (used by instant rich cards) ────────────────────────

function buildCaption(offer, analysis = {}) {
  const brand = offer.brand || analysis.brand || '';
  const title = offer.clean_title || analysis.clean_title || offer.product_name || analysis.product_name || offer.channel_name;
  const price = offer.price || analysis.price;
  const summary = offer.summary || analysis.summary || '';
  const score = offer.confidence_score || analysis.confidence_score || 0;

  const heading = brand ? `${escapeMarkdown(brand)} ${escapeMarkdown(title)}` : escapeMarkdown(title);
  const date = new Date(offer.created_at || Date.now()).toLocaleDateString('it-IT', { day: '2-digit', month: 'short' });
  const badge = score >= 90 ? '\n⭐ Best Match' : '';

  let caption = `🏷️ *${heading}*\n`;
  if (price) caption += `💰 ${price}${String(price).includes('€') || String(price).includes('EUR') ? '' : ' EUR'}\n`;
  caption += `📡 _${escapeMarkdown(offer.channel_name || '')}_  ·  _${date}_`;
  if (badge) caption += badge;
  if (summary) caption += `\n\n${summary}`;
  return caption.slice(0, 4000);
}

function buildInlineKeyboard(offerId) {
  return {
    inline_keyboard: [[
      { text: '🔥 Spot On', callback_data: `fb_spot:${offerId}` },
      { text: '🌀 Not for me', callback_data: `fb_no:${offerId}` },
    ]],
  };
}

async function sendRichCard(bot, chatId, offer, analysis) {
  const caption = buildCaption(offer, analysis);
  const keyboard = buildInlineKeyboard(offer.id);
  try {
    await bot.sendMessage(chatId, caption, {
      parse_mode: 'Markdown',
      reply_markup: keyboard,
    });
  } catch (err) {
    if (err && /parse entities/i.test(err.message)) {
      logger.warn('Rich card Markdown error, sending plain text');
      try {
        await bot.sendMessage(chatId, stripMarkdown(caption), { reply_markup: keyboard });
      } catch (err2) {
        logger.error('Rich card fallback failed:', err2.message);
      }
    } else {
      logger.error('sendRichCard failed:', err.message);
    }
  }
}

function escapeMarkdown(text) {
  if (!text) return '';
  return text.replace(/([_*`\[])/g, '\\$1');
}

function stripMarkdown(text) {
  return text.replace(/[*_`]/g, '');
}

// ── MarkdownV2 helpers (used by digest cards) ────────────────────────────────

function escapeMarkdownV2(text) {
  if (!text) return '';
  return String(text).replace(/[_*[\]()~`>#+=|{}.!\-\\]/g, '\\$&');
}

function stripMarkdownV2(text) {
  return String(text).replace(/[_*[\]()~`>#+=|{}.!\-\\]/g, '');
}

function buildDigestCaption(offer, matchedInterestName) {
  const brand = offer.brand || null;
  const title = offer.clean_title || offer.product_name || offer.channel_name || 'Offerta';
  const currentPrice = offer.price ? `€${offer.price}` : null;
  const originalPrice = offer.original_price ? `€${offer.original_price}` : null;
  const drop = offer.price_drop_percentage ? Math.round(offer.price_drop_percentage) : null;

  let caption = '';

  if (brand) {
    caption += `*${escapeMarkdownV2(brand)}* — *${escapeMarkdownV2(title)}*\n`;
  } else {
    caption += `*${escapeMarkdownV2(title)}*\n`;
  }

  if (currentPrice) {
    let priceLine = `💰 *${escapeMarkdownV2(currentPrice)}*`;
    if (originalPrice) priceLine += `  ~${escapeMarkdownV2(originalPrice)}~`;
    if (drop) priceLine += `  \\-${drop}%`;
    caption += priceLine + '\n';
  }

  if (matchedInterestName) {
    caption += `💡 _Matches your interest in ${escapeMarkdownV2(matchedInterestName)}_\n`;
  }

  caption += `📡 ${escapeMarkdownV2(offer.channel_name || '')}`;

  return caption.slice(0, 1024);
}

function buildDigestKeyboard(offer) {
  const rows = [];

  if (offer.channel_username && offer.message_id) {
    rows.push([{
      text: '🛒 Apri Offerta',
      url: `https://t.me/${offer.channel_username}/${offer.message_id}`,
    }]);
  }

  rows.push([
    { text: '⭐ Salva', callback_data: `fav:${offer.id}` },
    { text: '👎 Non mi interessa', callback_data: `dismiss:${offer.id}` },
  ]);

  return { inline_keyboard: rows };
}

async function sendDigestCard(bot, chatId, offer, matchedInterestName) {
  const caption = buildDigestCaption(offer, matchedInterestName);
  const reply_markup = buildDigestKeyboard(offer);
  const opts = { parse_mode: 'MarkdownV2', reply_markup };

  async function trySend() {
    if (offer.image_url) {
      return bot.sendPhoto(chatId, offer.image_url, { caption, ...opts });
    }
    return bot.sendMessage(chatId, caption, opts);
  }

  try {
    await trySend();
  } catch (err) {
    if (err && /parse entities/i.test(err.message)) {
      logger.warn('Digest card MarkdownV2 error, retrying plain text');
      try {
        const plain = stripMarkdownV2(caption);
        if (offer.image_url) {
          await bot.sendPhoto(chatId, offer.image_url, { caption: plain, reply_markup });
        } else {
          await bot.sendMessage(chatId, plain, { reply_markup });
        }
      } catch (err2) {
        logger.error('Digest card fallback failed:', err2.message);
      }
    } else {
      logger.error('sendDigestCard failed:', err.message);
    }
  }
}

async function sendDigestTrailer(bot, chatId, sent, remaining) {
  if (remaining <= 0) return;
  const text = escapeMarkdownV2(
    `Hai visualizzato le ${sent} migliori offerte per te. Vedi altre ${remaining} nel Control Center.`
  );
  try {
    await bot.sendMessage(chatId, text, { parse_mode: 'MarkdownV2' });
  } catch (err) {
    logger.error('sendDigestTrailer failed:', err.message);
  }
}

module.exports = {
  buildCaption, buildInlineKeyboard, sendRichCard,
  escapeMarkdownV2, buildDigestCaption, buildDigestKeyboard,
  sendDigestCard, sendDigestTrailer,
};

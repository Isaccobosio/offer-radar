const TOO_MANY_THRESHOLD = 8;
const SHOW_LIMIT = 5;

function sourceLink(offer) {
  if (!offer.channel_username || !offer.message_id) return '';
  return ` [↗](https://t.me/${offer.channel_username}/${offer.message_id})`;
}

function offerSnippet(offer, maxLen = 120) {
  const hasRealSummary = offer.summary && !offer.summary.startsWith('Error:');
  const text = hasRealSummary
    ? offer.summary
    : offer.raw_text.replace(/\s+/g, ' ').trim().slice(0, maxLen);
  return text.length >= maxLen ? text.slice(0, maxLen) + '…' : text;
}

async function handleSearch(bot, msg, match) {
  await bot.getOrCreateUser(msg);

  const query = (match[1] || '').trim();
  if (!query) {
    await bot.reply(msg, '❌ Formato: `/search keyword`\n\nEsempio: `/search MacBook Pro M4`');
    return;
  }

  try {
    const results = await bot.db.searchOffers(query);

    if (results.length === 0) {
      await bot.reply(msg, `🔍 Nessuna offerta trovata per «${query}».\n\nProva con una parola più corta, o usa /offers per vedere i messaggi recenti.`);
      return;
    }

    if (results.length > TOO_MANY_THRESHOLD) {
      await bot.reply(
        msg,
        `🔍 *${results.length} risultati* per «${query}» — ricerca troppo generica.\n\n` +
        `Prova a essere più specifico:\n` +
        `\`/search ${query} Pro\`\n` +
        `\`/search ${query} 2026\`\n` +
        `\`/search ${query} Amazon\``
      );
      return;
    }

    let text = `🔍 *${results.length} risultat${results.length === 1 ? 'o' : 'i'} per «${query}»*\n\n`;

    results.slice(0, SHOW_LIMIT).forEach((offer, idx) => {
      const date = new Date(offer.created_at).toLocaleDateString('it-IT', { day: '2-digit', month: 'short' });
      const score = offer.confidence_score != null ? ` · ${offer.confidence_score}%` : '';
      const link = sourceLink(offer);

      text += `${idx + 1}. *${offer.channel_name}*${score}${link}\n`;
      text += `   ${offerSnippet(offer)}\n`;
      text += `   _${date}_\n\n`;
    });

    await bot.safeSend(msg.chat.id, text, {
      parse_mode: 'Markdown',
      reply_to_message_id: msg.message_id,
      disable_web_page_preview: true,
    });
  } catch (err) {
    await bot.reply(msg, `❌ Errore: ${err.message}`);
  }
}

async function handleOffers(bot, msg) {
  await bot.getOrCreateUser(msg);

  try {
    const offers = await bot.db.getRecentOffers(20);

    if (offers.length === 0) {
      await bot.reply(msg, '📭 Nessuna offerta ancora. Inoltra messaggi dai tuoi canali deal per iniziare!');
      return;
    }

    let text = `📬 *Offerte recenti* (${offers.length})\n\n`;
    offers.forEach((offer, idx) => {
      const date = new Date(offer.created_at).toLocaleDateString('it-IT', { day: '2-digit', month: 'short' });
      const status = offer.status === 'processed' ? '✅' : offer.status === 'pending' ? '⏳' : '❌';
      const score = offer.confidence_score != null ? ` ${offer.confidence_score}%` : '';
      const link = sourceLink(offer);

      text += `${idx + 1}. ${status}${score} *${offer.channel_name}*${link}\n`;
      text += `   ${offerSnippet(offer, 80)}\n`;
      text += `   _${date}_\n\n`;
    });

    await bot.safeSend(msg.chat.id, text, {
      parse_mode: 'Markdown',
      reply_to_message_id: msg.message_id,
      disable_web_page_preview: true,
    });
  } catch (err) {
    await bot.reply(msg, `❌ Errore: ${err.message}`);
  }
}

module.exports = { handleSearch, handleOffers };

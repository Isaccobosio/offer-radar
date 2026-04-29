const TOO_MANY_THRESHOLD = 8;
const SHOW_LIMIT = 5;

function offerTitle(offer) {
  if (offer.clean_title) return offer.clean_title;
  if (offer.product_name) return offer.product_name;
  const firstLine = (offer.raw_text || '').split('\n').map(l => l.trim()).find(l => l.length > 3) || '';
  return firstLine.length > 60 ? firstLine.slice(0, 60) + '…' : firstLine || offer.channel_name;
}

function sourceLink(offer) {
  if (offer.channel_username && offer.message_id) {
    return `[Apri ↗](https://t.me/${offer.channel_username}/${offer.message_id})`;
  }
  return '';
}

function formatPrice(offer) {
  if (!offer.price) return '';
  const p = offer.price;
  return ` 🏷️ ${p}${String(p).includes('€') || String(p).includes('EUR') ? '' : ' EUR'}`;
}

function matchPct(offer, topRank) {
  const rank = offer.fts_rank || 0;
  const pct = topRank > 0 ? Math.round((rank / topRank) * 100) : 50;
  return Math.min(100, Math.max(1, pct));
}

function renderOfferLine(offer, idx, topRank) {
  const date = new Date(offer.created_at).toLocaleDateString('it-IT', { day: '2-digit', month: 'short' });
  const brand = offer.brand ? `${offer.brand} ` : '';
  const title = offerTitle(offer);
  const price = formatPrice(offer);
  const link = sourceLink(offer);
  const linkPart = link ? ` · ${link}` : '';
  const pct = matchPct(offer, topRank);
  const badge = pct >= 90 ? ' ⭐ Best Match' : '';
  return `${idx + 1}. *${brand}${title}*${price}${badge}\n   📡 ${offer.channel_name} · _${date}_${linkPart}\n`;
}

async function handleSearch(bot, msg, match) {
  await bot.getOrCreateUser(msg);

  const query = (match[1] || '').trim();
  if (!query) {
    await bot.reply(msg, '❌ Formato: `/search keyword`\n\nEsempio: `/search MacBook Pro M4`');
    return;
  }

  try {
    let parsed = null;
    if (bot.llm && typeof bot.llm.parseSearchQuery === 'function') {
      try {
        parsed = await bot.llm.parseSearchQuery(query);
      } catch (_) {
        parsed = null;
      }
    }

    const results = bot.db.searchOffers(query, parsed);

    if (results.length === 0) {
      await bot.reply(msg, `🔍 Nessuna offerta trovata per «${query}».\n\nProva con una parola più corta, o usa /offers per vedere i messaggi recenti.`);
      return;
    }

    if (results.length > TOO_MANY_THRESHOLD) {
      await bot.reply(
        msg,
        `🔍 *${results.length} risultati* per «${query}» — troppo generico.\n\n` +
        `Sii più specifico, es: \`/search ${query} Pro\``
      );
      return;
    }

    const displayQuery = query.replace(/^[""""]+|[""""]+$/g, '');
    const topRank = results.reduce((m, r) => Math.max(m, r.fts_rank || 0), 0);

    let text = `🔍 *${results.length} risultat${results.length === 1 ? 'o' : 'i'} per «${displayQuery}»*\n\n`;
    results.slice(0, SHOW_LIMIT).forEach((offer, idx) => {
      text += renderOfferLine(offer, idx, topRank);
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
    const offers = bot.db.getRecentOffers(20);

    if (offers.length === 0) {
      await bot.reply(msg, '📭 Nessuna offerta ancora. Inoltra messaggi dai tuoi canali deal per iniziare!');
      return;
    }

    let text = `📬 *Offerte recenti* (${offers.length})\n\n`;
    offers.forEach((offer, idx) => {
      const date = new Date(offer.created_at).toLocaleDateString('it-IT', { day: '2-digit', month: 'short' });
      const status = offer.status === 'processed' ? '✅' : offer.status === 'pending' ? '⏳' : offer.status === 'duplicate' ? '🔁' : '❌';
      const score = offer.confidence_score != null ? ` ${offer.confidence_score}%` : '';
      const link = sourceLink(offer);
      const priceStr = offer.price ? ` · 🏷️ ${offer.price}` : '';
      const title = offerTitle(offer);
      text += `${idx + 1}. ${status}${score} *${title}*${priceStr}\n`;
      text += `   📡 ${offer.channel_name}${link ? ` · ${link}` : ''} · _${date}_\n\n`;
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

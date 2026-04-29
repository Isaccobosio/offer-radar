const logger = require('../../utils/logger');

async function handleAddInterest(bot, msg, match) {
  const userId = await bot.getOrCreateUser(msg);
  if (!userId) { await bot.reply(msg, '❌ Impossibile identificare l\'utente.'); return; }

  const raw = (match[1] || '').trim();
  if (!raw) {
    await bot.reply(
      msg,
      '❌ È necessaria almeno una parola chiave!\n\n' +
      'Formati accettati:\n' +
      '`/add_interest AirPods`\n' +
      '`/add_interest AirPods elettronica`\n' +
      '`/add_interest AirPods | elettronica | Cuffie wireless, max €150`\n\n' +
      '_La descrizione (dopo `|`) aiuta a trovare corrispondenze migliori._'
    );
    return;
  }

  let keyword, category, description;
  if (raw.includes('|')) {
    const parts = raw.split('|').map(p => p.trim());
    keyword = parts[0].replace(/^["'"'"]+|["'"'"]+$/g, '').trim();
    category = parts[1] || 'Generale';
    description = parts[2] || null;
  } else {
    keyword = raw.replace(/^["'"'"]+|["'"'"]+$/g, '').trim();
    category = 'Generale';
    description = null;
  }

  if (!keyword) { await bot.reply(msg, '❌ La parola chiave non può essere vuota.'); return; }

  const keywordSlug = category === 'Generale' ? bot.db.categoryMapper.map(keyword) : null;
  const slug = keywordSlug || bot.db.categoryMapper.map(category);
  const storedCategory = slug || category;
  const displayCategory = slug ? bot.db.categoryMapper.getName(slug) : category;

  try {
    bot.db.insertInterest(userId, keyword, storedCategory, description);

    const requeued = bot.db.requeueRejectedByKeyword(keyword);
    logger.info(`User ${userId} added interest: ${keyword} → ${category}${requeued > 0 ? `, re-queued ${requeued} rejected offers` : ''}`);

    let reply = `✅ Aggiunto: *${keyword}* [${displayCategory}]`;
    if (description) reply += `\n_${description}_`;
    if (requeued > 0) {
      reply += `\n\n🔄 Ho trovato *${requeued}* offerte rifiutate che potrebbero interessarti — le ri-analizzo subito.`;
    } else {
      reply += '\n\nLo terrò d\'occhio per te!';
    }
    await bot.reply(msg, reply);

    if (bot.processor && !bot.processor.isProcessing) {
      bot.processor.processBatch().catch(err => logger.warn('Background batch after interest add failed:', err.message));
    }
  } catch (err) {
    if (err.message.includes('UNIQUE')) {
      await bot.reply(msg, `⚠️ Stai già tracciando «${keyword}». Rimuovilo prima con /remove\\_interest.`);
    } else {
      await bot.reply(msg, `❌ Errore: ${err.message}`);
    }
  }
}

async function handleMyInterests(bot, msg) {
  const userId = await bot.getOrCreateUser(msg);
  if (!userId) { await bot.reply(msg, '❌ Impossibile identificare l\'utente.'); return; }

  try {
    const interests = bot.db.getAllInterests(userId);

    if (interests.length === 0) {
      await bot.reply(
        msg,
        '📋 Nessun interesse tracciato.\n\n' +
        'Aggiungine uno:\n`/add_interest AirPods`\n`/add_interest AirPods | elettronica | Cuffie wireless, max €150`'
      );
      return;
    }

    const grouped = {};
    for (const i of interests) {
      if (!grouped[i.category]) grouped[i.category] = [];
      grouped[i.category].push(i);
    }

    let text = `📋 *I tuoi interessi* (${interests.length})\n\n`;
    for (const [category, items] of Object.entries(grouped)) {
      const displayName = bot.db.categoryMapper.getName(category) || category;
      text += `*${displayName}*\n`;
      for (const i of items) {
        text += `  • ${i.keyword}`;
        if (i.description) text += ` — _${i.description}_`;
        text += '\n';
      }
      text += '\n';
    }

    await bot.safeSend(msg.chat.id, text, {
      parse_mode: 'Markdown',
      reply_to_message_id: msg.message_id,
    });
  } catch (err) {
    await bot.reply(msg, `❌ Errore: ${err.message}`);
  }
}

async function handleRemoveInterest(bot, msg, match) {
  const userId = await bot.getOrCreateUser(msg);
  if (!userId) { await bot.reply(msg, '❌ Impossibile identificare l\'utente.'); return; }

  const keyword = (match[1] || '').trim();
  if (!keyword) { await bot.reply(msg, '❌ Formato: `/remove_interest keyword`'); return; }

  try {
    const result = bot.db.removeInterest(userId, keyword);
    if (result.changes === 0) {
      await bot.reply(msg, `⚠️ Non stai tracciando «${keyword}».`);
    } else {
      await bot.reply(msg, `✅ Rimosso: *${keyword}*`);
      logger.info(`User ${userId} removed interest: ${keyword}`);
    }
  } catch (err) {
    await bot.reply(msg, `❌ Errore: ${err.message}`);
  }
}

module.exports = { handleAddInterest, handleMyInterests, handleRemoveInterest };

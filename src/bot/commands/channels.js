const logger = require('../../utils/logger');
const config = require('../../../config/constants');

async function handleForwardedMessage(bot, msg) {
  const senderId = (msg.from || {}).id;
  const isAdmin = senderId === bot.mainAccountId;
  const channelName = msg.forward_from_chat?.title || 'Forwarded';
  const channelId = msg.forward_from_chat?.id || 0;
  const channelUsername = msg.forward_from_chat?.username || null;
  const text = msg.text || msg.caption || '';

  if (!isAdmin) {
    if (channelId === 0) {
      await bot.reply(msg, '❌ Could not identify the source channel. Forward a message directly from a public channel.');
      return;
    }
    const senderName = msg.from?.username ? `@${msg.from.username}` : (msg.from?.first_name || `User ${senderId}`);
    try {
      const existing = bot.db.get(
        'SELECT id FROM channel_requests WHERE channel_id = ? AND status = "pending"',
        [channelId]
      );
      if (existing) {
        await bot.reply(msg, `⏳ Channel *${channelName}* is already pending admin review.`);
        return;
      }
      bot.db.run(
        'INSERT INTO channel_requests (channel_id, channel_name, channel_username, requested_by_id, requested_by_name) VALUES (?, ?, ?, ?, ?)',
        [channelId, channelName, channelUsername, senderId, senderName]
      );
      const req = bot.db.get(
        'SELECT id FROM channel_requests WHERE channel_id = ? AND status = "pending" ORDER BY id DESC LIMIT 1',
        [channelId]
      );
      await bot.safeSend(bot.mainAccountId,
        `📡 *Channel Request*\n\n${senderName} wants to add:\n*${channelName}*${channelUsername ? ` (@${channelUsername})` : ''}\n\nApprove to register and backfill this channel.`,
        {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [[
              { text: '✅ Approve', callback_data: `cha:${req.id}` },
              { text: '❌ Reject', callback_data: `chr:${req.id}` },
            ]],
          },
        }
      );
      await bot.reply(msg, `📩 Channel suggestion sent to admin for review!\n\nYou'll be notified when it's approved or rejected.`);
    } catch (err) {
      logger.error('Channel suggestion error:', err.message);
      await bot.reply(msg, '❌ Could not send suggestion. Try again later.');
    }
    return;
  }

  // Admin flow: register channel + store offer
  try {
    if (channelId !== 0) {
      bot.db.run(
        'INSERT OR IGNORE INTO channels (channel_id, channel_name, channel_username) VALUES (?, ?, ?)',
        [channelId, channelName, channelUsername]
      );
      logger.info(`📡 Auto-registered channel: ${channelName}${channelUsername ? ' (@' + channelUsername + ')' : ''}`);
    }

    if (!text || text.length < config.MIN_MESSAGE_LENGTH) {
      logger.debug(`Message too short, skipping; channel ${channelName} registered`);
      return;
    }

    const messageId = msg.forward_from_message_id || msg.message_id;
    const offer = {
      message_id: messageId,
      channel_id: channelId,
      channel_name: channelName,
      raw_text: text,
      created_at: new Date(),
    };

    const isProcessed = bot.db.isProcessed(messageId);
    if (isProcessed) {
      logger.debug(`Message ${messageId} already processed`);
      return;
    }

    bot.db.insertOffer(offer);
    bot.db.markProcessed(messageId, offer.channel_id);

    await bot.safeSend(
      bot.mainAccountId,
      `✅ Offerta ricevuta da *${channelName}*\n\nAvvio analisi… 📊`,
      { parse_mode: 'Markdown' }
    );

    if (bot.processor && !bot.processor.isProcessing) {
      bot.processor.processBatch().catch(err => logger.warn('Batch after forwarded offer failed:', err.message));
    }
  } catch (err) {
    logger.error('Error handling forwarded message:', err.message);
  }
}

async function handleAddChannel(bot, msg, match) {
  if (!bot.isFromMainAccount(msg)) {
    await bot.reply(msg, '❌ Unauthorized');
    return;
  }

  const channelName = (match[1] || '').trim();
  if (!channelName) {
    await bot.reply(
      msg,
      '❌ Formato: `/add_channel nome_canale`\n\n' +
      'Oppure inoltra un messaggio dal canale — viene registrato automaticamente.'
    );
    return;
  }

  try {
    const crypto = require('crypto');
    const channelId = parseInt(crypto.createHash('md5').update(channelName).digest('hex').substring(0, 8), 16);

    bot.db.run(
      'INSERT OR IGNORE INTO channels (channel_id, channel_name, channel_username) VALUES (?, ?, ?)',
      [channelId, channelName, null]
    );

    await bot.reply(msg, `✅ Canale aggiunto: *${channelName}*\n\nInoltra messaggi da questo canale per iniziare a raccogliere offerte.`);
    logger.info(`Added channel: ${channelName}`);

    if (bot.backfiller) {
      try {
        await bot.safeSend(msg.chat.id, '🔁 Recupero offerte recenti...', { reply_to_message_id: msg.message_id });
        await bot.backfiller.backfillChannel({ channel_id: channelId, channel_name: channelName }, config.OFFER_RETENTION_DAYS, bot.db);
        await bot.safeSend(msg.chat.id, '✅ Recupero completato — avvio analisi…', { reply_to_message_id: msg.message_id });
        if (bot.processor && !bot.processor.isProcessing) {
          bot.processor.processBatch().catch(err => logger.warn('Batch after add_channel backfill failed:', err.message));
        }
      } catch (err) {
        logger.warn('Backfill for new channel failed:', err.message || err);
      }
    }
  } catch (err) {
    if (err.message.includes('UNIQUE')) {
      await bot.reply(msg, `⚠️ Il canale «${channelName}» è già registrato.`);
    } else {
      await bot.reply(msg, `❌ Errore: ${err.message}`);
    }
  }
}

async function handleChannels(bot, msg) {
  if (!bot.isFromMainAccount(msg)) {
    await bot.reply(msg, '❌ Unauthorized');
    return;
  }

  try {
    const channels = bot.db.all('SELECT channel_name, channel_username FROM channels ORDER BY channel_name');

    if (channels.length === 0) {
      await bot.safeSend(
        msg.chat.id,
        '📡 Nessun canale monitorato.\n\nInoltra un messaggio da qualsiasi canale deal per registrarlo automaticamente.',
        { reply_to_message_id: msg.message_id }
      );
      return;
    }

    let text = `📡 *Canali monitorati* (${channels.length})\n\n`;
    channels.forEach((ch, idx) => {
      text += `${idx + 1}. ${ch.channel_name}`;
      if (ch.channel_username) text += ` (@${ch.channel_username})`;
      text += '\n';
    });

    await bot.safeSend(msg.chat.id, text, { reply_to_message_id: msg.message_id });
  } catch (err) {
    await bot.reply(msg, `❌ Error: ${err.message}`);
  }
}

async function handleChannelRequestCallback(bot, msg, reqId, approve) {
  const req = bot.db.get('SELECT * FROM channel_requests WHERE id = ?', [reqId]);
  if (!req || req.status !== 'pending') {
    await bot.safeSend(msg.chat.id, '⚠️ Request already handled or not found.');
    return;
  }

  if (approve) {
    bot.db.run(
      'INSERT OR IGNORE INTO channels (channel_id, channel_name, channel_username) VALUES (?, ?, ?)',
      [req.channel_id, req.channel_name, req.channel_username]
    );
    bot.db.run('UPDATE channel_requests SET status = "approved" WHERE id = ?', [reqId]);

    if (bot.backfiller) {
      const handle = req.channel_username || req.channel_name;
      bot.backfiller.joinChannel(handle).catch(err =>
        logger.warn(`MTProto join failed for ${handle}: ${err.message}`)
      );
      const ch = { channel_id: req.channel_id, channel_name: req.channel_name, channel_username: req.channel_username };
      bot.backfiller.backfillChannel(ch, config.OFFER_RETENTION_DAYS, bot.db)
        .then(() => {
          if (bot.processor && !bot.processor.isProcessing) {
            return bot.processor.processBatch();
          }
        })
        .catch(err => logger.warn('Post-approval backfill/batch failed:', err.message));
    }

    await bot.safeSend(
      msg.chat.id,
      `✅ Channel *${req.channel_name}* approved and registered!\n\nBackfilling recent offers in background…`,
      { parse_mode: 'Markdown' }
    );
    bot.safeSend(
      req.requested_by_id,
      `✅ Your channel suggestion *${req.channel_name}* was approved! Offers will start appearing in the daily digest.`,
      { parse_mode: 'Markdown' }
    ).catch(() => {});
  } else {
    bot.db.run('UPDATE channel_requests SET status = "rejected" WHERE id = ?', [reqId]);
    await bot.safeSend(msg.chat.id, `❌ Channel *${req.channel_name}* rejected.`, { parse_mode: 'Markdown' });
    bot.safeSend(
      req.requested_by_id,
      `❌ Your channel suggestion *${req.channel_name}* was not approved by the admin.`,
      { parse_mode: 'Markdown' }
    ).catch(() => {});
  }
}

module.exports = { handleForwardedMessage, handleAddChannel, handleChannels, handleChannelRequestCallback };

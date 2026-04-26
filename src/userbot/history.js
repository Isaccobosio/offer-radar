const logger = require('../utils/logger');
const config = require('../../config/constants');
let TelegramClient;
let StringSession;
try {
  ({ TelegramClient } = require('telegram'));
  ({ StringSession } = require('telegram/sessions'));
} catch (err) {
  // Module may be optional; leave client uninitialized and warn at runtime
  TelegramClient = null;
  StringSession = null;
}

class Backfiller {
  constructor() {
    this.client = null;
    this.connected = false;
    this.apiId = parseInt(process.env.API_ID, 10);
    this.apiHash = process.env.API_HASH;
    this.sessionString = process.env.TELEGRAM_SESSION || '';
  }

  async init() {
    if (!this.apiId || !this.apiHash || !this.sessionString) {
      logger.warn('Backfiller disabled: missing API_ID/API_HASH/TELEGRAM_SESSION');
      return false;
    }

    if (!TelegramClient || !StringSession) {
      logger.warn('Backfiller disabled: missing optional dependency "telegram". Install with: npm install telegram');
      return false;
    }

    try {
      const session = new StringSession(this.sessionString);
      this.client = new TelegramClient(session, this.apiId, this.apiHash, { connectionRetries: 5 });
      // If session string is valid, connect silently
      await this.client.connect();
      this.connected = true;
      logger.info('✅ Backfiller (MTProto) initialized');
      return true;
    } catch (err) {
      logger.error('Failed to initialize MTProto client:', err.message || err);
      this.connected = false;
      throw err;
    }
  }

  /**
   * Backfill multiple channels. `channels` is an array of { channel_id, channel_name }
   */
  async backfillChannels(channels = [], days = 14, db) {
    if (!this.connected) {
      logger.warn('Backfiller not connected - skipping backfill');
      return;
    }

    for (const ch of channels) {
      try {
        await this.backfillChannel(ch, days, db);
      } catch (err) {
        logger.warn(`Backfill failed for ${ch.channel_name || ch.channel_id}: ${err.message}`);
      }
    }
  }

  /**
   * Backfill a single channel for the last `days` days.
   */
  async backfillChannel(channel, days = 14, db) {
    if (!this.connected) {
      throw new Error('MTProto client not connected');
    }

    const dateLimit = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    let entity = null;

    try {
      // Prefer numeric channel_id if present
      if (channel.channel_id && Math.abs(channel.channel_id) > 1000) {
        try {
          // Use absolute value to avoid -100... Bot API prefix issues
          const idCandidate = Math.abs(channel.channel_id);
          entity = await this.client.getEntity(idCandidate);
        } catch (errId) {
          logger.warn(`Could not resolve channel by numeric id ${channel.channel_id}: ${errId.message || errId}`);
          entity = null;
        }
      }

      // If numeric resolution failed or wasn't attempted, try by channel name (username) when possible
      if (!entity && channel.channel_name) {
        let username = channel.channel_name;
        // Only try to form a username if channel_name looks like a handle (no spaces)
        if (!username.startsWith('@') && !username.includes(' ')) {
          username = '@' + username;
        }
        try {
          entity = await this.client.getEntity(username);
        } catch (errName) {
          logger.warn(`Could not resolve channel by name ${channel.channel_name}: ${errName.message || errName}`);
          entity = null;
        }
      }

      if (!entity) {
        logger.warn('No usable identifier for channel, skipping backfill');
        return;
      }
    } catch (err) {
      logger.warn(`Could not resolve channel ${channel.channel_name || channel.channel_id}: ${err.message}`);
      return;
    }

    logger.info(`🔁 Backfilling ${channel.channel_name || channel.channel_id} up to ${days} days`);

    // Counters for diagnostics
    let scanned = 0;
    let added = 0;
    let skippedProcessed = 0;
    let skippedEmpty = 0;
    let latestDate = null;
    let earliestDate = null;

    try {
      // Use iterator to traverse messages (newest -> oldest)
      if (typeof this.client.iterMessages === 'function') {
        for await (const msg of this.client.iterMessages(entity, { limit: 1000 })) {
          if (!msg) continue;
          // msg.date is a Date object
          if (msg.date < dateLimit) break;

          scanned++;
          if (!latestDate || msg.date > latestDate) latestDate = msg.date;
          if (!earliestDate || msg.date < earliestDate) earliestDate = msg.date;

          // Prefer text fields: message, caption, or text
          const rawText = msg.message || msg.caption || (msg.text && (typeof msg.text === 'string' ? msg.text : JSON.stringify(msg.text))) || '';
          if (!rawText || rawText.trim().length === 0) {
            skippedEmpty++;
            continue;
          }

          const messageId = msg.id;
          const isProcessed = await db.isProcessed(messageId);
          if (isProcessed) {
            skippedProcessed++;
            continue;
          }

          const offer = {
            message_id: messageId,
            channel_id: channel.channel_id || (entity && entity.id) || 0,
            channel_name: channel.channel_name || (entity && (entity.title || entity.username)) || 'Unknown',
            raw_text: rawText,
            created_at: new Date(msg.date),
          };

          await db.insertOffer(offer);
          await db.markProcessed(messageId, offer.channel_id);
          // Log concise info for the new offer: channel and short title
          try {
            const raw = offer.raw_text || '';
            let shortTitle = raw.split('\n')[0].trim();
            if (shortTitle.length > 80) shortTitle = shortTitle.substring(0, 77) + '...';
            logger.info(`📥 New offer: ${offer.channel_name} — ${shortTitle}`);
          } catch (e) {
            // ignore logging errors
          }
          added++;
        }
      } else {
        // Fallback: try getMessages in pages
        let offsetId = 0;
        const limit = 100;
        while (true) {
          // getMessages may accept offsetId
          const messages = await this.client.getMessages(entity, { limit, offsetId });
          if (!messages || messages.length === 0) break;

          for (const msg of messages) {
            if (!msg) continue;
            if (msg.date < dateLimit) {
              // we've reached older messages
              break;
            }

            scanned++;
            if (!latestDate || msg.date > latestDate) latestDate = msg.date;
            if (!earliestDate || msg.date < earliestDate) earliestDate = msg.date;

            const rawText = msg.message || msg.caption || (msg.text && (typeof msg.text === 'string' ? msg.text : JSON.stringify(msg.text))) || '';
            if (!rawText || rawText.trim().length === 0) {
              skippedEmpty++;
              continue;
            }

            const messageId = msg.id;
            const isProcessed = await db.isProcessed(messageId);
            if (isProcessed) {
              skippedProcessed++;
              continue;
            }

            const offer = {
              message_id: messageId,
              channel_id: channel.channel_id || (entity && entity.id) || 0,
              channel_name: channel.channel_name || (entity && (entity.title || entity.username)) || 'Unknown',
              raw_text: rawText,
              created_at: new Date(msg.date),
            };

            await db.insertOffer(offer);
            await db.markProcessed(messageId, offer.channel_id);
            // Log concise info for the new offer: channel and short title
            try {
              const raw = offer.raw_text || '';
              let shortTitle = raw.split('\n')[0].trim();
              if (shortTitle.length > 80) shortTitle = shortTitle.substring(0, 77) + '...';
              logger.info(`📥 New offer: ${offer.channel_name} — ${shortTitle}`);
            } catch (e) {
              // ignore logging errors
            }
            added++;
          }

          if (messages.length < limit) break;
          offsetId = messages[messages.length - 1].id - 1;
        }
      }

      // Summary diagnostics for this backfill run
      try {
        const latestStr = latestDate ? latestDate.toISOString() : 'N/A';
        const earliestStr = earliestDate ? earliestDate.toISOString() : 'N/A';
        logger.info(`🔎 Backfill summary for ${channel.channel_name || channel.channel_id}: scanned=${scanned}, added=${added}, skippedProcessed=${skippedProcessed}, skippedEmpty=${skippedEmpty}, latest=${latestStr}, earliest=${earliestStr}`);
      } catch (e) {
        // ignore
      }

      logger.info(`✅ Backfill complete for ${channel.channel_name || channel.channel_id} — ${added} new offers added`);
      return added;
    } catch (err) {
      logger.error('Backfill error:', err.message || err);
      throw err;
    }
  }
}

module.exports = Backfiller;

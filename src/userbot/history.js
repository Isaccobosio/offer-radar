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
      if (this.client) {
        try { await this.client.disconnect(); } catch (_) {}
        this.client = null;
      }
      throw err;
    }
  }

  async disconnect() {
    if (this.client) {
      try {
        await this.client.disconnect();
        logger.info('Backfiller disconnected');
      } catch (_) {}
    }
    this.connected = false;
    this.client = null;
  }

  /**
   * Join a Telegram channel via MTProto so the burner account can read its messages.
   * Accepts a username (@channel), a t.me link, or a channel name.
   */
  async joinChannel(usernameOrLink) {
    if (!this.connected) throw new Error('MTProto client not connected');

    let handle = (usernameOrLink || '').trim();
    handle = handle.replace(/^https?:\/\/t\.me\//, '').replace(/^t\.me\//, '');
    if (!handle.startsWith('@') && !handle.startsWith('+')) handle = '@' + handle;

    const { Api } = require('telegram');
    const entity = await this.client.getEntity(handle);
    await this.client.invoke(new Api.channels.JoinChannel({ channel: entity }));
    logger.info(`Joined channel ${handle} via MTProto`);
    return entity;
  }

  /**
   * Backfill multiple channels. `channels` is an array of { channel_id, channel_name }
   * Pass `analysisQueue` to route backfilled offers through LLM extraction (low priority).
   */
   async backfillChannels(channels = [], days = 14, db, analysisQueue = null) {
     if (!this.connected) {
       logger.warn('Backfiller not connected - skipping backfill');
       return;
     }

     for (const ch of channels) {
       try {
         await this.backfillChannel(ch, days, db, analysisQueue);
         // Add 3-second delay between channels to avoid rate limiting
         await new Promise(resolve => setTimeout(resolve, 3000));
       } catch (err) {
         logger.warn(`Backfill failed for ${ch.channel_name || ch.channel_id}: ${err.message}`);
       }
     }
   }

  /**
   * Backfill a single channel for the last `days` days.
   */
  async backfillChannel(channel, days = 14, db, analysisQueue = null) {
    if (!this.connected) {
      throw new Error('MTProto client not connected');
    }

    // msg.date from GramJS is Unix seconds; compare as seconds throughout
    const dateLimitSec = Math.floor((Date.now() - days * 24 * 60 * 60 * 1000) / 1000);
    let entity = null;

    try {
      // Prefer numeric channel_id if present
      if (channel.channel_id && Math.abs(channel.channel_id) > 1000) {
        try {
          // Bot API channel IDs have a -100 prefix (e.g. -1001063843030).
          // GramJS needs the bare channel ID (1063843030), so strip the leading "100".
          let idStr = Math.abs(channel.channel_id).toString();
          if (idStr.startsWith('100')) idStr = idStr.slice(3);
          const idCandidate = parseInt(idStr, 10);
          entity = await this.client.getEntity(idCandidate);
        } catch (errId) {
          logger.warn(`Could not resolve channel by numeric id ${channel.channel_id}: ${errId.message || errId}`);
          entity = null;
        }
      }

      // If numeric resolution failed or wasn't attempted, try by channel name (username) when possible
      if (!entity && (channel.channel_username || channel.channel_name)) {
        let username = channel.channel_username || channel.channel_name;
        // Normalize username if it's a plain handle (no spaces) and missing '@'
        if (!username.startsWith('@') && !username.includes(' ')) {
          username = '@' + username;
        }
        try {
          entity = await this.client.getEntity(username);
        } catch (errName) {
          logger.warn(`Could not resolve channel by name ${channel.channel_username || channel.channel_name}: ${errName.message || errName}`);
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

    // Diagnostic: inspect resolved entity and test simple fetch
    try {
      const entSummary = {
        id: entity && (entity.id || entity.channel_id || (entity.peer && entity.peer.channel_id)) || null,
        username: entity && (entity.username || (entity.peer && entity.peer.username)) || null,
        title: entity && (entity.title || null) || null,
        className: entity && (entity.className || (entity.constructor && entity.constructor.name)) || null,
      };
      logger.info(`🔍 Resolved entity: ${JSON.stringify(entSummary)}`);
    } catch (e) {
      logger.debug('Failed to serialize entity for diagnostics', e.message || e);
    }

    // Quick test: try getMessages or iterMessages to see if the session can see any messages
    let testMsgs = [];
    let methodUsed = null; // Track which method worked
    
    if (typeof this.client.getMessages === 'function') {
      try {
        testMsgs = await this.client.getMessages(entity, { limit: 3 });
        logger.info(`🔍 getMessages test returned ${testMsgs?.length || 0} messages`);
        if (testMsgs && testMsgs.length > 0) {
          methodUsed = 'getMessages';
          try {
            const sample = testMsgs.slice(0,3).map(m => `${m.id || m.message?.id || 'id?'}@${m.date ? new Date(m.date * 1000).toISOString() : 'no-date'}`);
            logger.info(`🔍 getMessages sample: ${sample.join(', ')}`);
          } catch (e) {
            // ignore sample formatting errors
          }
        }
      } catch (e) {
        logger.warn('getMessages test failed:', e.message || e);
      }
    }

    if ((!testMsgs || testMsgs.length === 0) && typeof this.client.iterMessages === 'function') {
      try {
        let i = 0;
        for await (const m of this.client.iterMessages(entity, { limit: 3 })) {
          if (!m) continue;
          testMsgs.push(m);
          i++;
          if (i >= 3) break;
        }
        logger.info(`🔍 iterMessages test yielded ${testMsgs.length} messages`);
        if (testMsgs && testMsgs.length > 0) {
          methodUsed = 'iterMessages';
          try {
            const sample2 = testMsgs.slice(0,3).map(m => `${m.id || m.message?.id || 'id?'}@${m.date ? new Date(m.date * 1000).toISOString() : 'no-date'}`);
            logger.info(`🔍 iterMessages sample: ${sample2.join(', ')}`);
          } catch (e) {
            // ignore
          }
        }
      } catch (e) {
        logger.warn('iterMessages test failed:', e.message || e);
      }
    }

    if (!testMsgs || testMsgs.length === 0) {
      logger.warn(`No messages visible to MTProto session for ${channel.channel_name || channel.channel_id}. Ensure the burner account is joined or the channel is public.`);
      logger.info(`🔎 Backfill summary for ${channel.channel_name || channel.channel_id}: scanned=0, added=0, skippedProcessed=0, skippedEmpty=0, latest=N/A, earliest=N/A`);
      logger.info(`✅ Backfill complete for ${channel.channel_name || channel.channel_id} — 0 new offers added`);
      return 0;
    }

    // Counters for diagnostics
    let scanned = 0;
    let added = 0;
    let skippedProcessed = 0;
    let skippedEmpty = 0;
    let latestDate = null;
    let earliestDate = null;

    try {
      // Use the method that worked in the test
      if (methodUsed === 'iterMessages' && typeof this.client.iterMessages === 'function') {
        logger.debug(`Using iterMessages for real fetch (${channel.channel_name})`);
        for await (const msg of this.client.iterMessages(entity, { limit: 100 })) {
          if (!msg) continue;
          // msg.date is Unix seconds from GramJS
          if (msg.date < dateLimitSec) break;

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
          const isProcessed = db.isProcessed(messageId);
          if (isProcessed) {
            skippedProcessed++;
            continue;
          }

          const offer = {
            message_id: messageId,
            channel_id: channel.channel_id || (entity && entity.id) || 0,
            channel_name: channel.channel_name || (entity && (entity.title || entity.username)) || 'Unknown',
            raw_text: rawText,
            created_at: new Date(msg.date * 1000),
          };

          const insertResult = db.insertOffer(offer);
          db.markProcessed(messageId, offer.channel_id);
          if (insertResult && insertResult.id && analysisQueue) {
            analysisQueue.enqueue(insertResult.id, 'low');
          }
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
      } else if (methodUsed === 'getMessages' || typeof this.client.getMessages === 'function') {
        // Use getMessages (which worked in the test)
        logger.debug(`Using getMessages for real fetch (${channel.channel_name})`);
        let offsetId = 0;
        const limit = 100;
        let reachedOldMessages = false;
        while (true) {
          const messages = await this.client.getMessages(entity, { limit, offsetId });
          if (!messages || messages.length === 0) break;

          for (const msg of messages) {
            if (!msg) continue;
            // msg.date is Unix seconds; dateLimitSec is also in seconds
            if (msg.date < dateLimitSec) {
              reachedOldMessages = true;
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
            const isProcessed = db.isProcessed(messageId);
            if (isProcessed) {
              skippedProcessed++;
              continue;
            }

            const offer = {
              message_id: messageId,
              channel_id: channel.channel_id || (entity && entity.id) || 0,
              channel_name: channel.channel_name || (entity && (entity.title || entity.username)) || 'Unknown',
              raw_text: rawText,
              created_at: new Date(msg.date * 1000),
            };

            const insertResult = db.insertOffer(offer);
            db.markProcessed(messageId, offer.channel_id);
            if (insertResult && insertResult.id && analysisQueue) {
              analysisQueue.enqueue(insertResult.id, 'low');
            }
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

          if (reachedOldMessages || messages.length < limit) break;
          offsetId = messages[messages.length - 1].id - 1;
          // Pause between pages to avoid flood waits
          await new Promise(resolve => setTimeout(resolve, 3000));
        }
      }

      // Summary diagnostics for this backfill run
      try {
        const latestStr = latestDate ? new Date(latestDate * 1000).toISOString() : 'N/A';
        const earliestStr = earliestDate ? new Date(earliestDate * 1000).toISOString() : 'N/A';
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

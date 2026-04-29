const { workerData, parentPort } = require('worker_threads');
const path = require('path');

// Inject env vars passed from main process
Object.assign(process.env, workerData.env || {});

const BetterSqlite = require('better-sqlite3');

const MIN_MSG_LEN = 20;
const SPAM_KEYWORDS = ['vote', 'like', 'share', 'subscribe'];

function isSpam(text) {
  if (!text || text.trim().length < MIN_MSG_LEN) return true;
  const lower = text.toLowerCase();
  const emojiOnly = /^[\s\p{Emoji}\p{Extended_Pictographic}]+$/u.test(text.trim());
  if (emojiOnly) return true;
  return SPAM_KEYWORDS.some(kw => lower.includes(kw));
}

async function main() {
  const { channelIds = [], dbPath } = workerData;

  // Open DB in WAL mode — safe for concurrent access with main process
  const db = new BetterSqlite(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  const insertStmt = db.prepare(
    'INSERT OR IGNORE INTO pending_review (message_id, channel_id, channel_name, raw_text) VALUES (?, ?, ?, ?)'
  );

  // Strip Bot API -100 prefix to get bare GramJS channel IDs
  const allowedBareIds = new Set(
    channelIds.map(id => parseInt(Math.abs(id).toString().replace(/^100/, ''), 10))
  );

  let TelegramClient, StringSession, NewMessage;
  try {
    ({ TelegramClient } = require('telegram'));
    ({ StringSession } = require('telegram/sessions'));
    ({ NewMessage } = require('telegram/events'));
  } catch (err) {
    parentPort.postMessage({ type: 'error', message: `GramJS not found: ${err.message}` });
    process.exit(1);
  }

  const apiId = parseInt(process.env.API_ID, 10);
  const apiHash = process.env.API_HASH;
  const sessionString = process.env.TELEGRAM_SESSION || '';

  if (!apiId || !apiHash || !sessionString) {
    parentPort.postMessage({ type: 'error', message: 'Missing API_ID/API_HASH/TELEGRAM_SESSION in worker' });
    process.exit(1);
  }

  const session = new StringSession(sessionString);
  const client = new TelegramClient(session, apiId, apiHash, { connectionRetries: 5 });

  try {
    await client.connect();
    parentPort.postMessage({ type: 'ready' });
  } catch (err) {
    parentPort.postMessage({ type: 'error', message: `GramJS connect failed: ${err.message}` });
    process.exit(1);
  }

  client.addEventHandler(async (event) => {
    try {
      const msg = event.message;
      if (!msg) return;

      const rawText = msg.message || msg.caption || '';
      if (isSpam(rawText)) return;

      // Get bare channel ID from GramJS peer
      let channelId;
      if (msg.peerId?.channelId) {
        const raw = msg.peerId.channelId;
        channelId = typeof raw.toJSNumber === 'function' ? raw.toJSNumber() : Number(raw);
      } else if (msg.peerId?.chatId) {
        const raw = msg.peerId.chatId;
        channelId = typeof raw.toJSNumber === 'function' ? raw.toJSNumber() : Number(raw);
      }

      if (!channelId) return;
      if (allowedBareIds.size > 0 && !allowedBareIds.has(channelId)) return;

      let channelName = 'Unknown';
      try {
        const entity = await client.getEntity(channelId);
        channelName = entity.title || entity.username || String(channelId);
      } catch (_) {}

      insertStmt.run(msg.id, channelId, channelName, rawText);
      parentPort.postMessage({ type: 'inserted', messageId: msg.id, channelId });
    } catch (err) {
      parentPort.postMessage({ type: 'error', message: `Handler error: ${err.message}` });
    }
  }, new NewMessage({}));

  // Keep worker alive
  process.on('SIGTERM', async () => {
    await client.disconnect();
    db.close();
    process.exit(0);
  });
}

main().catch(err => {
  parentPort.postMessage({ type: 'error', message: err.message });
  process.exit(1);
});

const crypto = require('crypto');

const FLOW_TTL_MS = 5 * 60 * 1000;
const STASH_TTL_MS = 2 * 60 * 1000;
const STASH_MAX = 200;

// { chatId -> { intent, expiresAt, timer } }
const flows = new Map();

// { id -> { text, expiresAt } }
const stash = new Map();

function set(chatId, intent, ttlMs = FLOW_TTL_MS) {
  const existing = flows.get(chatId);
  if (existing) clearTimeout(existing.timer);
  const timer = setTimeout(() => flows.delete(chatId), ttlMs);
  flows.set(chatId, { intent, expiresAt: Date.now() + ttlMs, timer });
}

function get(chatId) {
  const entry = flows.get(chatId);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) { flows.delete(chatId); return null; }
  return entry.intent;
}

function clear(chatId) {
  const entry = flows.get(chatId);
  if (entry) clearTimeout(entry.timer);
  flows.delete(chatId);
}

function stashPendingText(text, ttlMs = STASH_TTL_MS) {
  if (stash.size >= STASH_MAX) {
    const oldest = [...stash.entries()].sort((a, b) => a[1].expiresAt - b[1].expiresAt)[0];
    if (oldest) stash.delete(oldest[0]);
  }
  const id = crypto.randomBytes(4).toString('hex');
  stash.set(id, { text, expiresAt: Date.now() + ttlMs });
  return id;
}

function takePendingText(id) {
  const entry = stash.get(id);
  if (!entry) return null;
  stash.delete(id);
  if (Date.now() > entry.expiresAt) return null;
  return entry.text;
}

function stopAll() {
  for (const entry of flows.values()) clearTimeout(entry.timer);
  flows.clear();
  stash.clear();
}

module.exports = { set, get, clear, stashPendingText, takePendingText, stopAll };

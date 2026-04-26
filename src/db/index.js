const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const logger = require('../utils/logger');
const config = require('../../config/constants');

class Database {
  constructor(dbPath = config.DATABASE_PATH) {
    this.dbPath = dbPath;
    this.db = null;
  }

  /**
   * Initialize database and create tables
   */
  async initialize() {
    return new Promise((resolve, reject) => {
      this.db = new sqlite3.Database(this.dbPath, (err) => {
        if (err) {
          logger.error('Error opening database:', err);
          reject(err);
          return;
        }

        logger.info(`Database initialized at ${this.dbPath}`);
        this.createTables()
          .then(() => resolve())
          .catch(reject);
      });
    });
  }

  /**
   * Execute SQL query
   */
  run(sql, params = []) {
    return new Promise((resolve, reject) => {
      this.db.run(sql, params, function(err) {
        if (err) {
          logger.error(`SQL Error: ${sql}`, err);
          reject(err);
        } else {
          resolve({ id: this.lastID, changes: this.changes });
        }
      });
    });
  }

  /**
   * Get single row
   */
  get(sql, params = []) {
    return new Promise((resolve, reject) => {
      this.db.get(sql, params, (err, row) => {
        if (err) {
          logger.error(`SQL Error: ${sql}`, err);
          reject(err);
        } else {
          resolve(row);
        }
      });
    });
  }

  /**
   * Get all rows
   */
  all(sql, params = []) {
    return new Promise((resolve, reject) => {
      this.db.all(sql, params, (err, rows) => {
        if (err) {
          logger.error(`SQL Error: ${sql}`, err);
          reject(err);
        } else {
          resolve(rows || []);
        }
      });
    });
  }

  /**
   * Create all necessary tables
   */
  async createTables() {
    const tables = [
      // Interests table
      `CREATE TABLE IF NOT EXISTS interests (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        keyword TEXT NOT NULL UNIQUE,
        category TEXT NOT NULL,
        confidence_threshold INTEGER DEFAULT 70,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`,

      // Offers table
      `CREATE TABLE IF NOT EXISTS offers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        message_id INTEGER NOT NULL UNIQUE,
        channel_id INTEGER NOT NULL,
        channel_name TEXT,
        raw_text TEXT NOT NULL,
        summary TEXT,
        matched_interests TEXT,
        confidence_score FLOAT,
        category TEXT,
        status TEXT DEFAULT 'pending',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        processed_at DATETIME
      )`,

      // Processed messages (deduplication)
      `CREATE TABLE IF NOT EXISTS processed_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        message_id INTEGER NOT NULL UNIQUE,
        channel_id INTEGER NOT NULL,
        processed_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`,

      // User feedback
      `CREATE TABLE IF NOT EXISTS feedback (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        offer_id INTEGER NOT NULL,
        rating TEXT CHECK(rating IN ('useful', 'spam', 'irrelevant')),
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(offer_id) REFERENCES offers(id)
      )`,

      // Channels tracking
      `CREATE TABLE IF NOT EXISTS channels (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        channel_id INTEGER NOT NULL UNIQUE,
        channel_name TEXT NOT NULL,
        channel_username TEXT,
        subscribed_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`,
    ];

    for (const table of tables) {
      try {
        await this.run(table);
      } catch (err) {
        if (!err.message.includes('already exists')) {
          throw err;
        }
      }
    }

    // Create indexes
    const indexes = [
      'CREATE INDEX IF NOT EXISTS idx_offers_status ON offers(status)',
      'CREATE INDEX IF NOT EXISTS idx_offers_category ON offers(category)',
      'CREATE INDEX IF NOT EXISTS idx_offers_created_at ON offers(created_at)',
      'CREATE INDEX IF NOT EXISTS idx_interests_keyword ON interests(keyword)',
      'CREATE INDEX IF NOT EXISTS idx_processed_msg_id ON processed_messages(message_id)',
    ];

    for (const index of indexes) {
      try {
        await this.run(index);
      } catch (err) {
        if (!err.message.includes('already exists')) {
          throw err;
        }
      }
    }

    logger.info('✅ Database tables and indexes created');

    // Ensure channels table has channel_username column (migration for older DBs)
    try {
      const cols = await this.all("PRAGMA table_info(channels)");
      const hasUsername = cols.some(c => c.name === 'channel_username');
      if (!hasUsername) {
        await this.run("ALTER TABLE channels ADD COLUMN channel_username TEXT");
        logger.info('Added channel_username column to channels table (migration)');
      }
    } catch (err) {
      logger.debug('Channels migration check failed:', err.message || err);
    }
  }

  /**
   * Insert a new offer
   */
  async insertOffer(offer) {
    const sql = `
      INSERT INTO offers (message_id, channel_id, channel_name, raw_text, status)
      VALUES (?, ?, ?, ?, 'pending')
    `;
    const result = await this.run(sql, [
      offer.message_id,
      offer.channel_id,
      offer.channel_name,
      offer.raw_text,
    ]);

    try {
      const raw = offer.raw_text || '';
      const firstLine = (raw.split('\n').find(l => l && l.trim()) || raw).trim();
      const shortTitle = firstLine.replace(/\s+/g, ' ').slice(0, 80);
      const channel = offer.channel_name || offer.channel_id || 'unknown-channel';
      logger.info(`🆕 New offer: ${channel} — ${shortTitle}`);
    } catch (err) {
      logger.debug('Failed to log new offer summary', err);
    }

    return result;
  }

  /**
   * Update offer with analysis results
   */
  async updateOffer(offerId, updates) {
    const fields = Object.keys(updates)
      .map(key => `${key} = ?`)
      .join(', ');
    const values = Object.values(updates);

    const sql = `UPDATE offers SET ${fields}, processed_at = CURRENT_TIMESTAMP WHERE id = ?`;
    return this.run(sql, [...values, offerId]);
  }

  /**
   * Get all pending offers
   */
  async getPendingOffers() {
    const sql = 'SELECT * FROM offers WHERE status = ?';
    return this.all(sql, ['pending']);
  }

  /**
   * Get offers by status
   */
  async getOffersByStatus(status) {
    const sql = 'SELECT * FROM offers WHERE status = ? ORDER BY created_at DESC';
    return this.all(sql, [status]);
  }

  /**
   * Check if message already processed
   */
  async isProcessed(messageId) {
    const sql = 'SELECT id FROM processed_messages WHERE message_id = ?';
    const row = await this.get(sql, [messageId]);
    return !!row;
  }

  /**
   * Mark message as processed
   */
  async markProcessed(messageId, channelId) {
    const sql = 'INSERT OR IGNORE INTO processed_messages (message_id, channel_id) VALUES (?, ?)';
    return this.run(sql, [messageId, channelId]);
  }

  /**
   * Insert interest
   */
  async insertInterest(keyword, category, confidence_threshold = 70) {
    const sql = `
      INSERT INTO interests (keyword, category, confidence_threshold)
      VALUES (?, ?, ?)
    `;
    return this.run(sql, [keyword, category, confidence_threshold]);
  }

  /**
   * Get all interests
   */
  async getAllInterests() {
    const sql = 'SELECT * FROM interests ORDER BY category, keyword';
    return this.all(sql);
  }

  /**
   * Get interests by category
   */
  async getInterestsByCategory(category) {
    const sql = 'SELECT * FROM interests WHERE category = ?';
    return this.all(sql, [category]);
  }

  /**
   * Remove interest
   */
  async removeInterest(keyword) {
    const sql = 'DELETE FROM interests WHERE keyword = ?';
    return this.run(sql, [keyword]);
  }

  /**
   * Search offers by keyword in summary or raw_text
   */
  async searchOffers(query) {
    const sql = `
      SELECT * FROM offers 
      WHERE status = 'processed' 
      AND (raw_text LIKE ? OR summary LIKE ?)
      ORDER BY created_at DESC
      LIMIT 50
    `;
    const searchTerm = `%${query}%`;
    return this.all(sql, [searchTerm, searchTerm]);
  }

  /**
   * Delete old offers (older than OFFER_RETENTION_DAYS)
   */
  async deleteOldOffers() {
    const sql = `
      DELETE FROM offers
      WHERE status = 'processed'
      AND created_at < datetime('now', '-' || ? || ' days')
    `;
    const result = await this.run(sql, [config.OFFER_RETENTION_DAYS]);
    logger.info(`🧹 Cleaned up ${result.changes} old offers`);
    return result;
  }

  /**
   * Add feedback to offer
   */
  async addFeedback(offerId, rating) {
    const sql = 'INSERT INTO feedback (offer_id, rating) VALUES (?, ?)';
    return this.run(sql, [offerId, rating]);
  }

  /**
   * Get statistics
   */
  async getStats() {
    const stats = {};

    stats.total_offers = await this.get('SELECT COUNT(*) as count FROM offers');
    stats.processed_offers = await this.get('SELECT COUNT(*) as count FROM offers WHERE status = ?', ['processed']);
    stats.pending_offers = await this.get('SELECT COUNT(*) as count FROM offers WHERE status = ?', ['pending']);
    stats.interests_count = await this.get('SELECT COUNT(*) as count FROM interests');
    stats.categories = await this.all('SELECT DISTINCT category FROM interests ORDER BY category');

    return stats;
  }

  /**
   * Close database connection
   */
  async close() {
    return new Promise((resolve, reject) => {
      if (this.db) {
        this.db.close((err) => {
          if (err) {
            logger.error('Error closing database:', err);
            reject(err);
          } else {
            logger.info('Database closed');
            resolve();
          }
        });
      } else {
        resolve();
      }
    });
  }
}

module.exports = Database;

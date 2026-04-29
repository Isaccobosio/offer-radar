const BetterSqlite = require('better-sqlite3');
const logger = require('../utils/logger');
const config = require('../../config/constants');
const { TAXONOMY, CategoryMapper } = require('./categories');

function parsePriceCents(priceStr) {
  if (!priceStr || typeof priceStr !== 'string') return null;
  let s = priceStr.replace(/[€$£\s]/g, '');
  if (s.includes(',')) {
    s = s.replace(/\./g, '').replace(',', '.');
  }
  const match = s.match(/[\d.]+/);
  if (!match) return null;
  const val = parseFloat(match[0]);
  return isNaN(val) ? null : Math.round(val * 100);
}

class Database {
  constructor(dbPath = config.DATABASE_PATH) {
    this.db = new BetterSqlite(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.ftsAvailable = false;
    this.categoryMapper = new CategoryMapper();
  }

  async initialize() {
    logger.info(`Database initialized at ${config.DATABASE_PATH}`);
    this._createTables();
    this._runMigrations();
    logger.info('✅ Database tables and indexes created');
  }

  // ── Core query helpers (synchronous) ────────────────────────────────────────

  run(sql, params = []) {
    try {
      const result = this.db.prepare(sql).run(...params);
      return { id: result.lastInsertRowid, changes: result.changes };
    } catch (err) {
      logger.error(`SQL Error: ${sql}`, err.message);
      throw err;
    }
  }

  get(sql, params = []) {
    try {
      return this.db.prepare(sql).get(...params);
    } catch (err) {
      logger.error(`SQL Error: ${sql}`, err.message);
      throw err;
    }
  }

  all(sql, params = []) {
    try {
      return this.db.prepare(sql).all(...params) || [];
    } catch (err) {
      logger.error(`SQL Error: ${sql}`, err.message);
      throw err;
    }
  }

  // ── Schema ──────────────────────────────────────────────────────────────────

  _createTables() {
    const tables = [
      `CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        telegram_id INTEGER NOT NULL UNIQUE,
        username TEXT,
        first_name TEXT,
        is_active INTEGER DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`,

      `CREATE TABLE IF NOT EXISTS interests (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        keyword TEXT NOT NULL,
        category TEXT NOT NULL,
        description TEXT,
        confidence_threshold INTEGER DEFAULT 50,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, keyword)
      )`,

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
        category_id INTEGER,
        product_name TEXT,
        brand TEXT,
        price TEXT,
        price_cents INTEGER,
        tags TEXT,
        status TEXT DEFAULT 'pending',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        processed_at DATETIME
      )`,

      `CREATE TABLE IF NOT EXISTS processed_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        message_id INTEGER NOT NULL UNIQUE,
        channel_id INTEGER NOT NULL,
        processed_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`,

      `CREATE TABLE IF NOT EXISTS feedback (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        offer_id INTEGER NOT NULL,
        user_id INTEGER,
        rating TEXT CHECK(rating IN ('useful', 'spam', 'irrelevant')),
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(offer_id) REFERENCES offers(id)
      )`,

      `CREATE TABLE IF NOT EXISTS channels (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        channel_id INTEGER NOT NULL UNIQUE,
        channel_name TEXT NOT NULL,
        channel_username TEXT,
        subscribed_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`,

      `CREATE TABLE IF NOT EXISTS channel_requests (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        channel_id INTEGER NOT NULL,
        channel_name TEXT NOT NULL,
        channel_username TEXT,
        requested_by_id INTEGER NOT NULL,
        requested_by_name TEXT,
        status TEXT NOT NULL DEFAULT 'pending',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`,

      `CREATE TABLE IF NOT EXISTS categories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        slug TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        parent_slug TEXT,
        display_order INTEGER DEFAULT 0
      )`,

      `CREATE TABLE IF NOT EXISTS offer_tags (
        offer_id INTEGER NOT NULL,
        tag TEXT NOT NULL,
        tag_type TEXT NOT NULL CHECK(tag_type IN ('interest', 'category', 'brand')),
        PRIMARY KEY (offer_id, tag, tag_type)
      )`,

      // Phase 2: staging table for GramJS worker
      `CREATE TABLE IF NOT EXISTS pending_review (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        message_id INTEGER NOT NULL,
        channel_id INTEGER NOT NULL,
        channel_name TEXT,
        raw_text TEXT NOT NULL,
        received_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(message_id, channel_id)
      )`,

      // Phase 4: 🔥/🌀 feedback (separate from legacy feedback table)
      `CREATE TABLE IF NOT EXISTS user_feedback (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        offer_id INTEGER NOT NULL,
        user_id INTEGER NOT NULL,
        rating TEXT NOT NULL CHECK(rating IN ('spot_on', 'not_for_me')),
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(offer_id) REFERENCES offers(id),
        UNIQUE(offer_id, user_id)
      )`,

      `CREATE TABLE IF NOT EXISTS favorites (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        offer_id INTEGER NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, offer_id),
        FOREIGN KEY(offer_id) REFERENCES offers(id)
      )`,
    ];

    for (const sql of tables) {
      try { this.run(sql); } catch (err) {
        if (!err.message.includes('already exists')) throw err;
      }
    }

    const indexes = [
      'CREATE INDEX IF NOT EXISTS idx_offers_status ON offers(status)',
      'CREATE INDEX IF NOT EXISTS idx_offers_category ON offers(category)',
      'CREATE INDEX IF NOT EXISTS idx_offers_category_id ON offers(category_id)',
      'CREATE INDEX IF NOT EXISTS idx_offers_created_at ON offers(created_at)',
      'CREATE INDEX IF NOT EXISTS idx_interests_keyword ON interests(keyword)',
      'CREATE INDEX IF NOT EXISTS idx_processed_msg_id ON processed_messages(message_id)',
      'CREATE INDEX IF NOT EXISTS idx_offer_tags_tag ON offer_tags(tag)',
      'CREATE INDEX IF NOT EXISTS idx_offer_tags_offer ON offer_tags(offer_id)',
      'CREATE INDEX IF NOT EXISTS idx_pending_review_received ON pending_review(received_at)',
      'CREATE INDEX IF NOT EXISTS idx_user_feedback_offer ON user_feedback(offer_id)',
    ];
    for (const sql of indexes) {
      try { this.run(sql); } catch (_) {}
    }

    this._initFts();
  }

  _initFts() {
    try {
      const existing = this.get(`SELECT sql FROM sqlite_master WHERE type='table' AND name='offers_fts'`);
      if (!existing) {
        this.run(`CREATE VIRTUAL TABLE IF NOT EXISTS offers_fts USING fts5(
          brand,
          clean_title,
          keywords,
          summary,
          raw_text,
          tokenize='unicode61 remove_diacritics 1'
        )`);
        this.ftsNewSchema = true;
      } else {
        this.ftsNewSchema = existing.sql.includes('clean_title');
      }
      this.ftsAvailable = true;
      logger.info(`✅ FTS5 index ready (schema: ${this.ftsNewSchema ? 'new' : 'legacy'})`);
    } catch (err) {
      logger.warn('FTS5 not available — falling back to LIKE search:', err.message);
      this.ftsAvailable = false;
      this.ftsNewSchema = false;
    }
  }

  _runMigrations() {
    // 1. channels: add channel_username
    try {
      const cols = this.all('PRAGMA table_info(channels)');
      if (!cols.some(c => c.name === 'channel_username')) {
        this.run('ALTER TABLE channels ADD COLUMN channel_username TEXT');
        logger.info('Migration: added channel_username to channels');
      }
    } catch (err) { logger.debug('channels migration:', err.message); }

    // 2. interests: migrate from old schema (UNIQUE keyword) to UNIQUE(user_id, keyword)
    try {
      const cols = this.all('PRAGMA table_info(interests)');
      if (!cols.some(c => c.name === 'user_id')) {
        logger.info('Migration: recreating interests table with user_id...');
        const ownerId = config.MAIN_ACCOUNT_ID || null;
        this.run(`CREATE TABLE interests_v2 (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER,
          keyword TEXT NOT NULL,
          category TEXT NOT NULL,
          description TEXT,
          confidence_threshold INTEGER DEFAULT 50,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(user_id, keyword)
        )`);
        this.run(
          `INSERT INTO interests_v2 SELECT id, ?, keyword, category, description, confidence_threshold, created_at FROM interests`,
          [ownerId]
        );
        this.run('DROP TABLE interests');
        this.run('ALTER TABLE interests_v2 RENAME TO interests');
        logger.info('Migration: interests table updated');
      }
    } catch (err) { logger.warn('interests migration failed:', err.message); }

    // 3. interests: add description column if still missing
    try {
      const cols = this.all('PRAGMA table_info(interests)');
      if (!cols.some(c => c.name === 'description')) {
        this.run('ALTER TABLE interests ADD COLUMN description TEXT');
        logger.info('Migration: added description to interests');
      }
    } catch (err) { logger.debug('interests description migration:', err.message); }

    // 4. Auto-register owner in users table
    if (config.MAIN_ACCOUNT_ID) {
      try {
        this.run(
          `INSERT OR IGNORE INTO users (telegram_id, username, first_name) VALUES (?, 'owner', 'Owner')`,
          [config.MAIN_ACCOUNT_ID]
        );
      } catch (_) {}
    }

    // 5. Reset offers whose summary is a stored error message back to pending
    try {
      const result = this.run(
        `UPDATE offers SET status = 'pending', summary = NULL, confidence_score = NULL,
         matched_interests = NULL, category = NULL, processed_at = NULL
         WHERE summary LIKE 'Error:%'`
      );
      if (result.changes > 0) {
        logger.info(`Migration: reset ${result.changes} offers with error summaries back to pending`);
      }
    } catch (err) { logger.debug('error-summary reset migration:', err.message); }

    // 6. Add new columns to offers
    try {
      const cols = this.all('PRAGMA table_info(offers)');
      const existing = new Set(cols.map(c => c.name));
      const newCols = [
        ['product_name', 'TEXT'],
        ['brand',        'TEXT'],
        ['price',        'TEXT'],
        ['price_cents',  'INTEGER'],
        ['category_id',  'INTEGER'],
        ['tags',         'TEXT'],
      ];
      for (const [col, type] of newCols) {
        if (!existing.has(col)) {
          this.run(`ALTER TABLE offers ADD COLUMN ${col} ${type}`);
          logger.info(`Migration: added ${col} to offers`);
        }
      }
    } catch (err) { logger.warn('offers column migration failed:', err.message); }

    // 7. Seed categories taxonomy
    try {
      const count = this.get('SELECT COUNT(*) as n FROM categories');
      if (!count || count.n === 0) {
        for (const cat of TAXONOMY) {
          this.run(
            `INSERT OR IGNORE INTO categories (slug, name, parent_slug, display_order) VALUES (?, ?, ?, ?)`,
            [cat.slug, cat.name, cat.parent_slug, cat.display_order]
          );
        }
        logger.info(`Migration: seeded ${TAXONOMY.length} categories`);
      }
    } catch (err) { logger.warn('categories seed migration failed:', err.message); }

    // 8. Backfill category_id from existing category TEXT
    try {
      const offers = this.all(
        `SELECT id, category FROM offers WHERE category IS NOT NULL AND category_id IS NULL`
      );
      let backfilled = 0;
      for (const offer of offers) {
        const id = this._resolveCategoryId(offer.category);
        if (id) {
          this.run('UPDATE offers SET category_id = ? WHERE id = ?', [id, offer.id]);
          backfilled++;
        }
      }
      if (backfilled > 0) logger.info(`Migration: backfilled category_id for ${backfilled} offers`);
    } catch (err) { logger.warn('category_id backfill failed:', err.message); }

    // 9. Backfill offer_tags from matched_interests
    try {
      const offers = this.all(
        `SELECT id, matched_interests, category FROM offers WHERE matched_interests IS NOT NULL`
      );
      let backfilled = 0;
      for (const offer of offers) {
        const existing = this.get('SELECT COUNT(*) as n FROM offer_tags WHERE offer_id = ?', [offer.id]);
        if (existing && existing.n > 0) continue;
        try {
          const interests = JSON.parse(offer.matched_interests || '[]');
          this._syncOfferTags(offer.id, interests, offer.category);
          backfilled++;
        } catch (_) {}
      }
      if (backfilled > 0) logger.info(`Migration: backfilled offer_tags for ${backfilled} offers`);
    } catch (err) { logger.warn('offer_tags backfill failed:', err.message); }

    // 10. Backfill FTS from existing offers
    if (this.ftsAvailable) {
      try {
        const total = this.get('SELECT COUNT(*) as n FROM offers');
        const indexed = this.get('SELECT COUNT(*) as n FROM offers_fts');
        if (total && indexed && total.n > indexed.n) {
          const offers = this.all('SELECT id FROM offers');
          const inFts = new Set(this.all('SELECT rowid FROM offers_fts').map(r => r.rowid));
          let count = 0;
          for (const offer of offers) {
            if (!inFts.has(offer.id)) {
              try { this._syncOfferFts(offer.id); } catch (_) {}
              count++;
            }
          }
          if (count > 0) logger.info(`Migration: indexed ${count} offers in FTS5`);
        }
      } catch (err) { logger.warn('FTS backfill failed:', err.message); }
    }

    // 11. Rebuild FTS if product_name column is missing (schema upgrade)
    if (this.ftsAvailable) {
      try {
        const ftsRow = this.get(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'offers_fts'`);
        if (ftsRow && ftsRow.sql && !ftsRow.sql.includes('product_name') && !ftsRow.sql.includes('clean_title')) {
          logger.info('Migration: rebuilding FTS with product_name column...');
          this.run('DROP TABLE IF EXISTS offers_fts');
          this._initFts();
          const offers = this.all('SELECT id FROM offers');
          for (const o of offers) {
            try { this._syncOfferFts(o.id); } catch (_) {}
          }
          logger.info(`Migration: FTS rebuilt and indexed ${offers.length} offers`);
        }
      } catch (err) { logger.warn('FTS rebuild migration failed:', err.message); }
    }

    // 12. Add structured metadata columns to offers
    try {
      const cols = this.all('PRAGMA table_info(offers)');
      const existing = new Set(cols.map(c => c.name));
      const newCols = [
        ['model',        'TEXT'],
        ['clean_title',  'TEXT'],
        ['is_accessory', 'INTEGER'],
        ['slug',         'TEXT'],
        ['keywords',     'TEXT'],
      ];
      for (const [col, type] of newCols) {
        if (!existing.has(col)) {
          this.run(`ALTER TABLE offers ADD COLUMN ${col} ${type}`);
          logger.info(`Migration: added ${col} to offers`);
        }
      }
      try {
        this.run('CREATE UNIQUE INDEX IF NOT EXISTS idx_offers_slug ON offers(slug) WHERE slug IS NOT NULL');
      } catch (_) {}
    } catch (err) { logger.warn('structured metadata migration failed:', err.message); }

    // 13. Rebuild FTS with new schema (brand, clean_title, keywords, summary, raw_text)
    if (this.ftsAvailable) {
      try {
        const ftsRow = this.get(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'offers_fts'`);
        if (ftsRow && ftsRow.sql && !ftsRow.sql.includes('clean_title')) {
          logger.info('Migration: rebuilding FTS with structured metadata columns...');
          this.run('DROP TABLE IF EXISTS offers_fts');
          this.run(`CREATE VIRTUAL TABLE offers_fts USING fts5(
            brand, clean_title, keywords, summary, raw_text,
            tokenize='unicode61 remove_diacritics 1'
          )`);
          this.ftsNewSchema = true;
          const offers = this.all('SELECT id FROM offers');
          for (const o of offers) {
            try { this._syncOfferFts(o.id); } catch (_) {}
          }
          logger.info(`Migration: FTS rebuilt with new schema, indexed ${offers.length} offers`);
        }
      } catch (err) { logger.warn('FTS schema rebuild migration failed:', err.message); }
    }

    // 14. Add price-drop and image columns to offers
    try {
      const cols = this.all('PRAGMA table_info(offers)');
      const existing = new Set(cols.map(c => c.name));
      const newCols = [
        ['original_price',      'TEXT'],
        ['original_price_cents', 'INTEGER'],
        ['price_drop_percentage', 'REAL'],
        ['image_url',           'TEXT'],
      ];
      for (const [col, type] of newCols) {
        if (!existing.has(col)) {
          this.run(`ALTER TABLE offers ADD COLUMN ${col} ${type}`);
          logger.info(`Migration: added ${col} to offers`);
        }
      }
    } catch (err) { logger.warn('price-drop columns migration failed:', err.message); }

    // 15. Add weight column to interests
    try {
      const cols = this.all('PRAGMA table_info(interests)');
      if (!cols.some(c => c.name === 'weight')) {
        this.run('ALTER TABLE interests ADD COLUMN weight INTEGER NOT NULL DEFAULT 100');
        logger.info('Migration: added weight to interests');
      }
    } catch (err) { logger.warn('interests weight migration failed:', err.message); }

    // 16. Reset processed offers missing structured metadata back to pending for re-analysis
    // Old offers were analyzed with a schema that didn't return brand/clean_title/keywords,
    // so digest keyword/brand joins fail for them. Re-pending lets the current LLM fill them in.
    try {
      const result = this.run(
        `UPDATE offers SET status = 'pending'
         WHERE status = 'processed' AND clean_title IS NULL AND brand IS NULL AND keywords IS NULL`
      );
      if (result.changes > 0) {
        logger.info(`Migration: reset ${result.changes} processed offers (missing structured metadata) back to pending`);
      }
    } catch (err) { logger.warn('structured-metadata reset migration failed:', err.message); }
  }

  // ── FTS helpers ─────────────────────────────────────────────────────────────

  _syncOfferFts(offerId) {
    if (!this.ftsAvailable) return;
    try {
      const offer = this.get('SELECT * FROM offers WHERE id = ?', [offerId]);
      if (!offer) return;
      this.run('DELETE FROM offers_fts WHERE rowid = ?', [offerId]);
      if (this.ftsNewSchema) {
        this.run(
          `INSERT INTO offers_fts(rowid, brand, clean_title, keywords, summary, raw_text)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [offerId, offer.brand || '', offer.clean_title || offer.product_name || '',
           offer.keywords || '', offer.summary || '', offer.raw_text || '']
        );
      } else {
        const tagRows = this.all('SELECT tag FROM offer_tags WHERE offer_id = ?', [offerId]);
        const tags = tagRows.map(t => t.tag).join(' ');
        this.run(
          `INSERT INTO offers_fts(rowid, product_name, summary, channel_name, category_name, tags, raw_text)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [offerId, offer.product_name || '', offer.summary || '', offer.channel_name || '',
           offer.category || '', tags, offer.raw_text || '']
        );
      }
    } catch (err) {
      logger.debug('FTS sync failed for offer', offerId, err.message);
    }
  }

  _syncOfferTags(offerId, matchedInterests = [], rawCategory = null) {
    try {
      this.run(`DELETE FROM offer_tags WHERE offer_id = ? AND tag_type = 'interest'`, [offerId]);
      for (const kw of matchedInterests) {
        const tag = String(kw).toLowerCase().trim();
        if (tag) {
          this.run(
            `INSERT OR IGNORE INTO offer_tags (offer_id, tag, tag_type) VALUES (?, ?, 'interest')`,
            [offerId, tag]
          );
        }
      }

      if (rawCategory) {
        this.run(`DELETE FROM offer_tags WHERE offer_id = ? AND tag_type = 'category'`, [offerId]);
        const slug = this.categoryMapper.map(rawCategory);
        const tag = slug || rawCategory.toLowerCase().trim();
        this.run(
          `INSERT OR IGNORE INTO offer_tags (offer_id, tag, tag_type) VALUES (?, ?, 'category')`,
          [offerId, tag]
        );
      }
    } catch (err) {
      logger.debug('offer_tags sync failed for offer', offerId, err.message);
    }
  }

  _resolveCategoryId(rawCategory) {
    if (!rawCategory) return null;
    const slug = this.categoryMapper.map(rawCategory);
    if (!slug) return null;
    const row = this.get('SELECT id FROM categories WHERE slug = ?', [slug]);
    return row ? row.id : null;
  }

  // ── Users ───────────────────────────────────────────────────────────────────

  upsertUser(telegramId, username, firstName) {
    this.run(
      `INSERT INTO users (telegram_id, username, first_name)
       VALUES (?, ?, ?)
       ON CONFLICT(telegram_id) DO UPDATE SET username=excluded.username, first_name=excluded.first_name`,
      [telegramId, username || null, firstName || null]
    );
    return this.get('SELECT * FROM users WHERE telegram_id = ?', [telegramId]);
  }

  getAllActiveUsers() {
    return this.all('SELECT * FROM users WHERE is_active = 1');
  }

  // ── Interests ───────────────────────────────────────────────────────────────

  insertInterest(userId, keyword, category, description = null, confidence_threshold = 50) {
    return this.run(
      `INSERT INTO interests (user_id, keyword, category, description, confidence_threshold) VALUES (?, ?, ?, ?, ?)`,
      [userId, keyword, category, description, confidence_threshold]
    );
  }

  getAllInterests(userId = null) {
    if (userId == null) {
      return this.all('SELECT * FROM interests ORDER BY category, keyword');
    }
    return this.all(
      'SELECT * FROM interests WHERE user_id = ? ORDER BY category, keyword',
      [userId]
    );
  }

  getInterestsByCategory(userId, category) {
    return this.all('SELECT * FROM interests WHERE user_id = ? AND category = ?', [userId, category]);
  }

  removeInterest(userId, keyword) {
    return this.run('DELETE FROM interests WHERE user_id = ? AND keyword = ?', [userId, keyword]);
  }

  requeueRejectedByKeyword(keyword, days = 7) {
    const result = this.run(
      `UPDATE offers SET status = 'pending'
       WHERE status = 'rejected'
         AND created_at > datetime('now', '-' || ? || ' days')
         AND LOWER(raw_text) LIKE LOWER(?)`,
      [days, `%${keyword}%`]
    );
    return result.changes;
  }

  updateInterestDescription(userId, keyword, description) {
    return this.run(
      'UPDATE interests SET description = ? WHERE user_id = ? AND keyword = ?',
      [description, userId, keyword]
    );
  }

  // ── Offers ──────────────────────────────────────────────────────────────────

  insertOffer(offer) {
    const result = this.run(
      `INSERT INTO offers (message_id, channel_id, channel_name, raw_text, status)
       VALUES (?, ?, ?, ?, 'pending')`,
      [offer.message_id, offer.channel_id, offer.channel_name, offer.raw_text]
    );
    logger.info(`🆕 Queued: ${offer.channel_name || offer.channel_id} — ${(offer.raw_text || '').slice(0, 60)}`);
    return result;
  }

  upsertOfferBySlug(offerId, fields, ttlSeconds = config.SLUG_DEDUP_TTL_SECONDS) {
    const { slug } = fields;
    if (slug) {
      const existing = this.get(
        `SELECT id FROM offers WHERE slug = ? AND id != ? AND created_at > datetime('now', '-' || ? || ' seconds') ORDER BY created_at DESC LIMIT 1`,
        [slug, offerId, ttlSeconds]
      );
      if (existing) {
        const cents = fields.price_cents || (fields.price ? parsePriceCents(fields.price) : null);
        this.run(
          `UPDATE offers SET price = ?, price_cents = ?, processed_at = CURRENT_TIMESTAMP WHERE id = ?`,
          [fields.price || null, cents, existing.id]
        );
        this._syncOfferFts(existing.id);
        this.run(`UPDATE offers SET status = 'duplicate' WHERE id = ?`, [offerId]);
        logger.info(`🔁 Slug dedup: offer ${offerId} merged into ${existing.id} (${slug})`);
        return { id: existing.id, action: 'updated' };
      }
    }
    this.updateOffer(offerId, fields);
    return { id: offerId, action: 'inserted' };
  }

  updateOffer(offerId, updates) {
    const enriched = { ...updates };

    if (updates.category !== undefined) {
      const categoryId = this._resolveCategoryId(updates.category);
      if (categoryId) enriched.category_id = categoryId;
    }

    if (updates.price !== undefined && updates.price_cents === undefined) {
      const cents = parsePriceCents(updates.price);
      if (cents !== null) enriched.price_cents = cents;
    }

    const fields = Object.keys(enriched).map(k => `${k} = ?`).join(', ');
    const result = this.run(
      `UPDATE offers SET ${fields}, processed_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [...Object.values(enriched), offerId]
    );

    if (updates.matched_interests !== undefined) {
      let interests = [];
      try { interests = JSON.parse(updates.matched_interests || '[]'); } catch (_) {}
      this._syncOfferTags(offerId, interests, updates.category);
    }

    this._syncOfferFts(offerId);
    return result;
  }

  getPendingOffers() {
    return this.all("SELECT * FROM offers WHERE status = 'pending'");
  }

  getOffersByStatus(status) {
    return this.all('SELECT * FROM offers WHERE status = ? ORDER BY created_at DESC', [status]);
  }

  // FTS5 search with BM25 ranking; falls back to LIKE if FTS unavailable.
  // Accepts optional pre-parsed {brand, model} from LLM query parser.
  searchOffers(query, parsed = null) {
    if (!this.ftsAvailable) return this._searchOffersLike(query);

    const strip = q => q.replace(/^[""""]+|[""""]+$/g, '').trim();
    const sanitize = w => w.replace(/["*()\-^]/g, '').trim();

    let ftsQuery;
    if (this.ftsNewSchema && parsed && (parsed.brand || parsed.model)) {
      const parts = [];
      if (parsed.brand) parts.push(`brand:"${sanitize(parsed.brand)}"`);
      if (parsed.model) parts.push(`clean_title:"${sanitize(parsed.model)}"`);
      ftsQuery = parts.join(' AND ');
    } else {
      const normalized = strip(query);
      const words = normalized.split(/\s+/).filter(Boolean).map(sanitize).filter(Boolean);
      if (!words.length) return [];
      ftsQuery = words.length > 1 ? `"${words.join(' ')}"*` : `${words[0]}*`;
    }

    const bm25Weights = this.ftsNewSchema
      ? '10.0, 8.0, 6.0, 2.0, 1.0'   // brand, clean_title, keywords, summary, raw_text
      : '10.0, 8.0, 2.0, 2.0, 4.0, 1.0'; // legacy: product_name, summary, channel_name, category_name, tags, raw_text

    const runFts = (ftsQ) => this.all(
      `SELECT o.*, c.channel_username,
              (-bm25(offers_fts, ${bm25Weights})) AS fts_rank
       FROM offers_fts
       JOIN offers o ON o.id = offers_fts.rowid
       LEFT JOIN channels c ON c.channel_id = o.channel_id
       WHERE offers_fts MATCH ?
       ORDER BY COALESCE(o.is_accessory, 0) ASC,
                (-bm25(offers_fts, ${bm25Weights})) DESC,
                o.created_at DESC
       LIMIT 20`,
      [ftsQ]
    );

    try {
      const results = runFts(ftsQuery);
      if (results.length > 0) return results;
      // Fallback to AND-tokenized query if phrase had no results
      if (!parsed) {
        const normalized = strip(query);
        const words = normalized.split(/\s+/).filter(Boolean).map(sanitize).filter(Boolean);
        if (words.length > 1) {
          const andQuery = words.map((w, i) => i === words.length - 1 ? `${w}*` : w).join(' ');
          return runFts(andQuery);
        }
      }
      return results;
    } catch (err) {
      logger.warn('FTS5 search error, falling back:', err.message);
      return this._searchOffersLike(query);
    }
  }

  _searchOffersLike(query) {
    const words = query.trim().split(/\s+/).filter(Boolean);
    if (!words.length) return [];

    const params = [];
    const phraseBonus = words.length > 1
      ? `CASE WHEN o.raw_text LIKE ? OR o.summary LIKE ? THEN 1 ELSE 0 END DESC,`
      : '';
    if (words.length > 1) params.push(`%${query}%`, `%${query}%`);

    const wordConditions = words.map(word => {
      const stem = word.length > 4 ? word.replace(/[aeiouàèéìíîòóùú]$/i, '') : null;
      const validStem = stem && stem !== word && stem.length >= 3 ? stem : null;

      params.push(`%${word}%`, `%${word}%`);
      const clauses = [`o.raw_text LIKE ?`, `o.summary LIKE ?`];

      if (validStem) {
        params.push(`%${validStem}%`, `%${validStem}%`);
        clauses.push(`o.raw_text LIKE ?`, `o.summary LIKE ?`);
      }

      return `(${clauses.join(' OR ')})`;
    });

    return this.all(
      `SELECT o.*, c.channel_username
       FROM offers o
       LEFT JOIN channels c ON c.channel_id = o.channel_id
       WHERE ${wordConditions.join(' AND ')}
       ORDER BY
         ${phraseBonus}
         CASE WHEN o.confidence_score IS NOT NULL THEN o.confidence_score ELSE -1 END DESC,
         o.created_at DESC
       LIMIT 50`,
      params
    );
  }

  getRecentOffers(limit = 20) {
    return this.all(
      `SELECT o.*, c.channel_username
       FROM offers o
       LEFT JOIN channels c ON c.channel_id = o.channel_id
       ORDER BY o.created_at DESC
       LIMIT ?`,
      [limit]
    );
  }

  getOffersByCategory(slug, limit = 20) {
    return this.all(
      `SELECT o.*, c.channel_username
       FROM offer_tags t
       JOIN offers o ON o.id = t.offer_id
       LEFT JOIN channels c ON c.channel_id = o.channel_id
       WHERE t.tag_type = 'category' AND t.tag LIKE ?
       ORDER BY o.confidence_score DESC, o.created_at DESC
       LIMIT ?`,
      [`${slug}%`, limit]
    );
  }

  // ── Pending review (staging for GramJS worker) ──────────────────────────────

  drainPendingReview(limit = 50) {
    return this.all('SELECT * FROM pending_review ORDER BY received_at ASC LIMIT ?', [limit]);
  }

  deletePendingReviewRow(id) {
    return this.run('DELETE FROM pending_review WHERE id = ?', [id]);
  }

  // ── Processed messages (dedup) ──────────────────────────────────────────────

  isProcessed(messageId) {
    const row = this.get('SELECT id FROM processed_messages WHERE message_id = ?', [messageId]);
    return !!row;
  }

  markProcessed(messageId, channelId) {
    return this.run(
      'INSERT OR IGNORE INTO processed_messages (message_id, channel_id) VALUES (?, ?)',
      [messageId, channelId]
    );
  }

  // ── Cleanup ─────────────────────────────────────────────────────────────────

  deleteOldOffers() {
    const days = config.OFFER_RETENTION_DAYS;
    const offers = this.run(
      `DELETE FROM offers WHERE created_at < datetime('now', '-' || ? || ' days')`,
      [days]
    );
    const msgs = this.run(
      `DELETE FROM processed_messages WHERE processed_at < datetime('now', '-' || ? || ' days')`,
      [days]
    );
    logger.info(`🧹 Cleaned up ${offers.changes} old offers and ${msgs.changes} dedup records`);
    return { offers: offers.changes, messages: msgs.changes };
  }

  // ── Feedback ────────────────────────────────────────────────────────────────

  addFeedback(offerId, userId, rating) {
    return this.run('INSERT INTO feedback (offer_id, user_id, rating) VALUES (?, ?, ?)', [offerId, userId, rating]);
  }

  addUserFeedback(offerId, userId, rating) {
    return this.run(
      'INSERT INTO user_feedback (offer_id, user_id, rating) VALUES (?, ?, ?)',
      [offerId, userId, rating]
    );
  }

  // ── Favorites ───────────────────────────────────────────────────────────────

  addFavorite(userId, offerId) {
    return this.run(
      'INSERT INTO favorites (user_id, offer_id) VALUES (?, ?)',
      [userId, offerId]
    );
  }

  removeFavorite(userId, offerId) {
    return this.run('DELETE FROM favorites WHERE user_id = ? AND offer_id = ?', [userId, offerId]);
  }

  // ── Interest weight (digest dampening) ──────────────────────────────────────

  decrementInterestWeight(userId, brand, categorySlug, step) {
    return this.run(
      `UPDATE interests
       SET weight = MAX(0, weight - ?)
       WHERE user_id = ?
         AND (LOWER(keyword) = LOWER(?) OR category = ?)`,
      [step, userId, brand || '', categorySlug || '']
    );
  }

  // ── Digest candidates ────────────────────────────────────────────────────────

  getDigestCandidatesForUser(userId, { limit = 50, accessoriesAllowed = false } = {}) {
    const accessFlag = accessoriesAllowed ? 1 : 0;
    return this.all(
      `WITH matches AS (
        SELECT o.id AS offer_id,
               i.keyword AS matched_keyword,
               i.weight  AS matched_weight,
               (o.confidence_score * i.weight / 100.0) AS effective_score,
               ROW_NUMBER() OVER (
                 PARTITION BY o.id
                 ORDER BY i.weight DESC, i.id ASC
               ) AS rn
        FROM offers o
        JOIN interests i ON i.user_id = ?
        WHERE o.status = 'processed'
          AND o.confidence_score >= ?
          AND o.confidence_score <  ?
          AND (? OR COALESCE(o.is_accessory, 0) = 0)
          AND i.weight > 0
          AND o.created_at > datetime('now', '-1 day')
          AND (
                LOWER(i.keyword) = LOWER(COALESCE(o.brand, ''))
             OR i.category = o.category
             OR INSTR(LOWER(COALESCE(o.keywords, '')),          LOWER(i.keyword)) > 0
             OR INSTR(LOWER(COALESCE(o.matched_interests, '')), LOWER(i.keyword)) > 0
          )
      )
      SELECT o.*, c.channel_username, m.matched_keyword, m.effective_score
      FROM matches m
      JOIN offers o ON o.id = m.offer_id
      LEFT JOIN channels c ON c.channel_id = o.channel_id
      WHERE m.rn = 1
      ORDER BY m.effective_score DESC,
               COALESCE(o.price_drop_percentage, 0) DESC,
               o.created_at DESC
      LIMIT ?`,
      [userId, config.SCORE_DIGEST_MIN, config.SCORE_INSTANT, accessFlag, limit]
    );
  }

  // ── Stats ───────────────────────────────────────────────────────────────────

  getStats() {
    return {
      total_offers:        this.get('SELECT COUNT(*) as count FROM offers'),
      processed_offers:    this.get("SELECT COUNT(*) as count FROM offers WHERE status = 'processed'"),
      pending_offers:      this.get("SELECT COUNT(*) as count FROM offers WHERE status = 'pending'"),
      rejected_offers:     this.get("SELECT COUNT(*) as count FROM offers WHERE status = 'rejected'"),
      interests_count:     this.get('SELECT COUNT(*) as count FROM interests'),
      users_count:         this.get('SELECT COUNT(*) as count FROM users WHERE is_active = 1'),
      channels_count:      this.get('SELECT COUNT(*) as count FROM channels'),
      feedback_count:      this.get('SELECT COUNT(*) as count FROM user_feedback'),
      interest_categories: this.all('SELECT DISTINCT category FROM interests ORDER BY category'),
      top_categories:      this.all(
        `SELECT cat.slug, cat.name, COUNT(o.id) as offer_count
         FROM categories cat
         LEFT JOIN offers o ON o.category_id = cat.id
         WHERE cat.parent_slug IS NOT NULL
         GROUP BY cat.id
         HAVING offer_count > 0
         ORDER BY offer_count DESC`
      ),
    };
  }

  // ── Close ───────────────────────────────────────────────────────────────────

  close() {
    if (this.db) {
      this.db.close();
      logger.info('Database closed');
    }
  }
}

module.exports = Database;

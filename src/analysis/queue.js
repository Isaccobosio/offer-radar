const logger = require('../utils/logger');
const config = require('../../config/constants');

class AnalysisQueue {
  constructor(llm, db, botSender) {
    this.llm = llm;
    this.db = db;
    this.botSender = botSender;
    this.queue = [];
    this.isProcessing = false;
    this.timestamps = [];
    this.requestsToday = 0;
    this.lastResetDate = new Date().toDateString();
  }

  enqueue(offerId, priority = 'high') {
    if (!this.llm) return;
    if (priority === 'high') {
      this.queue.unshift(offerId);
    } else {
      this.queue.push(offerId);
    }
    this._processNext().catch(err => logger.error('AnalysisQueue error:', err.message));
  }

  async _processNext() {
    if (this.isProcessing || this.queue.length === 0) return;
    this.isProcessing = true;

    try {
      while (this.queue.length > 0) {
        this._checkDailyReset();

        if (config.OPENROUTER_RPD_LIMIT > 0 && this.requestsToday >= config.OPENROUTER_RPD_LIMIT) {
          logger.warn(
            `⚠️  Daily LLM quota exhausted (${this.requestsToday}/${config.OPENROUTER_RPD_LIMIT}) — ${this.queue.length} offers deferred to batch`
          );
          this.queue = [];
          break;
        }

        await this._waitForRateLimit();

        const offerId = this.queue.shift();
        try {
          await this._analyzeOffer(offerId);
          this.requestsToday++;
          this.timestamps.push(Date.now());
        } catch (err) {
          if (err.status === 429) {
            logger.warn(`Rate limited on offer ${offerId} — leaving as pending for batch`);
          } else {
            logger.error(`Analysis failed for offer ${offerId}:`, err.message);
          }
        }
      }
    } finally {
      this.isProcessing = false;
    }
  }

  async _analyzeOffer(offerId) {
    const offer = this.db.get('SELECT * FROM offers WHERE id = ?', [offerId]);
    if (!offer || offer.status !== 'pending') return;

    const allInterests = this.db.getAllInterests();
    if (allInterests.length === 0) return;

    const recentFeedback = this.db.all(
      `SELECT COALESCE(o.clean_title, o.product_name) AS product_name, f.rating
       FROM user_feedback f
       JOIN offers o ON o.id = f.offer_id
       ORDER BY f.created_at DESC LIMIT 20`
    );

    const analysis = await this.llm.extractOffer(offer.raw_text, allInterests, recentFeedback);

    const score = analysis.confidence_score || analysis.score || 0;
    let status;
    if (score >= config.SCORE_INSTANT) {
      status = 'processed';
    } else if (score >= config.SCORE_DIGEST_MIN) {
      status = 'processed';
    } else {
      status = 'rejected';
    }

    const mergedInterests = [
      ...new Set([...(analysis.matched_interests || []), ...(analysis.tags || [])]),
    ];

    const priceNum = analysis._price_number ?? (typeof analysis.price === 'number' ? analysis.price : null);
    const updateFields = {
      summary: analysis.summary,
      confidence_score: score,
      category: analysis.category,
      product_name: analysis.product_name || null,
      clean_title: analysis.clean_title || analysis.product_name || null,
      brand: analysis.brand || null,
      model: analysis.model || null,
      price: analysis.price || null,
      price_cents: priceNum !== null ? Math.round(priceNum * 100) : null,
      original_price: analysis.original_price != null ? String(analysis.original_price) : null,
      price_drop_percentage: analysis.price_drop_percentage ?? null,
      image_url: analysis.image_url || null,
      is_accessory: analysis.is_accessory ? 1 : 0,
      slug: analysis.slug || null,
      keywords: analysis.keywords ? JSON.stringify(analysis.keywords) : null,
      tags: JSON.stringify(analysis.tags || []),
      matched_interests: JSON.stringify(mergedInterests),
      status,
    };

    const result = this.db.upsertOfferBySlug(offerId, updateFields);

    logger.info(`🧠 Analyzed offer ${offerId}: ${analysis.clean_title || analysis.product_name || '?'} (${score}%) → ${status} [${result.action}]`);

    if (result.action === 'inserted' && status === 'processed' && score >= config.SCORE_INSTANT) {
      const canonicalOffer = this.db.get('SELECT * FROM offers WHERE id = ?', [result.id]);
      await this._sendRichCard(canonicalOffer || offer, analysis);
    }
  }

  async _sendRichCard(offer, analysis) {
    try {
      const users = this.db.getAllActiveUsers();
      const matchedKws = new Set((analysis.matched_interests || []).map(k => k.toLowerCase()));

      for (const user of users) {
        const userInterests = this.db.getAllInterests(user.telegram_id);
        const userKws = new Set(userInterests.map(i => i.keyword.toLowerCase()));
        const hasMatch = [...matchedKws].some(kw => userKws.has(kw));
        if (hasMatch) {
          await this.botSender.sendRichCard(user.telegram_id, offer, analysis);
        }
      }
    } catch (err) {
      logger.error('Failed to send rich card:', err.message);
    }
  }

  async _waitForRateLimit() {
    const windowMs = config.OPENROUTER_RPM_WINDOW_MS;
    const limit = config.OPENROUTER_RPM_LIMIT;
    const now = Date.now();

    this.timestamps = this.timestamps.filter(t => now - t < windowMs);

    if (this.timestamps.length >= limit) {
      const oldest = this.timestamps[0];
      const waitMs = oldest + windowMs - now + 50;
      if (waitMs > 0) {
        logger.debug(`RPM limit reached — waiting ${waitMs}ms`);
        await new Promise(r => setTimeout(r, waitMs));
        const now2 = Date.now();
        this.timestamps = this.timestamps.filter(t => now2 - t < windowMs);
      }
    }
  }

  _checkDailyReset() {
    const today = new Date().toDateString();
    if (this.lastResetDate !== today) {
      logger.info(`Daily LLM quota reset (was ${this.requestsToday})`);
      this.requestsToday = 0;
      this.lastResetDate = today;
    }
  }
}

module.exports = AnalysisQueue;

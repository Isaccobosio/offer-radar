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
    this.quotaExhausted = false;
    this.rpdLimit = config.OPENROUTER_RPD_LIMIT;
    this.remainingToday = null; // populated from API response headers
  }

  async init() {
    if (!this.llm) return;
    try {
      const limits = await this.llm.fetchKeyLimits();
      if (limits.rpdLimit !== null) {
        this.rpdLimit = limits.rpdLimit;
        logger.info(`OpenRouter RPD limit auto-detected: ${this.rpdLimit}${limits.isFreeTier ? ' (free tier)' : ''}`);
      } else {
        logger.info(`OpenRouter: no daily limit detected (credit-based plan), using config default ${this.rpdLimit}`);
      }
    } catch (err) {
      logger.warn(`Could not fetch OpenRouter key limits — using config default ${this.rpdLimit}:`, err.message);
    }
  }

  enqueue(offerId, priority = 'high') {
    if (!this.llm) return;
    this._checkDailyReset();
    if (this.quotaExhausted) return;
    const max = config.ANALYSIS_QUEUE_MAX;
    if (priority !== 'high' && this.queue.length >= max) {
      logger.warn(`AnalysisQueue full (${max}) — dropping low-priority offer ${offerId}`);
      return;
    }
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

        const quotaHit =
          (this.remainingToday !== null && this.remainingToday <= 0) ||
          (this.rpdLimit > 0 && this.requestsToday >= this.rpdLimit);

        if (quotaHit) {
          logger.warn(
            `⚠️  Daily LLM quota exhausted (${this.requestsToday}/${this.rpdLimit}) — ${this.queue.length} offers deferred to batch`
          );
          this.quotaExhausted = true;
          this.queue = [];
          break;
        }

        await this._waitForRateLimit();

        const offerIds = this.queue.splice(0, config.ANALYSIS_BATCH_SIZE);
        try {
          const remaining = await this._analyzeBatch(offerIds);
          this.requestsToday++;
          this.timestamps.push(Date.now());
          if (remaining !== null && remaining !== undefined) {
            this.remainingToday = remaining;
          }
        } catch (err) {
          if (err.status === 429) {
            if (err.allExhausted) {
              logger.warn(`⚠️  All LLM providers exhausted — ${this.queue.length + offerIds.length} offers deferred to batch`);
              this.quotaExhausted = true;
              this.queue = [];
              break;
            }
            logger.warn(`Rate limited on batch [${offerIds.join(',')}] — leaving as pending for next batch`);
          } else {
            logger.error(`Batch analysis failed for offers [${offerIds.join(',')}]:`, err.message);
          }
        }
      }
    } finally {
      this.isProcessing = false;
    }
  }

  // Returns remaining daily quota, or null if unknown
  async _analyzeBatch(offerIds) {
    const allInterests = this.db.getAllInterests();
    if (allInterests.length === 0) return null;

    const recentFeedback = this.db.all(
      `SELECT COALESCE(o.clean_title, o.product_name) AS product_name, f.rating
       FROM user_feedback f
       JOIN offers o ON o.id = f.offer_id
       ORDER BY f.created_at DESC LIMIT 20`
    );

    const offers = offerIds
      .map(id => this.db.get('SELECT * FROM offers WHERE id = ?', [id]))
      .filter(o => o && o.status === 'pending');

    if (offers.length === 0) return null;

    let batchResult;
    try {
      batchResult = await this.llm.extractOffersBatch(
        offers.map(o => ({ id: o.id, raw_text: o.raw_text })),
        allInterests,
        recentFeedback,
      );
    } catch (err) {
      if (err.status === 429 || err.allExhausted) throw err;
      // Malformed response — reject the whole batch
      const placeholders = offers.map(() => '?').join(',');
      this.db.run(
        `UPDATE offers SET status='rejected', processed_at=CURRENT_TIMESTAMP WHERE id IN (${placeholders})`,
        offers.map(o => o.id),
      );
      logger.error(`🧠 Batch rejected (${offers.length} offers) — malformed LLM response: ${err.message}`);
      return null;
    }

    const remaining = batchResult.remaining ?? null;

    for (const { offer_id, analysis } of batchResult.results) {
      const offer = offers.find(o => o.id === offer_id);
      if (!offer) continue;

      const score = analysis.confidence_score || analysis.score || 0;
      const status = score >= config.SCORE_DIGEST_MIN ? 'processed' : 'rejected';
      const mergedInterests = [...new Set([...(analysis.matched_interests || []), ...(analysis.tags || [])])];
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

      const result = this.db.upsertOfferBySlug(offer_id, updateFields);
      logger.info(`🧠 Analyzed offer ${offer_id}: ${analysis.clean_title || '?'} (${score}%) → ${status} [${result.action}]`);

      if (result.action === 'inserted' && status === 'processed' && score >= config.SCORE_INSTANT) {
        const canonicalOffer = this.db.get('SELECT * FROM offers WHERE id = ?', [result.id]);
        await this._sendRichCard(canonicalOffer || offer, analysis);
      }
    }

    const remainingStr = remaining !== null ? ` [${remaining} req remaining today]` : '';
    logger.info(`🧠 Batch complete: ${batchResult.results.length} offers via ${batchResult.provider}${remainingStr}`);
    return remaining;
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
      this.remainingToday = null;
      this.quotaExhausted = false;
      this.lastResetDate = today;
    }
  }
}

module.exports = AnalysisQueue;

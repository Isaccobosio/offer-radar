const cron = require('node-cron');
const logger = require('../utils/logger');
const config = require('../../config/constants');
const { sendDigestCard, sendDigestTrailer } = require('../bot/richCard');

class BatchProcessor {
  constructor(llmAnalyzer, database, botSender) {
    this.llm = llmAnalyzer;
    this.db = database;
    this.botSender = botSender;
    this.isProcessing = false;
  }

  startJobs() {
    cron.schedule(config.BATCH_SCHEDULE, async () => {
      if (this.isProcessing) {
        logger.warn('⏭️  Batch job already in progress, skipping...');
        return;
      }
      try {
        await this.processBatch();
      } catch (err) {
        logger.error('❌ Batch processing failed:', err.message);
      }
    });
    logger.info(`📅 Batch job scheduled: ${config.BATCH_SCHEDULE}`);

    cron.schedule(config.CLEANUP_SCHEDULE, () => {
      try {
        this.db.deleteOldOffers();
      } catch (err) {
        logger.error('Cleanup job failed:', err.message);
      }
    });
    logger.info(`🧹 Cleanup job scheduled: ${config.CLEANUP_SCHEDULE}`);
  }

  async processBatch() {
    this.isProcessing = true;
    const startTime = Date.now();

    try {
      logger.info('🚀 Starting batch processing...');

      const pendingOffers = this.db.getPendingOffers();
      logger.info(`📦 Found ${pendingOffers.length} pending offers`);

      if (pendingOffers.length === 0) {
        logger.info('✨ No offers to process');
        this.isProcessing = false;
        return;
      }

      const allInterests = this.db.getAllInterests();
      if (allInterests.length === 0) {
        logger.warn('⚠️  No interests configured. Users should add interests first!');
        this.isProcessing = false;
        return;
      }

      logger.info(`🎯 Analyzing ${pendingOffers.length} offers against ${allInterests.length} interests...`);

      if (!this.llm) {
        logger.warn('⚠️  LLM not available — skipping analysis. Check OPEN_ROUTER_API_KEY and restart.');
        this.isProcessing = false;
        return;
      }

      // Fetch feedback context once for all offers
      const recentFeedback = this.db.all(
        `SELECT o.product_name, f.rating
         FROM user_feedback f
         JOIN offers o ON o.id = f.offer_id
         ORDER BY f.created_at DESC LIMIT 20`
      );

      let successCount = 0;
      let errorCount = 0;

      for (let i = 0; i < pendingOffers.length; i += config.ANALYSIS_BATCH_SIZE) {
        const chunk = pendingOffers.slice(i, i + config.ANALYSIS_BATCH_SIZE);
        try {
          const { results } = await this.llm.extractOffersBatch(
            chunk.map(o => ({ id: o.id, raw_text: o.raw_text })),
            allInterests,
            recentFeedback,
          );

          for (const { offer_id, analysis } of results) {
            const score = analysis.confidence_score || analysis.score || 0;
            const mergedInterests = [
              ...new Set([...(analysis.matched_interests || []), ...(analysis.tags || [])]),
            ];
            const status = score >= config.SCORE_DIGEST_MIN ? 'processed' : 'rejected';

            this.db.upsertOfferBySlug(offer_id, {
              summary: analysis.summary,
              confidence_score: score,
              category: analysis.category,
              product_name: analysis.product_name || null,
              brand: analysis.brand || null,
              price: analysis.price || null,
              original_price: analysis.original_price != null ? String(analysis.original_price) : null,
              price_drop_percentage: analysis.price_drop_percentage ?? null,
              is_accessory: analysis.is_accessory ? 1 : 0,
              clean_title: analysis.clean_title || null,
              model: analysis.model || null,
              slug: analysis.slug || null,
              keywords: Array.isArray(analysis.keywords) ? JSON.stringify(analysis.keywords) : (analysis.keywords || null),
              image_url: analysis.image_url || null,
              tags: JSON.stringify(analysis.tags || []),
              matched_interests: JSON.stringify(mergedInterests),
              status,
            });
          }

          successCount += results.length;
          logger.info(`🧠 Scheduler batch ${Math.floor(i / config.ANALYSIS_BATCH_SIZE) + 1}: ${results.length} offers processed`);
        } catch (err) {
          if (err.status === 429 || err.allExhausted || /rate.?limit|quota.?exceed/i.test(err.message)) {
            const remaining = pendingOffers.length - i;
            logger.warn(`Rate limited at chunk ${i} — leaving ${remaining} offers pending for next batch`);
            break;
          }
          // Malformed batch response — reject the chunk and continue
          const placeholders = chunk.map(() => '?').join(',');
          this.db.run(
            `UPDATE offers SET status='rejected', processed_at=CURRENT_TIMESTAMP WHERE id IN (${placeholders})`,
            chunk.map(o => o.id),
          );
          errorCount += chunk.length;
          logger.error(`Scheduler batch failed (${chunk.length} offers rejected):`, err.message);
        }
      }

      logger.info(`✅ Analysis complete: ${successCount} success, ${errorCount} errors`);

      // Send individual digest rich cards per user
      const users = this.db.getAllActiveUsers();
      for (const user of users) {
        try {
          const userInterests = this.db.getAllInterests(user.telegram_id);
          if (userInterests.length === 0) continue;

          const accessoriesAllowed = userInterests.some(
            i => i.category === 'tecnologia/accessori'
          );

          const candidates = this.db.getDigestCandidatesForUser(user.telegram_id, {
            limit: config.DIGEST_CANDIDATE_FETCH_MAX,
            accessoriesAllowed,
          });

          if (candidates.length === 0) continue;

          const top = candidates.slice(0, config.DIGEST_CARDS_MAX);
          const remaining = candidates.length - top.length;

          for (const offer of top) {
            await sendDigestCard(this.botSender.bot, user.telegram_id, offer, offer.matched_keyword);
          }

          await sendDigestTrailer(this.botSender.bot, user.telegram_id, top.length, remaining);

          logger.info(`📨 Sent ${top.length} digest cards to user ${user.telegram_id} (${remaining} more available)`);
        } catch (err) {
          logger.error(`Failed to send digest to user ${user.telegram_id}:`, err.message);
        }
      }

      const stats = this.db.getStats();
      const duration = ((Date.now() - startTime) / 1000).toFixed(2);
      logger.info(`📊 Batch complete in ${duration}s. Total offers: ${stats.total_offers.count}`);

      this.isProcessing = false;
    } catch (err) {
      logger.error('Batch processing error:', err);
      this.isProcessing = false;
      throw err;
    }
  }

  async test() {
    try {
      logger.info('Testing batch processor...');
      const stats = this.db.getStats();
      logger.info('✅ Database accessible');
      logger.info(`   Total offers: ${stats.total_offers.count}`);
      logger.info(`   Total interests: ${stats.interests_count.count}`);
      return true;
    } catch (err) {
      logger.error('❌ Batch processor test failed:', err.message);
      throw err;
    }
  }
}

module.exports = BatchProcessor;

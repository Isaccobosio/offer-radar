const cron = require('node-cron');
const logger = require('../utils/logger');
const config = require('../../config/constants');

class BatchProcessor {
  constructor(llmAnalyzer, database, botSender) {
    this.llm = llmAnalyzer;
    this.db = database;
    this.botSender = botSender;
    this.isProcessing = false;
  }

  /**
   * Start cron jobs for batch processing and cleanup
   */
  startJobs() {
    // Batch processing job
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

    // Cleanup job
    cron.schedule(config.CLEANUP_SCHEDULE, async () => {
      try {
        await this.db.deleteOldOffers();
      } catch (err) {
        logger.error('Cleanup job failed:', err.message);
      }
    });

    logger.info(`🧹 Cleanup job scheduled: ${config.CLEANUP_SCHEDULE}`);
  }

  /**
   * Main batch processing logic
   */
  async processBatch() {
    this.isProcessing = true;
    const startTime = Date.now();

    try {
      logger.info('🚀 Starting daily batch processing...');

      // 1. Get all pending offers
      const pendingOffers = await this.db.getPendingOffers();
      logger.info(`📦 Found ${pendingOffers.length} pending offers`);

      if (pendingOffers.length === 0) {
        logger.info('✨ No offers to process today');
        this.isProcessing = false;
        return;
      }

      // 2. Get user interests
      const interests = await this.db.getAllInterests();

      if (interests.length === 0) {
        logger.warn('⚠️  No interests configured. Add interests first!');
        this.isProcessing = false;
        return;
      }

      logger.info(`🎯 Analyzing against ${interests.length} interests...`);

      // 3. Analyze offers with LLM
      const filteredOffers = [];
      let successCount = 0;
      let errorCount = 0;

      for (const offer of pendingOffers) {
        try {
          const analysis = await this.llm.analyzeOffer(offer.raw_text, interests);

          // Update offer with analysis
          await this.db.updateOffer(offer.id, {
            summary: analysis.summary,
            confidence_score: analysis.confidence_score,
            category: analysis.category,
            matched_interests: JSON.stringify(analysis.matched_interests),
            status: analysis.confidence_score >= config.CONFIDENCE_THRESHOLD ? 'processed' : 'rejected',
          });

          // Collect high-confidence offers
          if (analysis.confidence_score >= config.CONFIDENCE_THRESHOLD) {
            filteredOffers.push({
              ...analysis,
              offer_id: offer.id,
              channel_name: offer.channel_name,
              original_text: offer.raw_text,
            });
          }

          successCount++;
        } catch (err) {
          logger.error(`Failed to analyze offer ${offer.id}:`, err.message);
          errorCount++;

          // Mark as rejected on error
          await this.db.updateOffer(offer.id, {
            status: 'rejected',
            summary: `Error: ${err.message}`,
          });
        }
      }

      logger.info(`✅ Analysis complete: ${successCount} success, ${errorCount} errors`);

      // 4. Group offers by category
      const groupedOffers = this.groupOffersByCategory(filteredOffers);

      // 5. Send summary if we have offers
      if (filteredOffers.length > 0) {
        await this.sendSummary(groupedOffers, filteredOffers.length, pendingOffers.length);
      } else {
        logger.info('✨ No high-confidence offers to send');
      }

      // 6. Get stats
      const stats = await this.db.getStats();
      const duration = ((Date.now() - startTime) / 1000).toFixed(2);
      logger.info(`📊 Batch complete in ${duration}s. Total offers: ${stats.total_offers.count}`);

      this.isProcessing = false;
    } catch (err) {
      logger.error('Batch processing error:', err);
      this.isProcessing = false;
      throw err;
    }
  }

  /**
   * Group offers by category
   */
  groupOffersByCategory(offers) {
    return offers.reduce((acc, offer) => {
      const category = offer.category || 'Other';
      if (!acc[category]) {
        acc[category] = [];
      }
      acc[category].push(offer);
      return acc;
    }, {});
  }

  /**
   * Send summary to main account
   */
  async sendSummary(groupedOffers, filteredCount, totalCount) {
    try {
      let message = `📦 **Daily Offers Summary**\n`;
      message += `✨ Found ${filteredCount} valuable offers from ${totalCount} total\n`;
      message += `⏰ *${new Date().toLocaleString()}*\n\n`;

      let categoryNum = 1;

      for (const [category, offers] of Object.entries(groupedOffers)) {
        message += `\n${categoryNum}. **${category}** (${offers.length} offers)\n`;
        message += '─'.repeat(40) + '\n';

        // Show top 3 per category, rest in summary
        offers.slice(0, 3).forEach((offer, idx) => {
          const emoji = ['🥇', '🥈', '🥉'][idx] || '📌';
          message += `${emoji} *${offer.product_name}*\n`;
          message += `   ${offer.summary}\n`;
          if (offer.price) {
            message += `   💰 ${offer.price}\n`;
          }
          message += `   Confidence: ${offer.confidence_score}%\n`;
          message += `   Source: ${offer.channel_name}\n\n`;
        });

        if (offers.length > 3) {
          message += `   ... and ${offers.length - 3} more offers\n\n`;
        }

        categoryNum++;
      }

      message += '\n─'.repeat(40) + '\n';
      message += 'Use /search [keyword] to find specific offers\n';
      message += 'Use /add_interest [keyword] [category] to track new products\n';

      // Send via bot API
      if (this.botSender) {
        await this.botSender.sendMessage(message);
        logger.info(`✅ Summary sent with ${filteredCount} offers`);
      } else {
        logger.warn('Bot sender not configured. Summary would be:\n', message);
      }
    } catch (err) {
      logger.error('Failed to send summary:', err.message);
    }
  }

  /**
   * Test batch processor
   */
  async test() {
    try {
      logger.info('Testing batch processor...');
      const stats = await this.db.getStats();
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

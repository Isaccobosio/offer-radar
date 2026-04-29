const { Worker } = require('worker_threads');
const path = require('path');
const logger = require('../utils/logger');
const config = require('../../config/constants');

class WorkerBridge {
  constructor(db, onOfferInserted) {
    this.db = db;
    this.onOfferInserted = onOfferInserted;
    this.worker = null;
    this._drainInterval = null;
  }

  start(channelIds = []) {
    if (!process.env.TELEGRAM_SESSION || !process.env.TELEGRAM_SESSION.trim()) {
      logger.info('WorkerBridge: no TELEGRAM_SESSION — live listening disabled');
      return;
    }

    this.worker = new Worker(path.join(__dirname, 'worker.js'), {
      workerData: {
        channelIds,
        dbPath: config.DATABASE_PATH,
        env: { ...process.env },
      },
    });

    this.worker.on('message', (msg) => {
      if (msg.type === 'ready') {
        logger.info('✅ GramJS worker connected and listening');
      } else if (msg.type === 'inserted') {
        logger.debug(`Worker: message ${msg.messageId} queued in pending_review`);
      } else if (msg.type === 'error') {
        logger.error('GramJS worker error:', msg.message);
      }
    });

    this.worker.on('error', (err) => {
      logger.error('GramJS worker crashed:', err.message);
    });

    this.worker.on('exit', (code) => {
      if (code !== 0) logger.warn(`GramJS worker exited with code ${code}`);
    });

    this._drainInterval = setInterval(() => this._drain(), config.PENDING_REVIEW_POLL_MS);
    logger.info(`🔄 Drain loop started (every ${config.PENDING_REVIEW_POLL_MS}ms)`);
  }

  _drain() {
    try {
      const rows = this.db.drainPendingReview(50);
      for (const row of rows) {
        try {
          if (!this.db.isProcessed(row.message_id)) {
            const result = this.db.insertOffer({
              message_id: row.message_id,
              channel_id: row.channel_id,
              channel_name: row.channel_name,
              raw_text: row.raw_text,
            });
            this.db.markProcessed(row.message_id, row.channel_id);
            if (result && result.id) {
              this.onOfferInserted(result.id);
            }
          }
        } catch (err) {
          logger.error(`Drain error for message ${row.message_id}:`, err.message);
        } finally {
          this.db.deletePendingReviewRow(row.id);
        }
      }
    } catch (err) {
      logger.error('Drain loop error:', err.message);
    }
  }

  stop() {
    if (this._drainInterval) {
      clearInterval(this._drainInterval);
      this._drainInterval = null;
    }
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
  }
}

module.exports = WorkerBridge;

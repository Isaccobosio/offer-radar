#!/usr/bin/env node
require('dotenv').config();
const logger = require('./utils/logger');
const config = require('../config/constants');

const Database = require('./db');
const AnalyzerClass = require('./llm');
const BatchProcessor = require('./scheduler');

async function main() {
  logger.info('🔎 Manual analyze: running one-shot batch processing');

  const db = new Database(config.DATABASE_PATH);
  try {
    await db.initialize();
  } catch (err) {
    logger.error('Failed to initialize database:', err.message);
    process.exit(1);
  }

  if (!process.env.OPEN_ROUTER_API_KEY) {
    logger.error('OPEN_ROUTER_API_KEY not set. Aborting analyze.');
    await db.close();
    process.exit(1);
  }

  const llm = new AnalyzerClass();
  try {
    await llm.test();
  } catch (err) {
    logger.error('LLM test failed:', err.message);
    await db.close();
    process.exit(1);
  }

  const processor = new BatchProcessor(llm, db, null);

  try {
    await processor.processBatch();
    logger.info('🔎 Analyze finished');
  } catch (err) {
    logger.error('Analyze failed:', err.message);
    process.exitCode = 1;
  } finally {
    await db.close();
  }
}

main().catch(err => {
  logger.error('Analyze fatal error:', err.message || err);
  process.exit(1);
});

#!/usr/bin/env node
/**
 * OfferRadar - Setup Guide
 * 
 * This script helps you set up OfferRadar for the first time
 */

const fs = require('fs');
const path = require('path');
const logger = require('./utils/logger');
const config = require('../config/constants');

async function main() {
  logger.info('🚀 OfferRadar Setup Guide');
  logger.info('═'.repeat(60));
  
  logger.info('\n📋 CHECKLIST - Before you continue:');
  logger.info('  □ You have Node.js 16+ installed');
  logger.info('  □ You have a Telegram account (main)');
  logger.info('  □ You have API_ID and API_HASH from https://my.telegram.org');
  logger.info('  □ You have a bot token from @BotFather');
  logger.info('  □ You have Groq API key from https://console.groq.com');
  logger.info('  □ You have joined the Telegram channels with your main account');
  
  logger.info('\n📝 NEXT STEPS:');
  logger.info('\n1️⃣  Fill in your .env file:');
  logger.info('   cp .env.example .env');
  logger.info('   nano .env  # or your favorite editor');
  
  logger.info('\n2️⃣  Add your initial interests:');
  logger.info('   /add_interest airpods electronics');
  logger.info('   /add_interest anker battery');
  
  logger.info('\n3️⃣  Start the bot:');
  logger.info('   npm start');
  
  logger.info('\n4️⃣  Check logs for errors:');
  logger.info('   tail -f combined.log');
  
  logger.info('\n📚 For detailed setup instructions, see README.md');
  logger.info('\n✨ Good luck! You\'re about to save tons of time finding deals!');
}

main().catch(err => {
  logger.error('Setup error:', err);
  process.exit(1);
});

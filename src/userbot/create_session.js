#!/usr/bin/env node
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const readline = require('readline');
let TelegramClient;
let StringSession;
try {
  ({ TelegramClient } = require('telegram'));
  ({ StringSession } = require('telegram/sessions'));
} catch (err) {
  console.error('Module "telegram" is not installed.');
  console.error('Install it with: npm install telegram');
  console.error('Then re-run: npm run create:session');
  process.exit(1);
}
const logger = require('../utils/logger');

function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => rl.question(question, ans => { rl.close(); resolve(ans); }));
}

async function main() {
  const apiId = parseInt(process.env.API_ID, 10);
  const apiHash = process.env.API_HASH;
  const defaultPhone = process.env.BURNER_PHONE || '';

  if (!apiId || !apiHash) {
    logger.error('API_ID and API_HASH must be set in your .env');
    process.exit(1);
  }

  const phone = await ask(`Phone number for burner account [${defaultPhone}]: `) || defaultPhone;
  if (!phone) {
    logger.error('Phone number is required');
    process.exit(1);
  }

  const stringSession = new StringSession('');
  const client = new TelegramClient(stringSession, apiId, apiHash, { connectionRetries: 5 });

  try {
    await client.start({
      phoneNumber: async () => phone,
      phoneCode: async () => await ask('Enter the code you received: '),
      password: async () => await ask('Two-step password (if set, else press enter): '),
      onError: (err) => logger.error('Auth error:', err.message || err),
    });

    const sessionString = client.session.save();
    console.log('\n✅ Session created. Add the following line to your .env file:');
    console.log(`TELEGRAM_SESSION=${sessionString}\n`);

    const save = (await ask('Save to .env automatically? (y/N): ')).toLowerCase() === 'y';
    if (save) {
      const envPath = path.resolve(process.cwd(), '.env');
      let content = '';
      if (fs.existsSync(envPath)) content = fs.readFileSync(envPath, 'utf8');
      if (!/TELEGRAM_SESSION=/.test(content)) {
        content = content.trim() + '\nTELEGRAM_SESSION=' + sessionString + '\n';
      } else {
        content = content.replace(/TELEGRAM_SESSION=.*/g, 'TELEGRAM_SESSION=' + sessionString);
      }
      fs.writeFileSync(envPath, content, { encoding: 'utf8' });
      console.log('✅ Saved to .env');
    }

    await client.disconnect();
  } catch (err) {
    logger.error('Failed to create session:', err.message || err);
    process.exit(1);
  }
}

main();

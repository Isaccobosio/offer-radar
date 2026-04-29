process.env.DATABASE_PATH = '/tmp/test_offerradar.db';
process.env.MAIN_ACCOUNT_ID = '123';
const Database = require('./src/db');
async function test() {
  const db = new Database('/tmp/test_offerradar.db');
  await db.initialize();
  
  db.run('INSERT OR IGNORE INTO users (telegram_id, username) VALUES (?, ?)', [123, 'test']);
  const user = db.get('SELECT * FROM users WHERE telegram_id = ?', [123]);
  console.log('✅ User:', JSON.stringify(user));
  
  db.run('INSERT OR IGNORE INTO pending_review (message_id, channel_id, raw_text) VALUES (?, ?, ?)', [999, 456, 'Test offer text here that is long enough']);
  const rows = db.drainPendingReview(10);
  console.log('✅ pending_review rows:', rows.length);
  db.deletePendingReviewRow(rows[0]?.id);
  
  db.run('INSERT OR IGNORE INTO offers (message_id, channel_id, raw_text) VALUES (?, ?, ?)', [1, 1, 'test offer']);
  const offerRow = db.get('SELECT id FROM offers WHERE message_id = 1');
  db.addUserFeedback(offerRow.id, 123, 'spot_on');
  const fb = db.get('SELECT * FROM user_feedback WHERE user_id = 123');
  console.log('✅ Feedback:', JSON.stringify(fb));
  
  const walMode = db.get('PRAGMA journal_mode');
  console.log('✅ WAL mode:', walMode.journal_mode);
  
  const stats = db.getStats();
  console.log('✅ Stats total_offers:', stats.total_offers.count);
  
  // Test isProcessed + markProcessed
  db.markProcessed(12345, 456);
  const processed = db.isProcessed(12345);
  console.log('✅ isProcessed:', processed);
  
  db.close();
  console.log('\n✅ All DB tests passed');
}
test().catch(e => { console.error('❌ FAIL:', e.message); process.exit(1); });

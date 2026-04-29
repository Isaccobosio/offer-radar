// One-off: pick N pending offers, analyze them via LLM, print result.
// Run: node scripts/test-analyze.js [N]
require('dotenv').config();
const Database = require('../src/db');
const Analyzer = require('../src/llm');
const config = require('../config/constants');

(async () => {
  const N = parseInt(process.argv[2] || '3', 10);
  const db = new Database(config.DATABASE_PATH);
  await db.initialize();

  if (!process.env.OPEN_ROUTER_API_KEY) {
    console.error('OPEN_ROUTER_API_KEY missing'); process.exit(1);
  }
  const llm = new Analyzer();
  console.log(`Model: ${llm.model}`);

  const interests = await db.getAllInterests();
  console.log(`Interests: ${interests.length}`);
  if (!interests.length) { console.error('No interests configured'); process.exit(1); }

  const offers = await db.all('SELECT * FROM offers WHERE status = ? LIMIT ?', ['pending', N]);
  console.log(`Picked ${offers.length} pending offers\n`);

  for (const offer of offers) {
    console.log(`── Offer ${offer.id} (${offer.channel_name}) ──`);
    console.log((offer.raw_text || '').slice(0, 160).replace(/\n/g, ' ') + '…');
    try {
      const a = await llm.analyzeOffer(offer.raw_text, interests);
      console.log(`  product:  ${a.product_name}`);
      console.log(`  brand:    ${a.brand}`);
      console.log(`  category: ${a.category}`);
      console.log(`  price:    ${a.price}`);
      console.log(`  score:    ${a.confidence_score}%`);
      console.log(`  matched:  ${JSON.stringify(a.matched_interests)}`);
      console.log(`  summary:  ${a.summary}`);

      const status = a.confidence_score >= config.CONFIDENCE_THRESHOLD ? 'processed' : 'rejected';
      await db.updateOffer(offer.id, {
        summary: a.summary,
        confidence_score: a.confidence_score,
        category: a.category,
        product_name: a.product_name || null,
        brand: a.brand || null,
        price: a.price || null,
        matched_interests: JSON.stringify(a.matched_interests || []),
        status,
      });
      console.log(`  → ${status}\n`);
    } catch (err) {
      console.error(`  ERROR: ${err.message}\n`);
    }
  }

  await db.close();
})().catch(err => { console.error(err); process.exit(1); });

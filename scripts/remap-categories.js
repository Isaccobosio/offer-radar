// Re-map existing freeform `category` values to canonical taxonomy slugs.
// Uses CategoryMapper aliases — no LLM calls.
require('dotenv').config();
const Database = require('../src/db');
const config = require('../config/constants');

(async () => {
  const db = new Database(config.DATABASE_PATH);
  await db.initialize();

  const rows = await db.all(`SELECT DISTINCT category FROM offers WHERE category IS NOT NULL`);
  let updated = 0, unmapped = [];

  for (const { category } of rows) {
    const slug = db.categoryMapper.map(category);
    if (slug && slug !== category) {
      const r = await db.run(
        `UPDATE offers SET category = ? WHERE category = ?`,
        [slug, category]
      );
      updated += r.changes;
      console.log(`  ${category.padEnd(30)} → ${slug}  (${r.changes} offers)`);
    } else if (!slug) {
      unmapped.push(category);
    }
  }

  // Refresh category_id for everyone
  const all = await db.all(`SELECT id, category FROM offers WHERE category IS NOT NULL`);
  for (const o of all) {
    const id = await db._resolveCategoryId(o.category);
    if (id) await db.run(`UPDATE offers SET category_id = ? WHERE id = ?`, [id, o.id]);
  }

  console.log(`\n✅ Remapped ${updated} offers`);
  if (unmapped.length) {
    console.log(`\n⚠️  Unmapped categories (no alias hit) — will need LLM re-analysis or manual fix:`);
    unmapped.forEach(c => console.log(`   - ${c}`));
  }

  await db.close();
})().catch(err => { console.error(err); process.exit(1); });

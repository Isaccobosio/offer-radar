# Plan: Improved Categorization and Search Engine

## Problem

### Search
- `searchOffers` uses `LIKE '%word%'` queries — full table scan, no relevance ranking.
- Italian stemming is a hand-rolled strip of trailing vowels — misses conjugated verbs and plurals.
- No FTS index means search degrades linearly with DB size.
- Scores mix `confidence_score` (LLM relevance) with full-text rank — they're independent axes.

### Categorization
- `category` is a free-form string produced by the LLM — inconsistent values ("Electronics", "Elettronica", "Tech", "Tecnologia").
- No hierarchy: can't query "all tech" when items are tagged "Smartphones" vs "Computers".
- `matched_interests` is a JSON-stringified array stored in TEXT — not queryable.
- No structured product attributes (brand, price, model) — only raw_text and the LLM summary.

---

## Goal

- Fast, ranked full-text search with Italian language support.
- Normalized category taxonomy (fixed hierarchy, Italian-first).
- Structured tags stored relationally (queryable, filterable).
- Backward compatible: existing offers migrate cleanly; no breaking changes to bot commands.

---

## Part 1: Full-Text Search with SQLite FTS5

### Why FTS5

- Built into SQLite — no new dependency.
- Supports BM25 ranking (`rank` column).
- Supports prefix queries (`word*`), phrase queries (`"offerta lampo"`).
- Supports porter stemmer for English; for Italian we use the `unicode61` tokenizer with custom diacritics.
- `better-sqlite3` (or the existing `sqlite3` npm package) both support FTS5.

### Schema change

Create a virtual FTS5 table that mirrors `offers`:

```sql
CREATE VIRTUAL TABLE IF NOT EXISTS offers_fts USING fts5(
  offer_id UNINDEXED,      -- FK to offers.id
  channel_name,
  raw_text,
  summary,
  category,
  tags,                    -- space-separated tag list for fast category filter
  tokenize = "unicode61 remove_diacritics 2"
);
```

`remove_diacritics 2` normalizes accented Italian characters (`è`, `à`, `ù` → `e`, `a`, `u`).

### Keeping FTS in sync

Insert trigger approach (SQLite triggers on FTS virtual tables are supported):

```sql
CREATE TRIGGER offers_fts_insert AFTER INSERT ON offers BEGIN
  INSERT INTO offers_fts(offer_id, channel_name, raw_text, summary, category, tags)
  VALUES (new.id, new.channel_name, new.raw_text, '', '', '');
END;

CREATE TRIGGER offers_fts_update AFTER UPDATE ON offers BEGIN
  INSERT INTO offers_fts(offers_fts, offer_id, channel_name, raw_text, summary, category, tags)
  VALUES ('delete', old.id, old.channel_name, old.raw_text, old.summary, old.category, '');
  INSERT INTO offers_fts(offer_id, channel_name, raw_text, summary, category, tags)
  VALUES (new.id, new.channel_name, new.raw_text, new.summary, new.category, '');
END;

CREATE TRIGGER offers_fts_delete BEFORE DELETE ON offers BEGIN
  INSERT INTO offers_fts(offers_fts, offer_id, channel_name, raw_text, summary, category, tags)
  VALUES ('delete', old.id, old.channel_name, old.raw_text, old.summary, old.category, '');
END;
```

Alternative: manage sync in application code inside `db.insertOffer()` and `db.updateOffer()`.
**Recommendation: application-side sync** — simpler to debug, no hidden trigger side effects.

### New `searchOffers` query

```sql
SELECT o.*, c.channel_username,
       rank AS fts_rank
FROM offers_fts
JOIN offers o ON o.id = offers_fts.offer_id
LEFT JOIN channels c ON c.channel_id = o.channel_id
WHERE offers_fts MATCH ?
ORDER BY
  CASE WHEN o.confidence_score IS NOT NULL THEN o.confidence_score * 0.4 ELSE 0 END
  + (rank * -10) DESC    -- FTS5 rank is negative; larger magnitude = better
LIMIT 20
```

The combined score weights LLM confidence (40%) + FTS rank (60%).

For the query string, preprocess user input:
- Multi-word → `word1 word2` (FTS5 default is AND, same as current behavior)
- Append `*` to last token for prefix search: `macbook pro m*` → finds "M4"
- Phrase: wrap quoted text in `"..."`: `/search "power bank"` → `"power bank"`

---

## Part 2: Category Taxonomy

### Taxonomy (Italian-first, LLM maps to these)

```
Tecnologia
  ├── Smartphone
  ├── Tablet
  ├── PC & Laptop
  ├── Audio (cuffie, auricolari, speaker)
  ├── TV & Monitor
  ├── Fotografia
  ├── Gaming
  ├── Accessori (cavi, caricatori, cover)
  └── Smart Home

Casa & Cucina
  ├── Elettrodomestici grandi
  ├── Elettrodomestici piccoli
  ├── Arredamento
  └── Pulizia

Moda & Sport
  ├── Abbigliamento
  ├── Scarpe
  ├── Sport & Outdoor
  └── Borse & Accessori

Alimentari
  ├── Cibo & Bevande
  └── Integratori

Libri & Media
  ├── Libri
  ├── Film & Serie
  └── Musica

Servizi & Abbonamenti
  ├── Streaming
  ├── Software
  └── Cloud

Altro
```

Stored in a new `categories` table:

```sql
CREATE TABLE categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE,        -- 'tecnologia/smartphone'
  name TEXT NOT NULL,               -- 'Smartphone'
  parent_slug TEXT,                 -- 'tecnologia'
  display_order INTEGER DEFAULT 0
);
```

### Offer → category mapping

LLM response already includes `category` (free text). During analysis:
1. LLM returns `"category": "Cuffie e Auricolari"`
2. A `CategoryMapper` normalizes it → matches to `tecnologia/audio`
3. `offers.category_id` stores the FK (new column)

`CategoryMapper` uses a static lookup table (slug → aliases):
```js
const ALIASES = {
  'tecnologia/audio': ['cuffie', 'auricolari', 'speaker', 'headphones', 'earbuds', 'audio'],
  'tecnologia/smartphone': ['smartphone', 'telefono', 'iphone', 'android'],
  // ...
};
```

If no alias matches → fall back to LLM's raw string as-is (stored in `offers.category` TEXT for backward compat).

### Schema changes for offers

```sql
ALTER TABLE offers ADD COLUMN category_id INTEGER REFERENCES categories(id);
ALTER TABLE offers ADD COLUMN brand TEXT;
ALTER TABLE offers ADD COLUMN price_cents INTEGER;  -- price in euro cents for range filtering
ALTER TABLE offers ADD COLUMN product_name TEXT;    -- extracted by LLM (already in response)
```

`brand` and `product_name` are already extracted by the LLM in the current JSON response — just not persisted. Store them.

---

## Part 3: Structured Tags (replacing JSON TEXT)

Current: `matched_interests TEXT` = `'["cuffie","laptop"]'` — not queryable.

New: separate `offer_tags` junction table:

```sql
CREATE TABLE offer_tags (
  offer_id INTEGER NOT NULL REFERENCES offers(id) ON DELETE CASCADE,
  tag TEXT NOT NULL,
  tag_type TEXT NOT NULL CHECK(tag_type IN ('interest', 'category', 'brand')),
  PRIMARY KEY (offer_id, tag, tag_type)
);
CREATE INDEX idx_offer_tags_tag ON offer_tags(tag);
```

This enables:
```sql
-- "show me all offers matching interest 'laptop'"
SELECT o.* FROM offers o
JOIN offer_tags t ON t.offer_id = o.id
WHERE t.tag = 'laptop' AND t.tag_type = 'interest'
ORDER BY o.confidence_score DESC;
```

Backward compat: keep `matched_interests TEXT` column for now (populated from `offer_tags` on read), remove after migration.

---

## Migration Plan

1. Add new columns to `offers` (`category_id`, `brand`, `price_cents`, `product_name`) — `ALTER TABLE ADD COLUMN` (nullable, backward safe).
2. Create `categories` table and seed with taxonomy.
3. Create `offer_tags` table.
4. Create `offers_fts` virtual table.
5. Backfill migration:
   - For each existing offer with `summary IS NOT NULL`: re-extract `brand`, `product_name` from summary (regex heuristic, no LLM call).
   - Map existing `category TEXT` to `category_id` via `CategoryMapper`.
   - Populate `offer_tags` from `matched_interests` JSON.
   - Populate `offers_fts` from existing offers.
6. Update `db.insertOffer()` and `db.updateOffer()` to sync FTS + tags.
7. Update `searchOffers()` to use FTS5 query.
8. Update bot `/search` command to support category filter: `/search cuffie in:tecnologia/audio`.

---

## Key Changes

| File | Change |
|------|--------|
| `src/db/index.js` | Add FTS sync in `insertOffer`/`updateOffer`; new `searchOffers` using FTS5; `createTables` adds new schema; migration steps 1–5 |
| `src/db/categories.js` | **NEW** — taxonomy seed data + `CategoryMapper` class |
| `src/db/migrations/004-fts-categories.js` | **NEW** — one-time migration script |
| `src/scheduler/index.js` | Store `brand`, `product_name`, `price_cents` from LLM response |
| `src/analysis/queue.js` | Same — store structured fields on analysis complete |
| `src/bot/commands/search.js` | Support `in:category` filter; render `brand` and `price` |
| `config/constants.js` | Add `CATEGORY_TAXONOMY_VERSION = 1` |

---

## Trade-offs

| Option | Pro | Con |
|--------|-----|-----|
| SQLite FTS5 | No new deps, built-in BM25 | Slightly complex sync logic |
| Typesense/Meilisearch | Better Italian stemming, real-time | New external service, ops burden |
| PostgreSQL + tsvector | Production-grade, Italian dictionary | Major infra change |
| Current LIKE queries | Zero change | Slow, no ranking |

**Recommendation:** SQLite FTS5. Fits the single-process architecture, no ops overhead,
BM25 ranking is good enough for a personal tool with <10k offers.

---

## Open Questions

- Should `/search` support category filter syntax in v1 or defer to v2?
- Should `price_cents` enable `/search cuffie price:<50` commands?
- Should the taxonomy be configurable (user adds categories) or fixed?
  (Recommendation: fixed taxonomy, user adds *interests* not categories.)
- Should `offers_fts` index `raw_text` or only `summary`?
  (Recommendation: index both — raw_text has more terms; summary is higher-quality signal.)

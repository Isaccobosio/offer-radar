const OpenAI = require('openai');
const logger = require('../utils/logger');
const { sleep, exponentialBackoff } = require('../utils/delays');
const config = require('../../config/constants');
const { TAXONOMY } = require('../db/categories');

const CATEGORY_LIST = TAXONOMY
  .filter(c => c.parent_slug !== null || c.slug === 'altro')
  .map(c => `- ${c.slug} (${c.name})`)
  .join('\n');

const SYSTEM_PROMPT = `You are a structured-data extractor for Italian e-commerce deal posts (Amazon, Mediaworld, Unieuro, etc.).

Input: raw Telegram message text from a deal channel, plus the user's interest list.
Output: STRICT JSON, no prose, no markdown fences.

Schema:
{
  "brand": string | null,
  "model": string | null,
  "clean_title": string,
  "price": number | null,
  "original_price": number | null,
  "price_drop_percentage": number | null,
  "category": string,
  "is_accessory": boolean,
  "slug": string | null,
  "keywords": string[],
  "summary": string,
  "score": number,
  "matched_interests": string[],
  "image_url": null
}

Field rules:
- brand: canonical brand name (e.g. "Apple", "Samsung", "Xiaomi"). null if unclear.
- model: model identifier (e.g. "iPhone 15 Pro", "Galaxy S24 Ultra 512GB"). null if unclear.
- clean_title: human-readable title, no emoji, no promo tail ("MIN STORICO!", "IMPERDIBILE", etc.), no URLs. Max 80 chars.
- price: current EUR as float (e.g. 1299.00). null if not found.
- original_price: pre-discount EUR as float if explicitly stated in the message (e.g. original was €399 now €299 → 399.00). null otherwise.
- price_drop_percentage: integer 0-100. Compute from stated discount % OR from (original−price)/original*100. null if no discount info available.
- category: EXACT slug from taxonomy below. Use "altro" only as last resort.
- is_accessory: true if the item is an accessory (cover, cavo, custodia, supporto, caricatore, vetro, pellicola, "compatibile con"). false otherwise.
- slug: dedup key. Format: lowercase kebab-case of brand+model, non-alphanumerics → "-" (e.g. "apple-iphone-15-pro-256gb"). null if brand or model unknown.
- keywords: 3-8 search terms (Italian+English) a user might type to find this. Lowercase. e.g. ["iphone","apple","smartphone","melafonino"].
- summary: 1-2 sentences in Italian, factual.
- score: 0-100 relevance against provided interests. 0 if no interests given.
  - 80-100: direct match — offer is clearly about what user wants
  - 50-79: partial/related — same brand, category, or plausible substitute
  - 0-49: not relevant
  Be generous with partial matches. Italian hints: "cuffie"=headphones, "auricolari"=earbuds, "caricabatterie"=charger, "smartphone"=phone.
- matched_interests: subset of provided interest keywords this offer matches. [] if none.
- image_url: always null (reserved for future use).

CATEGORY — return EXACT slug (never a product name, brand, or freeform string):
${CATEGORY_LIST}

Pick the most specific slug. Examples:
- "Cuffie Sony WH-1000XM5" → "tecnologia/audio"
- "Intel NUC mini PC" → "tecnologia/pc-laptop"
- "Friggitrice ad aria Ninja" → "casa/elettrodomestici-piccoli"

Output ONLY the JSON object. No commentary.`;

const SEARCH_PARSE_PROMPT = 'Extract brand and model from this product search query. Return strict JSON {"brand": string|null, "model": string|null}. No prose, no markdown.';

class OpenRouterAnalyzer {
  constructor() {
    this.model = config.OPEN_ROUTER_MODEL;
    this.searchModel = config.OPEN_ROUTER_SEARCH_MODEL;
    this.client = new OpenAI({
      apiKey: config.OPEN_ROUTER_API_KEY,
      baseURL: 'https://openrouter.ai/api/v1',
      defaultHeaders: { 'X-Title': 'OfferRadar' },
    });
    this.requestQueue = [];
    this.isProcessing = false;
    this.consecutiveRateLimits = 0;
    this._searchCache = new Map();
  }

  async analyzeOffer(offerText, interests, feedbackContext = []) {
    return this.extractOffer(offerText, interests, feedbackContext);
  }

  async extractOffer(offerText, interests, feedbackContext = []) {
    return new Promise((resolve, reject) => {
      this.requestQueue.push({ offerText, interests, feedbackContext, resolve, reject });
      this.processQueue();
    });
  }

  async processQueue() {
    if (this.isProcessing || this.requestQueue.length === 0) return;
    this.isProcessing = true;

    while (this.requestQueue.length > 0) {
      if (this.consecutiveRateLimits >= 5) {
        logger.warn(`⚠️  Rate limit circuit breaker — pausing 60s (${this.requestQueue.length} offers queued)`);
        await sleep(60000);
        this.consecutiveRateLimits = 0;
      }

      const { offerText, interests, feedbackContext, resolve, reject } = this.requestQueue.shift();
      try {
        const result = await this.callWithRetry(offerText, interests, feedbackContext);
        this.consecutiveRateLimits = 0;
        resolve(result);
      } catch (err) {
        if (err.status === 429) this.consecutiveRateLimits++;
        else this.consecutiveRateLimits = 0;
        reject(err);
      }
      await sleep(config.OPEN_ROUTER_REQUEST_DELAY_MS);
    }

    this.isProcessing = false;
  }

  async callWithRetry(offerText, interests, feedbackContext = [], attempt = 1, maxAttempts = 3) {
    const interestsList = interests
      .map(i => {
        let line = `- ${i.keyword} [${i.category}]`;
        if (i.description) line += `: ${i.description}`;
        return line;
      })
      .join('\n');

    const feedbackSection = feedbackContext.length > 0
      ? `\nRecent user feedback:\n${feedbackContext.map(f => `- ${f.product_name || f.clean_title}: ${f.rating}`).join('\n')}`
      : '';

    const userPrompt = `User interests:\n${interestsList}${feedbackSection}\n\nOffer text:\n${offerText}\n\nReturn ONLY valid JSON.`;

    logger.debug(`Extracting offer with OpenRouter (attempt ${attempt}/${maxAttempts})`);

    try {
      const response = await this.client.chat.completions.create({
        model: this.model,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.3,
        max_tokens: 700,
      });

      const raw = response.choices?.[0]?.message?.content;
      if (!raw) throw new Error('Empty response from OpenRouter');

      const content = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
      const result = JSON.parse(content);

      // Normalize score field for backward compat
      if (result.score !== undefined && result.confidence_score === undefined) {
        result.confidence_score = result.score;
      }
      // Add product_name alias for backward compat with scheduler
      result.product_name = result.clean_title || result.product_name || null;
      // price as string for scheduler compat (scheduler calls updateOffer with price string)
      if (typeof result.price === 'number') {
        result._price_number = result.price;
        result.price = String(result.price);
      }

      if (typeof result.confidence_score !== 'number' || !result.summary) {
        throw new Error('Invalid response: missing required fields');
      }

      logger.debug(`Extraction: ${result.clean_title || result.product_name} (${result.confidence_score}%)`);
      return result;
    } catch (err) {
      if (err.status === 429) {
        logger.warn(`OpenRouter rate limited (attempt ${attempt}/${maxAttempts})`);
        if (attempt < maxAttempts) {
          await exponentialBackoff(attempt, 2000);
          return this.callWithRetry(offerText, interests, feedbackContext, attempt + 1, maxAttempts);
        }
      }

      if (err instanceof SyntaxError && attempt < maxAttempts) {
        logger.warn('JSON parse failed. Retrying...');
        await sleep(1000);
        return this.callWithRetry(offerText, interests, feedbackContext, attempt + 1, maxAttempts);
      }

      logger.error('OpenRouter API error:', err.message);
      throw err;
    }
  }

  async parseSearchQuery(query) {
    const key = query.toLowerCase().trim();
    const cached = this._searchCache.get(key);
    if (cached && Date.now() - cached.ts < config.SEARCH_PARSE_CACHE_TTL_MS) {
      return cached.value;
    }

    // Evict oldest entries when cache full
    if (this._searchCache.size >= config.SEARCH_PARSE_CACHE_SIZE) {
      const oldest = [...this._searchCache.entries()].sort((a, b) => a[1].ts - b[1].ts)[0];
      if (oldest) this._searchCache.delete(oldest[0]);
    }

    try {
      const response = await this.client.chat.completions.create({
        model: this.searchModel,
        messages: [
          { role: 'system', content: SEARCH_PARSE_PROMPT },
          { role: 'user', content: query },
        ],
        temperature: 0,
        max_tokens: 60,
      });

      const raw = response.choices?.[0]?.message?.content || '';
      const content = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
      const parsed = JSON.parse(content);
      const value = {
        brand: parsed.brand || null,
        model: parsed.model || null,
      };
      this._searchCache.set(key, { value, ts: Date.now() });
      return value;
    } catch (err) {
      logger.warn('Search query parse failed, using raw query:', err.message);
      return { brand: null, model: null };
    }
  }

  async analyzeOffersBatch(offers, interests) {
    const results = [];
    for (const offer of offers) {
      try {
        const analysis = await this.extractOffer(offer.raw_text, interests);
        results.push({ offer_id: offer.id, analysis });
      } catch (err) {
        logger.error(`Failed to analyze offer ${offer.id}:`, err.message);
        results.push({ offer_id: offer.id, error: err.message });
      }
    }
    return results;
  }

  async test() {
    logger.info('Testing OpenRouter API...');
    try {
      const response = await this.client.chat.completions.create({
        model: this.model,
        messages: [{ role: 'user', content: 'Hello! Respond with one word.' }],
        max_tokens: 10,
      });
      logger.info(`✅ OpenRouter API connection successful (model: ${this.model})`);
      return true;
    } catch (err) {
      logger.error('❌ OpenRouter API connection failed:', err.message);
      if (err.error) logger.error('Detail:', JSON.stringify(err.error));
      throw err;
    }
  }
}

module.exports = OpenRouterAnalyzer;

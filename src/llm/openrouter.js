const axios = require('axios');
const logger = require('../utils/logger');
const { sleep, exponentialBackoff } = require('../utils/delays');
const config = require('../../config/constants');

const SYSTEM_PROMPT = `You are an expert product offer analyzer for Italian Telegram deal channels.
Offers are mostly in Italian. Your job is to:

1. Extract key product information from the offer message
2. Match it against the user's interests (each interest has a keyword and an optional description that clarifies intent)
3. Assign a confidence score 0–100
4. Generate a concise Italian summary (1–2 lines)
5. Categorize the offer

SCORING GUIDE:
- 80–100: direct match — the offer is clearly about what the user wants
- 50–79: partial/related match — same brand, same category, similar product, or plausible substitute
- 0–49: not relevant
Be generous with partial matches. If an interest has a description, use it to understand the user's intent and price expectations.
Extract the price (look for "€", "EUR", or numbers followed by "euro").

RESPONSE FORMAT — return ONLY valid JSON, no markdown fences:
{
  "product_name": "string",
  "category": "string",
  "confidence_score": number,
  "matched_interests": ["array", "of", "matched keywords"],
  "price": "string or null",
  "summary": "1–2 line Italian summary",
  "reasoning": "one sentence explaining the score"
}`;

class OpenRouterAnalyzer {
  constructor() {
    if (!config.OPEN_ROUTER_API_KEY) throw new Error('OPEN_ROUTER_API_KEY not set');
    this.apiKey = config.OPEN_ROUTER_API_KEY;
    this.model = config.OPEN_ROUTER_MODEL;
    this.endpoint = config.OPEN_ROUTER_ENDPOINT;
    this.requestQueue = [];
    this.isProcessing = false;
  }

  async analyzeOffer(offerText, interests) {
    return new Promise((resolve, reject) => {
      this.requestQueue.push({ offerText, interests, resolve, reject });
      this.processQueue();
    });
  }

  async processQueue() {
    if (this.isProcessing || this.requestQueue.length === 0) return;
    this.isProcessing = true;

    while (this.requestQueue.length > 0) {
      const { offerText, interests, resolve, reject } = this.requestQueue.shift();
      try {
        const result = await this.callOpenRouterWithRetry(offerText, interests);
        resolve(result);
      } catch (err) {
        reject(err);
      }

      await sleep(config.OPEN_ROUTER_REQUEST_DELAY_MS || 1000);
    }

    this.isProcessing = false;
  }

  async callOpenRouterWithRetry(offerText, interests, attemptNumber = 1, maxAttempts = 3) {
    try {
      const interestsList = interests
        .map(i => {
          let line = `- ${i.keyword} [${i.category}]`;
          if (i.description) line += `: ${i.description}`;
          return line;
        })
        .join('\n');

      const userPrompt = `User interests:\n${interestsList}\n\nOffer text:\n${offerText}\n\nReturn ONLY valid JSON.`;

      logger.debug(`Analyzing offer with OpenRouter (attempt ${attemptNumber}/${maxAttempts})`);

      const payload = {
        model: this.model,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.3,
        max_tokens: 500,
      };

      const headers = {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      };

      const response = await axios.post(this.endpoint, payload, { headers });

      // Try to extract content from a few response shapes
      let content = null;
      if (response.data) {
        if (response.data.choices && response.data.choices[0]) {
          content = response.data.choices[0].message?.content || response.data.choices[0].text || null;
        }
        if (!content && response.data.output && response.data.output[0] && response.data.output[0].content) {
          // openrouter can sometimes put text here
          const c = response.data.output[0].content[0];
          content = c && (c.text || c.type === 'message' && c.text) ? (c.text || c) : null;
        }
      }

      content = (content || '').toString().trim();
      content = content.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
      const result = JSON.parse(content);

      if (typeof result.confidence_score !== 'number' || !result.summary) {
        throw new Error('Invalid OpenRouter response: missing required fields');
      }

      logger.debug(`OpenRouter analysis: ${result.product_name} (${result.confidence_score}%)`);
      return result;
    } catch (err) {
      // Rate limit / retry logic
      const status = err?.response?.status;
      const errMsg = err?.message || '';
      if (status === 429 || /rate/i.test(errMsg)) {
        logger.warn(`⚠️  OpenRouter rate limited (attempt ${attemptNumber}/${maxAttempts})`);
        if (attemptNumber < maxAttempts) {
          await exponentialBackoff(attemptNumber, 2000);
          return this.callOpenRouterWithRetry(offerText, interests, attemptNumber + 1, maxAttempts);
        }
      }

      // JSON parse error recovery
      if (err instanceof SyntaxError && err.message.includes('JSON')) {
        logger.warn('Failed to parse OpenRouter JSON response. Attempting recovery...');
        if (attemptNumber < maxAttempts) {
          await sleep(1000);
          return this.callOpenRouterWithRetry(offerText, interests, attemptNumber + 1, maxAttempts);
        }
      }

      logger.error('OpenRouter API error:', errMsg);
      throw err;
    }
  }

  async analyzeOffersBatch(offers, interests) {
    const results = [];
    for (const offer of offers) {
      try {
        const analysis = await this.analyzeOffer(offer.raw_text, interests);
        results.push({ offer_id: offer.id, analysis });
      } catch (err) {
        logger.error(`Failed to analyze offer ${offer.id}:`, err.message || err);
        results.push({ offer_id: offer.id, error: err.message });
      }
    }
    return results;
  }

  async test() {
    try {
      logger.info('Testing OpenRouter API...');
      const payload = {
        model: this.model,
        messages: [{ role: 'user', content: 'Hello from OfferRadar test. Reply with one word.' }],
        max_tokens: 10,
      };
      const headers = { 'Authorization': `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' };
      await axios.post(this.endpoint, payload, { headers });
      logger.info('✅ OpenRouter API connection successful');
      return true;
    } catch (err) {
      logger.error('❌ OpenRouter API connection failed:', err.message || err);
      throw err;
    }
  }
}

module.exports = OpenRouterAnalyzer;

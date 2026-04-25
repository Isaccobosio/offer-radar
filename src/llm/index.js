const Groq = require('groq-sdk');
const logger = require('../utils/logger');
const { sleep, exponentialBackoff } = require('../utils/delays');
const { handleGroqError, GroqRateLimitError } = require('../utils/errors');
const config = require('../../config/constants');

const SYSTEM_PROMPT = `You are an expert product offer analyzer. Your job is to:

1. Extract key product information from an offer message
2. Match it against user interests
3. Assign a confidence score (0-100%)
4. Generate a concise summary
5. Categorize the offer

IMPORTANT RULES:
- Only return HIGH confidence matches (>70%). Be strict and prefer false negatives.
- If unsure about relevance, return confidence < 70
- Summary should be 1-2 lines, concise and actionable
- Extract price if available
- Be smart about typos and variations (e.g., "AirPods", "airpods", "air pods" should all match)
- Look for partial matches too (e.g., if interested in "battery", match "10000mAh battery", "power bank", etc.)

RESPONSE FORMAT - Return ONLY valid JSON:
{
  "product_name": "string",
  "category": "string", 
  "confidence_score": number,
  "matched_interests": ["array", "of", "keywords"],
  "price": "string or null",
  "summary": "concise 1-2 line summary",
  "reasoning": "brief explanation of score"
}`;

class GroqAnalyzer {
  constructor() {
    this.client = new Groq({
      apiKey: config.GROQ_API_KEY,
    });
    this.requestQueue = [];
    this.isProcessing = false;
  }

  /**
   * Queue an analysis request
   */
  async analyzeOffer(offerText, interests) {
    return new Promise((resolve, reject) => {
      this.requestQueue.push({ offerText, interests, resolve, reject });
      this.processQueue();
    });
  }

  /**
   * Process queued requests with rate limiting
   */
  async processQueue() {
    if (this.isProcessing || this.requestQueue.length === 0) return;

    this.isProcessing = true;

    while (this.requestQueue.length > 0) {
      const { offerText, interests, resolve, reject } = this.requestQueue.shift();

      try {
        const result = await this.callGroqWithRetry(offerText, interests);
        resolve(result);
      } catch (err) {
        reject(err);
      }

      // Rate limiting: delay between requests (safe for free tier)
      await sleep(config.GROQ_REQUEST_DELAY_MS);
    }

    this.isProcessing = false;
  }

  /**
   * Call Groq API with automatic retry on rate limit
   */
  async callGroqWithRetry(offerText, interests, attemptNumber = 1, maxAttempts = 3) {
    try {
      // Format interests for the prompt
      const interestsList = interests
        .map(i => `- ${i.keyword} (${i.category})`)
        .join('\n');

      const userPrompt = `User's interests to match against:
${interestsList}

Offer to analyze:
${offerText}

Return ONLY valid JSON.`;

      logger.debug(`Analyzing offer with Groq (attempt ${attemptNumber}/${maxAttempts})`);

      const response = await this.client.chat.completions.create({
        model: config.GROQ_MODEL,
        messages: [
          {
            role: 'system',
            content: SYSTEM_PROMPT,
          },
          {
            role: 'user',
            content: userPrompt,
          },
        ],
        temperature: 0.3, // Lower temp for consistent results
        max_tokens: 500,
      });

      const content = response.choices[0].message.content;
      const result = JSON.parse(content);

      // Validate response
      if (!result.confidence_score || !result.summary) {
        throw new Error('Invalid Groq response: missing required fields');
      }

      logger.debug(`Groq analysis: ${result.product_name} (${result.confidence_score}%)`);
      return result;
    } catch (err) {
      // Handle Groq-specific errors
      if (err.status === 429 || err.message?.includes('rate')) {
        logger.warn(`⚠️  Groq rate limited (attempt ${attemptNumber}/${maxAttempts})`);

        if (attemptNumber < maxAttempts) {
          await exponentialBackoff(attemptNumber, 2000); // Start with 2s
          return this.callGroqWithRetry(offerText, interests, attemptNumber + 1, maxAttempts);
        }
      }

      // JSON parse error - try to extract JSON from response
      if (err instanceof SyntaxError && err.message.includes('JSON')) {
        logger.warn('Failed to parse Groq JSON response. Attempting recovery...');
        if (attemptNumber < maxAttempts) {
          await sleep(1000);
          return this.callGroqWithRetry(offerText, interests, attemptNumber + 1, maxAttempts);
        }
      }

      logger.error(`Groq API error:`, err.message);
      throw err;
    }
  }

  /**
   * Batch analyze multiple offers
   */
  async analyzeOffersBatch(offers, interests) {
    const results = [];

    for (const offer of offers) {
      try {
        const analysis = await this.analyzeOffer(offer.raw_text, interests);
        results.push({
          offer_id: offer.id,
          analysis,
        });
      } catch (err) {
        logger.error(`Failed to analyze offer ${offer.id}:`, err.message);
        results.push({
          offer_id: offer.id,
          error: err.message,
        });
      }
    }

    return results;
  }

  /**
   * Test Groq connection
   */
  async test() {
    try {
      logger.info('Testing Groq API...');
      const response = await this.client.chat.completions.create({
        model: config.GROQ_MODEL,
        messages: [
          {
            role: 'user',
            content: 'Hello! Just a quick test. Respond with one word.',
          },
        ],
        max_tokens: 10,
      });

      logger.info('✅ Groq API connection successful');
      return true;
    } catch (err) {
      logger.error('❌ Groq API connection failed:', err.message);
      throw err;
    }
  }
}

module.exports = GroqAnalyzer;

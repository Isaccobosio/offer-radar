const { sleep, exponentialBackoff } = require('../../utils/delays');
const { SYSTEM_PROMPT, SYSTEM_PROMPT_BATCH, SEARCH_PARSE_PROMPT } = require('../prompts');
const logger = require('../../utils/logger');

class BaseProvider {
  constructor({ name, client, model, searchModel, rpdLimit }) {
    this.name = name;
    this.client = client;
    this.model = model;
    this.searchModel = searchModel;
    this.rpdLimit = rpdLimit;
    this.requestsToday = 0;
    this.quotaExhausted = false;
    this.cooldownUntil = 0;
    this.lastResetDate = new Date().toDateString();
  }

  isAvailable() {
    this._checkDailyReset();
    if (this.quotaExhausted) return false;
    if (Date.now() < this.cooldownUntil) return false;
    return true;
  }

  markRateLimited(err) {
    // Permanent daily exhaustion
    if (err && err._exhausted) {
      this.quotaExhausted = true;
      logger.warn(`[${this.name}] daily quota exhausted — skipping until midnight`);
      return;
    }
    // Transient 429 — short cooldown, not full exhaustion
    this.cooldownUntil = Date.now() + 30000;
    logger.warn(`[${this.name}] rate limited — cooling down 30s`);
  }

  resetDaily() {
    this.requestsToday = 0;
    this.quotaExhausted = false;
    this.cooldownUntil = 0;
    this.lastResetDate = new Date().toDateString();
  }

  _checkDailyReset() {
    const today = new Date().toDateString();
    if (this.lastResetDate !== today) {
      this.resetDaily();
    }
  }

  // Returns { content: string, remaining: number|null }
  async chat({ messages, temperature = 0.3, max_tokens = 700 }) {
    const { data: response, response: rawResponse } = await this.client.chat.completions.create({
      model: this.model,
      messages,
      temperature,
      max_tokens,
    }).withResponse();

    const raw = response.choices?.[0]?.message?.content;
    if (!raw) throw new Error(`Empty response from ${this.name}`);

    const remainingHeader = rawResponse.headers.get('x-ratelimit-requests-remaining');
    const remaining = remainingHeader !== null ? parseInt(remainingHeader, 10) : null;

    return { content: raw, remaining };
  }

  async chatSearch({ messages }) {
    const response = await this.client.chat.completions.create({
      model: this.searchModel,
      messages,
      temperature: 0,
      max_tokens: 60,
    });
    const raw = response.choices?.[0]?.message?.content || '';
    return { content: raw, remaining: null };
  }

  async callWithRetry(messages, opts = {}, attempt = 1) {
    const { max_tokens = 700, maxAttempts = 3 } = opts;
    try {
      const result = await this.chat({ messages, max_tokens });
      this.requestsToday++;

      const rpdHit = this.rpdLimit > 0 && this.requestsToday >= this.rpdLimit;
      if (rpdHit) {
        const err = new Error(`[${this.name}] RPD limit reached`);
        err._exhausted = true;
        this.markRateLimited(err);
      }

      return result;
    } catch (err) {
      if (err.status === 429) {
        logger.warn(`[${this.name}] 429 (attempt ${attempt}/${maxAttempts})`);
        if (attempt < maxAttempts) {
          await exponentialBackoff(attempt, 2000);
          return this.callWithRetry(messages, opts, attempt + 1);
        }
        throw err;
      }
      if (err instanceof SyntaxError && attempt < maxAttempts) {
        await sleep(1000);
        return this.callWithRetry(messages, opts, attempt + 1);
      }
      throw err;
    }
  }

  buildOfferMessages(offerText, interests, feedbackContext = []) {
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

    return [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: `User interests:\n${interestsList}${feedbackSection}\n\nOffer text:\n${offerText}\n\nReturn ONLY valid JSON.` },
    ];
  }

  buildOfferBatchMessages(offers, interests, feedbackContext = []) {
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

    const offersSection = offers
      .map((o, idx) => `### Offer ${idx}\n${o.raw_text}`)
      .join('\n\n');

    return [
      { role: 'system', content: SYSTEM_PROMPT_BATCH },
      { role: 'user', content: `User interests:\n${interestsList}${feedbackSection}\n\n${offersSection}\n\nReturn ONLY a valid JSON array with ${offers.length} objects.` },
    ];
  }

  buildSearchMessages(query) {
    return [
      { role: 'system', content: SEARCH_PARSE_PROMPT },
      { role: 'user', content: query },
    ];
  }
}

module.exports = BaseProvider;

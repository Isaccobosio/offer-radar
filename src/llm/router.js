const logger = require('../utils/logger');
const { sleep } = require('../utils/delays');

class AllProvidersExhaustedError extends Error {
  constructor() {
    super('All LLM providers exhausted or rate-limited');
    this.status = 429;
    this.allExhausted = true;
  }
}

class LLMRouter {
  constructor(providers) {
    this.providers = providers;
    this._searchCache = new Map();
  }

  // Returns analysis result with _rateLimit.remaining = aggregate remaining across non-exhausted providers
  async extractOffer(offerText, interests, feedbackContext = []) {
    const messages = this.providers[0]?.buildOfferMessages(offerText, interests, feedbackContext);
    if (!messages) throw new AllProvidersExhaustedError();

    let lastErr;
    for (const provider of this.providers) {
      if (!provider.isAvailable()) {
        logger.debug(`[router] skipping ${provider.name} (unavailable)`);
        continue;
      }

      try {
        const provMessages = provider.buildOfferMessages(offerText, interests, feedbackContext);
        const { content, remaining } = await provider.callWithRetry(provMessages);

        const cleaned = content.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
        const result = JSON.parse(cleaned);

        if (result.score !== undefined && result.confidence_score === undefined) {
          result.confidence_score = result.score;
        }
        result.product_name = result.clean_title || result.product_name || null;
        if (typeof result.price === 'number') {
          result._price_number = result.price;
          result.price = String(result.price);
        }

        if (typeof result.confidence_score !== 'number' || !result.summary) {
          throw new Error('Invalid response: missing required fields');
        }

        result._rateLimit = { remaining: this._aggregateRemaining(provider, remaining) };
        result._provider = provider.name;

        logger.debug(`[router] ${provider.name} extracted: ${result.clean_title || '?'} (${result.confidence_score}%)`);
        return result;
      } catch (err) {
        if (err.status === 429) {
          provider.markRateLimited(err);
          logger.warn(`[router] ${provider.name} 429 — trying next provider`);
          lastErr = err;
          continue;
        }
        if (err instanceof SyntaxError) {
          logger.warn(`[router] ${provider.name} JSON parse error — trying next provider`);
          lastErr = err;
          continue;
        }
        throw err;
      }
    }

    throw lastErr?.status === 429 ? new AllProvidersExhaustedError() : (lastErr || new AllProvidersExhaustedError());
  }

  async analyzeOffer(offerText, interests, feedbackContext = []) {
    return this.extractOffer(offerText, interests, feedbackContext);
  }

  async parseSearchQuery(query) {
    const key = query.toLowerCase().trim();
    const cached = this._searchCache.get(key);
    if (cached && Date.now() - cached.ts < 3600000) return cached.value;

    if (this._searchCache.size >= 100) {
      const oldest = [...this._searchCache.entries()].sort((a, b) => a[1].ts - b[1].ts)[0];
      if (oldest) this._searchCache.delete(oldest[0]);
    }

    for (const provider of this.providers) {
      if (!provider.isAvailable()) continue;
      try {
        const messages = provider.buildSearchMessages(query);
        const { content } = await provider.chatSearch({ messages });
        const cleaned = content.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
        const parsed = JSON.parse(cleaned);
        const value = { brand: parsed.brand || null, model: parsed.model || null };
        this._searchCache.set(key, { value, ts: Date.now() });
        return value;
      } catch (err) {
        logger.warn(`[router] parseSearchQuery failed on ${provider.name}:`, err.message);
      }
    }

    logger.warn('[router] parseSearchQuery: all providers failed, using raw query');
    return { brand: null, model: null };
  }

  async analyzeOffersBatch(offers, interests) {
    const results = [];
    for (const offer of offers) {
      try {
        const analysis = await this.extractOffer(offer.raw_text, interests);
        results.push({ offer_id: offer.id, analysis });
      } catch (err) {
        logger.error(`[router] batch failed for offer ${offer.id}:`, err.message);
        results.push({ offer_id: offer.id, error: err.message });
      }
      await sleep(200);
    }
    return results;
  }

  // Aggregated fetchKeyLimits: tries OpenRouter for real limits, sums RPD across providers
  async fetchKeyLimits() {
    const orProvider = this.providers.find(p => p.name === 'openrouter');
    let orLimits = {};
    if (orProvider && typeof orProvider.fetchKeyLimits === 'function') {
      try {
        orLimits = await orProvider.fetchKeyLimits();
        if (orLimits.rpdLimit !== null) {
          orProvider.rpdLimit = orLimits.rpdLimit;
        }
      } catch (err) {
        logger.warn('[router] Could not fetch OpenRouter key limits:', err.message);
      }
    }

    // Return aggregate daily capacity across all providers
    const totalRpd = this.providers.reduce((sum, p) => sum + (p.rpdLimit || 0), 0);
    return {
      rpdLimit: totalRpd || null,
      rpmLimit: orLimits.rpmLimit ?? null,
      isFreeTier: orLimits.isFreeTier ?? null,
      usage: orLimits.usage ?? null,
      creditLimit: orLimits.creditLimit ?? null,
    };
  }

  async test() {
    const active = [];
    const failed = [];
    for (const provider of this.providers) {
      try {
        await provider.client.chat.completions.create({
          model: provider.model,
          messages: [{ role: 'user', content: 'Hello! Respond with one word.' }],
          max_tokens: 10,
        });
        logger.info(`✅ [router] ${provider.name} OK (model: ${provider.model})`);
        active.push(provider.name);
      } catch (err) {
        logger.warn(`⚠️  [router] ${provider.name} test failed: ${err.message}`);
        failed.push(provider.name);
      }
    }
    if (active.length === 0) throw new Error('No LLM providers available');
    return true;
  }

  _aggregateRemaining(usedProvider, apiRemaining) {
    // Sum remaining capacity across all non-exhausted providers
    let total = 0;
    for (const p of this.providers) {
      if (p.quotaExhausted) continue;
      if (p === usedProvider && apiRemaining !== null) {
        total += apiRemaining;
      } else {
        total += Math.max(0, p.rpdLimit - p.requestsToday);
      }
    }
    return total;
  }
}

module.exports = LLMRouter;

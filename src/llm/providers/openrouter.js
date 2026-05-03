const OpenAI = require('openai');
const config = require('../../../config/constants');
const BaseProvider = require('./base');

class OpenRouterProvider extends BaseProvider {
  constructor() {
    const client = new OpenAI({
      apiKey: config.OPEN_ROUTER_API_KEY,
      baseURL: 'https://openrouter.ai/api/v1',
      defaultHeaders: { 'X-Title': 'OfferRadar' },
    });
    super({
      name: 'openrouter',
      client,
      model: config.OPEN_ROUTER_MODEL,
      searchModel: config.OPEN_ROUTER_SEARCH_MODEL,
      rpdLimit: config.OPENROUTER_RPD_LIMIT,
    });
  }

  // OpenRouter exposes a key-limits endpoint; override to auto-detect real RPD
  async fetchKeyLimits() {
    const response = await fetch('https://openrouter.ai/api/v1/auth/key', {
      headers: { Authorization: `Bearer ${config.OPEN_ROUTER_API_KEY}` },
    });
    if (!response.ok) throw new Error(`OpenRouter key endpoint: ${response.status}`);
    const body = await response.json();
    const data = body.data || {};
    const rateLimit = data.rate_limit || {};
    const intervalSec = rateLimit.interval ? parseInt(rateLimit.interval, 10) : null;
    return {
      rpdLimit: intervalSec >= 86400 ? (rateLimit.requests ?? null) : null,
      rpmLimit: intervalSec && intervalSec < 86400 ? (rateLimit.requests ?? null) : null,
      isFreeTier: data.is_free_tier ?? null,
      usage: data.usage ?? null,
      creditLimit: data.limit ?? null,
    };
  }
}

module.exports = OpenRouterProvider;

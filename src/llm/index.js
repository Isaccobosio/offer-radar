const config = require('../../config/constants');
const logger = require('../utils/logger');
const LLMRouter = require('./router');
const GroqProvider = require('./providers/groq');
const GeminiProvider = require('./providers/gemini');
const OpenRouterProvider = require('./providers/openrouter');

const PROVIDER_FACTORIES = {
  groq: () => config.GROQ_API_KEY ? new GroqProvider() : null,
  gemini: () => config.GEMINI_API_KEY ? new GeminiProvider() : null,
  openrouter: () => config.OPEN_ROUTER_API_KEY ? new OpenRouterProvider() : null,
};

function createLLMRouter() {
  const providers = [];
  const skipped = [];

  for (const name of config.LLM_PROVIDERS) {
    const factory = PROVIDER_FACTORIES[name];
    if (!factory) {
      logger.warn(`[llm] Unknown provider in LLM_PROVIDERS: "${name}" — skipping`);
      continue;
    }
    const provider = factory();
    if (provider) {
      providers.push(provider);
    } else {
      skipped.push(name);
    }
  }

  if (providers.length === 0) return null;

  const activeNames = providers.map(p => p.name).join(', ');
  const skippedStr = skipped.length ? ` (${skipped.join(', ')} skipped — no key)` : '';
  logger.info(`🧠 LLM router: ${activeNames} active${skippedStr}`);

  return new LLMRouter(providers);
}

module.exports = createLLMRouter;

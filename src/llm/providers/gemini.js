const OpenAI = require('openai');
const config = require('../../../config/constants');
const BaseProvider = require('./base');

class GeminiProvider extends BaseProvider {
  constructor() {
    const client = new OpenAI({
      apiKey: config.GEMINI_API_KEY,
      baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai/',
    });
    super({
      name: 'gemini',
      client,
      model: config.GEMINI_MODEL,
      searchModel: config.GEMINI_SEARCH_MODEL,
      rpdLimit: config.GEMINI_RPD_LIMIT,
    });
  }
}

module.exports = GeminiProvider;

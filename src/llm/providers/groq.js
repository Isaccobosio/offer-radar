const OpenAI = require('openai');
const config = require('../../../config/constants');
const BaseProvider = require('./base');

class GroqProvider extends BaseProvider {
  constructor() {
    const client = new OpenAI({
      apiKey: config.GROQ_API_KEY,
      baseURL: 'https://api.groq.com/openai/v1',
    });
    super({
      name: 'groq',
      client,
      model: config.GROQ_MODEL,
      searchModel: config.GROQ_SEARCH_MODEL,
      rpdLimit: config.GROQ_RPD_LIMIT,
    });
  }
}

module.exports = GroqProvider;

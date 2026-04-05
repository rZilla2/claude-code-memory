import type { Config } from '../../types.js';
import type { EmbeddingProvider } from './types.js';
import { OpenAIEmbeddingProvider } from './openai.js';

export function createEmbeddingProvider(config: Config): EmbeddingProvider {
  if (config.embeddingProvider === 'openai') {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error('OPENAI_API_KEY environment variable is required');
    }
    return new OpenAIEmbeddingProvider(apiKey, config.openaiModel, config.batchSize, config.concurrency);
  }

  if (config.embeddingProvider === 'ollama') {
    throw new Error('Ollama embedding provider is not yet implemented (planned for Phase 6)');
  }

  throw new Error(`Unknown embedding provider: ${config.embeddingProvider}`);
}

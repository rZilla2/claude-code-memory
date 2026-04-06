import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Config } from '../../types.js';

const mockCreate = vi.fn();

vi.mock('openai', () => {
  class MockOpenAI {
    embeddings = { create: mockCreate };
    constructor(_opts: unknown) {}
  }
  return { default: MockOpenAI, OpenAI: MockOpenAI };
});

vi.mock('p-limit', () => ({
  default: vi.fn((_concurrency: number) => (fn: () => unknown) => fn()),
}));

vi.mock('./ollama.js', () => ({
  OllamaEmbeddingProvider: vi.fn(),
}));

import { createEmbeddingProvider } from './factory.js';
import { OpenAIEmbeddingProvider } from './openai.js';
import { OllamaEmbeddingProvider } from './ollama.js';

const baseConfig: Config = {
  vaultPath: '/test/vault',
  indexPath: '/test/index',
  embeddingProvider: 'openai',
  openaiModel: 'text-embedding-3-small',
  ollamaModel: 'nomic-embed-text',
  ollamaBaseUrl: 'http://localhost:11434',
  batchSize: 100,
  concurrency: 2,
  ignorePaths: [],
  includeExtensions: ['.md'],
};

describe('createEmbeddingProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.OPENAI_API_KEY = 'test-api-key';
  });

  it('returns OpenAIEmbeddingProvider when embeddingProvider is "openai"', () => {
    const provider = createEmbeddingProvider(baseConfig);
    expect(provider).toBeInstanceOf(OpenAIEmbeddingProvider);
  });

  it('returned provider modelId() matches expected openai format', () => {
    const provider = createEmbeddingProvider(baseConfig);
    expect(provider.modelId()).toBe('openai:text-embedding-3-small');
  });

  it('throws when OPENAI_API_KEY is not set', () => {
    delete process.env.OPENAI_API_KEY;
    expect(() => createEmbeddingProvider(baseConfig)).toThrow('OPENAI_API_KEY');
  });

  it('returns OllamaEmbeddingProvider when embeddingProvider is "ollama"', () => {
    const config: Config = { ...baseConfig, embeddingProvider: 'ollama' };
    createEmbeddingProvider(config);
    expect(OllamaEmbeddingProvider).toHaveBeenCalledWith('nomic-embed-text', 'http://localhost:11434');
  });

  it('passes custom ollamaModel to OllamaEmbeddingProvider', () => {
    const config: Config = {
      ...baseConfig,
      embeddingProvider: 'ollama',
      ollamaModel: 'mxbai-embed-large',
    };
    createEmbeddingProvider(config);
    expect(OllamaEmbeddingProvider).toHaveBeenCalledWith('mxbai-embed-large', 'http://localhost:11434');
  });
});

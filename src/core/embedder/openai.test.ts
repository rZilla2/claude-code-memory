import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { EmbeddingProvider } from './types.js';

// Shared mock for embeddings.create — set up before vi.mock hoisting
const mockCreate = vi.fn();

vi.mock('openai', () => {
  class MockOpenAI {
    embeddings = { create: mockCreate };
    constructor(_opts: unknown) {}
  }
  return { default: MockOpenAI, OpenAI: MockOpenAI };
});

vi.mock('p-limit', () => ({
  default: vi.fn((_concurrency: number) => {
    // Pass-through: immediately invoke the given fn
    return (fn: () => unknown) => fn();
  }),
}));

import { OpenAIEmbeddingProvider } from './openai.js';

describe('OpenAIEmbeddingProvider', () => {
  beforeEach(() => {
    mockCreate.mockReset();
  });

  it('implements EmbeddingProvider interface (type-level)', () => {
    const provider: EmbeddingProvider = new OpenAIEmbeddingProvider('test-key');
    expect(typeof provider.embed).toBe('function');
    expect(typeof provider.modelId).toBe('function');
  });

  it('modelId() returns "openai:text-embedding-3-small" for default model', () => {
    const provider = new OpenAIEmbeddingProvider('test-key');
    expect(provider.modelId()).toBe('openai:text-embedding-3-small');
  });

  it('modelId() returns correct id when constructed with text-embedding-3-large', () => {
    const provider = new OpenAIEmbeddingProvider('test-key', 'text-embedding-3-large');
    expect(provider.modelId()).toBe('openai:text-embedding-3-large');
  });

  it('embed([]) returns empty array without calling the API', async () => {
    const provider = new OpenAIEmbeddingProvider('test-key');
    const result = await provider.embed([]);
    expect(result).toEqual([]);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('embed(["hello"]) calls OpenAI embeddings.create and returns number[][]', async () => {
    const fakeEmbedding = Array(1536).fill(0.1);
    mockCreate.mockResolvedValueOnce({
      data: [{ embedding: fakeEmbedding }],
    });

    const provider = new OpenAIEmbeddingProvider('test-key');
    const result = await provider.embed(['hello']);

    expect(mockCreate).toHaveBeenCalledWith({
      model: 'text-embedding-3-small',
      input: ['hello'],
    });
    expect(result).toHaveLength(1);
    expect(result[0]).toHaveLength(1536);
  });

  it('embed(array of 150 items) splits into 2 batches (100 + 50)', async () => {
    const fakeEmbedding = Array(1536).fill(0.1);
    // First batch: 100 items
    mockCreate.mockResolvedValueOnce({
      data: Array(100).fill({ embedding: fakeEmbedding }),
    });
    // Second batch: 50 items
    mockCreate.mockResolvedValueOnce({
      data: Array(50).fill({ embedding: fakeEmbedding }),
    });

    const provider = new OpenAIEmbeddingProvider('test-key', 'text-embedding-3-small', 100, 2);
    const texts = Array(150).fill('test text');
    const result = await provider.embed(texts);

    expect(mockCreate).toHaveBeenCalledTimes(2);
    expect(result).toHaveLength(150);
  });

  it('embed respects concurrency limit via p-limit (mock pass-through)', async () => {
    const fakeEmbedding = Array(1536).fill(0.1);
    mockCreate.mockResolvedValueOnce({ data: [{ embedding: fakeEmbedding }] });

    const provider = new OpenAIEmbeddingProvider('test-key', 'text-embedding-3-small', 100, 2);
    const result = await provider.embed(['text']);
    expect(result).toHaveLength(1);
  });
});

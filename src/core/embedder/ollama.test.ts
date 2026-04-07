import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { OllamaEmbeddingProvider } from './ollama.js';

describe('OllamaEmbeddingProvider', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    global.fetch = fetchMock;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('modelId() returns "ollama:nomic-embed-text" with default model', () => {
    const provider = new OllamaEmbeddingProvider();
    expect(provider.modelId()).toBe('ollama:nomic-embed-text');
  });

  it('modelId() returns "ollama:custom-model" when constructed with custom model', () => {
    const provider = new OllamaEmbeddingProvider('custom-model');
    expect(provider.modelId()).toBe('ollama:custom-model');
  });

  it('embed([]) returns [] without making any fetch call', async () => {
    const provider = new OllamaEmbeddingProvider();
    const result = await provider.embed([]);
    expect(result).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('embed(["hello", "world"]) calls fetch to the correct endpoint with correct body and returns embeddings', async () => {
    const provider = new OllamaEmbeddingProvider();
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ embeddings: [[0.1, 0.2], [0.3, 0.4]] }),
    });

    const result = await provider.embed(['hello', 'world']);

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe('http://localhost:11434/api/embed');
    expect(options.method).toBe('POST');
    const body = JSON.parse(options.body);
    expect(body.model).toBe('nomic-embed-text');
    expect(body.input).toEqual(['hello', 'world']);
    expect(result).toEqual([[0.1, 0.2], [0.3, 0.4]]);
  });

  it('embed() batches inputs when array exceeds batchSize (batchSize=2 with 3 texts makes 2 fetch calls)', async () => {
    const provider = new OllamaEmbeddingProvider('nomic-embed-text', 'http://localhost:11434', 2);
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ embeddings: [[0.1, 0.2], [0.3, 0.4]] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ embeddings: [[0.5, 0.6]] }),
      });

    const result = await provider.embed(['a', 'b', 'c']);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result).toHaveLength(3);
    expect(result).toEqual([[0.1, 0.2], [0.3, 0.4], [0.5, 0.6]]);
  });

  it('embed() throws user-friendly error containing "ollama serve" when fetch gets ECONNREFUSED', async () => {
    const provider = new OllamaEmbeddingProvider();
    const connRefusedError = Object.assign(new Error('fetch failed'), {
      cause: { code: 'ECONNREFUSED' },
    });
    fetchMock.mockRejectedValueOnce(connRefusedError);

    await expect(provider.embed(['test'])).rejects.toThrow(/ollama serve/i);
  });

  it('embed() throws on non-OK HTTP status with status code in message', async () => {
    const provider = new OllamaEmbeddingProvider();
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
    });

    await expect(provider.embed(['test'])).rejects.toThrow(/500/);
  });

  it('full embed cycle: multiple texts produce correct dimensionality vectors', async () => {
    const dims = 768; // nomic-embed-text dimension
    const provider = new OllamaEmbeddingProvider();
    const texts = ['first document about coding', 'second document about cooking', 'third document about music'];

    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        embeddings: texts.map(() => Array.from({ length: dims }, () => Math.random())),
      }),
    });

    const vectors = await provider.embed(texts);

    expect(vectors).toHaveLength(3);
    for (const vec of vectors) {
      expect(vec).toHaveLength(dims);
      expect(vec.every(v => typeof v === 'number')).toBe(true);
    }
  });

  it('custom baseUrl is used in fetch calls', async () => {
    const provider = new OllamaEmbeddingProvider('nomic-embed-text', 'http://myhost:9999');
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ embeddings: [[0.1]] }),
    });

    await provider.embed(['test']);

    expect(fetchMock.mock.calls[0][0]).toBe('http://myhost:9999/api/embed');
  });
});

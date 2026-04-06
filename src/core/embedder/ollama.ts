import type { EmbeddingProvider } from './types.js';

/** Split an array into chunks of the given size. */
function chunk<T>(array: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}

export class OllamaEmbeddingProvider implements EmbeddingProvider {
  private readonly model: string;
  private readonly baseUrl: string;
  private readonly batchSize: number;

  constructor(
    model: string = 'nomic-embed-text',
    baseUrl: string = 'http://localhost:11434',
    batchSize: number = 20,
  ) {
    this.model = model;
    this.baseUrl = baseUrl;
    this.batchSize = batchSize;
  }

  modelId(): string {
    return `ollama:${this.model}`;
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) {
      return [];
    }

    const batches = chunk(texts, this.batchSize);
    const results: number[][] = [];

    for (const batch of batches) {
      let res: Response;
      try {
        res = await fetch(`${this.baseUrl}/api/embed`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: this.model, input: batch }),
        });
      } catch (err: unknown) {
        const cause = (err as { cause?: { code?: string } }).cause;
        if (cause?.code === 'ECONNREFUSED') {
          throw new Error(
            'Ollama is not running. Start it with `ollama serve` or install from https://ollama.ai',
          );
        }
        throw err;
      }

      if (!res.ok) {
        throw new Error(`Ollama embed error: ${res.status} ${res.statusText}`);
      }

      const data = (await res.json()) as { embeddings: number[][] };
      results.push(...data.embeddings);
    }

    return results;
  }
}

import type { EmbeddingProvider } from './types.js';
import { chunk } from './utils.js';

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

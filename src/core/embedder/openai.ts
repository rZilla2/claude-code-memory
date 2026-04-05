import OpenAI from 'openai';
import pLimit from 'p-limit';
import type { EmbeddingProvider } from './types.js';

/** Split an array into chunks of the given size. */
function chunk<T>(array: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}

export class OpenAIEmbeddingProvider implements EmbeddingProvider {
  private readonly client: OpenAI;
  private readonly model: string;
  private readonly batchSize: number;
  private readonly limit: ReturnType<typeof pLimit>;

  constructor(
    apiKey: string,
    model: string = 'text-embedding-3-small',
    batchSize: number = 100,
    concurrency: number = 2,
  ) {
    this.client = new OpenAI({ apiKey });
    this.model = model;
    this.batchSize = batchSize;
    this.limit = pLimit(concurrency);
  }

  modelId(): string {
    return `openai:${this.model}`;
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) {
      return [];
    }

    const batches = chunk(texts, this.batchSize);

    const batchResults = await Promise.all(
      batches.map((batch) =>
        this.limit(() =>
          this.client.embeddings
            .create({ model: this.model, input: batch })
            .then((res) => res.data.map((d) => d.embedding)),
        ),
      ),
    );

    return batchResults.flat();
  }
}

export interface Config {
  vaultPath: string;
  indexPath: string;
  embeddingProvider: 'openai' | 'ollama';
  openaiModel: string;
  batchSize: number;
  concurrency: number;
}

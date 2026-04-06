export interface Config {
  vaultPath: string;
  indexPath: string;
  embeddingProvider: 'openai' | 'ollama';
  openaiModel: string;
  ollamaModel?: string;
  ollamaBaseUrl?: string;
  batchSize: number;
  concurrency: number;
  ignorePaths: string[];
  includeExtensions: string[];
  stalenessDecayRate: number;
}

export interface SearchResult {
  id: string;
  sourcePath: string;
  headingPath: string;
  text: string;
  score: number;
  indexedAt: Date;
}

export interface SearchOptions {
  topK?: number;
  mode?: 'vector' | 'fts' | 'hybrid';
  afterDate?: Date;
  beforeDate?: Date;
  sourceGlob?: string;
  stalenessDecayRate?: number;
}

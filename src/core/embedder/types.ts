/**
 * Pluggable embedding provider interface.
 * All embedding calls go through this contract.
 * Implementations: OpenAIEmbeddingProvider (Phase 1), OllamaEmbeddingProvider (Phase 6)
 */
export interface EmbeddingProvider {
  /**
   * Generate embeddings for an array of text inputs.
   * Implementations handle batching internally.
   * @param texts - Array of strings to embed
   * @returns Promise resolving to array of number arrays (one vector per input text)
   */
  embed(texts: string[]): Promise<number[][]>;

  /**
   * Returns a stable identifier for the model being used.
   * Format: 'provider:model-name' (e.g., 'openai:text-embedding-3-small')
   * Stored in SQLite for mismatch detection across sessions.
   */
  modelId(): string;
}

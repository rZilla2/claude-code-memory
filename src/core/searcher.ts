import * as lancedb from '@lancedb/lancedb';
import type { EmbeddingProvider } from './embedder/types.js';
import type { SearchOptions, SearchResult } from '../types.js';

const DEFAULT_TOP_K = 10;
const RRF_OVERFETCH_MULTIPLIER = 3;
const RESULT_COLUMNS = ['id', 'text', 'source_path', 'heading_path', 'indexed_at'];

function buildWherePredicate(options: SearchOptions): string | undefined {
  const conditions: string[] = [];
  if (options.afterDate) {
    conditions.push(`indexed_at >= ${options.afterDate.getTime()}`);
  }
  if (options.beforeDate) {
    conditions.push(`indexed_at <= ${options.beforeDate.getTime()}`);
  }
  if (options.sourceGlob) {
    conditions.push(`source_path LIKE '${options.sourceGlob.replace(/'/g, "''")}'`);
  }
  return conditions.length > 0 ? conditions.join(' AND ') : undefined;
}

function rowToResult(row: Record<string, unknown>): SearchResult {
  return {
    id: row['id'] as string,
    sourcePath: row['source_path'] as string,
    headingPath: row['heading_path'] as string,
    text: row['text'] as string,
    score: (row['_distance'] as number) ?? (row['_score'] as number) ?? 0,
    indexedAt: new Date(Number(row['indexed_at'])),
  };
}

export async function search(
  query: string,
  table: lancedb.Table,
  embedder: EmbeddingProvider,
  options: SearchOptions = {},
): Promise<SearchResult[]> {
  const { topK = DEFAULT_TOP_K, mode = 'hybrid' } = options;
  const predicate = buildWherePredicate(options);

  if (mode === 'fts') {
    const q = table.search(query, 'fts').select(RESULT_COLUMNS).limit(topK);
    if (predicate) q.where(predicate);
    const rows = await q.toArray();
    return rows.map(rowToResult);
  }

  const queryVector = (await embedder.embed([query]))[0];

  if (mode === 'vector') {
    const q = table.search(queryVector as lancedb.IntoVector).select(RESULT_COLUMNS).limit(topK);
    if (predicate) q.where(predicate);
    const rows = await q.toArray();
    return rows.map(rowToResult);
  }

  // Hybrid: parallel vector + FTS, merge with RRF
  const fetchK = topK * RRF_OVERFETCH_MULTIPLIER;
  const [vecArrow, ftsArrow] = await Promise.all([
    table
      .search(queryVector as lancedb.IntoVector)
      .select(RESULT_COLUMNS)
      .withRowId()
      .limit(fetchK)
      .toArrow(),
    table.search(query, 'fts').select(RESULT_COLUMNS).withRowId().limit(fetchK).toArrow(),
  ]);

  const { RRFReranker } = lancedb.rerankers;
  const reranker = await RRFReranker.create();
  const merged = await reranker.rerankHybrid(
    query,
    vecArrow.batches[0],
    ftsArrow.batches[0],
  );

  // Convert RecordBatch to SearchResult[]
  const results: SearchResult[] = [];
  const numResults = Math.min(merged.numRows, topK);
  const fieldNames = merged.schema.fields.map((f) => f.name);
  const getField = (name: string, row: number): unknown => {
    const idx = fieldNames.indexOf(name);
    return idx >= 0 ? merged.getChildAt(idx)?.get(row) : undefined;
  };
  for (let i = 0; i < numResults; i++) {
    results.push({
      id: (getField('id', i) as string) ?? '',
      sourcePath: (getField('source_path', i) as string) ?? '',
      headingPath: (getField('heading_path', i) as string) ?? '',
      text: (getField('text', i) as string) ?? '',
      score:
        (getField('_relevance_score', i) as number) ??
        (getField('_score', i) as number) ??
        0,
      indexedAt: new Date(Number(getField('indexed_at', i) ?? 0)),
    });
  }
  return results;
}

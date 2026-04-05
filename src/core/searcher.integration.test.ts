/**
 * Integration tests for search() with a real LanceDB instance.
 *
 * These tests use a real tmp-dir LanceDB (no mocking) to verify:
 * - SRCH-01: Vector search returns semantically ranked results
 * - SRCH-02: FTS search finds exact keyword matches
 * - SRCH-03: Hybrid RRF merge works without error
 * - SRCH-04: Every result has all SearchResult fields populated
 * - SRCH-05: afterDate filter and sourceGlob filter work correctly
 *
 * Open questions validated here (per 03-RESEARCH.md):
 * - RRF field name for merged score (_relevance_score vs _score)
 * - BigInt WHERE predicate format for indexed_at
 * - FTS index creation and query behavior
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, rm } from 'fs/promises';
import os from 'os';
import path from 'path';
import * as lancedb from '@lancedb/lancedb';
import type { EmbeddingProvider } from './embedder/types.js';
import { ensureFtsIndex } from './db/lance.js';
import { search } from './searcher.js';

// ---------------------------------------------------------------------------
// Mock EmbeddingProvider
// ---------------------------------------------------------------------------

/**
 * Deterministic hash-to-vector function.
 * Maps text to a 1536-dim float32 vector by hashing text into byte pattern.
 * Biases certain semantic keywords toward specific dimensions to make
 * similarity meaningful in tests.
 */
function textToVector(text: string): number[] {
  const vec = new Array(1536).fill(0.1);
  // Simple deterministic hash: LCG over char codes to fill all 1536 dimensions
  let seed = 0;
  for (let i = 0; i < text.length; i++) {
    seed = ((seed * 31 + text.charCodeAt(i)) >>> 0);
  }
  for (let i = 0; i < 1536; i++) {
    // LCG: next = (a * seed + c) mod 2^32
    seed = ((1664525 * seed + 1013904223) >>> 0);
    vec[i] = (seed & 0xff) / 255;
  }
  // Keyword biases for semantic similarity
  if (text.toLowerCase().includes('calendar') || text.toLowerCase().includes('scheduling')) {
    vec[0] = 0.9; vec[1] = 0.9; vec[2] = 0.1;
  }
  if (text.toLowerCase().includes('xylophone')) {
    vec[0] = 0.1; vec[1] = 0.1; vec[2] = 0.9;
  }
  if (text.toLowerCase().includes('meeting')) {
    vec[0] = 0.85; vec[1] = 0.8;
  }
  if (text.toLowerCase().includes('health') || text.toLowerCase().includes('workout')) {
    vec[3] = 0.9; vec[4] = 0.9;
  }
  // Normalize to unit vector
  const magnitude = Math.sqrt(vec.reduce((s, v) => s + v * v, 0));
  return vec.map(v => v / (magnitude || 1));
}

class MockEmbeddingProvider implements EmbeddingProvider {
  embed(texts: string[]): Promise<number[][]> {
    return Promise.resolve(texts.map(t => textToVector(t)));
  }
  modelId(): string {
    return 'test:mock-1536';
  }
}

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------

const CHUNKS = [
  {
    id: 'c1',
    text: 'Meeting notes about calendar setup and scheduling',
    source_path: '/vault/Claude Lab/meetings.md',
    heading_path: 'Meetings > Calendar',
    indexed_at: BigInt(new Date('2025-06-15').getTime()),
    chunk_hash: 'hash-c1',
    embedding_model_id: 'test:mock-1536',
  },
  {
    id: 'c2',
    text: 'Daily xylophone practice schedule for beginners',
    source_path: '/vault/Health/music.md',
    heading_path: 'Music > Practice',
    indexed_at: BigInt(new Date('2025-03-01').getTime()),
    chunk_hash: 'hash-c2',
    embedding_model_id: 'test:mock-1536',
  },
  {
    id: 'c3',
    text: 'Project planning and roadmap discussion',
    source_path: '/vault/Claude Lab/planning.md',
    heading_path: 'Planning > Roadmap',
    indexed_at: BigInt(new Date('2024-01-15').getTime()),
    chunk_hash: 'hash-c3',
    embedding_model_id: 'test:mock-1536',
  },
  {
    id: 'c4',
    text: 'Workout routine and health tracking',
    source_path: '/vault/Health/fitness.md',
    heading_path: 'Health > Fitness',
    indexed_at: BigInt(new Date('2025-09-01').getTime()),
    chunk_hash: 'hash-c4',
    embedding_model_id: 'test:mock-1536',
  },
  {
    id: 'c5',
    text: 'Claude Code memory system architecture',
    source_path: '/vault/Claude Lab/architecture.md',
    heading_path: 'Architecture > Memory',
    indexed_at: BigInt(new Date('2025-11-01').getTime()),
    chunk_hash: 'hash-c5',
    embedding_model_id: 'test:mock-1536',
  },
];

// ---------------------------------------------------------------------------
// Setup / Teardown
// ---------------------------------------------------------------------------

let tmpDir: string;
let table: lancedb.Table;
const embedder = new MockEmbeddingProvider();

beforeAll(async () => {
  tmpDir = await mkdtemp(path.join(os.tmpdir(), 'ccm-integration-'));

  const db = await lancedb.connect(tmpDir);

  // Build Arrow schema via apache-arrow (matches openChunksTable schema)
  const { Schema, Field, Utf8, Float32, FixedSizeList, Int64 } = await import('apache-arrow');
  const schema = new Schema([
    new Field('id', new Utf8(), false),
    new Field('vector', new FixedSizeList(1536, new Field('item', new Float32(), true)), false),
    new Field('text', new Utf8(), false),
    new Field('source_path', new Utf8(), false),
    new Field('heading_path', new Utf8(), false),
    new Field('chunk_hash', new Utf8(), false),
    new Field('indexed_at', new Int64(), false),
    new Field('embedding_model_id', new Utf8(), false),
  ]);

  table = await db.createEmptyTable('chunks', schema);

  // Add rows with computed vectors
  const rows = CHUNKS.map(c => ({
    ...c,
    vector: textToVector(c.text),
  }));
  await table.add(rows);

  // Create FTS index so FTS and hybrid tests can run
  await ensureFtsIndex(table);
}, 60_000);

afterAll(async () => {
  if (tmpDir) {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('searcher integration', () => {
  it('SRCH-01: vector search returns semantically similar chunks', async () => {
    const results = await search('calendar scheduling meeting', table, embedder, {
      mode: 'vector',
      topK: 5,
    });

    expect(results.length).toBeGreaterThan(0);
    // Results should be sorted by score (ascending distance = best first, or higher is better)
    expect(results[0].id).toBeDefined();
    // The calendar/meeting chunk should rank highly (c1 is biased toward this)
    const ids = results.map(r => r.id);
    expect(ids).toContain('c1');
  });

  it('SRCH-02: fts search returns exact keyword match in top results', async () => {
    const results = await search('xylophone practice schedule', table, embedder, {
      mode: 'fts',
      topK: 5,
    });

    expect(results.length).toBeGreaterThan(0);
    // c2 contains "xylophone practice schedule" — must appear in results
    const ids = results.map(r => r.id);
    expect(ids).toContain('c2');
  });

  it('SRCH-03: hybrid merges vector + FTS without error', async () => {
    const results = await search('memory architecture', table, embedder, {
      mode: 'hybrid',
      topK: 5,
    });

    expect(Array.isArray(results)).toBe(true);
    expect(results.length).toBeGreaterThan(0);
  });

  it('SRCH-04: result shape has all required fields', async () => {
    const results = await search('planning roadmap', table, embedder, {
      mode: 'vector',
      topK: 5,
    });

    expect(results.length).toBeGreaterThan(0);
    for (const r of results) {
      expect(typeof r.id).toBe('string');
      expect(r.id.length).toBeGreaterThan(0);
      expect(typeof r.sourcePath).toBe('string');
      expect(typeof r.headingPath).toBe('string');
      expect(typeof r.text).toBe('string');
      expect(typeof r.score).toBe('number');
      expect(r.indexedAt).toBeInstanceOf(Date);
      expect(isNaN(r.indexedAt.getTime())).toBe(false);
    }
  });

  it('SRCH-05: afterDate filter excludes old chunks', async () => {
    // c3 has indexed_at = 2024-01-15 — should be excluded
    // c1, c2, c4, c5 have 2025 dates — should be included
    const cutoff = new Date('2025-01-01');
    const results = await search('project planning', table, embedder, {
      mode: 'vector',
      topK: 10,
      afterDate: cutoff,
    });

    for (const r of results) {
      expect(r.indexedAt.getTime()).toBeGreaterThanOrEqual(cutoff.getTime());
    }
    // c3 (2024) must not appear
    const ids = results.map(r => r.id);
    expect(ids).not.toContain('c3');
  });

  it('SRCH-05: sourceGlob filter restricts results to matching paths', async () => {
    // Only Claude Lab chunks: c1, c3, c5
    const results = await search('architecture memory', table, embedder, {
      mode: 'vector',
      topK: 10,
      sourceGlob: '%/Claude Lab/%',
    });

    expect(results.length).toBeGreaterThan(0);
    for (const r of results) {
      expect(r.sourcePath).toContain('/Claude Lab/');
    }
    // Health chunks should be excluded
    const ids = results.map(r => r.id);
    expect(ids).not.toContain('c2'); // Health/music.md
    expect(ids).not.toContain('c4'); // Health/fitness.md
  });
});

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { connectLanceDb, openChunksTable } from './lance.js';

describe('connectLanceDb', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lance-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns a LanceDB connection object', async () => {
    const db = await connectLanceDb(tmpDir);
    expect(db).toBeDefined();
    expect(typeof db.tableNames).toBe('function');
    expect(typeof db.openTable).toBe('function');
  });
});

describe('openChunksTable', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lance-chunks-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('creates the chunks table on a fresh DB', async () => {
    const db = await connectLanceDb(tmpDir);
    const table = await openChunksTable(db);
    expect(table).toBeDefined();
    const names = await db.tableNames();
    expect(names).toContain('chunks');
  });

  it('opens the existing chunks table without error on second call', async () => {
    const db = await connectLanceDb(tmpDir);
    await openChunksTable(db);
    // Re-connect to simulate a restart
    const db2 = await connectLanceDb(tmpDir);
    const table2 = await openChunksTable(db2);
    expect(table2).toBeDefined();
    const names = await db2.tableNames();
    expect(names).toContain('chunks');
  });

  it('chunks table schema includes all required fields', async () => {
    const db = await connectLanceDb(tmpDir);
    const table = await openChunksTable(db, 4); // small vector for test

    // Insert a sample row to verify schema
    await table.add([
      {
        id: 'test/file.md#0',
        vector: [0.1, 0.2, 0.3, 0.4],
        text: 'sample chunk content',
        source_path: 'test/file.md',
        heading_path: '# Title > ## Section',
        chunk_hash: 'abc123',
        indexed_at: Date.now(),
        embedding_model_id: 'openai:text-embedding-3-small',
      },
    ]);

    const results = await table.query().limit(1).toArray();
    expect(results.length).toBe(1);

    const row = results[0];
    expect(row).toHaveProperty('id');
    expect(row).toHaveProperty('vector');
    expect(row).toHaveProperty('text');
    expect(row).toHaveProperty('source_path');
    expect(row).toHaveProperty('heading_path');
    expect(row).toHaveProperty('chunk_hash');
    expect(row).toHaveProperty('indexed_at');
    expect(row).toHaveProperty('embedding_model_id');
  });

  it('vector field is a Float32 array of the specified dimension', async () => {
    const db = await connectLanceDb(tmpDir);
    const table = await openChunksTable(db, 8);

    const vector = Array.from({ length: 8 }, (_, i) => i * 0.1);
    await table.add([
      {
        id: 'test/file.md#1',
        vector,
        text: 'vector dimension test',
        source_path: 'test/file.md',
        heading_path: '# Root',
        chunk_hash: 'def456',
        indexed_at: Date.now(),
        embedding_model_id: 'openai:text-embedding-3-small',
      },
    ]);

    const results = await table.query().limit(1).toArray();
    expect(results[0].vector.length).toBe(8);
  });
});

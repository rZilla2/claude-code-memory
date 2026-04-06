import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type * as lancedb from '@lancedb/lancedb';
import { connectLanceDb, openChunksTable } from '../core/db/lance.js';
import { openMetadataDb, assertModelMatch } from '../core/db/sqlite.js';
import { createEmbeddingProvider } from '../core/embedder/factory.js';
import { createWatcher, startupCatchUp } from '../core/watcher.js';
import { maybeAutoCompact } from '../cli/commands/compact-cmd.js';
import { registerSearchMemoryTool } from './tools/search-memory.js';
import { registerGetContextTool } from './tools/get-context.js';
import { logger } from '../logger.js';
import type { Config } from '../types.js';

export async function startMcpServer(config: Config): Promise<void> {
  // Open DB connections
  const connection = await connectLanceDb(config.indexPath);
  const table = await openChunksTable(connection);
  const db = openMetadataDb(config.indexPath);

  // Create embedder
  const embedder = createEmbeddingProvider(config);

  // Warm-up: open LanceDB + SQLite + run dummy embed before transport connect
  try {
    const warmVec = await embedder.embed(['warmup']);
    await table.search(warmVec[0] as lancedb.IntoVector).limit(1).toArray();
    logger.info('Warm-up complete');
  } catch (err) {
    logger.warn('Warm-up failed (non-fatal)', err);
  }

  // Assert embedding model matches stored fingerprint
  assertModelMatch(db, embedder.modelId());

  // Auto-compact on startup if thresholds met
  try {
    const didCompact = await maybeAutoCompact(db, table);
    if (didCompact) logger.info('Auto-compaction completed on startup');
  } catch (err) {
    logger.warn('Auto-compaction failed (non-fatal)', err);
  }

  // Catch-up scan for files changed since last session
  try {
    const catchUp = await startupCatchUp({ config, db, table, embedder });
    if (catchUp.reindexed > 0) {
      logger.info(`Catch-up: re-indexed ${catchUp.reindexed}/${catchUp.total} files`);
    }
  } catch (err) {
    logger.warn('Catch-up scan failed (non-fatal)', err);
  }

  // Start file watcher
  const watcher = createWatcher({
    config,
    db,
    table,
    embedder,
    onBatchComplete: (result) => {
      logger.info('Watcher batch complete', result);
    },
  });

  // Cleanup on signals (exit handler removed — it cannot run async watcher.close())
  process.on('SIGINT', async () => { await watcher.close(); process.exit(0); });
  process.on('SIGTERM', async () => { await watcher.close(); process.exit(0); });

  // Create MCP server and register tools
  const server = new McpServer({ name: 'claude-code-memory', version: '0.1.0' });
  registerSearchMemoryTool(server, table, embedder);
  registerGetContextTool(server, table);

  // Connect stdio transport
  const transport = new StdioServerTransport();
  await server.connect(transport);
  logger.info('MCP server started');
}

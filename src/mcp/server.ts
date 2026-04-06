import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type * as lancedb from '@lancedb/lancedb';
import { connectLanceDb, openChunksTable } from '../core/db/lance.js';
import { openMetadataDb } from '../core/db/sqlite.js';
import { createEmbeddingProvider } from '../core/embedder/factory.js';
import { registerSearchMemoryTool } from './tools/search-memory.js';
import { registerGetContextTool } from './tools/get-context.js';
import { logger } from '../logger.js';
import type { Config } from '../types.js';

export async function startMcpServer(config: Config): Promise<void> {
  // Open DB connections
  const connection = await connectLanceDb(config.indexPath);
  const table = await openChunksTable(connection);
  // Open SQLite (kept open for potential future tools)
  const _db = openMetadataDb(config.indexPath);

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

  // Create MCP server and register tools
  const server = new McpServer({ name: 'claude-code-memory', version: '0.1.0' });
  registerSearchMemoryTool(server, table, embedder);
  registerGetContextTool(server, table);

  // Connect stdio transport
  const transport = new StdioServerTransport();
  await server.connect(transport);
  logger.info('MCP server started');
}

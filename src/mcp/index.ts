#!/usr/bin/env node
import { loadConfig } from '../config.js';
import { startMcpServer } from './server.js';
import { logger } from '../logger.js';

const config = loadConfig();
startMcpServer(config).catch((err) => {
  logger.error('MCP server failed to start', err);
  process.exit(1);
});

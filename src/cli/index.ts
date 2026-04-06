#!/usr/bin/env node
import { Command } from 'commander';
import { registerIndexCommand } from './commands/index-cmd.js';
import { registerStatusCommand } from './commands/status-cmd.js';
import { registerSearchCommand } from './commands/search-cmd.js';
import { registerConfigCommand } from './commands/config-cmd.js';
import { registerWatchCommand } from './commands/watch-cmd.js';
import { registerCompactCommand } from './commands/compact-cmd.js';
import { registerPruneCommand } from './commands/prune-cmd.js';
import { runFirstTimeSetup } from './first-run.js';

runFirstTimeSetup();

const program = new Command();
program
  .name('mem')
  .description('Semantic memory for your Obsidian vault')
  .version('0.1.0');

registerIndexCommand(program);
registerStatusCommand(program);
registerSearchCommand(program);
registerConfigCommand(program);
registerWatchCommand(program);
registerCompactCommand(program);
registerPruneCommand(program);

program.parse();

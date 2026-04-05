#!/usr/bin/env node
import { Command } from 'commander';
import { registerIndexCommand } from './commands/index-cmd.js';
import { registerStatusCommand } from './commands/status-cmd.js';

const program = new Command();
program
  .name('mem')
  .description('Semantic memory for your Obsidian vault')
  .version('0.1.0');

registerIndexCommand(program);
registerStatusCommand(program);

program.parse();

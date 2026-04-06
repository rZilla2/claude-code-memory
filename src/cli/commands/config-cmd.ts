import { Command } from 'commander';
import { homedir } from 'os';
import { join } from 'path';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { loadConfig } from '../../config.js';

const CONFIG_DIR = join(homedir(), '.claude-code-memory');
const CONFIG_PATH = join(CONFIG_DIR, 'config.json');

function readConfigFile(): Record<string, unknown> {
  if (!existsSync(CONFIG_PATH)) return {};
  try {
    return JSON.parse(readFileSync(CONFIG_PATH, 'utf-8'));
  } catch {
    return {};
  }
}

function writeConfigFile(data: Record<string, unknown>): void {
  mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(CONFIG_PATH, JSON.stringify(data, null, 2));
}

function parseConfigValue(key: string, value: string): unknown {
  if (key === 'batchSize' || key === 'concurrency') {
    return parseInt(value, 10);
  }
  if (key === 'ignorePaths' || key === 'includeExtensions') {
    return value.split(',');
  }
  return value;
}

export function registerConfigCommand(program: Command): void {
  const configCmd = program.command('config').description('View or set configuration');

  // Default action: show all config values
  configCmd.action(() => {
    try {
      const config = loadConfig();
      console.log('Current Configuration:');
      for (const [key, val] of Object.entries(config)) {
        console.log(`  ${key}: ${Array.isArray(val) ? val.join(', ') : val}`);
      }
    } catch {
      // If loadConfig fails (no vaultPath), show raw file
      const raw = readConfigFile();
      if (Object.keys(raw).length === 0) {
        console.log('No configuration found. Run `mem config init` to set up.');
      } else {
        console.log('Configuration (raw — validation failed):');
        for (const [key, val] of Object.entries(raw)) {
          console.log(`  ${key}: ${JSON.stringify(val)}`);
        }
      }
    }
  });

  // config set <key> <value>
  configCmd
    .command('set <key> <value>')
    .description('Set a configuration value')
    .action((key: string, value: string) => {
      const existing = readConfigFile();
      existing[key] = parseConfigValue(key, value);
      writeConfigFile(existing);
      console.log(`Set ${key} = ${JSON.stringify(existing[key])}`);
    });

  // config init (interactive wizard)
  configCmd
    .command('init')
    .description('Interactive configuration wizard')
    .action(async () => {
      const { input } = await import('@inquirer/prompts');
      const existing = readConfigFile();

      const vaultPath = await input({
        message: 'Path to your Obsidian vault:',
        default: (existing.vaultPath as string) || '',
      });
      const embeddingProvider = await input({
        message: 'Embedding provider (openai/ollama):',
        default: (existing.embeddingProvider as string) || 'openai',
      });

      const config = { ...existing, vaultPath, embeddingProvider };
      writeConfigFile(config);
      console.log(`Configuration saved to ${CONFIG_PATH}`);
    });
}

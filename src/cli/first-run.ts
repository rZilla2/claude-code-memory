import { homedir } from 'os';
import { join } from 'path';
import { existsSync, mkdirSync, writeFileSync } from 'fs';

const ICLOUD_OBSIDIAN = join(
  homedir(),
  'Library/Mobile Documents/iCloud~md~obsidian/Documents',
);
const CONFIG_DIR = join(homedir(), '.claude-code-memory');
const CONFIG_PATH = join(CONFIG_DIR, 'config.json');

export function runFirstTimeSetup(): boolean {
  if (existsSync(CONFIG_PATH)) return false; // already configured

  if (existsSync(ICLOUD_OBSIDIAN)) {
    mkdirSync(CONFIG_DIR, { recursive: true });
    const config = { vaultPath: ICLOUD_OBSIDIAN };
    writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
    console.log(`Auto-detected Obsidian vault at ${ICLOUD_OBSIDIAN}`);
    console.log(`Created config at ${CONFIG_PATH}`);
    return true;
  }

  return false; // needs manual init
}

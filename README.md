# claude-code-memory

Semantic memory for [Claude Code](https://docs.anthropic.com/en/docs/claude-code). Index your entire Obsidian vault into vector embeddings and search by meaning — not keywords.

Claude Code gets a `search_memory` MCP tool for automatic semantic recall. You get a `mem` CLI for terminal search.

## How it works

```
Obsidian vault (1000+ .md files)
    ↓ remark AST chunking (by heading)
    ↓ OpenAI or Ollama embeddings
    ↓ LanceDB vectors + SQLite metadata
    ↓
Claude Code ← MCP server (search_memory, get_context)
You         ← CLI (mem search "what was that calendar thing?")
```

## Install

```bash
npm install -g claude-code-memory
```

### First run

```bash
mem config init
```

Auto-detects your Obsidian vault at `~/Library/Mobile Documents/iCloud~md~obsidian/Documents/`. Set it manually with:

```bash
mem config set vaultPath /path/to/your/vault
```

### Index your vault

```bash
mem index
```

Indexes all `.md` files. Content hashing skips unchanged files on re-runs. Full vault (~1000 files) costs ~$0.25 with OpenAI embeddings.

### Search

```bash
mem search "how did I set up the calendar integration?"
mem search "ADHD productivity workflow" --mode fts
mem search "budget app architecture" --limit 10 --full
```

Modes: `hybrid` (default, vector + keyword), `vector`, `fts`.

### Check status

```bash
mem status
```

## Claude Code MCP setup

Add to `~/.claude.json`:

```json
{
  "mcpServers": {
    "claude-code-memory": {
      "command": "node",
      "args": ["/path/to/claude-code-memory/dist/mcp/index.js"],
      "env": {
        "OPENAI_API_KEY": "sk-..."
      }
    }
  }
}
```

Or if installed globally:

```json
{
  "mcpServers": {
    "claude-code-memory": {
      "command": "mem-mcp",
      "env": {
        "OPENAI_API_KEY": "sk-..."
      }
    }
  }
}
```

Restart Claude Code. Two tools become available:

- **`search_memory`** — semantic search across your vault
- **`get_context`** — retrieve a chunk with its surrounding context

## File watcher

Keep your index up to date automatically:

```bash
mem watch
```

Or let the MCP server handle it — the watcher starts automatically when Claude Code connects.

Features:
- 5-second batch window (handles iCloud sync cascades)
- Rename detection via content hash matching
- Startup catch-up scan for offline changes

## Maintenance

```bash
mem compact    # Optimize LanceDB storage after many incremental updates
mem prune      # Remove chunks from deleted files
```

## Embedding providers

### OpenAI (default)

Uses `text-embedding-3-small` (1,536 dimensions). Set `OPENAI_API_KEY` env var.

### Ollama (local, free)

```bash
# Install Ollama
brew install ollama
ollama pull nomic-embed-text

# Switch provider
mem config set embeddingProvider ollama
mem index   # Full reindex required when switching providers
```

Uses `nomic-embed-text` (768 dimensions). No API key needed.

## Configuration

Config lives at `~/.claude-code-memory/config.json`.

```bash
mem config              # Show current config
mem config set key val  # Set a value
mem config init         # Interactive setup
```

| Key | Default | Description |
|-----|---------|-------------|
| `vaultPath` | _(auto-detected)_ | Path to Obsidian vault |
| `indexPath` | `~/.claude-code-memory` | Where index files are stored |
| `embeddingProvider` | `openai` | `openai` or `ollama` |
| `openaiModel` | `text-embedding-3-small` | OpenAI embedding model |
| `ollamaModel` | `nomic-embed-text` | Ollama embedding model |
| `batchSize` | `100` | Chunks per embedding batch |
| `concurrency` | `3` | Parallel embedding requests |
| `stalenessDecayRate` | `0.003` | Exponential decay rate for old content (0 = disabled) |
| `ignorePaths` | `[".obsidian", "node_modules"]` | Directories to skip |
| `includeExtensions` | `[".md"]` | File extensions to index |

## Architecture

```
src/
├── config.ts              # Zod-validated config loading
├── logger.ts              # stderr-only logger (MCP-safe)
├── types.ts               # Shared interfaces
├── core/
│   ├── scanner.ts         # Vault file discovery (fast-glob)
│   ├── chunker.ts         # Markdown AST chunking (remark/unified)
│   ├── indexer.ts         # Orchestrator: scan → chunk → embed → store
│   ├── searcher.ts        # Vector/FTS/hybrid search + staleness decay
│   ├── watcher.ts         # File watcher (chokidar v4)
│   ├── db/
│   │   ├── sqlite.ts      # Metadata store (better-sqlite3)
│   │   └── lance.ts       # Vector store (LanceDB)
│   └── embedder/
│       ├── types.ts       # EmbeddingProvider interface
│       ├── openai.ts      # OpenAI adapter
│       ├── ollama.ts      # Ollama adapter
│       └── factory.ts     # Provider factory
├── mcp/
│   ├── server.ts          # MCP stdio server with warm-up
│   └── tools/
│       ├── search-memory.ts
│       └── get-context.ts
└── cli/
    ├── first-run.ts       # Auto-detect vault path
    └── commands/          # CLI command handlers
```

**Storage:** Index lives at `~/.claude-code-memory/` (outside iCloud to prevent sync corruption). Your vault is read-only input.

**Search pipeline:** Query → embed → LanceDB vector search + BM25 full-text → reciprocal rank fusion → staleness decay → top-K results.

## Development

```bash
git clone https://github.com/yourusername/claude-code-memory
cd claude-code-memory
npm install
npm test          # 173 tests across 23 files
npm run build     # ESM + CJS + DTS via tsup
```

## License

ISC

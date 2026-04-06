---
phase: 04-consumer-surfaces
plan: "01"
subsystem: mcp-server
tags: [mcp, search, stdio, warmup]
dependency_graph:
  requires: [src/core/searcher.ts, src/core/db/lance.ts, src/core/db/sqlite.ts, src/core/embedder/factory.ts]
  provides: [dist/mcp/index.cjs, src/mcp/server.ts, src/mcp/tools/search-memory.ts, src/mcp/index.ts]
  affects: [package.json, tsup.config.ts]
tech_stack:
  added: ["@modelcontextprotocol/sdk@^1.29.0", "commander@^14.0.3 (moved to deps)", "picocolors@^1.1.1", "@inquirer/prompts@^8.3.2"]
  patterns: [stdio-transport, mcp-tool-registration, warm-up-before-connect, tdd-red-green]
key_files:
  created:
    - src/mcp/tools/search-memory.ts
    - src/mcp/tools/search-memory.test.ts
    - src/mcp/server.ts
    - src/mcp/index.ts
  modified:
    - package.json
    - tsup.config.ts
decisions:
  - "commander moved from devDependencies to dependencies — required at runtime for CLI binary"
  - "search_memory defaults: limit=5, mode=hybrid — matches searcher.ts DEFAULT_TOP_K intent for MCP use case"
  - "Warm-up wraps embed+vector-search in try/catch — non-fatal; server starts even if index is empty"
  - "Test 4 excludes *.test.ts from console.log grep — test descriptions reference the string; production check is accurate"
metrics:
  duration: "~10 minutes"
  completed: "2026-04-06"
  tasks_completed: 2
  files_created: 4
  files_modified: 2
---

# Phase 04 Plan 01: MCP Server with search_memory Tool Summary

MCP stdio server with search_memory tool, eager warm-up (embed+LanceDB dummy search), and dist/mcp/index.cjs binary registered as mem-mcp bin.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Install deps, create MCP server + search_memory tool | bee1331 | package.json, tsup.config.ts, src/mcp/server.ts, src/mcp/tools/search-memory.ts |
| 2 | MCP entry point and build verification | 28bd702 | src/mcp/index.ts, package.json (bin) |

## What Was Built

- `src/mcp/tools/search-memory.ts` — `registerSearchMemoryTool(server, table, embedder)` registers `search_memory` tool with query/limit/mode/afterDate/beforeDate/sourceGlob params via Zod schemas
- `src/mcp/server.ts` — `startMcpServer(config)`: opens LanceDB+SQLite, creates embedder, runs warm-up, registers tool, connects StdioServerTransport
- `src/mcp/index.ts` — shebang entry point: loadConfig → startMcpServer → crash handler
- `dist/mcp/index.cjs` — 398KB built binary

## Verification Results

- Build: CJS success (DTS pre-existing TypeScript 6.0 deprecation warning — not introduced here)
- dist/mcp/index.cjs: EXISTS
- console.log in src/mcp/ (production files): NONE
- mem-mcp bin: registered
- @modelcontextprotocol/sdk in dependencies: YES
- commander in dependencies: YES
- Tests: 111/111 passed (14 test files)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Correctness] Test 4 grep excludes test files**
- **Found during:** Task 1 TDD
- **Issue:** Test 4 grepped src/mcp/ for console.log — the test description string itself contains "console.log", causing a false positive
- **Fix:** Updated grep command to use `--exclude="*.test.ts"` — only production files are checked
- **Files modified:** src/mcp/tools/search-memory.test.ts
- **Commit:** bee1331

**2. [Rule 3 - Blocking] commander still in devDependencies after npm install**
- **Found during:** Task 1
- **Issue:** `npm install commander` only adds it to dependencies if not already present; since it was in devDependencies, npm kept it there
- **Fix:** Manually edited package.json to remove from devDependencies and add to dependencies
- **Files modified:** package.json
- **Commit:** bee1331

## Self-Check: PASSED

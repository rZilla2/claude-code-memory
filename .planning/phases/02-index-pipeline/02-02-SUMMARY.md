---
phase: 02-index-pipeline
plan: "02"
subsystem: chunker
tags: [chunking, remark, ast, markdown, embeddings]
dependency_graph:
  requires: [02-01-SUMMARY.md]
  provides: [Chunk interface, chunkMarkdown function]
  affects: [02-03 indexer]
tech_stack:
  added: [unified, remark-parse, remark-frontmatter, remark-gfm, mdast-util-to-string]
  patterns: [remark AST traversal, heading breadcrumb injection, SHA-256 hashing]
key_files:
  created:
    - src/core/chunker.ts
    - src/core/chunker.test.ts
  modified: []
decisions:
  - "H4+ headings treated as body content (not split), stays in parent H3 chunk"
  - "SHA-256 used for chunk hashing (built-in crypto, no native dep)"
  - "Token estimate: charCount / 4 heuristic for paragraph-split threshold"
  - "Preamble text (before first heading) becomes (root) chunk"
  - "Breadcrumb uses '# H1 > ## H2 > ### H3' format with '#' depth markers"
metrics:
  duration: "2 minutes"
  completed_date: "2026-04-05"
  tasks_completed: 1
  files_created: 2
---

# Phase 02 Plan 02: Markdown Chunker Summary

**One-liner:** Remark AST chunker splitting markdown at H1/H2/H3 with heading breadcrumb prepended to embeddable text, SHA-256 chunk hashing, and collision-safe IDs.

## What Was Built

`src/core/chunker.ts` exports:
- `Chunk` interface with `id`, `headingPath`, `embeddableText`, `chunkHash`
- `chunkMarkdown(content, relativePath, maxTokens?)` — pure function, no I/O

`src/core/chunker.test.ts` — 14 unit tests covering all required behaviors.

## Key Behaviors

- Splits at H1/H2/H3 heading nodes via remark AST (not regex)
- H4+ nodes appended to body of their parent H3 chunk
- Heading breadcrumb format: `# H1 > ## H2 > ### H3` prepended before body text
- Preamble text before first heading → `(root)` chunk
- No-heading files: single chunk if ≤500 tokens; paragraph-split with `(root:1)`, `(root:2)` etc. if over
- Code block headings not split (remark AST `code` nodes vs `heading` nodes)
- Frontmatter YAML nodes skipped entirely
- Collision suffix: duplicate heading IDs get `-2`, `-3` appended
- `chunkHash` = SHA-256 of `embeddableText`

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 (RED) | Failing chunker tests | 849ecfd | src/core/chunker.test.ts |
| 1 (GREEN) | Chunker implementation | 1f4935b | src/core/chunker.ts, src/core/chunker.test.ts |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Test 5 paragraph size insufficient to trigger split**
- **Found during:** TDD GREEN phase — test failed because 3 × 600-char paragraphs = ~450 tokens total, under the 500-token threshold
- **Fix:** Changed test fixtures to 3 × 2000-char paragraphs (~500 tokens each), ensuring each paragraph alone exceeds the max threshold
- **Files modified:** src/core/chunker.test.ts
- **Commit:** 1f4935b

## Self-Check: PASSED

- src/core/chunker.ts exists: FOUND
- src/core/chunker.test.ts exists: FOUND
- Commit 849ecfd exists: FOUND
- Commit 1f4935b exists: FOUND
- npm test exits 0: CONFIRMED (14/14 tests pass)
- npx tsc --noEmit exits 0: CONFIRMED

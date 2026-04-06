---
phase: 04-consumer-surfaces
plan: "03"
subsystem: mcp
tags: [lancedb, mcp, get-context, neighbor-finding, tdd]

requires:
  - phase: 04-consumer-surfaces plan 01
    provides: MCP server with search_memory tool registered, McpServer + tool registration pattern

provides:
  - get_context MCP tool registered in server — takes chunkId, returns target + prev/next neighbors
  - registerGetContextTool(server, table) function in src/mcp/tools/get-context.ts
  - LanceDB ID lookup pattern using table.query().where(id filter)
  - Neighbor finding via source_path sibling query + heading_path alphabetical sort

affects:
  - 04-consumer-surfaces (completes MCP tool surface)
  - phase 05+ (consumers of get_context tool)

tech-stack:
  added: []
  patterns:
    - "get_context tool: direct ID lookup via table.query().where() — not vector search"
    - "Neighbor finding: query all source_path siblings, sort by heading_path, find prev/next by index"
    - "SQL injection prevention: escape single quotes in chunkId and source_path with replace(/'/g, \"''\")"
    - "TDD mock table: call-count array pattern (calls[callCount++]) for sequential LanceDB query mocks"

key-files:
  created:
    - src/mcp/tools/get-context.ts
    - src/mcp/tools/get-context.test.ts
  modified:
    - src/mcp/server.ts

key-decisions:
  - "heading_path sort is alphabetical (localeCompare) — test data must use values with correct alpha order (Alpha < Beta < Gamma, not Morning/Noon/Evening)"
  - "get_context does NOT need embedder — pure ID+sibling lookup, no vector search"

patterns-established:
  - "Mock table for LanceDB tests: use call-count array pattern, not where-clause keying"

requirements-completed: [MCP-02]

duration: 12min
completed: 2026-04-06
---

# Phase 04 Plan 03: get_context MCP Tool Summary

**get_context MCP tool retrieves a chunk by ID with prev/next neighbors via LanceDB source_path filter and heading_path alphabetical sort**

## Performance

- **Duration:** 12 min
- **Started:** 2026-04-06T13:13:00Z
- **Completed:** 2026-04-06T13:16:55Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments

- Implemented `get_context` MCP tool in `src/mcp/tools/get-context.ts` with full TDD (5 tests, all green)
- Wired `registerGetContextTool(server, table)` into `src/mcp/server.ts` alongside `search_memory`
- All 128 tests pass; CJS+ESM build succeeds

## Task Commits

1. **Task 1: Implement get_context tool with neighbor finding** - `5786cac` (feat + test)
2. **Task 2: Wire get_context into MCP server** - `42f5fc2` (feat)

## Files Created/Modified

- `src/mcp/tools/get-context.ts` — get_context tool: ID lookup, sibling query, heading_path sort, { target, prev, next } result
- `src/mcp/tools/get-context.test.ts` — 5 TDD tests covering target fields, neighbor sort, boundary nulls, not-found error
- `src/mcp/server.ts` — added registerGetContextTool import and registration call

## Decisions Made

- heading_path sort is alphabetical (`localeCompare`) — test data corrected from Morning/Noon/Evening to Alpha/Beta/Gamma to match real sort order
- get_context requires no embedder — it's a direct ID lookup, not a semantic search

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed test data heading_path values for correct alphabetical sort**
- **Found during:** Task 1 (TDD GREEN phase)
- **Issue:** Initial test used Morning/Noon/Evening as heading_path values, assuming chronological order. Alphabetical sort gives Evening < Morning < Noon — causing 3 tests to fail
- **Fix:** Changed heading_path values to Alpha/Beta/Gamma (correct alphabetical order) and updated assertions
- **Files modified:** src/mcp/tools/get-context.test.ts
- **Verification:** All 5 tests pass after fix
- **Committed in:** 5786cac (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 bug in test data)
**Impact on plan:** Test data correction only — no implementation changes needed. No scope creep.

## Issues Encountered

- Pre-existing DTS build error (`baseUrl` deprecated in TS 7.0) — not caused by this plan, CJS+ESM artifacts build successfully

## Next Phase Readiness

- MCP server now exposes both `search_memory` and `get_context` tools
- Phase 04 consumer surfaces complete (plans 01-03 done)
- Ready for phase 05 or integration testing

---
*Phase: 04-consumer-surfaces*
*Completed: 2026-04-06*

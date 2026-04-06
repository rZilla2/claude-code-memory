---
phase: 06-ollama-adapter-staleness-scoring
plan: "02"
subsystem: search
tags: [staleness, decay, scoring, tdd]
dependency_graph:
  requires: []
  provides: [applyDecay, stalenessDecayRate-config, recency-weighted-search]
  affects: [src/core/searcher.ts, src/types.ts, src/config.ts]
tech_stack:
  added: []
  patterns: [exponential-decay, tdd-red-green, additive-config-fields]
key_files:
  created: []
  modified:
    - src/core/searcher.ts
    - src/core/searcher.test.ts
    - src/types.ts
    - src/config.ts
decisions:
  - "stalenessDecayRate=0 (not 0.003) as default in SearchOptions so existing callers get zero decay — backward compatible"
  - "applyDecay re-sorts after multiplier application — callers always get ordered results"
  - "Preserved ollamaModel/ollamaBaseUrl from plan 06-01 in types.ts and config.ts"
metrics:
  duration: "~15 min"
  completed: "2026-04-06"
  tasks: 2
  files: 4
requirements: [SRCH-06, SRCH-07]
---

# Phase 06 Plan 02: Staleness Decay Scoring Summary

Exponential staleness decay scoring wired into all three search modes with configurable decay rate, using TDD throughout.

## Tasks Completed

| # | Name | Commit | Files |
|---|------|--------|-------|
| 1 | Staleness decay with TDD | 15dc874 | src/core/searcher.ts, src/core/searcher.test.ts |
| 2 | Wire decay into search, extend Config | 016cb88 | src/core/searcher.ts, src/types.ts, src/config.ts |

## What Was Built

### `applyDecay(results, decayRate)` — `src/core/searcher.ts`

```typescript
export function applyDecay(results: SearchResult[], decayRate: number): SearchResult[] {
  if (decayRate === 0) return results;
  const now = Date.now();
  return results
    .map(r => {
      const ageInDays = (now - r.indexedAt.getTime()) / 86_400_000;
      const multiplier = ageInDays <= 0 ? 1.0 : Math.exp(-decayRate * ageInDays);
      return { ...r, score: r.score * multiplier };
    })
    .sort((a, b) => b.score - a.score);
}
```

- 7-day-old chunk: score × 0.979 (exp(-0.003 × 7))
- 548-day-old chunk: score × 0.193 (exp(-0.003 × 548))
- Future `indexedAt` capped at multiplier = 1.0 (no boost)
- `decayRate=0` short-circuits with no-op return

### Config extension

- `Config.stalenessDecayRate: number` (required, always present after schema parse)
- `SearchOptions.stalenessDecayRate?: number` (optional, defaults to 0 in search())
- `ConfigSchema`: `stalenessDecayRate: z.number().default(0.003)`

### Wired into all search modes

`search()` destructures `{ stalenessDecayRate = 0 }` from options and calls `applyDecay` at:
- FTS return path
- Vector return path
- Hybrid return path (after RRF merge)

## Decisions Made

- `stalenessDecayRate` defaults to `0` inside `search()` (not 0.003) — callers opt in explicitly. The config default of 0.003 applies when callers pass `config.stalenessDecayRate`.
- `applyDecay` re-sorts results so callers always receive score-ordered output.
- Preserved `ollamaModel` and `ollamaBaseUrl` fields added by Plan 06-01 when editing shared files.

## Deviations from Plan

None — plan executed exactly as written.

## Test Coverage

6 new `applyDecay` unit tests added to `src/core/searcher.test.ts`:
- rate=0 passthrough (scores unchanged)
- 7-day chunk scores higher than 548-day chunk
- 548-day approximation ≈ 0.193 (toBeCloseTo 2dp)
- 7-day approximation ≈ 0.979 (toBeCloseTo 2dp)
- Re-sort by decayed score (lower raw score wins if much newer)
- Future date capped at 1.0

Full suite: **173 tests passing, 0 failures**.

## Self-Check: PASSED

All files present, both task commits verified in git log.

---
phase: 05
slug: file-watcher-maintenance
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-06
---

# Phase 05 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 4.1.2 |
| **Config file** | vitest.config.ts |
| **Quick run command** | `npm test -- --reporter=verbose src/core/watcher.test.ts` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~15 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npm test -- src/core/watcher.test.ts src/cli/commands/compact-cmd.test.ts src/cli/commands/prune-cmd.test.ts`
- **After every plan wave:** Run `npm test`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 15 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 05-01-01 | 01 | 1 | WATCH-01 | unit | `npm test -- src/core/watcher.test.ts` | ❌ W0 | ⬜ pending |
| 05-01-02 | 01 | 1 | WATCH-02 | unit | `npm test -- src/core/watcher.test.ts` | ❌ W0 | ⬜ pending |
| 05-01-03 | 01 | 1 | WATCH-03 | unit | `npm test -- src/core/watcher.test.ts` | ❌ W0 | ⬜ pending |
| 05-01-04 | 01 | 1 | WATCH-04 | unit | `npm test -- src/core/watcher.test.ts` | ❌ W0 | ⬜ pending |
| 05-02-01 | 02 | 2 | WATCH-05 | manual | N/A — requires live process | N/A | ⬜ pending |
| 05-02-02 | 02 | 2 | MAINT-01 | unit | `npm test -- src/cli/commands/compact-cmd.test.ts` | ❌ W0 | ⬜ pending |
| 05-02-03 | 02 | 2 | MAINT-02 | unit | `npm test -- src/cli/commands/prune-cmd.test.ts` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `src/core/watcher.test.ts` — stubs for WATCH-01 through WATCH-04 + startup compaction check
- [ ] `src/cli/commands/compact-cmd.test.ts` — stubs for MAINT-01
- [ ] `src/cli/commands/prune-cmd.test.ts` — stubs for MAINT-02
- [ ] Install deps: `npm install chokidar@^4`
- [ ] SQLite schema migration: `ensureCompactionMetadata()` added to `openMetadataDb()`

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| `mem watch` starts watcher, Ctrl+C stops | WATCH-05 | Requires live process and signal handling | Run `mem watch`, edit a vault file, verify reindex log output, Ctrl+C to stop |
| iCloud bulk sync triggers single reindex per file | WATCH-02 | Requires real iCloud sync event storm | Edit file on iPhone, observe Mac watcher logs, verify one reindex per file |
| 500+ incremental updates don't fragment excessively | MAINT-01 | Requires sustained load over time | Run indexer in loop, check `mem status` fragment count |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 15s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending

---
phase: 1
slug: foundation
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-05
---

# Phase 1 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 4.x |
| **Config file** | vitest.config.ts (Wave 0 installs) |
| **Quick run command** | `npx vitest run --reporter=verbose` |
| **Full suite command** | `npx vitest run --coverage` |
| **Estimated runtime** | ~5 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run --reporter=verbose`
- **After every plan wave:** Run `npx vitest run --coverage`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 5 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 01-01-01 | 01 | 0 | FOUND-02 | unit | `npx vitest run src/core/__tests__/config.test.ts` | ❌ W0 | ⬜ pending |
| 01-01-02 | 01 | 0 | FOUND-04 | unit | `npx vitest run src/core/__tests__/logger.test.ts` | ❌ W0 | ⬜ pending |
| 01-02-01 | 02 | 1 | FOUND-01 | unit | `npx vitest run src/core/__tests__/path-safety.test.ts` | ❌ W0 | ⬜ pending |
| 01-02-02 | 02 | 1 | FOUND-03 | unit | `npx vitest run src/core/__tests__/schema.test.ts` | ❌ W0 | ⬜ pending |
| 01-03-01 | 03 | 1 | EMB-01 | unit | `npx vitest run src/core/__tests__/embedding.test.ts` | ❌ W0 | ⬜ pending |
| 01-03-02 | 03 | 1 | EMB-02 | integration | `npx vitest run src/core/__tests__/openai-adapter.test.ts` | ❌ W0 | ⬜ pending |
| 01-03-03 | 03 | 1 | EMB-04 | unit | `npx vitest run src/core/__tests__/model-mismatch.test.ts` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `vitest.config.ts` — vitest configuration with TypeScript support
- [ ] `tsconfig.json` — TypeScript configuration
- [ ] `src/core/__tests__/config.test.ts` — config loading test stubs
- [ ] `src/core/__tests__/logger.test.ts` — stderr-only logging test stubs
- [ ] `src/core/__tests__/path-safety.test.ts` — iCloud path rejection test stubs
- [ ] `src/core/__tests__/schema.test.ts` — schema versioning test stubs
- [ ] `src/core/__tests__/embedding.test.ts` — embedding interface test stubs
- [ ] `src/core/__tests__/openai-adapter.test.ts` — OpenAI adapter test stubs
- [ ] `src/core/__tests__/model-mismatch.test.ts` — model fingerprint mismatch test stubs

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| OpenAI API returns vectors | EMB-02 | Requires live API key | Run `npx vitest run src/core/__tests__/openai-adapter.test.ts` with OPENAI_API_KEY set |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 5s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending

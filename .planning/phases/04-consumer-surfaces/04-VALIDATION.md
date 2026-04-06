---
phase: 04
slug: consumer-surfaces
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-06
---

# Phase 04 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest v4.1.2 |
| **Config file** | vitest.config.ts |
| **Quick run command** | `npm test -- --reporter=verbose` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~15 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npm test -- src/mcp/ src/cli/commands/search-cmd.test.ts src/cli/commands/config-cmd.test.ts src/cli/first-run.test.ts`
- **After every plan wave:** Run `npm test`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 15 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 04-01-01 | 01 | 1 | MCP-01 | unit | `npm test -- src/mcp/tools/search-memory.test.ts` | ❌ W0 | ⬜ pending |
| 04-01-02 | 01 | 1 | MCP-02 | unit | `npm test -- src/mcp/tools/get-context.test.ts` | ❌ W0 | ⬜ pending |
| 04-01-03 | 01 | 1 | MCP-03 | unit | `npm test -- src/mcp/server.test.ts` | ❌ W0 | ⬜ pending |
| 04-01-04 | 01 | 1 | MCP-04 | unit | `npm test -- src/mcp/server.test.ts` | ❌ W0 | ⬜ pending |
| 04-02-01 | 02 | 1 | CLI-01 | unit | `npm test -- src/cli/commands/search-cmd.test.ts` | ❌ W0 | ⬜ pending |
| 04-02-02 | 02 | 1 | CLI-04 | unit | `npm test -- src/cli/commands/config-cmd.test.ts` | ❌ W0 | ⬜ pending |
| 04-02-03 | 02 | 1 | CLI-05 | unit | `npm test -- src/cli/first-run.test.ts` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `src/mcp/tools/search-memory.test.ts` — stubs for MCP-01
- [ ] `src/mcp/tools/get-context.test.ts` — stubs for MCP-02
- [ ] `src/mcp/server.test.ts` — stubs for MCP-03, MCP-04
- [ ] `src/cli/commands/search-cmd.test.ts` — stubs for CLI-01
- [ ] `src/cli/commands/config-cmd.test.ts` — stubs for CLI-04
- [ ] `src/cli/first-run.test.ts` — stubs for CLI-05
- [ ] Install deps: `npm install @modelcontextprotocol/sdk picocolors @inquirer/prompts` and move `commander` to dependencies

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| MCP server registers in Claude Code | MCP-01 | Requires live Claude Code session | Add config to `~/.claude.json`, restart Claude Code, verify `search_memory` appears in tool list |
| `npm install -g` installs working binary | CLI-05 | Requires clean npm global install | `npm pack && npm install -g ./claude-code-memory-*.tgz && mem --help` |
| Cold-start warm-up completes under 60s | MCP-04 | Depends on real vault size | Start MCP server, observe warm-up log, issue first query, verify no timeout |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 15s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending

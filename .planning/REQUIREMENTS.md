# Requirements: v1.1 Baseline Fixes

**Defined:** 2026-04-06
**Core Value:** Fix known issues from v1.0 sprint, validate Ollama end-to-end, prepare for open-source release.

## Chunking Robustness

- [ ] **CHUNK-01**: Sections under headings that exceed embedding token limit must be sub-chunked (split by paragraph, same as headingless files)
- [ ] **CHUNK-02**: Configurable max tokens per chunk (default 500, applies to both heading-based and headingless paths)
- [ ] **CHUNK-03**: Tests for large-section chunking — YouTube transcript style files with single H1 and 10k+ token body

## LanceDB Deprecation Fix

- [ ] **LANCE-01**: Explicitly include `_distance` in select columns for vector search queries to silence deprecation warning
- [ ] **LANCE-02**: Verify hybrid, vector, and FTS search paths produce no deprecation warnings in test output

## Ollama End-to-End Validation

- [ ] **OLLAMA-01**: Integration test: full index → search cycle with Ollama mock (embed, store, retrieve)
- [ ] **OLLAMA-02**: Verify model mismatch detection works correctly when switching between OpenAI and Ollama
- [ ] **OLLAMA-03**: Document Ollama setup steps in README (model pull, config change)

## Open-Source Readiness

- [ ] **OSS-01**: Create GitHub repo with proper .gitignore, LICENSE (MIT), and remote configured
- [ ] **OSS-02**: Bump version to 1.1.0 in package.json
- [ ] **OSS-03**: Add author, repository, and homepage fields to package.json
- [ ] **OSS-04**: Verify `npm pack` produces clean tarball (no junk files, correct exports)

## Test Coverage

- [ ] **TEST-01**: Run coverage report and document current baseline
- [ ] **TEST-02**: Maintain >=80% line coverage after all v1.1 changes

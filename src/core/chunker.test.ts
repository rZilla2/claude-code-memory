import { describe, it, expect } from 'vitest';
import { chunkMarkdown, type Chunk } from './chunker.js';
import { createHash } from 'crypto';

function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf-8').digest('hex');
}

describe('chunkMarkdown', () => {
  // Test 1: single H1 with body produces one chunk with breadcrumb
  it('single H1 with body produces one chunk with headingPath and breadcrumb', () => {
    const md = '# Introduction\n\nSome intro text here.';
    const chunks = chunkMarkdown(md, 'test.md');

    expect(chunks).toHaveLength(1);
    expect(chunks[0].headingPath).toBe('# Introduction');
    expect(chunks[0].embeddableText).toBe('# Introduction\n\nSome intro text here.');
    expect(chunks[0].id).toBe('test.md::# Introduction');
  });

  // Test 2: H1 > H2 > H3 hierarchy produces separate chunks with nested breadcrumbs
  it('H1 > H2 > H3 hierarchy produces 3 chunks with nested breadcrumbs', () => {
    const md = '# Top\n\nTop body\n## Middle\n\nMiddle body\n### Deep\n\nDeep body';
    const chunks = chunkMarkdown(md, 'notes.md');

    expect(chunks).toHaveLength(3);
    expect(chunks[0].headingPath).toBe('# Top');
    expect(chunks[1].headingPath).toBe('# Top > ## Middle');
    expect(chunks[2].headingPath).toBe('# Top > ## Middle > ### Deep');

    expect(chunks[1].embeddableText).toContain('# Top > ## Middle');
    expect(chunks[2].embeddableText).toContain('# Top > ## Middle > ### Deep');
  });

  // Test 3: H4 inside H3 section stays in the H3 chunk (not split)
  it('H4 headings stay inside their parent H3 chunk and do not cause a split', () => {
    const md = '# Title\n\nIntro\n## Section\n\nBody\n### Sub\n\nSub body\n#### Detail\n\nDetail text';
    const chunks = chunkMarkdown(md, 'test.md');

    // Should be 3 chunks: # Title, # Title > ## Section, # Title > ## Section > ### Sub
    // The #### Detail should be in the ### Sub chunk
    expect(chunks).toHaveLength(3);
    expect(chunks[2].headingPath).toBe('# Title > ## Section > ### Sub');
    expect(chunks[2].embeddableText).toContain('Detail text');
  });

  // Test 4: file with no headings and <500 tokens produces exactly one chunk
  it('file with no headings and under 500 tokens produces a single chunk with headingPath "(root)"', () => {
    const md = 'Just some plain text without any headings.\n\nSecond paragraph here.';
    const chunks = chunkMarkdown(md, 'plain.md');

    expect(chunks).toHaveLength(1);
    expect(chunks[0].headingPath).toBe('(root)');
    expect(chunks[0].id).toBe('plain.md::(root)');
  });

  // Test 5: file with no headings and >500 tokens splits at double newlines
  it('file with no headings and over 500 tokens splits at double newlines', () => {
    // Each paragraph is ~500 tokens (2000 chars), total >500 per paragraph triggers split
    const para1 = 'A '.repeat(1000).trim(); // ~500 tokens
    const para2 = 'B '.repeat(1000).trim(); // ~500 tokens
    const para3 = 'C '.repeat(1000).trim(); // ~500 tokens
    const md = `${para1}\n\n${para2}\n\n${para3}`;
    const chunks = chunkMarkdown(md, 'long.md');

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[0].headingPath).toBe('(root:1)');
    expect(chunks[1].headingPath).toBe('(root:2)');
  });

  // Test 6: heading inside fenced code block does NOT cause a split
  it('heading inside fenced code block does not cause a split', () => {
    const md = '# Real Heading\n\nBody text\n\n```bash\n# This is a comment\necho hello\n```\n\nMore body';
    const chunks = chunkMarkdown(md, 'code.md');

    expect(chunks).toHaveLength(1);
    expect(chunks[0].headingPath).toBe('# Real Heading');
    expect(chunks[0].embeddableText).toContain('This is a comment');
  });

  // Test 7: duplicate heading text gets collision suffix
  it('duplicate heading text in same file gets -2 collision suffix', () => {
    const md = '## Usage\n\nFirst usage section\n\n## Usage\n\nSecond usage section';
    const chunks = chunkMarkdown(md, 'dup.md');

    expect(chunks).toHaveLength(2);
    expect(chunks[0].id).toBe('dup.md::## Usage');
    expect(chunks[1].id).toBe('dup.md::## Usage-2');
  });

  // Test 8: chunk id format is "{relativePath}::{headingPath}"
  it('chunk id is relativePath::headingPath', () => {
    const md = '# My Note\n\nContent here';
    const chunks = chunkMarkdown(md, '20 - Journal/2026-04-05.md');

    expect(chunks[0].id).toBe('20 - Journal/2026-04-05.md::# My Note');
  });

  // Test 9: frontmatter (YAML between ---) is excluded from chunk body
  it('frontmatter YAML is excluded from chunk body', () => {
    const md = '---\ntitle: My Note\ntags: [test]\n---\n\n# Heading\n\nBody text only';
    const chunks = chunkMarkdown(md, 'test.md');

    expect(chunks).toHaveLength(1);
    expect(chunks[0].embeddableText).not.toContain('title: My Note');
    expect(chunks[0].embeddableText).not.toContain('tags:');
    expect(chunks[0].embeddableText).toContain('Body text only');
  });

  // Test 10: chunkHash is SHA-256 of embeddableText
  it('chunkHash is SHA-256 of embeddableText', () => {
    const md = '# Title\n\nContent';
    const chunks = chunkMarkdown(md, 'test.md');

    expect(chunks[0].chunkHash).toBe(sha256(chunks[0].embeddableText));
  });

  // Test 11: body text before first heading becomes a preamble chunk
  it('body text before first heading becomes a preamble chunk', () => {
    const md = 'Preamble text before any heading.\n\n# First Section\n\nSection body';
    const chunks = chunkMarkdown(md, 'test.md');

    expect(chunks).toHaveLength(2);
    expect(chunks[0].headingPath).toBe('(root)');
    expect(chunks[0].embeddableText).toContain('Preamble text before any heading.');
    expect(chunks[1].headingPath).toBe('# First Section');
  });

  // Additional: Chunk interface fields are all present
  it('every chunk has id, headingPath, embeddableText, and chunkHash fields', () => {
    const md = '# Title\n\nContent';
    const chunks = chunkMarkdown(md, 'test.md');

    const chunk = chunks[0];
    expect(chunk).toHaveProperty('id');
    expect(chunk).toHaveProperty('headingPath');
    expect(chunk).toHaveProperty('embeddableText');
    expect(chunk).toHaveProperty('chunkHash');
  });

  // Frontmatter-only file produces no chunks (or just the headings below)
  it('file with only frontmatter and a heading below excludes frontmatter from text', () => {
    const md = '---\nalias: test\n---\n\n# Real Content\n\nSome text';
    const chunks = chunkMarkdown(md, 'fm.md');

    expect(chunks).toHaveLength(1);
    expect(chunks[0].headingPath).toBe('# Real Content');
    expect(chunks[0].embeddableText).not.toContain('alias');
  });

  // H2 without parent H1 should just use H2 as top-level breadcrumb
  it('H2 without parent H1 uses H2 as the breadcrumb root', () => {
    const md = '## Standalone Section\n\nContent here';
    const chunks = chunkMarkdown(md, 'test.md');

    expect(chunks).toHaveLength(1);
    expect(chunks[0].headingPath).toBe('## Standalone Section');
  });

  // Test: large section under heading exceeding maxTokens gets sub-chunked
  it('heading section exceeding maxTokens is sub-chunked by paragraph', () => {
    // Each paragraph is ~500 tokens (2000 chars). With 3 paragraphs under one heading,
    // total is ~1500 tokens which exceeds maxTokens=500
    const para1 = 'Alpha '.repeat(333).trim();
    const para2 = 'Bravo '.repeat(333).trim();
    const para3 = 'Charlie '.repeat(333).trim();
    const md = `# Transcript\n\n${para1}\n\n${para2}\n\n${para3}`;
    const chunks = chunkMarkdown(md, 'youtube.md');

    // Should produce multiple chunks, not one giant chunk
    expect(chunks.length).toBeGreaterThan(1);
    // All sub-chunks should preserve the heading path
    for (const chunk of chunks) {
      expect(chunk.headingPath).toContain('# Transcript');
    }
    // Each sub-chunk's body should be roughly one paragraph (~500 tokens)
    // plus breadcrumb overhead, so total should be well under 2x maxTokens
    for (const chunk of chunks) {
      const tokens = Math.ceil(chunk.embeddableText.length / 4);
      expect(tokens).toBeLessThanOrEqual(1000);
    }
  });

  // Test: sub-chunking preserves heading breadcrumb in each sub-chunk's embeddableText
  it('sub-chunked sections include heading breadcrumb in embeddableText', () => {
    const para1 = 'Word '.repeat(600).trim(); // ~600 tokens
    const para2 = 'More '.repeat(600).trim();
    const md = `# Main\n## Sub\n\n${para1}\n\n${para2}`;
    const chunks = chunkMarkdown(md, 'big.md');

    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.embeddableText).toContain('# Main > ## Sub');
    }
  });

  // Test: custom maxTokens parameter is respected
  it('custom maxTokens parameter controls chunk size threshold', () => {
    const para1 = 'Test '.repeat(100).trim(); // ~125 tokens
    const para2 = 'More '.repeat(100).trim(); // ~125 tokens
    const md = `# Title\n\n${para1}\n\n${para2}`;

    // With maxTokens=50, should split (each para exceeds budget)
    const smallChunks = chunkMarkdown(md, 'test.md', 50);
    expect(smallChunks.length).toBeGreaterThan(1);

    // With maxTokens=500, should not split (~250 tokens total)
    const bigChunks = chunkMarkdown(md, 'test.md', 500);
    expect(bigChunks).toHaveLength(1);
  });

  it('Obsidian callout blocks: strips [!type] syntax and preserves list item separation', () => {
    const md = `# Notes

## Games

- [ ] do stuff

> [!note] Games to play
> - [ ] kingdoms of the dump
> - [ ] neva
> - [ ] hades

## Other

More content.
`;
    const chunks = chunkMarkdown(md, 'test.md');
    const gamesChunk = chunks.find(c => c.headingPath === '# Notes > ## Games');
    expect(gamesChunk).toBeDefined();
    // [!note] should be stripped
    expect(gamesChunk!.embeddableText).not.toContain('[!note]');
    // Callout title preserved
    expect(gamesChunk!.embeddableText).toContain('Games to play');
    // List items separated by newlines, not smooshed
    expect(gamesChunk!.embeddableText).toContain('kingdoms of the dump\nneva\nhades');
  });

  it('list items are separated by newlines in plain lists', () => {
    const md = `# Section

- item one
- item two
- item three
`;
    const chunks = chunkMarkdown(md, 'test.md');
    expect(chunks).toHaveLength(1);
    expect(chunks[0].embeddableText).toContain('item one\nitem two\nitem three');
  });
});

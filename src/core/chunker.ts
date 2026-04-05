import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkFrontmatter from 'remark-frontmatter';
import remarkGfm from 'remark-gfm';
import { toString as mdastToString } from 'mdast-util-to-string';
import { createHash } from 'crypto';
import type { Root, Heading, RootContent } from 'mdast';

export interface Chunk {
  id: string;           // "{relativePath}::{headingPath}" with collision suffix
  headingPath: string;  // "# H1 > ## H2 > ### H3" or "(root)" for no-heading content
  embeddableText: string; // breadcrumb + "\n\n" + body text
  chunkHash: string;    // SHA-256 of embeddableText
}

const DEFAULT_MAX_TOKENS = 500;

function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf-8').digest('hex');
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Build the heading breadcrumb string from the current heading stack.
 * Stack is [h1Text, h2Text, h3Text] where undefined means that level is absent.
 */
function buildBreadcrumb(stack: (string | undefined)[]): string {
  const parts: string[] = [];
  if (stack[0] !== undefined) parts.push(`# ${stack[0]}`);
  if (stack[1] !== undefined) parts.push(`## ${stack[1]}`);
  if (stack[2] !== undefined) parts.push(`### ${stack[2]}`);
  return parts.join(' > ');
}

/**
 * Flush accumulated body nodes into a Chunk.
 * Returns null if there are no body nodes (nothing to flush).
 */
function flushChunk(
  bodyNodes: RootContent[],
  headingPath: string,
  relativePath: string,
  seenIds: Map<string, number>
): Chunk | null {
  if (bodyNodes.length === 0) return null;

  const bodyText = bodyNodes.map(node => mdastToString(node)).join('\n\n').trim();
  if (!bodyText) return null;

  const baseId = `${relativePath}::${headingPath}`;
  const count = seenIds.get(baseId) ?? 0;
  seenIds.set(baseId, count + 1);

  const id = count === 0 ? baseId : `${baseId}-${count + 1}`;

  const embeddableText = headingPath === '(root)'
    ? bodyText
    : `${headingPath}\n\n${bodyText}`;

  return {
    id,
    headingPath,
    embeddableText,
    chunkHash: sha256(embeddableText),
  };
}

/**
 * Split content with no headings by double newlines when it exceeds maxTokens.
 */
function splitByParagraphs(
  content: string,
  relativePath: string,
  maxTokens: number
): Chunk[] {
  const paragraphs = content.split(/\n\n+/).map(p => p.trim()).filter(Boolean);

  const chunks: Chunk[] = [];
  let currentParts: string[] = [];
  let chunkIndex = 1;

  const flushParagraphChunk = () => {
    if (currentParts.length === 0) return;
    const text = currentParts.join('\n\n');
    const headingPath = `(root:${chunkIndex})`;
    const id = `${relativePath}::${headingPath}`;
    chunks.push({
      id,
      headingPath,
      embeddableText: text,
      chunkHash: sha256(text),
    });
    chunkIndex++;
    currentParts = [];
  };

  for (const para of paragraphs) {
    const prospective = [...currentParts, para].join('\n\n');
    if (currentParts.length > 0 && estimateTokens(prospective) > maxTokens) {
      flushParagraphChunk();
    }
    currentParts.push(para);
  }
  flushParagraphChunk();

  return chunks;
}

/**
 * Parse markdown content and split into semantic chunks by heading (H1/H2/H3).
 *
 * @param content - Raw markdown string
 * @param relativePath - Path relative to vault root (used in chunk IDs)
 * @param maxTokens - Max tokens per chunk for no-heading files (default 500)
 */
export function chunkMarkdown(
  content: string,
  relativePath: string,
  maxTokens: number = DEFAULT_MAX_TOKENS
): Chunk[] {
  const tree = unified()
    .use(remarkParse)
    .use(remarkFrontmatter, ['yaml'])
    .use(remarkGfm)
    .parse(content) as Root;

  const chunks: Chunk[] = [];
  // heading stack: index 0 = H1 text, 1 = H2 text, 2 = H3 text
  const headingStack: (string | undefined)[] = [undefined, undefined, undefined];
  let bodyNodes: RootContent[] = [];
  let hasAnyHeading = false;
  const seenIds = new Map<string, number>();

  for (const node of tree.children) {
    // Skip frontmatter
    if (node.type === 'yaml') continue;

    if (node.type === 'heading') {
      const heading = node as Heading;

      if (heading.depth <= 3) {
        // Flush accumulated body as a chunk for the previous section
        const currentPath = buildBreadcrumb(headingStack);
        const headingPath = currentPath || '(root)';

        const chunk = flushChunk(bodyNodes, headingPath, relativePath, seenIds);
        if (chunk) chunks.push(chunk);
        bodyNodes = [];

        // Update heading stack
        const headingText = mdastToString(heading);
        const depth = heading.depth - 1; // 0-indexed: H1=0, H2=1, H3=2

        headingStack[depth] = headingText;
        // Clear deeper levels when we go up in hierarchy
        for (let i = depth + 1; i < headingStack.length; i++) {
          headingStack[i] = undefined;
        }

        hasAnyHeading = true;
        // Don't add heading node to bodyNodes — it becomes the headingPath
      } else {
        // H4+ treated as body content
        bodyNodes.push(node);
      }
    } else {
      bodyNodes.push(node);
    }
  }

  // Flush remaining body nodes
  if (hasAnyHeading) {
    const currentPath = buildBreadcrumb(headingStack);
    const chunk = flushChunk(bodyNodes, currentPath, relativePath, seenIds);
    if (chunk) chunks.push(chunk);
  } else {
    // No headings at all — handle as special case
    const fullText = bodyNodes.map(node => mdastToString(node)).join('\n\n').trim();

    if (!fullText) return [];

    if (estimateTokens(fullText) <= maxTokens) {
      const headingPath = '(root)';
      const id = `${relativePath}::${headingPath}`;
      chunks.push({
        id,
        headingPath,
        embeddableText: fullText,
        chunkHash: sha256(fullText),
      });
    } else {
      return splitByParagraphs(fullText, relativePath, maxTokens);
    }
  }

  return chunks;
}

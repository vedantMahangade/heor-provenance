/**
 * Minimal, isomorphic markdown block parser for the GVD chapter.
 *
 * Handles only what the enclave actually emits: ATX headings (#…######),
 * unordered/ordered list items, and paragraphs. Inline emphasis (**bold**) and
 * inline [PMID] citations are handled by the consumer (the React renderer and
 * the .docx exporter) so both stay in lockstep with the verifier's citation
 * order. No HTML, no Node/browser deps.
 */

export type MarkdownBlock =
  | { type: "heading"; level: number; text: string }
  | { type: "paragraph"; text: string }
  | { type: "list"; ordered: boolean; items: string[] };

export function parseMarkdownBlocks(md: string): MarkdownBlock[] {
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  const blocks: MarkdownBlock[] = [];

  let para: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;

  const flushPara = () => {
    if (para.length) {
      blocks.push({ type: "paragraph", text: para.join(" ").trim() });
      para = [];
    }
  };
  const flushList = () => {
    if (list && list.items.length) blocks.push({ type: "list", ...list });
    list = null;
  };

  for (const raw of lines) {
    const line = raw.trim();

    if (line === "") {
      flushPara();
      flushList();
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      flushPara();
      flushList();
      blocks.push({ type: "heading", level: heading[1].length, text: heading[2].trim() });
      continue;
    }

    const ul = line.match(/^[-*+]\s+(.*)$/);
    const ol = line.match(/^\d+[.)]\s+(.*)$/);
    if (ul || ol) {
      flushPara();
      const ordered = Boolean(ol);
      const item = (ul ? ul[1] : ol![1]).trim();
      if (!list || list.ordered !== ordered) {
        flushList();
        list = { ordered, items: [] };
      }
      list.items.push(item);
      continue;
    }

    // Plain prose line — accumulate into the current paragraph.
    flushList();
    para.push(line);
  }

  flushPara();
  flushList();
  return blocks;
}

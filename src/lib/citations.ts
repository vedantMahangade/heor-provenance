/**
 * Inline-citation parsing for the GVD chapter.
 *
 * ISOMORPHIC — no Node/browser deps. The SERVER uses this to build one verified
 * Claim per inline [PMID] (in document order), and the CLIENT uses the exact
 * same extraction to render each marker with its ✓/⚠ status. Sharing the parser
 * guarantees the k-th rendered marker maps to the k-th verified claim.
 */

/** Matches an inline citation like `[PMID 12345678]` (tolerant of spacing/colon). */
export const CITATION_PATTERN = "\\[\\s*PMID[\\s:]*?(\\d{4,})\\s*\\]";

/** Fresh global regex (own lastIndex) — never share one across loops. */
export function citationRegex(): RegExp {
  return new RegExp(CITATION_PATTERN, "gi");
}

export interface InlineCitation {
  /** PMID cited by this marker. */
  pmid: string;
  /** The chapter sentence the marker sits in (context for the verifier/UI). */
  sentence: string;
}

/**
 * Every inline [PMID] marker in `chapter`, in document order, paired with its
 * enclosing sentence. One entry per marker (a sentence citing two PMIDs yields
 * two entries).
 */
export function extractCitations(chapter: string): InlineCitation[] {
  const out: InlineCitation[] = [];
  for (const sentence of splitSentences(chapter)) {
    const re = citationRegex();
    let m: RegExpExecArray | null;
    while ((m = re.exec(sentence)) !== null) {
      out.push({ pmid: m[1], sentence: sentence.replace(/\s+/g, " ").trim() });
    }
  }
  return out;
}

/** Naive sentence splitter — good enough to attach a marker to its context. */
export function splitSentences(text: string): string[] {
  return text
    .replace(/\n+/g, " ")
    .split(/(?<=[.!?])\s+(?=[A-Z0-9"“(\[])/)
    .map((s) => s.trim())
    .filter(Boolean);
}

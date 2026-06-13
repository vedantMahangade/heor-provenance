import type { Source } from "./types";

/**
 * Claim-grounding verification.
 *
 * The LLM tells us which source span supports each claim. We DO NOT trust that
 * — we independently confirm the supporting sentence actually occurs in the
 * cited abstract. This is the heart of the provenance product: a claim is only
 * "grounded" if a third party (or our own code) can find the span in real text.
 */

export interface GroundingResult {
  grounded: boolean;
  /** Reason when not grounded, for the claim's flagReason. */
  reason?: string;
}

/** Normalize text for tolerant matching: lowercase, collapse whitespace,
 * strip most punctuation so minor quoting differences don't break a match. */
export function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[‘’“”]/g, "'") // smart quotes -> '
    .replace(/[^a-z0-9'%<>=.\-\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Verify a single supporting sentence against the abstract of its cited source.
 *
 * Matching strategy, in order:
 *  1. Cited PMID must exist among the fetched sources and have an abstract.
 *  2. Normalized exact-substring match (handles quoting/whitespace noise).
 *  3. Token-overlap fallback: a high fraction of the sentence's words appear in
 *     the abstract (guards against trivial reformatting), gated by a minimum
 *     length so a 3-word fragment can't pass on coincidence.
 */
export function verifyGrounding(
  pmid: string,
  supportingSentence: string,
  sources: Source[],
): GroundingResult {
  const source = sources.find((s) => s.pmid === pmid);
  if (!source) {
    return { grounded: false, reason: `Cited PMID ${pmid} was not in the fetched evidence set.` };
  }
  if (!source.abstract) {
    return { grounded: false, reason: `Source ${pmid} has no abstract text to verify against.` };
  }

  const sentence = normalize(supportingSentence);
  if (sentence.length < 12) {
    return { grounded: false, reason: "Supporting sentence too short to verify." };
  }

  const haystack = normalize(source.abstract);

  if (haystack.includes(sentence)) {
    return { grounded: true };
  }

  const overlap = tokenOverlap(sentence, haystack);
  if (overlap >= 0.85) {
    return { grounded: true };
  }

  return {
    grounded: false,
    reason: `Supporting sentence not found in source ${pmid} abstract (token overlap ${(overlap * 100).toFixed(0)}%).`,
  };
}

/** Fraction of the needle's content words that also appear in the haystack. */
function tokenOverlap(needle: string, haystack: string): number {
  const haystackTokens = new Set(haystack.split(" "));
  const needleTokens = needle.split(" ").filter((t) => t.length > 2);
  if (needleTokens.length === 0) return 0;
  const hits = needleTokens.filter((t) => haystackTokens.has(t)).length;
  return hits / needleTokens.length;
}

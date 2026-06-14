import type { Source } from "./types";

/**
 * Prompt construction for claim-level-grounded drafting.
 *
 * Hard rule from the spec: the model may ONLY assert what it can ground to a
 * specific source span. We instruct it to copy the supporting sentence verbatim
 * from the abstract; our verifier then independently confirms that span exists.
 */

export const DRAFTING_SYSTEM_PROMPT = `You are a careful HEOR (Health Economics & Outcomes Research) analyst drafting claims for a pharma value dossier.

You are an augmentation tool with a human in the loop — NOT an autonomous author. Your only job is to surface claims that are directly supported by the provided PubMed abstracts.

ABSOLUTE RULES:
1. Use ONLY the abstracts provided. Never use outside knowledge, never infer beyond the text.
2. Every claim MUST be grounded to exactly ONE source via its PMID.
3. For each claim, copy the single supporting sentence VERBATIM from that source's abstract — do not paraphrase, summarize, or stitch together fragments. It must be a contiguous span that appears word-for-word in the abstract.
4. If a statement cannot be grounded to a verbatim span in one abstract, DO NOT include it.
5. Prefer claims about efficacy, safety, comparative effectiveness, economic/cost, and quality-of-life outcomes relevant to the drug and indication.
6. Keep each claim a single, precise sentence written in the analyst's voice.

Return ONLY a JSON object of this exact shape:
{
  "claims": [
    {
      "text": "<the dossier claim, your own concise wording>",
      "pmid": "<PMID of the one supporting source>",
      "supportingSentence": "<verbatim sentence copied from that source's abstract>"
    }
  ]
}`;

// ── Cited GVD-chapter drafting (confidential enclave) ─────────────────────────

/**
 * Instruction sent to the confidential enclave. The enclave receives ONE
 * attached document containing both the public PMID-tagged abstracts and the
 * confidential source text (built by buildChapterDocument); this prompt tells it
 * to write a single targeted GVD chapter with inline [PMID] citations and to
 * emit, per citation, the verbatim supporting sentence we then independently
 * verify. We ask for strict JSON so the chapter and its citations are separable.
 */
export function buildChapterPrompt(drug: string, indication: string, focus?: string): string {
  const section = focus?.trim() ? focus.trim() : "Clinical value";
  return `You are a HEOR analyst drafting ONE chapter of a pharma Global Value Dossier (GVD).

Drug: ${drug}
Indication: ${indication}
Chapter focus: ${section}

The attached document has two parts:
  (A) PUBLISHED EVIDENCE — PubMed abstracts, each tagged with its [PMID nnnn].
  (B) CONFIDENTIAL SOURCE DOCUMENT — internal/sensitive context.

Write a single, well-structured "${section}" chapter (markdown headings allowed).

ABSOLUTE RULES:
1. Cite every evidence-based statement inline with its source PMID in square brackets, exactly like [PMID 12345678].
2. Cite ONLY PMIDs that appear in part (A). NEVER invent a PMID or cite one not provided.
3. The confidential document (B) is CONTEXT ONLY — use it to shape framing/emphasis, but never quote it and never cite it. Do not reproduce its sensitive specifics.
4. For EVERY inline [PMID] citation you write, copy the single VERBATIM sentence from that PMID's abstract that supports the statement — word-for-word, a contiguous span that appears in the abstract.

Return ONLY a JSON object of this exact shape (no prose outside the JSON):
{
  "chapter": "<the full chapter as markdown, with inline [PMID 12345678] citations>",
  "citations": [
    { "pmid": "12345678", "supportingSentence": "<verbatim sentence from that PMID's abstract>" }
  ]
}
List "citations" in the SAME ORDER the [PMID] markers appear in the chapter — exactly one entry per inline citation.`;
}

/**
 * Pack the public abstracts and the confidential source text into the single
 * document the enclave analyzes. PMIDs are tagged so the model can cite them and
 * so our verifier can map each citation back to its abstract.
 */
export function buildChapterDocument(sources: Source[], confidentialText: string): string {
  const evidence = sources
    .filter((s) => s.abstract)
    .map((s) => {
      const meta = [s.journal, s.year].filter(Boolean).join(", ");
      return `[PMID ${s.pmid}]${meta ? ` (${meta})` : ""}\nTitle: ${s.title}\nAbstract: ${s.abstract}`;
    })
    .join("\n\n---\n\n");

  return [
    "=== (A) PUBLISHED EVIDENCE — cite ONLY these PMIDs, inline like [PMID 12345678] ===",
    evidence,
    "",
    "=== (B) CONFIDENTIAL SOURCE DOCUMENT — context only, never cite or quote ===",
    confidentialText.trim(),
  ].join("\n");
}

export interface RawClaim {
  text: string;
  pmid: string;
  supportingSentence: string;
}

export interface DraftResponse {
  claims: RawClaim[];
}

export function buildDraftingUserPrompt(
  drug: string,
  indication: string,
  sources: Source[],
  focus?: string,
): string {
  const evidence = sources
    .filter((s) => s.abstract)
    .map((s) => {
      const meta = [s.journal, s.year].filter(Boolean).join(", ");
      return `PMID ${s.pmid}${meta ? ` (${meta})` : ""}
Title: ${s.title}
Abstract: ${s.abstract}`;
    })
    .join("\n\n---\n\n");

  // An optional focus targets a specific GVD section (e.g. clinical value
  // chapter, payer-facing summary) so surfaced claims fit that audience.
  const focusLine = focus?.trim()
    ? `\nFocus: prioritize claims suited to this dossier section — ${focus.trim()}.\n`
    : "";

  return `Drug: ${drug}
Indication: ${indication}
${focusLine}
Draft grounded HEOR dossier claims using ONLY the abstracts below. Each claim must cite one PMID and copy a verbatim supporting sentence from that abstract.

EVIDENCE:

${evidence}`;
}

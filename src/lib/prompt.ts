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

  return `Drug: ${drug}
Indication: ${indication}

Draft grounded HEOR dossier claims using ONLY the abstracts below. Each claim must cite one PMID and copy a verbatim supporting sentence from that abstract.

EVIDENCE:

${evidence}`;
}

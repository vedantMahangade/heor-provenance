import { createLlmClient, chatJson, getLlmConfig, type LlmConfig } from "./llm";
import { searchAndFetch, type SearchOptions } from "./pubmed";
import { verifyGrounding } from "./grounding";
import { bundleSha256 } from "./hash";
import { AGENT_VERSION } from "./version";
import {
  DRAFTING_SYSTEM_PROMPT,
  buildDraftingUserPrompt,
  type DraftResponse,
} from "./prompt";
import type { Claim, EvidenceBundle, Source } from "./types";

/**
 * Phase 1 pipeline: drug + indication -> real PubMed evidence -> claim-level
 * grounded draft -> verified, content-addressed JSON evidence bundle.
 *
 * No chain, no storage — this just produces the blob. Later phases store it on
 * Walrus and pin it via ENS.
 */

export interface GenerateOptions {
  drug: string;
  indication: string;
  /** How many PubMed records to retrieve as the evidence pool. */
  maxSources?: number;
  /** Optional explicit PubMed query; defaults to "<drug> <indication>". */
  query?: string;
  /** Inject an LLM config (defaults to env). */
  llmConfig?: LlmConfig;
  /** ISO timestamp override (mainly for deterministic tests). */
  timestamp?: string;
}

export interface GenerateResult {
  bundle: EvidenceBundle;
  /** PubMed query actually issued. */
  query: string;
  /** Counts for quick CLI reporting. */
  stats: {
    sourcesFetched: number;
    claimsDrafted: number;
    claimsGrounded: number;
    claimsFlagged: number;
  };
}

export async function generateEvidenceBundle(
  opts: GenerateOptions,
): Promise<GenerateResult> {
  const { drug, indication, maxSources = 8 } = opts;
  const query = opts.query ?? `${drug} ${indication}`;

  // 1. Fetch real evidence.
  const searchOpts: SearchOptions = { retmax: maxSources };
  const sources = await searchAndFetch(query, searchOpts);

  // 2. Draft grounded claims with the LLM.
  const llmConfig = opts.llmConfig ?? getLlmConfig();
  const draft = await draftClaims(drug, indication, sources, llmConfig);

  // 3. Independently verify each claim's grounding, then keep only the sources
  //    actually cited by surviving claims.
  const claims = verifyClaims(draft, sources);
  const citedPmids = new Set(claims.map((c) => c.pmid));
  const usedSources = sources.filter((s) => citedPmids.has(s.pmid));

  // 4. Assemble the bundle and content-address it.
  const timestamp = opts.timestamp ?? new Date().toISOString();
  const bundle = assembleBundle({
    drug,
    indication,
    claims,
    sources: usedSources,
    model: llmConfig.model,
    timestamp,
  });

  return {
    bundle,
    query,
    stats: {
      sourcesFetched: sources.length,
      claimsDrafted: draft.claims.length,
      claimsGrounded: claims.filter((c) => c.status === "grounded").length,
      claimsFlagged: claims.filter((c) => c.status === "flagged").length,
    },
  };
}

async function draftClaims(
  drug: string,
  indication: string,
  sources: Source[],
  llmConfig: LlmConfig,
): Promise<DraftResponse> {
  const withAbstracts = sources.filter((s) => s.abstract);
  if (withAbstracts.length === 0) {
    return { claims: [] };
  }

  const client = createLlmClient(llmConfig);
  const response = await chatJson<DraftResponse>(client, llmConfig.model, {
    system: DRAFTING_SYSTEM_PROMPT,
    user: buildDraftingUserPrompt(drug, indication, withAbstracts),
  });

  return { claims: Array.isArray(response?.claims) ? response.claims : [] };
}

function verifyClaims(draft: DraftResponse, sources: Source[]): Claim[] {
  return draft.claims
    .filter((c) => c && c.text && c.pmid && c.supportingSentence)
    .map((c, i) => {
      const result = verifyGrounding(
        String(c.pmid),
        c.supportingSentence,
        sources,
      );
      const claim: Claim = {
        id: `claim-${i + 1}`,
        text: c.text.trim(),
        pmid: String(c.pmid),
        supportingSentence: c.supportingSentence.trim(),
        status: result.grounded ? "grounded" : "flagged",
      };
      if (!result.grounded) claim.flagReason = result.reason;
      return claim;
    });
}

function assembleBundle(args: {
  drug: string;
  indication: string;
  claims: Claim[];
  sources: Source[];
  model: string;
  timestamp: string;
}): EvidenceBundle {
  const withoutHash = {
    query: { drug: args.drug, indication: args.indication },
    claims: args.claims,
    sources: args.sources,
    model: args.model,
    version: AGENT_VERSION,
    timestamp: args.timestamp,
  };
  const sha256 = bundleSha256(withoutHash);
  return { ...withoutHash, sha256 };
}

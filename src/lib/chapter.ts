/**
 * Cited GVD-chapter generation + INDEPENDENT verification — the headline.
 *
 * The chapter is drafted entirely inside the Chainlink confidential enclave from
 * the PMID-tagged abstracts + the confidential source document (the confidential
 * text never touches the public LLM). The enclave is asked to cite inline and to
 * return, per citation, a verbatim supporting sentence.
 *
 * We DO NOT trust those citations. For every inline [PMID] we re-run the existing
 * verbatim-span grounding check against that PMID's real abstract and mark the
 * citation grounded (✓) or flagged (⚠). The de-risk test showed the enclave keeps
 * PMIDs in-set but mis-attributes ~1/3 of citations — so this verifier is what
 * makes the chapter trustworthy, not the model.
 *
 * We draft with two enclave models (gemma4 + qwen3.6) and keep whichever cites
 * more accurately (highest verified ratio). SERVER-SIDE ONLY.
 */
import {
  analyzeConfidential,
  type ConfidentialResult,
} from "./confidential";
import { verifyGrounding } from "./grounding";
import { buildChapterPrompt, buildChapterDocument } from "./prompt";
import { extractCitations } from "./citations";
import type { Claim, Source } from "./types";

/** The two enclave models we race; the more accurately-citing one wins. */
export const CHAPTER_MODELS = ["gemma4", "qwen3.6"] as const;

/**
 * Which enclave models a live run should use, from env. Setting
 * `ENCLAVE_SINGLE_MODEL=gemma4` collapses to a single call — a fast path that
 * halves enclave load and timeout risk when the dev preview is contended. Unset
 * keeps the dual-model race. (export-sample.ts overrides this to force dual.)
 */
export function resolveChapterModels(): readonly string[] {
  const single = process.env.ENCLAVE_SINGLE_MODEL?.trim();
  return single ? [single] : CHAPTER_MODELS;
}

export interface ChapterCandidate {
  model: string;
  /** Markdown chapter with inline [PMID] citations. */
  chapter: string;
  /** One verified record per inline citation, in document order. */
  claims: Claim[];
  /** Enclave attestation (digests + raw output) for this run. */
  attestation: ConfidentialResult;
  verifiedCount: number;
  totalCitations: number;
  /** verifiedCount / totalCitations (0 when there are no citations). */
  accuracy: number;
}

interface ParsedEnclave {
  chapter: string;
  citations: { pmid: string; supportingSentence: string }[];
}

export interface GenerateChapterOptions {
  drug: string;
  indication: string;
  focus?: string;
  sources: Source[];
  confidentialText: string;
  /** Original filename of the confidential doc (surfaced to the enclave). */
  filename: string;
  contentType: string;
  timeoutMs?: number;
  /** Enclave models to draft with. Defaults to resolveChapterModels() (env). */
  models?: readonly string[];
}

/**
 * Draft with the configured enclave model(s) and keep the candidate whose
 * citations verify most accurately. With one model it's a single call; with two
 * they race in parallel. Throws only if EVERY model fails to produce a usable
 * chapter.
 */
export async function generateBestChapter(
  opts: GenerateChapterOptions,
): Promise<{ winner: ChapterCandidate; candidates: ChapterCandidate[] }> {
  const models = opts.models && opts.models.length ? opts.models : resolveChapterModels();
  const settled = await Promise.allSettled(
    models.map((model) => generateChapterWithModel(model, opts)),
  );

  const candidates = settled
    .filter((s): s is PromiseFulfilledResult<ChapterCandidate> => s.status === "fulfilled")
    .map((s) => s.value)
    .filter((c) => c.chapter.trim().length > 0);

  if (candidates.length === 0) {
    const firstErr = settled.find((s) => s.status === "rejected") as
      | PromiseRejectedResult
      | undefined;
    throw new Error(
      `All enclave models failed to draft a chapter. ${
        firstErr ? (firstErr.reason instanceof Error ? firstErr.reason.message : String(firstErr.reason)) : ""
      }`,
    );
  }

  // Most accurate first; tie-break on absolute verified count, then on having
  // any citations at all (a chapter with verified cites beats a prose-only one).
  const ranked = [...candidates].sort((a, b) => {
    if (b.accuracy !== a.accuracy) return b.accuracy - a.accuracy;
    if (b.verifiedCount !== a.verifiedCount) return b.verifiedCount - a.verifiedCount;
    return b.totalCitations - a.totalCitations;
  });

  return { winner: ranked[0], candidates: ranked };
}

/** Run one enclave model and independently verify each inline citation. */
export async function generateChapterWithModel(
  model: string,
  opts: GenerateChapterOptions,
): Promise<ChapterCandidate> {
  const document = buildChapterDocument(opts.sources, opts.confidentialText);
  const prompt = buildChapterPrompt(opts.drug, opts.indication, opts.focus);

  const attestation = await analyzeConfidential({
    document,
    filename: opts.filename,
    contentType: opts.contentType,
    prompt,
    model,
    // Generous cap: the JSON chapter + verbatim citations is heavier than a plain
    // summary, and two models race in parallel against a shared enclave queue.
    timeoutMs: opts.timeoutMs ?? 240_000,
  });

  const parsed = parseEnclaveOutput(attestation.output);
  const claims = buildVerifiedClaims(parsed.chapter, parsed.citations, opts.sources);
  const verifiedCount = claims.filter((c) => c.status === "grounded").length;
  const totalCitations = claims.length;

  return {
    model: attestation.model || model,
    chapter: parsed.chapter,
    claims,
    attestation,
    verifiedCount,
    totalCitations,
    accuracy: totalCitations > 0 ? verifiedCount / totalCitations : 0,
  };
}

/**
 * Build one verified Claim per inline [PMID] marker, in document order. The
 * enclave's per-citation supporting sentence is matched FIFO by PMID, then
 * independently re-checked against the real abstract via verifyGrounding.
 */
export function buildVerifiedClaims(
  chapter: string,
  jsonCitations: { pmid: string; supportingSentence: string }[],
  sources: Source[],
): Claim[] {
  const markers = extractCitations(chapter);

  // FIFO queue of supporting sentences per PMID, as the enclave supplied them.
  const queues = new Map<string, string[]>();
  for (const c of jsonCitations) {
    const pmid = String(c.pmid ?? "").trim();
    if (!pmid) continue;
    const ss = String(c.supportingSentence ?? "").trim();
    if (!queues.has(pmid)) queues.set(pmid, []);
    queues.get(pmid)!.push(ss);
  }

  return markers.map((marker, i) => {
    const supportingSentence = queues.get(marker.pmid)?.shift() ?? "";
    const result = verifyGrounding(marker.pmid, supportingSentence, sources);
    const claim: Claim = {
      id: `cite-${i + 1}`,
      text: marker.sentence,
      pmid: marker.pmid,
      supportingSentence,
      status: result.grounded ? "grounded" : "flagged",
    };
    if (!result.grounded) {
      claim.flagReason = supportingSentence
        ? result.reason
        : `No supporting sentence was provided for PMID ${marker.pmid}.`;
    }
    return claim;
  });
}

/**
 * Tolerantly parse the enclave's JSON ({ chapter, citations[] }). Strips code
 * fences and, if needed, slices the outermost braces. Falls back to treating the
 * whole output as the chapter (no citations) so a non-conforming model still
 * yields a readable — if unverified — draft.
 */
export function parseEnclaveOutput(raw: string): ParsedEnclave {
  const text = (raw ?? "").trim();
  const candidates: string[] = [];

  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) candidates.push(fenced[1].trim());
  candidates.push(text);
  const first = text.indexOf("{");
  const last = text.lastIndexOf("}");
  if (first >= 0 && last > first) candidates.push(text.slice(first, last + 1));

  for (const c of candidates) {
    try {
      const obj = JSON.parse(c) as Partial<ParsedEnclave>;
      if (obj && typeof obj.chapter === "string") {
        const citations = Array.isArray(obj.citations)
          ? obj.citations
              .filter((x) => x && typeof x === "object")
              .map((x) => ({
                pmid: String((x as { pmid?: unknown }).pmid ?? "").trim(),
                supportingSentence: String(
                  (x as { supportingSentence?: unknown }).supportingSentence ?? "",
                ).trim(),
              }))
          : [];
        return { chapter: obj.chapter.trim(), citations };
      }
    } catch {
      // try next candidate
    }
  }

  // No parseable JSON — keep the raw text as the chapter so it's still readable.
  return { chapter: text, citations: [] };
}

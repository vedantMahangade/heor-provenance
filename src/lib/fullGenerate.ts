/**
 * Full cited-GVD-chapter loop, shared by the CLI (scripts/generate-full.ts) and
 * the /api/generate route so both run the exact same path:
 *
 *   parse source doc -> fetch PubMed abstracts -> draft a cited chapter in the
 *   confidential enclave (two models, keep the more accurate) -> INDEPENDENTLY
 *   verify every inline [PMID] -> content-addressed bundle -> Walrus -> ENS.
 *
 * The confidential source document is parsed server-side and fed ONLY to the
 * enclave — it never reaches a public LLM. Emits coarse progress events so a UI
 * can show staged states across the ~1-3 minute run. SERVER-SIDE ONLY.
 */
import { searchAndFetch } from "./pubmed";
import { parseDocument } from "./docparse";
import { generateBestChapter } from "./chapter";
import { buildConfidentialAttestation } from "./confidential";
import { bundleSha256 } from "./hash";
import { storeBlob, blobUrl } from "./walrus";
import { writeProvenance } from "./ens";
import { AGENT_VERSION } from "./version";
import type { Claim, EvidenceBundle, Source } from "./types";

export const CAPABILITIES =
  "pubmed-evidence,confidential-chapter-drafting,citation-level-verification," +
  "walrus-storage,sha256-provenance,confidential-ai-attestation";

/** The mandatory source document for a run. */
export interface SourceInput {
  document: Uint8Array | string;
  filename: string;
  contentType: string;
}

export interface FullGenerateOptions {
  drug: string;
  indication: string;
  /** Optional GVD section the chapter targets (e.g. "Clinical value, payer-facing"). */
  focus?: string;
  query?: string;
  maxSources?: number;
  /** REQUIRED: the source document the chapter is drafted from. */
  source: SourceInput;
  /**
   * Enclave models to draft with. Omit to honor ENCLAVE_SINGLE_MODEL (env) and
   * otherwise race both models; pass an explicit list to force a specific set
   * (export-sample.ts passes both to always produce a dual-model sample).
   */
  models?: readonly string[];
  onProgress?: (event: ProgressEvent) => void;
}

export type ProgressStep = "pubmed" | "chapter" | "walrus" | "ens";

export interface ProgressEvent {
  step: ProgressStep;
  status: "start" | "done";
  detail?: string;
}

export interface FullGenerateResult {
  bundle: EvidenceBundle;
  blobId: string;
  aggregatorUrl: string;
  ensName: string;
  resolver: string;
  txs: { key: string; value: string; hash: string }[];
  stats: {
    sourcesFetched: number;
    citations: number;
    citationsVerified: number;
    model: string;
  };
  query: string;
}

export async function runFullGenerate(
  opts: FullGenerateOptions,
): Promise<FullGenerateResult> {
  const emit = opts.onProgress ?? (() => {});

  // 0. Parse the (mandatory) confidential source document server-side.
  const parsed = await parseDocument(
    typeof opts.source.document === "string"
      ? new TextEncoder().encode(opts.source.document)
      : opts.source.document,
    opts.source.filename,
    opts.source.contentType,
  );

  // 1. Real PubMed evidence.
  emit({ step: "pubmed", status: "start" });
  const query = opts.query ?? `${opts.drug} ${opts.indication}`;
  const fetched = await searchAndFetch(query, { retmax: opts.maxSources ?? 8 });
  const sources = fetched.filter((s) => s.abstract.trim().length > 0);
  if (sources.length === 0) {
    throw new Error(`No PubMed abstracts found for "${query}".`);
  }
  emit({ step: "pubmed", status: "done", detail: `${sources.length} abstracts` });

  // 2. Draft the cited chapter in the enclave (two models) and INDEPENDENTLY
  //    verify every citation; keep the more accurate model.
  emit({ step: "chapter", status: "start" });
  const { winner } = await generateBestChapter({
    drug: opts.drug,
    indication: opts.indication,
    focus: opts.focus,
    sources,
    confidentialText: parsed.text,
    filename: parsed.filename,
    contentType: opts.source.contentType,
    models: opts.models,
  });
  emit({
    step: "chapter",
    status: "done",
    detail: `${winner.model}: ${winner.verifiedCount}/${winner.totalCitations} citations verified`,
  });

  // 3. Content-address the bundle (chapter + verified citations + cited sources +
  //    the winning enclave's attestation).
  const citedPmids = new Set(winner.claims.map((c) => c.pmid));
  const citedSources = sources.filter((s) => citedPmids.has(s.pmid));
  const bundle = assembleBundle({
    drug: opts.drug,
    indication: opts.indication,
    focus: opts.focus,
    chapter: winner.chapter,
    claims: winner.claims,
    sources: citedSources.length ? citedSources : sources,
    model: winner.model,
    attestation: buildConfidentialAttestation(winner.attestation),
    timestamp: new Date().toISOString(),
  });

  // 4. Store on Walrus (pins >=5 epochs).
  emit({ step: "walrus", status: "start" });
  const blobId = await storeBlob(JSON.stringify(bundle));
  emit({ step: "walrus", status: "done", detail: blobId });

  // 5. Pin provenance into ENS text records.
  emit({ step: "ens", status: "start" });
  const ens = await writeProvenance(blobId, bundle.version, CAPABILITIES);
  emit({ step: "ens", status: "done", detail: ens.name });

  return {
    bundle,
    blobId,
    aggregatorUrl: blobUrl(blobId),
    ensName: ens.name,
    resolver: ens.resolver,
    txs: ens.txs.map((t) => ({ key: t.key, value: t.value, hash: t.hash })),
    stats: {
      sourcesFetched: sources.length,
      citations: winner.totalCitations,
      citationsVerified: winner.verifiedCount,
      model: winner.model,
    },
    query,
  };
}

function assembleBundle(args: {
  drug: string;
  indication: string;
  focus?: string;
  chapter: string;
  claims: Claim[];
  sources: Source[];
  model: string;
  attestation: EvidenceBundle["confidentialAttestation"];
  timestamp: string;
}): EvidenceBundle {
  const query = args.focus
    ? { drug: args.drug, indication: args.indication, focus: args.focus }
    : { drug: args.drug, indication: args.indication };
  const withoutHash = {
    query,
    chapter: args.chapter,
    claims: args.claims,
    sources: args.sources,
    model: args.model,
    version: AGENT_VERSION,
    timestamp: args.timestamp,
    confidentialAttestation: args.attestation,
  };
  const sha256 = bundleSha256(withoutHash);
  return { ...withoutHash, sha256 };
}

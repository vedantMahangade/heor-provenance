/**
 * The full end-to-end generate flow as a single reusable function, shared by the
 * CLI (scripts/generate-full.ts) and the /api/generate route so both run the
 * exact same path: PubMed-grounded draft -> optional confidential attestation
 * (attached BEFORE hashing) -> content-addressed bundle -> Walrus -> ENS.
 *
 * Emits coarse progress events via onProgress so a UI can show staged states
 * across the 1-2 minute run. SERVER-SIDE ONLY (reads the ENS key from env).
 */
import { generateEvidenceBundle, type GenerateResult } from "./pipeline";
import { analyzeConfidential, buildConfidentialAttestation } from "./confidential";
import { bundleSha256 } from "./hash";
import { storeBlob, blobUrl } from "./walrus";
import { writeProvenance } from "./ens";
import type { EvidenceBundle } from "./types";

export const BASE_CAPABILITIES =
  "pubmed-grounded-drafting,claim-level-verification,walrus-storage,sha256-provenance";

export interface SensitiveInput {
  document: Uint8Array | string;
  filename: string;
  contentType: string;
  prompt?: string;
  model?: string;
}

export interface FullGenerateOptions {
  drug: string;
  indication: string;
  query?: string;
  maxSources?: number;
  /** When present, runs a confidential-enclave attestation over the document. */
  sensitive?: SensitiveInput;
  onProgress?: (event: ProgressEvent) => void;
}

export type ProgressStep = "draft" | "confidential" | "walrus" | "ens";

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
  stats: GenerateResult["stats"];
  query: string;
}

export async function runFullGenerate(
  opts: FullGenerateOptions,
): Promise<FullGenerateResult> {
  const emit = opts.onProgress ?? (() => {});

  // 1. Grounded bundle (PubMed + LLM + verification).
  emit({ step: "draft", status: "start" });
  const { bundle, query, stats } = await generateEvidenceBundle({
    drug: opts.drug,
    indication: opts.indication,
    query: opts.query,
    maxSources: opts.maxSources,
  });
  emit({
    step: "draft",
    status: "done",
    detail: `${stats.claimsGrounded} grounded / ${stats.claimsFlagged} flagged from ${stats.sourcesFetched} sources`,
  });

  // 2. Optional confidential attestation — attached BEFORE hashing so the
  //    sha256 (and thus blobId + ENS pin) covers it.
  let finalBundle: EvidenceBundle = bundle;
  let capabilities = BASE_CAPABILITIES;
  if (opts.sensitive) {
    emit({ step: "confidential", status: "start" });
    const result = await analyzeConfidential({
      document: opts.sensitive.document,
      filename: opts.sensitive.filename,
      contentType: opts.sensitive.contentType,
      prompt:
        opts.sensitive.prompt ??
        `Summarize this document as it relates to ${opts.drug} for ${opts.indication}.`,
      model: opts.sensitive.model,
    });
    const { sha256: _omit, ...rest } = bundle;
    const withAttestation = {
      ...rest,
      confidentialAttestation: buildConfidentialAttestation(result),
    };
    finalBundle = { ...withAttestation, sha256: bundleSha256(withAttestation) };
    capabilities = `${BASE_CAPABILITIES},confidential-ai-attestation`;
    emit({ step: "confidential", status: "done", detail: `${result.model} (aws-nitro)` });
  }

  // 3. Store on Walrus (pins >=5 epochs).
  emit({ step: "walrus", status: "start" });
  const blobId = await storeBlob(JSON.stringify(finalBundle));
  emit({ step: "walrus", status: "done", detail: blobId });

  // 4. Pin provenance into ENS text records.
  emit({ step: "ens", status: "start" });
  const ens = await writeProvenance(blobId, finalBundle.version, capabilities);
  emit({ step: "ens", status: "done", detail: ens.name });

  return {
    bundle: finalBundle,
    blobId,
    aggregatorUrl: blobUrl(blobId),
    ensName: ens.name,
    resolver: ens.resolver,
    txs: ens.txs.map((t) => ({ key: t.key, value: t.value, hash: t.hash })),
    stats,
    query,
  };
}

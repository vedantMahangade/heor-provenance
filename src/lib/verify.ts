/**
 * Provenance verification: the read side of the loop.
 *
 * Given only an ENS name, independently reconstruct and re-check the chain of
 * custody — ENS text record -> Walrus blob -> sha256 — without trusting any
 * value we stored ourselves. This is the product: every claim in the dossier is
 * anchored to a blob whose integrity anyone can recompute from public infra.
 *
 *   ENS name --(readProvenance)--> blobId
 *   blobId   --(readBlob)--------> bundle JSON (from Walrus aggregator)
 *   bundle   --(bundleSha256)----> recomputed hash, compared to bundle.sha256
 */
import { readProvenance, type ProvenanceRecords } from "./ens";
import { readBlob, blobUrl } from "./walrus";
import { bundleSha256 } from "./hash";
import type { ConfidentialAttestation, EvidenceBundle } from "./types";

export interface VerifyResult {
  /** Overall verdict: blob resolved and its hash matches. */
  verified: boolean;
  /** Recomputed sha256 equals the bundle's stored sha256. */
  hashMatch: boolean;
  /** ENS name resolved (normalized). */
  ensName: string;
  /** blobId read from heor.dossier.latest. */
  blobId: string;
  /** The resolver address the records were read from (Sepolia). */
  resolver: string;
  /** All three provenance text records read live from the ENS name. */
  records: ProvenanceRecords["records"];
  /** Public Walrus URL the blob was fetched from (independently checkable). */
  aggregatorUrl: string;
  /** The fetched evidence bundle. */
  dossier: EvidenceBundle;
  /** Confidential-enclave attestation, if the bundle carries one. */
  confidentialAttestation?: ConfidentialAttestation;
}

/**
 * Resolve an ENS name to its pinned blob, fetch it from Walrus, and confirm the
 * bundle's sha256 by recomputing it over every field except sha256 itself.
 */
export async function verifyByEnsName(name?: string): Promise<VerifyResult> {
  // 1. ENS -> blobId.
  const provenance = await readProvenance(name);
  const blobId = provenance.records["heor.dossier.latest"];
  if (!blobId) {
    throw new Error(
      `ENS name "${provenance.name}" has no heor.dossier.latest record set on Sepolia. ` +
        `Run the generate-full flow (or npm run ens-write) to pin a blobId first.`,
    );
  }

  // 2. blobId -> bundle JSON from Walrus.
  const aggregatorUrl = blobUrl(blobId);
  const json = await readBlob(blobId);
  let dossier: EvidenceBundle;
  try {
    dossier = JSON.parse(json) as EvidenceBundle;
  } catch (err) {
    throw new Error(
      `Walrus blob ${blobId} is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // 3. Recompute sha256 over all fields except sha256 and compare.
  const recomputed = bundleSha256(dossier as unknown as Record<string, unknown>);
  const hashMatch = recomputed === dossier.sha256;

  return {
    verified: hashMatch,
    hashMatch,
    ensName: provenance.name,
    blobId,
    resolver: provenance.resolver,
    records: provenance.records,
    aggregatorUrl,
    dossier,
    confidentialAttestation: dossier.confidentialAttestation,
  };
}

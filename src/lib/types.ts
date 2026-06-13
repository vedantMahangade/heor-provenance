/**
 * Shared types for the HEOR provenance pipeline.
 *
 * The product is the verification/provenance layer. Every claim must trace to a
 * specific source span (PMID + supporting sentence) so a third party can
 * independently re-check it. These types encode that contract.
 */

/** A single piece of real evidence fetched from PubMed. */
export interface Source {
  pmid: string;
  title: string;
  /** Full abstract text (sections concatenated). Empty string if none. */
  abstract: string;
  journal?: string;
  /** Publication year as a string, e.g. "2021". */
  year?: string;
  authors?: string[];
  /** Canonical PubMed URL for the record. */
  url: string;
}

/** Grounding status of a claim after server-side verification. */
export type ClaimStatus = "grounded" | "flagged";

/**
 * A single dossier claim, grounded to one source.
 *
 * `status` is decided by OUR verifier, not the model: a claim is only
 * "grounded" if its supportingSentence is actually found in the cited
 * source's abstract. Otherwise it is "flagged" and never presented as fact.
 */
export interface Claim {
  id: string;
  /** The dossier statement, drafted by the LLM. */
  text: string;
  /** PMID of the single source this claim is grounded to. */
  pmid: string;
  /** Exact sentence/span from the source abstract that supports the claim. */
  supportingSentence: string;
  status: ClaimStatus;
  /** Why a claim was flagged (verifier note). Absent when grounded. */
  flagReason?: string;
}

/** The query that produced a bundle. */
export interface DossierQuery {
  drug: string;
  indication: string;
}

/**
 * The self-contained, content-addressed evidence bundle.
 *
 * `sha256` is computed over the canonical JSON of every field EXCEPT sha256
 * itself, so anyone can recompute and confirm integrity. In later phases this
 * blob is what gets stored on Walrus and pinned via ENS.
 */
export interface EvidenceBundle {
  query: DossierQuery;
  claims: Claim[];
  sources: Source[];
  model: string;
  version: string;
  /** ISO-8601 UTC timestamp. */
  timestamp: string;
  /** Hex sha256 of the canonical bundle (all fields except this one). */
  sha256: string;
}

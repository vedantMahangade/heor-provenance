"use client";

import { useMemo, useState, type ReactNode } from "react";
import type {
  Claim,
  ConfidentialAttestation,
  EvidenceBundle,
  Source,
} from "@/lib/types";
import { bundleSha256Client } from "./clientHash";

const card: React.CSSProperties = {
  background: "var(--panel)",
  border: "1px solid var(--border)",
  borderRadius: 12,
  padding: "1.1rem 1.25rem",
};

export function Card({
  children,
  style,
  id,
}: {
  children: ReactNode;
  style?: React.CSSProperties;
  id?: string;
}) {
  return (
    <div id={id} style={{ ...card, scrollMarginTop: "1rem", ...style }}>
      {children}
    </div>
  );
}

export function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <h3 style={{ margin: "0 0 0.75rem", fontSize: "0.8rem", letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--muted)" }}>
      {children}
    </h3>
  );
}

export function Chip({ children, tone = "default" }: { children: ReactNode; tone?: "default" | "good" | "bad" }) {
  const tones = {
    default: { bg: "var(--chip)", fg: "var(--text)" },
    good: { bg: "var(--accent-dim)", fg: "#d7ffe0" },
    bad: { bg: "#4d1f1f", fg: "#ffd7d7" },
  }[tone];
  return (
    <span style={{ background: tones.bg, color: tones.fg, borderRadius: 999, padding: "0.1rem 0.55rem", fontSize: "0.72rem", fontWeight: 600 }}>
      {children}
    </span>
  );
}

// ── Value header ─────────────────────────────────────────────────────────────

/**
 * Top-of-page contrast + the three guarantees, each anchor-linking to the panel
 * below where it is demonstrated (#grounded / #tamper-evident / #confidential).
 */
export function ValueHeader() {
  const guarantees: { label: string; href: string; blurb: string }[] = [
    { label: "Grounded", href: "#grounded", blurb: "every claim cites a real PubMed source" },
    { label: "Tamper-evident", href: "#tamper-evident", blurb: "bundle hash-locked; edits break the hash" },
    { label: "Confidential", href: "#confidential", blurb: "sensitive inputs analyzed in a TEE" },
  ];
  return (
    <Card style={{ marginBottom: "1.5rem" }}>
      <p style={{ margin: 0, color: "var(--muted)" }}>
        A plain LLM dossier: <span style={{ color: "var(--danger)" }}>unsourced, possibly hallucinated, unverifiable.</span>{" "}
        <span style={{ color: "var(--text)" }}>
          This: every claim sourced, the bundle hash-locked and tamper-evident, confidential inputs
          analyzed in a TEE without leaking.
        </span>
      </p>
      <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap", marginTop: "0.9rem" }}>
        {guarantees.map((g) => (
          <a
            key={g.label}
            href={g.href}
            style={{
              flex: "1 1 200px",
              border: "1px solid var(--accent-dim)",
              borderRadius: 10,
              padding: "0.6rem 0.8rem",
              textDecoration: "none",
            }}
          >
            <div style={{ color: "var(--accent)", fontWeight: 700 }}>✓ {g.label}</div>
            <div style={{ color: "var(--muted)", fontSize: "0.82rem" }}>{g.blurb}</div>
          </a>
        ))}
      </div>
    </Card>
  );
}

// ── Claims & citations ───────────────────────────────────────────────────────

function pubmedUrl(pmid: string): string {
  return `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`;
}

/** Inline clickable superscript citation; supporting sentence shown on hover. */
function Cite({ pmid, sentence }: { pmid: string; sentence: string }) {
  return (
    <sup style={{ marginLeft: 2 }}>
      <a
        href={pubmedUrl(pmid)}
        target="_blank"
        rel="noreferrer"
        title={sentence ? `PMID ${pmid} — “${sentence}”` : `PMID ${pmid}`}
        style={{ fontWeight: 600 }}
      >
        [{pmid}]
      </a>
    </sup>
  );
}

function SupportingSentence({ sentence }: { sentence: string }) {
  if (!sentence) return null;
  return (
    <details style={{ marginTop: "0.3rem" }}>
      <summary style={{ cursor: "pointer", color: "var(--muted)", fontSize: "0.78rem" }}>
        supporting sentence
      </summary>
      <blockquote
        style={{
          margin: "0.4rem 0 0",
          padding: "0.5rem 0.75rem",
          borderLeft: "3px solid var(--border)",
          color: "var(--muted)",
          fontSize: "0.84rem",
        }}
      >
        “{sentence}”
      </blockquote>
    </details>
  );
}

function ClaimsSummary({ claims }: { claims: Claim[] }) {
  const grounded = claims.filter((c) => c.status === "grounded").length;
  const dropped = claims.length - grounded;
  return (
    <p style={{ color: "var(--muted)", fontSize: "0.84rem", margin: "0 0 0.9rem" }}>
      {grounded}/{claims.length} claims grounded to a source; ungrounded claims dropped
      {dropped > 0 ? ` (${dropped} dropped)` : ""}.
    </p>
  );
}

/** Read-only grounded claims with inline citations (used by the Generate view). */
export function Claims({ claims }: { claims: Claim[] }) {
  const grounded = claims.filter((c) => c.status === "grounded");
  return (
    <>
      <ClaimsSummary claims={claims} />
      {grounded.length === 0 ? (
        <p style={{ color: "var(--muted)" }}>No grounded claims.</p>
      ) : (
        <ol style={{ margin: 0, paddingLeft: "1.2rem", display: "grid", gap: "0.9rem" }}>
          {grounded.map((c) => (
            <li key={c.id}>
              <span>{c.text}</span>
              <Cite pmid={c.pmid} sentence={c.supportingSentence} />
              <SupportingSentence sentence={c.supportingSentence} />
            </li>
          ))}
        </ol>
      )}
    </>
  );
}

// ── Confidential attestation ──────────────────────────────────────────────────

export function Attestation({ attestation }: { attestation: ConfidentialAttestation }) {
  const Digest = ({ label, value }: { label: string; value: string }) => (
    <div style={{ display: "flex", gap: "0.6rem" }}>
      <span style={{ color: "var(--muted)", minWidth: 120 }}>{label}</span>
      <span className="mono">{value}</span>
    </div>
  );
  return (
    <Card id="confidential" style={{ borderColor: "var(--accent-dim)" }}>
      <SectionTitle>Confidential AI attestation · analyzed in a TEE</SectionTitle>
      <div style={{ display: "flex", gap: "0.5rem", marginBottom: "0.75rem", flexWrap: "wrap" }}>
        <Chip>{attestation.provider}</Chip>
        <Chip>enclave: {attestation.enclave}</Chip>
        <Chip>model: {attestation.model}</Chip>
      </div>
      <div style={{ display: "grid", gap: "0.35rem", fontSize: "0.85rem" }}>
        <Digest label="contentDigest" value={attestation.contentDigest} />
        <Digest label="requestDigest" value={attestation.requestDigest} />
        <Digest label="responseDigest" value={attestation.responseDigest} />
      </div>
      {attestation.output ? (
        <details style={{ marginTop: "0.75rem" }}>
          <summary style={{ cursor: "pointer", color: "var(--muted)", fontSize: "0.85rem" }}>
            Enclave output
          </summary>
          <pre style={{ whiteSpace: "pre-wrap", background: "var(--panel-2)", padding: "0.75rem", borderRadius: 8, marginTop: "0.5rem", fontSize: "0.82rem" }}>
            {attestation.output}
          </pre>
        </details>
      ) : null}
    </Card>
  );
}

// ── Provenance banner ─────────────────────────────────────────────────────────

export function ProvenanceBanner(props: {
  ensName: string;
  blobId: string;
  aggregatorUrl: string;
  hashMatch: boolean;
  sha256: string;
}) {
  const ok = props.hashMatch;
  const Arrow = () => <span style={{ color: "var(--muted)" }}>→</span>;
  return (
    <Card id="tamper-evident" style={{ borderColor: ok ? "var(--accent)" : "var(--danger)", background: ok ? "#10231a" : "#231314" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", marginBottom: "0.6rem", flexWrap: "wrap" }}>
        <strong style={{ color: ok ? "var(--accent)" : "var(--danger)" }}>
          {ok ? "✓ Provenance verified" : "✗ Hash mismatch — not verified"}
        </strong>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", flexWrap: "wrap", fontSize: "0.88rem" }}>
        <span className="mono">{props.ensName}</span>
        <Arrow />
        <a href={props.aggregatorUrl} target="_blank" rel="noreferrer" className="mono" title="Fetch the blob from the Walrus aggregator">
          {props.blobId}
        </a>
        <Arrow />
        <Chip tone={ok ? "good" : "bad"}>sha256 {ok ? "match" : "mismatch"}</Chip>
      </div>
      <div className="mono" style={{ color: "var(--muted)", fontSize: "0.78rem", marginTop: "0.5rem" }}>
        {props.sha256}
      </div>
    </Card>
  );
}

// ── ENS pointer ───────────────────────────────────────────────────────────────

/** The three provenance text records, in render order, with human labels. */
const ENS_RECORD_KEYS: { key: string; label: string }[] = [
  { key: "heor.dossier.latest", label: "blobId of the evidence bundle on Walrus" },
  { key: "heor.agent.version", label: "agent version" },
  { key: "heor.agent.capabilities", label: "agent capabilities" },
];

/**
 * The ENS provenance pointer: the name + its three resolved text records, read
 * LIVE from the ENS name. This is the identity/anchor layer — the dossier and
 * its hash hang off the blobId pinned in heor.dossier.latest.
 */
export function EnsPointer({
  ensName,
  records,
}: {
  ensName: string;
  records: Record<string, string>;
}) {
  return (
    <Card style={{ borderColor: "var(--link)" }}>
      <SectionTitle>ENS provenance pointer · read live from the name</SectionTitle>
      <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap", marginBottom: "0.85rem" }}>
        <a
          href={`https://app.ens.dev/${ensName}`}
          target="_blank"
          rel="noreferrer"
          className="mono"
          style={{ fontSize: "1rem", fontWeight: 600 }}
          title="Open this name on the ENS app"
        >
          {ensName}
        </a>
        <Chip>Sepolia</Chip>
        <Chip>ENS text records</Chip>
      </div>

      <div style={{ display: "grid", gap: "0.55rem" }}>
        {ENS_RECORD_KEYS.map(({ key, label }) => (
          <div key={key} style={{ display: "grid", gap: "0.15rem" }}>
            <div style={{ display: "flex", gap: "0.5rem", alignItems: "baseline", flexWrap: "wrap" }}>
              <code style={{ color: "var(--link)" }}>{key}</code>
              <span style={{ color: "var(--muted)", fontSize: "0.76rem" }}>{label}</span>
            </div>
            <span className="mono" style={{ color: records[key] ? "var(--text)" : "var(--muted)" }}>
              {records[key] || "(not set)"}
            </span>
          </div>
        ))}
      </div>

      <p style={{ color: "var(--muted)", fontSize: "0.8rem", margin: "0.9rem 0 0" }}>
        Resolved <span className="mono">{ensName}</span> →{" "}
        <span className="mono">{records["heor.dossier.latest"] || "(no blobId)"}</span> via the{" "}
        <code>heor.dossier.latest</code> ENS text record.
      </p>
    </Card>
  );
}

// ── Dossier views ─────────────────────────────────────────────────────────────

const dossierHeaderChips = (bundle: EvidenceBundle) => (
  <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", marginBottom: "0.6rem" }}>
    <Chip>{bundle.query.drug}</Chip>
    <Chip>{bundle.query.indication}</Chip>
    <Chip>model: {bundle.model}</Chip>
    <Chip>v{bundle.version}</Chip>
  </div>
);

/** Read-only dossier (Generate view). */
export function DossierView({ bundle }: { bundle: EvidenceBundle }) {
  return (
    <div style={{ display: "grid", gap: "1rem" }}>
      <Card id="grounded">
        <SectionTitle>Dossier · grounded claims</SectionTitle>
        {dossierHeaderChips(bundle)}
        <Claims claims={bundle.claims} />
      </Card>
      {bundle.confidentialAttestation ? <Attestation attestation={bundle.confidentialAttestation} /> : null}
    </div>
  );
}

/** Verify-view dossier with an interactive tamper demo over the claim text. */
export function VerifyDossier({
  bundle,
  storedSha256,
}: {
  bundle: EvidenceBundle;
  storedSha256: string;
}) {
  const grounded = useMemo(() => bundle.claims.filter((c) => c.status === "grounded"), [bundle]);
  const original = useMemo(
    () => Object.fromEntries(bundle.claims.map((c) => [c.id, c.text])) as Record<string, string>,
    [bundle],
  );
  const [texts, setTexts] = useState<Record<string, string>>(original);
  const [busy, setBusy] = useState(false);
  const [check, setCheck] = useState<{ match: boolean; current: string } | null>(null);

  const edited = bundle.claims.some((c) => texts[c.id] !== original[c.id]);

  async function reVerify() {
    setBusy(true);
    // Rebuild the bundle with edited claim text and recompute the canonical hash
    // exactly as the server does (bundleSha256), then compare to the stored hash.
    const editedBundle = {
      ...bundle,
      claims: bundle.claims.map((c) => ({ ...c, text: texts[c.id] ?? c.text })),
    };
    const current = await bundleSha256Client(editedBundle as unknown as Record<string, unknown>);
    setCheck({ match: current === storedSha256, current });
    setBusy(false);
  }

  function reset() {
    setTexts(original);
    setCheck(null);
  }

  return (
    <div style={{ display: "grid", gap: "1rem" }}>
      <Card id="grounded">
        <SectionTitle>Dossier · grounded claims (editable — tamper demo)</SectionTitle>
        {dossierHeaderChips(bundle)}
        <ClaimsSummary claims={bundle.claims} />
        <p style={{ color: "var(--muted)", fontSize: "0.82rem", margin: "0 0 0.9rem" }}>
          Edit any claim below and press <strong>Re-verify</strong> — the bundle hash is recomputed
          client-side and compared to the hash stored on-chain.
        </p>

        {grounded.length === 0 ? (
          <p style={{ color: "var(--muted)" }}>No grounded claims.</p>
        ) : (
          <ol style={{ margin: 0, paddingLeft: "1.2rem", display: "grid", gap: "1rem" }}>
            {grounded.map((c) => {
              const isEdited = texts[c.id] !== original[c.id];
              return (
                <li key={c.id}>
                  <div style={{ display: "flex", alignItems: "baseline", gap: "0.3rem" }}>
                    <textarea
                      value={texts[c.id] ?? ""}
                      onChange={(e) => setTexts((t) => ({ ...t, [c.id]: e.target.value }))}
                      rows={2}
                      style={{
                        font: "inherit",
                        width: "100%",
                        resize: "vertical",
                        padding: "0.5rem 0.65rem",
                        background: "var(--panel-2)",
                        color: "var(--text)",
                        border: `1px solid ${isEdited ? "var(--danger)" : "var(--border)"}`,
                        borderRadius: 8,
                      }}
                    />
                    <Cite pmid={c.pmid} sentence={c.supportingSentence} />
                  </div>
                  {isEdited ? (
                    <span style={{ color: "var(--danger)", fontSize: "0.74rem" }}>edited</span>
                  ) : null}
                  <SupportingSentence sentence={c.supportingSentence} />
                </li>
              );
            })}
          </ol>
        )}

        <div style={{ display: "flex", gap: "0.6rem", marginTop: "1rem", alignItems: "center", flexWrap: "wrap" }}>
          <button
            onClick={reVerify}
            disabled={busy}
            style={{ padding: "0.45rem 1rem", borderRadius: 8, border: "1px solid var(--border)", background: "var(--panel-2)", color: "var(--text)", fontWeight: 600 }}
          >
            {busy ? "Hashing…" : "Re-verify"}
          </button>
          <button
            onClick={reset}
            disabled={!edited && !check}
            style={{ padding: "0.45rem 1rem", borderRadius: 8, border: "1px solid var(--border)", background: "transparent", color: "var(--muted)", fontWeight: 600 }}
          >
            Reset
          </button>
        </div>

        {check ? (
          <div
            style={{
              marginTop: "1rem",
              padding: "0.85rem 1rem",
              borderRadius: 10,
              border: `1px solid ${check.match ? "var(--accent)" : "var(--danger)"}`,
              background: check.match ? "#10231a" : "#231314",
            }}
          >
            <strong style={{ color: check.match ? "var(--accent)" : "var(--danger)" }}>
              {check.match
                ? "✓ PROVENANCE INTACT — recomputed hash matches the stored hash"
                : "✗ PROVENANCE FAILED — content altered, hash no longer matches"}
            </strong>
            <div style={{ display: "grid", gap: "0.25rem", marginTop: "0.6rem", fontSize: "0.78rem" }}>
              <div style={{ display: "flex", gap: "0.6rem" }}>
                <span style={{ color: "var(--muted)", minWidth: 110 }}>stored (before)</span>
                <span className="mono">{storedSha256}</span>
              </div>
              <div style={{ display: "flex", gap: "0.6rem" }}>
                <span style={{ color: "var(--muted)", minWidth: 110 }}>recomputed (after)</span>
                <span className="mono" style={{ color: check.match ? "var(--text)" : "var(--danger)" }}>
                  {check.current}
                </span>
              </div>
            </div>
          </div>
        ) : null}
      </Card>

      {bundle.confidentialAttestation ? <Attestation attestation={bundle.confidentialAttestation} /> : null}
    </div>
  );
}

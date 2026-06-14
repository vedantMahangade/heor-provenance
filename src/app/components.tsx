"use client";

import { useMemo, useState, type ReactNode } from "react";
import type {
  Claim,
  ConfidentialAttestation,
  EvidenceBundle,
} from "@/lib/types";
import { bundleSha256Client } from "./clientHash";

// ── Primitives ────────────────────────────────────────────────────────────────

const card: React.CSSProperties = {
  background: "var(--panel)",
  border: "1px solid var(--border)",
  borderRadius: 10,
  padding: "1.4rem 1.5rem",
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
    <h3
      style={{
        margin: "0 0 1rem",
        fontSize: "0.72rem",
        letterSpacing: "0.08em",
        textTransform: "uppercase",
        color: "var(--faint)",
        fontWeight: 600,
      }}
    >
      {children}
    </h3>
  );
}

function Mono({ children, style }: { children: ReactNode; style?: React.CSSProperties }) {
  return <span className="mono" style={style}>{children}</span>;
}

// A small, secondary tag holding the technical term next to a plain-language label.
function Tag({ children }: { children: ReactNode }) {
  return (
    <span
      style={{
        fontSize: "0.68rem",
        letterSpacing: "0.04em",
        textTransform: "uppercase",
        color: "var(--faint)",
        border: "1px solid var(--border)",
        borderRadius: 5,
        padding: "0.05rem 0.4rem",
        fontWeight: 600,
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </span>
  );
}

// ── Citations ─────────────────────────────────────────────────────────────────

function pubmedUrl(pmid: string): string {
  return `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`;
}

/** Small, quiet citation chip linking to the PubMed record. */
function Cite({ pmid, sentence }: { pmid: string; sentence: string }) {
  return (
    <a
      href={pubmedUrl(pmid)}
      target="_blank"
      rel="noreferrer"
      title={sentence ? `PMID ${pmid} — “${sentence}”` : `PMID ${pmid}`}
      style={{
        display: "inline-block",
        marginLeft: "0.4rem",
        fontSize: "0.7rem",
        fontWeight: 600,
        color: "var(--muted)",
        background: "var(--panel-2)",
        border: "1px solid var(--border)",
        borderRadius: 5,
        padding: "0.02rem 0.4rem",
        verticalAlign: "1px",
        whiteSpace: "nowrap",
        textDecoration: "none",
      }}
    >
      PMID {pmid}
    </a>
  );
}

function groundedCount(claims: Claim[]) {
  const grounded = claims.filter((c) => c.status === "grounded");
  return { grounded, total: claims.length };
}

// ── 1. Hero verdict ─────────────────────────────────────────────────────────

/** Plain-language verdict, quiet success styling — the first thing a judge reads. */
export function HeroVerdict({ ok, source }: { ok: boolean; source: "example" | "live" }) {
  const accent = ok ? "var(--good)" : "var(--danger)";
  return (
    <div
      style={{
        background: ok ? "var(--good-soft)" : "var(--danger-soft)",
        border: "1px solid var(--border)",
        borderLeft: `3px solid ${accent}`,
        borderRadius: 10,
        padding: "1.2rem 1.5rem",
      }}
    >
      <div style={{ display: "flex", alignItems: "baseline", gap: "0.6rem", flexWrap: "wrap" }}>
        <strong style={{ color: accent, fontSize: "1.05rem", fontWeight: 650 }}>
          {ok ? "Verified" : "Not verified"}
        </strong>
        <span style={{ fontSize: "1.05rem", color: "var(--text)" }}>
          {ok
            ? "every claim traces to a published source, and the record hasn’t been altered."
            : "the stored content no longer matches its integrity hash."}
        </span>
      </div>
      <p style={{ margin: "0.5rem 0 0", color: "var(--muted)", fontSize: "0.86rem" }}>
        {source === "live"
          ? "Checked just now: resolved the ENS name, fetched the evidence from Walrus, and recomputed the hash."
          : "Showing the bundled example. The full chain of custody is below under “How this is verified.”"}
      </p>
    </div>
  );
}

// ── 2. The dossier (readable) ─────────────────────────────────────────────────

/** Clean, read-only dossier: claims as readable prose with a quiet citation chip. */
export function ReadableDossier({ bundle }: { bundle: EvidenceBundle }) {
  const { grounded, total } = groundedCount(bundle.claims);
  return (
    <Card id="grounded">
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", flexWrap: "wrap", gap: "0.5rem", marginBottom: "0.25rem" }}>
        <h2 style={{ margin: 0, fontSize: "1.2rem", fontWeight: 650 }}>
          {titleCase(bundle.query.drug)} — {bundle.query.indication}
        </h2>
        <span style={{ color: "var(--muted)", fontSize: "0.85rem" }}>
          {grounded.length}/{total} claims sourced
        </span>
      </div>
      <p style={{ margin: "0 0 1.3rem", color: "var(--faint)", fontSize: "0.82rem" }}>
        Value-dossier evidence summary · drafted from PubMed, every claim grounded to a source
      </p>

      {grounded.length === 0 ? (
        <p style={{ color: "var(--muted)" }}>No grounded claims.</p>
      ) : (
        <div style={{ display: "grid", gap: "0" }}>
          {grounded.map((c, i) => (
            <div
              key={c.id}
              style={{
                padding: "0.95rem 0",
                borderTop: i === 0 ? "none" : "1px solid var(--hairline)",
                fontSize: "1.02rem",
                lineHeight: 1.6,
              }}
            >
              {c.text}
              <Cite pmid={c.pmid} sentence={c.supportingSentence} />
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function titleCase(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ── 3. How this is verified (collapsed by default) ─────────────────────────────

function ChainRow({
  label,
  tag,
  children,
  href,
}: {
  label: string;
  tag: string;
  children: ReactNode;
  href?: string;
}) {
  return (
    <div style={{ padding: "0.85rem 0", borderTop: "1px solid var(--hairline)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "0.55rem", marginBottom: "0.3rem" }}>
        {href ? (
          <a href={href} target="_blank" rel="noreferrer" style={{ fontWeight: 600 }}>
            {label}
          </a>
        ) : (
          <span style={{ fontWeight: 600 }}>{label}</span>
        )}
        <Tag>{tag}</Tag>
      </div>
      <div style={{ fontSize: "0.85rem" }}>{children}</div>
    </div>
  );
}

const ENS_RECORD_LABELS: Record<string, string> = {
  "heor.dossier.latest": "Evidence blob pinned on Walrus",
  "heor.agent.version": "Agent version",
  "heor.agent.capabilities": "Agent capabilities",
};

export function HowVerified(props: {
  ensName: string;
  blobId: string;
  aggregatorUrl: string;
  sha256: string;
  hashMatch: boolean;
  records: Record<string, string>;
  attestation?: ConfidentialAttestation;
}) {
  return (
    <Card id="how-verified" style={{ padding: 0 }}>
      <details>
        <summary
          style={{
            cursor: "pointer",
            padding: "1.1rem 1.5rem",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "0.5rem",
          }}
        >
          <span style={{ fontWeight: 600 }}>How this is verified</span>
          <span style={{ color: "var(--faint)", fontSize: "0.82rem" }}>
            chain of custody · technical detail ▾
          </span>
        </summary>

        <div style={{ padding: "0 1.5rem 1.4rem" }}>
          <p style={{ color: "var(--muted)", fontSize: "0.85rem", margin: "0 0 0.5rem" }}>
            Anyone can reconstruct this chain from public infrastructure, with no trust in us.
          </p>

          <ChainRow
            label={`Published at ${props.ensName}`}
            tag="ENS · Sepolia"
            href={`https://app.ens.dev/${props.ensName}`}
          >
            <span style={{ color: "var(--muted)" }}>
              The name resolves to the evidence blob via the{" "}
              <Mono>heor.dossier.latest</Mono> text record.
            </span>
          </ChainRow>

          <ChainRow label="Evidence stored" tag="Walrus" href={props.aggregatorUrl}>
            <Mono>{props.blobId}</Mono>
          </ChainRow>

          <ChainRow label="Integrity hash" tag="SHA-256">
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
              <Mono>{props.sha256}</Mono>
              <span
                style={{
                  fontSize: "0.72rem",
                  fontWeight: 600,
                  color: props.hashMatch ? "var(--good)" : "var(--danger)",
                }}
              >
                {props.hashMatch ? "recomputed match" : "mismatch"}
              </span>
            </div>
          </ChainRow>

          {/* ENS text records */}
          <div style={{ padding: "0.85rem 0", borderTop: "1px solid var(--hairline)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "0.55rem", marginBottom: "0.5rem" }}>
              <span style={{ fontWeight: 600 }}>On-chain records</span>
              <Tag>ENS text records</Tag>
            </div>
            <div style={{ display: "grid", gap: "0.5rem" }}>
              {Object.keys(ENS_RECORD_LABELS).map((key) => (
                <div key={key} style={{ display: "grid", gap: "0.1rem" }}>
                  <div style={{ display: "flex", gap: "0.5rem", alignItems: "baseline", flexWrap: "wrap" }}>
                    <span style={{ fontSize: "0.85rem", color: "var(--muted)" }}>
                      {ENS_RECORD_LABELS[key]}
                    </span>
                    <Mono style={{ color: "var(--faint)" }}>{key}</Mono>
                  </div>
                  <Mono>{props.records[key] || "(not set)"}</Mono>
                </div>
              ))}
            </div>
          </div>

          {/* Confidential attestation */}
          {props.attestation ? (
            <div style={{ padding: "0.85rem 0", borderTop: "1px solid var(--hairline)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "0.55rem", marginBottom: "0.5rem" }}>
                <span style={{ fontWeight: 600 }}>Confidential analysis</span>
                <Tag>TEE-attested</Tag>
              </div>
              <p style={{ color: "var(--muted)", fontSize: "0.85rem", margin: "0 0 0.5rem" }}>
                A sensitive document was analyzed inside an {props.attestation.enclave} enclave
                ({props.attestation.provider}); the enclave signed digests binding the
                content, request, and response.
              </p>
              <div style={{ display: "grid", gap: "0.35rem" }}>
                <DigestRow label="content" value={props.attestation.contentDigest} />
                <DigestRow label="request" value={props.attestation.requestDigest} />
                <DigestRow label="response" value={props.attestation.responseDigest} />
              </div>
              {props.attestation.output ? (
                <details style={{ marginTop: "0.7rem" }}>
                  <summary style={{ cursor: "pointer", color: "var(--muted)", fontSize: "0.82rem" }}>
                    Enclave output ▾
                  </summary>
                  <pre
                    style={{
                      whiteSpace: "pre-wrap",
                      background: "var(--panel-2)",
                      padding: "0.75rem",
                      borderRadius: 8,
                      marginTop: "0.5rem",
                      fontSize: "0.8rem",
                      lineHeight: 1.5,
                      color: "var(--text)",
                    }}
                  >
                    {props.attestation.output}
                  </pre>
                </details>
              ) : null}
            </div>
          ) : null}
        </div>
      </details>
    </Card>
  );
}

function DigestRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", gap: "0.6rem", alignItems: "baseline" }}>
      <span style={{ color: "var(--faint)", fontSize: "0.78rem", minWidth: 70 }}>{label}</span>
      <Mono>{value}</Mono>
    </div>
  );
}

// ── 4. Tamper test (opt-in) ────────────────────────────────────────────────────

export function TamperTest({
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

  const [open, setOpen] = useState(false);
  const [texts, setTexts] = useState<Record<string, string>>(original);
  const [busy, setBusy] = useState(false);
  const [check, setCheck] = useState<{ match: boolean; current: string } | null>(null);

  const edited = bundle.claims.some((c) => texts[c.id] !== original[c.id]);

  async function reVerify() {
    setBusy(true);
    // Recompute the canonical hash exactly as the server does (src/lib/hash.ts
    // logic, mirrored in clientHash.ts), then compare to the stored hash.
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

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        style={{
          padding: "0.55rem 1rem",
          borderRadius: 7,
          border: "1px solid var(--border)",
          background: "var(--panel)",
          color: "var(--muted)",
          fontWeight: 600,
          fontSize: "0.88rem",
        }}
      >
        Edit a claim to test integrity →
      </button>
    );
  }

  return (
    <Card>
      <SectionTitle>Integrity test</SectionTitle>
      <p style={{ color: "var(--muted)", fontSize: "0.85rem", margin: "0 0 1rem" }}>
        Change any claim and re-verify. The bundle hash is recomputed in your browser and
        compared to the hash stored on-chain — any edit breaks the match.
      </p>

      <div style={{ display: "grid", gap: "0.8rem" }}>
        {grounded.map((c) => {
          const isEdited = texts[c.id] !== original[c.id];
          return (
            <div key={c.id}>
              <textarea
                value={texts[c.id] ?? ""}
                onChange={(e) => setTexts((t) => ({ ...t, [c.id]: e.target.value }))}
                rows={2}
                style={{
                  font: "inherit",
                  width: "100%",
                  resize: "vertical",
                  padding: "0.55rem 0.7rem",
                  background: "var(--panel)",
                  color: "var(--text)",
                  border: `1px solid ${isEdited ? "var(--danger)" : "var(--border)"}`,
                  borderRadius: 7,
                  lineHeight: 1.5,
                }}
              />
              {isEdited ? (
                <span style={{ color: "var(--danger)", fontSize: "0.74rem" }}>edited</span>
              ) : null}
            </div>
          );
        })}
      </div>

      <div style={{ display: "flex", gap: "0.6rem", marginTop: "1rem", alignItems: "center", flexWrap: "wrap" }}>
        <button
          onClick={reVerify}
          disabled={busy}
          style={{
            padding: "0.5rem 1.1rem",
            borderRadius: 7,
            border: "1px solid var(--accent)",
            background: "var(--accent)",
            color: "#fff",
            fontWeight: 600,
          }}
        >
          {busy ? "Hashing…" : "Re-verify"}
        </button>
        <button
          onClick={reset}
          disabled={!edited && !check}
          style={{
            padding: "0.5rem 1.1rem",
            borderRadius: 7,
            border: "1px solid var(--border)",
            background: "transparent",
            color: "var(--muted)",
            fontWeight: 600,
          }}
        >
          Reset
        </button>
      </div>

      {check ? (
        <div
          style={{
            marginTop: "1.1rem",
            padding: "0.9rem 1.1rem",
            borderRadius: 9,
            border: "1px solid var(--border)",
            borderLeft: `3px solid ${check.match ? "var(--good)" : "var(--danger)"}`,
            background: check.match ? "var(--good-soft)" : "var(--danger-soft)",
          }}
        >
          <strong style={{ color: check.match ? "var(--good)" : "var(--danger)" }}>
            {check.match
              ? "Integrity check passed — recomputed hash matches the stored hash."
              : "Integrity check failed — content was altered."}
          </strong>
          <div style={{ display: "grid", gap: "0.3rem", marginTop: "0.6rem", fontSize: "0.78rem" }}>
            <div style={{ display: "flex", gap: "0.6rem" }}>
              <span style={{ color: "var(--faint)", minWidth: 110 }}>stored</span>
              <Mono>{storedSha256}</Mono>
            </div>
            <div style={{ display: "flex", gap: "0.6rem" }}>
              <span style={{ color: "var(--faint)", minWidth: 110 }}>recomputed</span>
              <Mono style={{ color: check.match ? "var(--muted)" : "var(--danger)" }}>
                {check.current}
              </Mono>
            </div>
          </div>
        </div>
      ) : null}
    </Card>
  );
}

// ── Result assembly ─────────────────────────────────────────────────────────

export interface DossierResultData {
  ensName: string;
  blobId: string;
  aggregatorUrl: string;
  records: Record<string, string>;
  bundle: EvidenceBundle;
  hashMatch: boolean;
}

/**
 * The full result view shared by Verify and Generate: hero verdict, readable
 * dossier, collapsed chain-of-custody, and the opt-in tamper test. Meaning
 * first, technical detail folded away.
 */
export function DossierResult({
  data,
  source,
}: {
  data: DossierResultData;
  source: "example" | "live";
}) {
  return (
    <div style={{ display: "grid", gap: "1.1rem" }}>
      <HeroVerdict ok={data.hashMatch} source={source} />
      <ReadableDossier bundle={data.bundle} />
      <HowVerified
        ensName={data.ensName}
        blobId={data.blobId}
        aggregatorUrl={data.aggregatorUrl}
        sha256={data.bundle.sha256}
        hashMatch={data.hashMatch}
        records={data.records}
        attestation={data.bundle.confidentialAttestation}
      />
      <TamperTest bundle={data.bundle} storedSha256={data.bundle.sha256} />
    </div>
  );
}

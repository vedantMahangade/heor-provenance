"use client";

import { useMemo, useState, type ReactNode } from "react";
import type { Claim, ConfidentialAttestation, EvidenceBundle, Source } from "@/lib/types";
import { citationRegex } from "@/lib/citations";
import { parseMarkdownBlocks } from "@/lib/markdownBlocks";
import { bundleSha256Client } from "./clientHash";
import { downloadChapterDocx } from "./exportDocx";

// ── Primitives ────────────────────────────────────────────────────────────────

const card: React.CSSProperties = {
  background: "var(--panel)",
  border: "1px solid var(--border)",
  borderRadius: 10,
  padding: "1.4rem 1.5rem",
};

export function Card({ children, style, id }: { children: ReactNode; style?: React.CSSProperties; id?: string }) {
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
        margin: "0 0 0.9rem",
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

function pubmedUrl(pmid: string): string {
  return `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`;
}

// ── Inline citation chip (clickable PMID + ✓/⚠) ────────────────────────────────

function Cite({ pmid, claim }: { pmid: string; claim?: Claim }) {
  const verified = claim?.status === "grounded";
  const mark = verified ? "✓" : "⚠";
  const color = verified ? "var(--good)" : "var(--danger)";
  const title = !claim
    ? `PMID ${pmid}`
    : verified
      ? `Verified — supporting sentence found in this source:\n“${claim.supportingSentence}”`
      : `Needs review — ${claim.flagReason ?? "supporting sentence not confirmed in this source."}`;
  return (
    <a
      href={pubmedUrl(pmid)}
      target="_blank"
      rel="noreferrer"
      title={title}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "0.2rem",
        margin: "0 0.1rem",
        fontSize: "0.72rem",
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
      <span style={{ color }}>{mark}</span>
    </a>
  );
}

// ── Chapter markdown renderer (interleaves inline citations) ───────────────────

interface RenderCtx {
  claims: Claim[];
  counter: { i: number };
  key: { k: number };
}

/** Render a text run, honoring **bold** and inline [PMID] citations in order. */
function renderInline(text: string, ctx: RenderCtx): ReactNode[] {
  const nodes: ReactNode[] = [];
  const re = citationRegex();
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) nodes.push(...renderBold(text.slice(last, m.index), ctx));
    const pmid = m[1];
    const claim = ctx.claims[ctx.counter.i++];
    nodes.push(<Cite key={`c${ctx.key.k++}`} pmid={pmid} claim={claim} />);
    last = m.index + m[0].length;
  }
  if (last < text.length) nodes.push(...renderBold(text.slice(last), ctx));
  return nodes;
}

function renderBold(text: string, ctx: RenderCtx): ReactNode[] {
  return text
    .split(/(\*\*[^*]+\*\*)/g)
    .filter(Boolean)
    .map((part) =>
      /^\*\*[^*]+\*\*$/.test(part) ? (
        <strong key={`b${ctx.key.k++}`}>{part.slice(2, -2)}</strong>
      ) : (
        <span key={`t${ctx.key.k++}`}>{part}</span>
      ),
    );
}

function ChapterBody({ chapter, claims }: { chapter: string; claims: Claim[] }) {
  const ctx: RenderCtx = { claims, counter: { i: 0 }, key: { k: 0 } };
  const blocks = useMemo(() => parseMarkdownBlocks(chapter), [chapter]);

  return (
    <div style={{ fontSize: "1rem", lineHeight: 1.65 }}>
      {blocks.map((b, i) => {
        if (b.type === "heading") {
          const size = b.level <= 1 ? "1.15rem" : b.level === 2 ? "1.02rem" : "0.92rem";
          return (
            <p
              key={i}
              style={{
                margin: i === 0 ? "0 0 0.6rem" : "1.4rem 0 0.55rem",
                fontSize: size,
                fontWeight: 650,
                color: "var(--text)",
              }}
            >
              {renderInline(b.text, ctx)}
            </p>
          );
        }
        if (b.type === "list") {
          const Tag = b.ordered ? "ol" : "ul";
          return (
            <Tag key={i} style={{ margin: "0.5rem 0", paddingLeft: "1.3rem", display: "grid", gap: "0.35rem" }}>
              {b.items.map((it, j) => (
                <li key={j}>{renderInline(it, ctx)}</li>
              ))}
            </Tag>
          );
        }
        return (
          <p key={i} style={{ margin: "0 0 0.9rem" }}>
            {renderInline(b.text, ctx)}
          </p>
        );
      })}
    </div>
  );
}

// ── Verification summary (the headline) ────────────────────────────────────────

function verifyCounts(claims: Claim[]) {
  const total = claims.length;
  const verified = claims.filter((c) => c.status === "grounded").length;
  return { total, verified, flagged: total - verified };
}

function VerificationSummary({ claims }: { claims: Claim[] }) {
  const { total, verified, flagged } = verifyCounts(claims);
  // Verification succeeding is the normal, good outcome — style it as a result,
  // not an error. Red is reserved for the failure case where NOTHING verified.
  const noneVerified = total > 0 && verified === 0;
  const accent = noneVerified ? "var(--danger)" : "var(--good)";
  return (
    <div
      style={{
        background: noneVerified ? "var(--danger-soft)" : "var(--good-soft)",
        border: "1px solid var(--border)",
        borderLeft: `3px solid ${accent}`,
        borderRadius: 9,
        padding: "0.9rem 1.1rem",
        margin: "0 0 1.2rem",
      }}
    >
      <strong style={{ color: accent, fontSize: "1.02rem", fontWeight: 650 }}>
        {total === 0
          ? "No inline citations found in this draft."
          : `Independent verification: ${verified} of ${total} citations confirmed against their source.` +
            (flagged > 0 ? ` ${flagged} need human review.` : "")}
      </strong>
      <p style={{ margin: "0.4rem 0 0", color: "var(--muted)", fontSize: "0.84rem" }}>
        Every inline <span style={{ color: "var(--good)", fontWeight: 600 }}>PMID ✓</span> was
        independently re-checked against its abstract;{" "}
        <span style={{ color: "var(--danger)", fontWeight: 600 }}>PMID ⚠</span> means the cited
        source doesn’t confirm the statement — needs human review.
      </p>
    </div>
  );
}

// ── 1. GVD chapter (draft) ─────────────────────────────────────────────────────

const SCOPE_NOTE =
  "Drafts a single, targeted GVD chapter — grounded and independently verified, not the full dossier.";

function titleCase(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function ChapterView({ bundle, source }: { bundle: EvidenceBundle; source: "example" | "live" }) {
  const [busy, setBusy] = useState(false);
  const focus = bundle.query.focus?.trim();

  async function onDownload() {
    setBusy(true);
    try {
      await downloadChapterDocx(bundle);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card id="grounded">
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", flexWrap: "wrap", gap: "0.5rem" }}>
        <SectionTitle>GVD chapter (draft)</SectionTitle>
        <div style={{ display: "flex", gap: "0.4rem", alignItems: "center" }}>
          <Tag>model {bundle.model}</Tag>
          <Tag>{source === "live" ? "generated live" : "example"}</Tag>
        </div>
      </div>

      <h2 style={{ margin: "0 0 0.15rem", fontSize: "1.25rem", fontWeight: 650 }}>
        {titleCase(bundle.query.drug)} — {bundle.query.indication}
        {focus ? <span style={{ color: "var(--muted)", fontWeight: 500 }}> · {focus}</span> : null}
      </h2>
      <p style={{ margin: "0 0 1.2rem", color: "var(--faint)", fontSize: "0.82rem" }}>{SCOPE_NOTE}</p>

      <VerificationSummary claims={bundle.claims} />

      <div style={{ marginBottom: "1.3rem" }}>
        <button
          onClick={onDownload}
          disabled={busy}
          style={{
            padding: "0.5rem 1rem",
            borderRadius: 7,
            border: "1px solid var(--border)",
            background: "var(--panel)",
            color: "var(--text)",
            fontWeight: 600,
            fontSize: "0.86rem",
          }}
        >
          {busy ? "Preparing…" : "Download .docx"}
        </button>
      </div>

      <ChapterBody chapter={bundle.chapter ?? ""} claims={bundle.claims} />
    </Card>
  );
}

// ── 2. References / sources ────────────────────────────────────────────────────

export function References({ bundle }: { bundle: EvidenceBundle }) {
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of bundle.claims) m.set(c.pmid, (m.get(c.pmid) ?? 0) + 1);
    return m;
  }, [bundle.claims]);

  if (bundle.sources.length === 0) return null;
  return (
    <Card>
      <SectionTitle>References / sources</SectionTitle>
      <ol style={{ margin: 0, paddingLeft: "1.2rem", display: "grid", gap: "0.7rem" }}>
        {bundle.sources.map((s) => (
          <li key={s.pmid}>
            <RefItem source={s} cited={counts.get(s.pmid) ?? 0} />
          </li>
        ))}
      </ol>
    </Card>
  );
}

function RefItem({ source, cited }: { source: Source; cited: number }) {
  const meta = [source.journal, source.year].filter(Boolean).join(", ");
  return (
    <div>
      <a href={pubmedUrl(source.pmid)} target="_blank" rel="noreferrer" style={{ fontWeight: 600 }}>
        {source.title}
      </a>
      <div style={{ color: "var(--muted)", fontSize: "0.82rem", marginTop: "0.15rem" }}>
        <Mono>PMID {source.pmid}</Mono>
        {meta ? <> · {meta}</> : null}
        {cited > 0 ? <> · cited {cited}×</> : null}
      </div>
    </div>
  );
}

// ── 3. How this is verified (collapsed) ────────────────────────────────────────

function ChainRow({ label, tag, children, href }: { label: string; tag: string; children: ReactNode; href?: string }) {
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
          <span style={{ color: props.hashMatch ? "var(--faint)" : "var(--danger)", fontSize: "0.82rem" }}>
            {props.hashMatch ? "integrity ✓ · chain of custody ▾" : "⚠ integrity check failed ▾"}
          </span>
        </summary>

        <div style={{ padding: "0 1.5rem 1.4rem" }}>
          <p style={{ color: "var(--muted)", fontSize: "0.85rem", margin: "0 0 0.5rem" }}>
            Anyone can reconstruct this chain from public infrastructure, with no trust in us.
          </p>

          <ChainRow label={`Published at ${props.ensName}`} tag="ENS · Sepolia" href={`https://app.ens.dev/${props.ensName}`}>
            <span style={{ color: "var(--muted)" }}>
              The name resolves to the evidence blob via the <Mono>heor.dossier.latest</Mono> text record.
            </span>
          </ChainRow>

          <ChainRow label="Evidence stored" tag="Walrus" href={props.aggregatorUrl}>
            <Mono>{props.blobId}</Mono>
          </ChainRow>

          <ChainRow label="Integrity hash" tag="SHA-256">
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
              <Mono>{props.sha256}</Mono>
              <span style={{ fontSize: "0.72rem", fontWeight: 600, color: props.hashMatch ? "var(--good)" : "var(--danger)" }}>
                {props.hashMatch ? "recomputed match" : "mismatch"}
              </span>
            </div>
          </ChainRow>

          <div style={{ padding: "0.85rem 0", borderTop: "1px solid var(--hairline)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "0.55rem", marginBottom: "0.5rem" }}>
              <span style={{ fontWeight: 600 }}>On-chain records</span>
              <Tag>ENS text records</Tag>
            </div>
            <div style={{ display: "grid", gap: "0.5rem" }}>
              {Object.keys(ENS_RECORD_LABELS).map((key) => (
                <div key={key} style={{ display: "grid", gap: "0.1rem" }}>
                  <div style={{ display: "flex", gap: "0.5rem", alignItems: "baseline", flexWrap: "wrap" }}>
                    <span style={{ fontSize: "0.85rem", color: "var(--muted)" }}>{ENS_RECORD_LABELS[key]}</span>
                    <Mono style={{ color: "var(--faint)" }}>{key}</Mono>
                  </div>
                  <Mono>{props.records[key] || "(not set)"}</Mono>
                </div>
              ))}
            </div>
          </div>

          {props.attestation ? (
            <div style={{ padding: "0.85rem 0", borderTop: "1px solid var(--hairline)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "0.55rem", marginBottom: "0.5rem" }}>
                <span style={{ fontWeight: 600 }}>Confidential analysis</span>
                <Tag>TEE-attested</Tag>
              </div>
              <p style={{ color: "var(--muted)", fontSize: "0.85rem", margin: "0 0 0.5rem" }}>
                The chapter was drafted inside an {props.attestation.enclave} enclave
                ({props.attestation.provider}, model {props.attestation.model}); the confidential
                source document never left the enclave. Enclave-signed digests bind the content,
                request, and response.
              </p>
              <div style={{ display: "grid", gap: "0.35rem" }}>
                <DigestRow label="content" value={props.attestation.contentDigest} />
                <DigestRow label="request" value={props.attestation.requestDigest} />
                <DigestRow label="response" value={props.attestation.responseDigest} />
              </div>
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

export function TamperTest({ bundle, storedSha256 }: { bundle: EvidenceBundle; storedSha256: string }) {
  const original = bundle.chapter ?? "";
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(original);
  const [busy, setBusy] = useState(false);
  const [check, setCheck] = useState<{ match: boolean; current: string } | null>(null);

  async function reVerify() {
    setBusy(true);
    const edited = { ...bundle, chapter: text };
    const current = await bundleSha256Client(edited as unknown as Record<string, unknown>);
    setCheck({ match: current === storedSha256, current });
    setBusy(false);
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
        Edit the chapter to test integrity →
      </button>
    );
  }

  return (
    <Card>
      <SectionTitle>Integrity test</SectionTitle>
      <p style={{ color: "var(--muted)", fontSize: "0.85rem", margin: "0 0 1rem" }}>
        Change any text below and re-verify. The bundle hash is recomputed in your browser and
        compared to the hash stored on-chain — any edit breaks the match.
      </p>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={8}
        style={{
          font: "inherit",
          width: "100%",
          resize: "vertical",
          padding: "0.6rem 0.7rem",
          background: "var(--panel)",
          color: "var(--text)",
          border: `1px solid ${text !== original ? "var(--danger)" : "var(--border)"}`,
          borderRadius: 7,
          lineHeight: 1.5,
          fontSize: "0.9rem",
        }}
      />
      <div style={{ display: "flex", gap: "0.6rem", marginTop: "0.8rem", alignItems: "center", flexWrap: "wrap" }}>
        <button
          onClick={reVerify}
          disabled={busy}
          style={{ padding: "0.5rem 1.1rem", borderRadius: 7, border: "1px solid var(--accent)", background: "var(--accent)", color: "#fff", fontWeight: 600 }}
        >
          {busy ? "Hashing…" : "Re-verify"}
        </button>
        <button
          onClick={() => {
            setText(original);
            setCheck(null);
          }}
          disabled={text === original && !check}
          style={{ padding: "0.5rem 1.1rem", borderRadius: 7, border: "1px solid var(--border)", background: "transparent", color: "var(--muted)", fontWeight: 600 }}
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
              <Mono style={{ color: check.match ? "var(--muted)" : "var(--danger)" }}>{check.current}</Mono>
            </div>
          </div>
        </div>
      ) : null}
    </Card>
  );
}

// ── Result assembly ────────────────────────────────────────────────────────────

export interface DossierResultData {
  ensName: string;
  blobId: string;
  aggregatorUrl: string;
  records: Record<string, string>;
  bundle: EvidenceBundle;
  hashMatch: boolean;
}

/**
 * The full result view shared by Generate and Verify, in the order a 2-minute
 * skim wants it: (a) the cited GVD chapter draft + verification summary,
 * (b) references, (c) collapsed chain-of-custody, then the opt-in tamper test.
 */
export function DossierResult({ data, source }: { data: DossierResultData; source: "example" | "live" }) {
  return (
    <div style={{ display: "grid", gap: "1.1rem" }}>
      <ChapterView bundle={data.bundle} source={source} />
      <References bundle={data.bundle} />
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

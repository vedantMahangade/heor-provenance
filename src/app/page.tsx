"use client";

import { useEffect, useState } from "react";
import type { FullGenerateResult, ProgressStep } from "@/lib/fullGenerate";
import type { VerifyResult } from "@/lib/verify";
import {
  Card,
  Chip,
  DossierView,
  EnsPointer,
  ProvenanceBanner,
  SectionTitle,
  ValueHeader,
  VerifyDossier,
} from "./components";

type Tab = "verify" | "generate";

export default function Home() {
  const [tab, setTab] = useState<Tab>("verify");
  return (
    <main style={{ maxWidth: 860, margin: "0 auto", padding: "2.5rem 1.25rem 4rem" }}>
      <header style={{ marginBottom: "1.25rem" }}>
        <h1 style={{ margin: 0, fontSize: "1.6rem" }}>HEOR Provenance Agent</h1>
        <p style={{ color: "var(--muted)", margin: "0.4rem 0 0" }}>
          Grounded HEOR dossier claims from real PubMed evidence, each independently verifiable via
          Walrus + ENS. Augmentation with a human in the loop — not autonomous drafting.
        </p>
      </header>

      <ValueHeader />

      <nav style={{ display: "flex", gap: "0.5rem", marginBottom: "1.5rem" }}>
        <TabButton active={tab === "verify"} onClick={() => setTab("verify")}>
          Verify (no keys needed)
        </TabButton>
        <TabButton active={tab === "generate"} onClick={() => setTab("generate")}>
          Generate (requires keys)
        </TabButton>
      </nav>

      {tab === "verify" ? <VerifyPanel /> : <GeneratePanel />}
    </main>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: "0.5rem 1.1rem",
        borderRadius: 8,
        border: "1px solid var(--border)",
        background: active ? "var(--panel-2)" : "transparent",
        color: active ? "var(--text)" : "var(--muted)",
        fontWeight: 600,
      }}
    >
      {children}
    </button>
  );
}

const primaryBtn: React.CSSProperties = {
  padding: "0.6rem 1.2rem",
  borderRadius: 8,
  border: "1px solid var(--accent-dim)",
  background: "var(--accent-dim)",
  color: "#eafff0",
  fontWeight: 600,
};

// ── Verify (default, keyless) ─────────────────────────────────────────────────

function VerifyPanel() {
  const [name, setName] = useState("heor-prov.eth");
  const [result, setResult] = useState<VerifyResult | null>(null);
  const [source, setSource] = useState<"example" | "live">("example");
  const [loadingExample, setLoadingExample] = useState(true);
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Render the bundled example immediately on load — no network to an external
  // service, no keys. This is the first thing a judge sees.
  useEffect(() => {
    let cancelled = false;
    fetch("/demo/sample-bundle.json")
      .then((r) => r.json())
      .then((d: VerifyResult) => {
        if (!cancelled) {
          setResult(d);
          setSource("example");
        }
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoadingExample(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function verifyLive() {
    if (verifying) return;
    setVerifying(true);
    setError(null);
    try {
      const res = await fetch("/api/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim() || "heor-prov.eth" }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j?.error ?? `Request failed (${res.status})`);
      setResult(j as VerifyResult);
      setSource("live");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setVerifying(false);
    }
  }

  return (
    <div style={{ display: "grid", gap: "1.25rem" }}>
      <Card>
        <SectionTitle>Verify provenance · ENS → Walrus → recompute sha256</SectionTitle>
        <div style={{ display: "flex", gap: "0.6rem", alignItems: "flex-end", flexWrap: "wrap" }}>
          <div style={{ flex: "1 1 240px" }}>
            <label htmlFor="ens">ENS name</label>
            <input id="ens" type="text" value={name} placeholder="heor-prov.eth" onChange={(e) => setName(e.target.value)} disabled={verifying} />
          </div>
          <button onClick={verifyLive} style={primaryBtn} disabled={verifying}>
            {verifying ? "Verifying on-chain…" : "Verify live on-chain"}
          </button>
        </div>
        <p style={{ color: "var(--muted)", fontSize: "0.82rem", margin: "0.7rem 0 0" }}>
          {source === "live"
            ? "✓ Verified live just now — resolved the ENS record, fetched the blob from Walrus, and recomputed the hash."
            : "Showing the bundled example below (no keys needed). Click “Verify live on-chain” to run the real round trip. Reads default to a public Sepolia RPC, so this works on a clean clone."}
        </p>
      </Card>

      {error ? (
        <Card style={{ borderColor: "var(--danger)", background: "#231314" }}>
          <strong style={{ color: "var(--danger)" }}>Error</strong>
          <p style={{ margin: "0.4rem 0 0", whiteSpace: "pre-wrap" }}>{error}</p>
        </Card>
      ) : null}

      {loadingExample && !result ? <Card><span className="spin" /> Loading example…</Card> : null}

      {result ? (
        <>
          <div style={{ display: "flex", gap: "0.5rem" }}>
            <Chip tone={source === "live" ? "good" : "default"}>
              {source === "live" ? "live on-chain result" : "bundled example (cached, keyless)"}
            </Chip>
          </div>
          <ProvenanceBanner
            ensName={result.ensName}
            blobId={result.blobId}
            aggregatorUrl={result.aggregatorUrl}
            hashMatch={result.hashMatch}
            sha256={result.dossier.sha256}
          />
          <EnsPointer ensName={result.ensName} records={result.records} />
          <VerifyDossier bundle={result.dossier} storedSha256={result.dossier.sha256} />
        </>
      ) : null}
    </div>
  );
}

// ── Generate (gated behind keys) ──────────────────────────────────────────────

const README_GENERATE_URL =
  "https://github.com/vedantMahangade/heor-provenance#generate-requires-keys";

function GeneratePanel() {
  const [cfg, setCfg] = useState<{ generateEnabled: boolean; missing: string[] } | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/config")
      .then((r) => r.json())
      .then((d) => !cancelled && setCfg(d))
      .catch(() => !cancelled && setCfg({ generateEnabled: false, missing: [] }));
    return () => {
      cancelled = true;
    };
  }, []);

  if (cfg === null) {
    return <Card><span className="spin" /> Checking configuration…</Card>;
  }

  if (!cfg.generateEnabled) {
    return (
      <Card style={{ borderColor: "var(--border)" }}>
        <SectionTitle>Generate needs API keys</SectionTitle>
        <p style={{ margin: "0 0 0.6rem" }}>
          Generating a new dossier runs PubMed → an LLM → optional confidential inference → Walrus →
          ENS writes, so it needs server-side keys and a funded Sepolia key. None are required for the
          Verify demo.
        </p>
        {cfg.missing.length > 0 ? (
          <p style={{ color: "var(--muted)", fontSize: "0.85rem", margin: "0 0 0.6rem" }}>
            Missing: <span className="mono">{cfg.missing.join(", ")}</span>
          </p>
        ) : null}
        <p style={{ margin: 0 }}>
          <a href={README_GENERATE_URL} target="_blank" rel="noreferrer">
            README → Generate (requires keys)
          </a>{" "}
          lists the env vars (also see <span className="mono">.env.example</span>).
        </p>
      </Card>
    );
  }

  return <GenerateForm />;
}

const STEP_LABELS: Record<ProgressStep, string> = {
  draft: "Fetch PubMed evidence + draft grounded claims",
  confidential: "Confidential enclave attestation (AWS Nitro)",
  walrus: "Store evidence bundle on Walrus",
  ens: "Pin provenance to ENS text records",
};
const STEP_ORDER: ProgressStep[] = ["draft", "confidential", "walrus", "ens"];
type StepState = "pending" | "active" | "done" | "skipped";

function GenerateForm() {
  const [drug, setDrug] = useState("");
  const [indication, setIndication] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [running, setRunning] = useState(false);
  const [steps, setSteps] = useState<Record<ProgressStep, StepState>>({
    draft: "pending",
    confidential: "pending",
    walrus: "pending",
    ens: "pending",
  });
  const [result, setResult] = useState<FullGenerateResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!drug.trim() || !indication.trim() || running) return;

    setRunning(true);
    setResult(null);
    setError(null);
    setSteps({
      draft: "pending",
      confidential: file ? "pending" : "skipped",
      walrus: "pending",
      ens: "pending",
    });

    const fd = new FormData();
    fd.set("drug", drug.trim());
    fd.set("indication", indication.trim());
    if (file) fd.set("sensitive", file);

    try {
      const res = await fetch("/api/generate", { method: "POST", body: fd });
      if (!res.ok || !res.body) {
        const j = await res.json().catch(() => null);
        throw new Error(j?.error ?? `Request failed (${res.status})`);
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let nl: number;
        while ((nl = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (!line) continue;
          const msg = JSON.parse(line);
          if (msg.type === "progress") {
            setSteps((s) => ({ ...s, [msg.step as ProgressStep]: msg.status === "done" ? "done" : "active" }));
          } else if (msg.type === "result") {
            setResult(msg.data as FullGenerateResult);
          } else if (msg.type === "error") {
            setError(msg.message);
          }
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRunning(false);
    }
  }

  return (
    <div style={{ display: "grid", gap: "1.25rem" }}>
      <Card>
        <form onSubmit={onSubmit} style={{ display: "grid", gap: "1rem" }}>
          <div>
            <label htmlFor="drug">Drug</label>
            <input id="drug" type="text" value={drug} placeholder="empagliflozin" onChange={(e) => setDrug(e.target.value)} disabled={running} />
          </div>
          <div>
            <label htmlFor="indication">Indication</label>
            <input id="indication" type="text" value={indication} placeholder="type 2 diabetes" onChange={(e) => setIndication(e.target.value)} disabled={running} />
          </div>
          <div>
            <label htmlFor="sensitive">Sensitive document (optional — runs confidential attestation)</label>
            <input id="sensitive" type="file" onChange={(e) => setFile(e.target.files?.[0] ?? null)} disabled={running} />
            <p style={{ color: "var(--muted)", fontSize: "0.78rem", margin: "0.4rem 0 0" }}>
              ⚠ The Confidential AI dev preview may log inputs — use SYNTHETIC data only, never real PHI.
            </p>
          </div>
          <div>
            <button type="submit" style={primaryBtn} disabled={running || !drug.trim() || !indication.trim()}>
              {running ? "Running…" : "Generate + anchor provenance"}
            </button>
            {running ? (
              <span style={{ color: "var(--muted)", fontSize: "0.82rem", marginLeft: "0.75rem" }}>
                This takes 1–2 min (PubMed + LLM + confidential + Walrus + ENS).
              </span>
            ) : null}
          </div>
        </form>
      </Card>

      {(running || result || error) && (
        <Card>
          <SectionTitle>Progress</SectionTitle>
          <div style={{ display: "grid", gap: "0.5rem" }}>
            {STEP_ORDER.map((key) => (
              <StepRow key={key} label={STEP_LABELS[key]} state={steps[key]} />
            ))}
          </div>
        </Card>
      )}

      {error ? (
        <Card style={{ borderColor: "var(--danger)", background: "#231314" }}>
          <strong style={{ color: "var(--danger)" }}>Error</strong>
          <p style={{ margin: "0.4rem 0 0", whiteSpace: "pre-wrap" }}>{error}</p>
        </Card>
      ) : null}

      {result ? (
        <>
          <ProvenanceBanner
            ensName={result.ensName}
            blobId={result.blobId}
            aggregatorUrl={result.aggregatorUrl}
            hashMatch
            sha256={result.bundle.sha256}
          />
          <EnsPointer ensName={result.ensName} records={Object.fromEntries(result.txs.map((t) => [t.key, t.value]))} />
          <DossierView bundle={result.bundle} />
        </>
      ) : null}
    </div>
  );
}

function StepRow({ label, state }: { label: string; state: StepState }) {
  const icon =
    state === "done" ? "✓" : state === "active" ? <span className="spin" /> : state === "skipped" ? "–" : "○";
  const color = state === "done" ? "var(--accent)" : state === "active" ? "var(--link)" : "var(--muted)";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", color: state === "pending" || state === "skipped" ? "var(--muted)" : "var(--text)" }}>
      <span style={{ width: 16, textAlign: "center", color }}>{icon}</span>
      <span>{label}</span>
      {state === "skipped" ? <span style={{ color: "var(--muted)", fontSize: "0.78rem" }}>(no document)</span> : null}
    </div>
  );
}

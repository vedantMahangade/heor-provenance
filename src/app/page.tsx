"use client";

import { useEffect, useState } from "react";
import type { FullGenerateResult, ProgressStep } from "@/lib/fullGenerate";
import type { VerifyResult } from "@/lib/verify";
import { Card, DossierResult, SectionTitle, type DossierResultData } from "./components";

type Tab = "verify" | "generate";

export default function Home() {
  const [tab, setTab] = useState<Tab>("verify");
  return (
    <main style={{ maxWidth: 760, margin: "0 auto", padding: "3rem 1.25rem 5rem" }}>
      <header style={{ marginBottom: "2rem" }}>
        <h1 style={{ margin: 0, fontSize: "1.5rem", fontWeight: 650, letterSpacing: "-0.01em" }}>
          HEOR Provenance Agent
        </h1>
        <p style={{ color: "var(--muted)", margin: "0.5rem 0 0", maxWidth: 600 }}>
          HEOR value-dossier claims drafted from real PubMed evidence — each one independently
          verifiable through Walrus and ENS. Augmentation with a human in the loop, not autonomous
          drafting.
        </p>
      </header>

      <nav style={{ display: "flex", gap: "1.5rem", marginBottom: "1.75rem", borderBottom: "1px solid var(--border)" }}>
        <TabButton active={tab === "verify"} onClick={() => setTab("verify")}>
          Verify
        </TabButton>
        <TabButton active={tab === "generate"} onClick={() => setTab("generate")}>
          Generate
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
        padding: "0 0 0.7rem",
        border: "none",
        background: "transparent",
        color: active ? "var(--text)" : "var(--muted)",
        fontWeight: 600,
        fontSize: "0.95rem",
        borderBottom: `2px solid ${active ? "var(--accent)" : "transparent"}`,
        marginBottom: -1,
      }}
    >
      {children}
    </button>
  );
}

const primaryBtn: React.CSSProperties = {
  padding: "0.55rem 1.1rem",
  borderRadius: 7,
  border: "1px solid var(--accent)",
  background: "var(--accent)",
  color: "#fff",
  fontWeight: 600,
};

const quietBtn: React.CSSProperties = {
  padding: "0.55rem 1.1rem",
  borderRadius: 7,
  border: "1px solid var(--border)",
  background: "var(--panel)",
  color: "var(--text)",
  fontWeight: 600,
};

/** Normalize a VerifyResult into the shared result shape. */
function fromVerify(v: VerifyResult): DossierResultData {
  return {
    ensName: v.ensName,
    blobId: v.blobId,
    aggregatorUrl: v.aggregatorUrl,
    records: v.records,
    bundle: v.dossier,
    hashMatch: v.hashMatch,
  };
}

/** Normalize a live FullGenerateResult into the shared result shape. */
function fromGenerate(r: FullGenerateResult): DossierResultData {
  return {
    ensName: r.ensName,
    blobId: r.blobId,
    aggregatorUrl: r.aggregatorUrl,
    records: Object.fromEntries(r.txs.map((t) => [t.key, t.value])),
    bundle: r.bundle,
    hashMatch: true,
  };
}

function useExample(): DossierResultData | null {
  const [data, setData] = useState<DossierResultData | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetch("/demo/sample-bundle.json")
      .then((r) => r.json())
      .then((d: VerifyResult) => !cancelled && setData(fromVerify(d)))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);
  return data;
}

// ── Verify (default, keyless) ─────────────────────────────────────────────────

function VerifyPanel() {
  const example = useExample();
  const [data, setData] = useState<DossierResultData | null>(null);
  const [source, setSource] = useState<"example" | "live">("example");
  const [name, setName] = useState("heor-prov.eth");
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const shown = data ?? example;

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
      setData(fromVerify(j as VerifyResult));
      setSource("live");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setVerifying(false);
    }
  }

  return (
    <div style={{ display: "grid", gap: "1.1rem" }}>
      {error ? <ErrorNote message={error} /> : null}
      {shown ? (
        <DossierResult data={shown} source={source} />
      ) : (
        <Card>
          <span className="spin" /> Loading example…
        </Card>
      )}

      <details style={{ marginTop: "0.25rem" }}>
        <summary style={{ cursor: "pointer", color: "var(--muted)", fontSize: "0.86rem" }}>
          Verify a live ENS name instead ▾
        </summary>
        <div style={{ display: "flex", gap: "0.6rem", alignItems: "flex-end", flexWrap: "wrap", marginTop: "0.8rem" }}>
          <div style={{ flex: "1 1 240px" }}>
            <label htmlFor="ens">ENS name</label>
            <input id="ens" type="text" value={name} placeholder="heor-prov.eth" onChange={(e) => setName(e.target.value)} disabled={verifying} />
          </div>
          <button onClick={verifyLive} style={quietBtn} disabled={verifying}>
            {verifying ? "Verifying…" : "Verify on-chain"}
          </button>
        </div>
        <p style={{ color: "var(--faint)", fontSize: "0.8rem", margin: "0.6rem 0 0" }}>
          Reads run against a public Sepolia RPC and the Walrus aggregator — no keys needed.
        </p>
      </details>
    </div>
  );
}

// ── Generate (example preloaded; live run gated behind keys) ───────────────────

function GeneratePanel() {
  const example = useExample();
  const [live, setLive] = useState(false);

  if (live) return <GenerateLive onBack={() => setLive(false)} />;

  return (
    <div style={{ display: "grid", gap: "1.1rem" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "0.75rem",
          flexWrap: "wrap",
          padding: "0.85rem 1.1rem",
          background: "var(--panel-2)",
          border: "1px solid var(--border)",
          borderRadius: 9,
        }}
      >
        <span style={{ color: "var(--muted)", fontSize: "0.88rem" }}>
          A finished example, generated earlier — no keys or wait.
        </span>
        <button onClick={() => setLive(true)} style={quietBtn}>
          Run live (requires keys)
        </button>
      </div>

      {example ? (
        <DossierResult data={example} source="example" />
      ) : (
        <Card>
          <span className="spin" /> Loading example…
        </Card>
      )}
    </div>
  );
}

function GenerateLive({ onBack }: { onBack: () => void }) {
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

  return (
    <div style={{ display: "grid", gap: "1.1rem" }}>
      <button onClick={onBack} style={{ ...quietBtn, justifySelf: "start", color: "var(--muted)" }}>
        ← Back to example
      </button>
      {cfg === null ? (
        <Card>
          <span className="spin" /> Checking configuration…
        </Card>
      ) : !cfg.generateEnabled ? (
        <KeysNeeded missing={cfg.missing} />
      ) : (
        <GenerateForm />
      )}
    </div>
  );
}

const README_GENERATE_URL =
  "https://github.com/vedantMahangade/heor-provenance#generate-requires-keys";

function KeysNeeded({ missing }: { missing: string[] }) {
  return (
    <Card>
      <SectionTitle>Live generate needs keys</SectionTitle>
      <p style={{ margin: "0 0 0.7rem" }}>
        A live run goes PubMed → LLM → optional confidential inference → Walrus → ENS, so it needs
        server-side API keys and a funded Sepolia key. The Verify demo and the example above need none.
      </p>
      {missing.length > 0 ? (
        <p style={{ color: "var(--muted)", fontSize: "0.85rem", margin: "0 0 0.7rem" }}>
          Missing: <span className="mono">{missing.join(", ")}</span>
        </p>
      ) : null}
      <p style={{ margin: 0 }}>
        <a href={README_GENERATE_URL} target="_blank" rel="noreferrer">
          README → Generate (requires keys)
        </a>{" "}
        lists the env vars (see also <span className="mono">.env.example</span>).
      </p>
    </Card>
  );
}

const STEP_LABELS: Record<ProgressStep, string> = {
  draft: "Fetch PubMed evidence and draft grounded claims",
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
    <div style={{ display: "grid", gap: "1.1rem" }}>
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
            <p style={{ color: "var(--faint)", fontSize: "0.78rem", margin: "0.4rem 0 0" }}>
              The Confidential AI dev preview may log inputs — use SYNTHETIC data only, never real PHI.
            </p>
          </div>
          <div>
            <button type="submit" style={primaryBtn} disabled={running || !drug.trim() || !indication.trim()}>
              {running ? "Running…" : "Generate and anchor provenance"}
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

      {error ? <ErrorNote message={error} /> : null}

      {result ? <DossierResult data={fromGenerate(result)} source="live" /> : null}
    </div>
  );
}

function StepRow({ label, state }: { label: string; state: StepState }) {
  const icon =
    state === "done" ? "✓" : state === "active" ? <span className="spin" /> : state === "skipped" ? "–" : "○";
  const color = state === "done" ? "var(--good)" : state === "active" ? "var(--accent)" : "var(--faint)";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", color: state === "pending" || state === "skipped" ? "var(--muted)" : "var(--text)" }}>
      <span style={{ width: 16, textAlign: "center", color }}>{icon}</span>
      <span>{label}</span>
      {state === "skipped" ? <span style={{ color: "var(--faint)", fontSize: "0.78rem" }}>(no document)</span> : null}
    </div>
  );
}

function ErrorNote({ message }: { message: string }) {
  return (
    <div
      style={{
        padding: "0.9rem 1.1rem",
        borderRadius: 9,
        border: "1px solid var(--border)",
        borderLeft: "3px solid var(--danger)",
        background: "var(--danger-soft)",
      }}
    >
      <strong style={{ color: "var(--danger)" }}>Error</strong>
      <p style={{ margin: "0.35rem 0 0", whiteSpace: "pre-wrap", fontSize: "0.88rem" }}>{message}</p>
    </div>
  );
}

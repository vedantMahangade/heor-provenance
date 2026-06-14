"use client";

import { useEffect, useState } from "react";
import type { FullGenerateResult, ProgressStep } from "@/lib/fullGenerate";
import type { VerifyResult } from "@/lib/verify";
import { Card, DossierResult, SectionTitle, type DossierResultData } from "./components";

type Tab = "generate" | "verify";

export default function Home() {
  const [tab, setTab] = useState<Tab>("generate");
  return (
    <main style={{ maxWidth: 760, margin: "0 auto", padding: "3rem 1.25rem 5rem" }}>
      <Header />

      <nav style={{ display: "flex", gap: "1.5rem", marginBottom: "1.75rem", borderBottom: "1px solid var(--border)" }}>
        <TabButton active={tab === "generate"} onClick={() => setTab("generate")}>
          Generate
        </TabButton>
        <TabButton active={tab === "verify"} onClick={() => setTab("verify")}>
          Verify
        </TabButton>
      </nav>

      {tab === "generate" ? <GeneratePanel /> : <VerifyPanel />}
    </main>
  );
}

function Header() {
  return (
    <header style={{ marginBottom: "2rem" }}>
      {/* Lineage logo is the primary header element. */}
      <img src="/lineage-logo.svg" alt="Lineage" height={40} style={{ display: "block", height: 40, width: "auto" }} />
      <p style={{ margin: "0.45rem 0 0", color: "var(--muted)", fontSize: "0.95rem", fontWeight: 500 }}>
        HEOR Provenance Agent
      </p>
      <details style={{ marginTop: "0.6rem" }}>
        <summary style={{ cursor: "pointer", color: "var(--faint)", fontSize: "0.82rem" }}>
          What is this?
        </summary>
        <p style={{ color: "var(--faint)", fontSize: "0.85rem", margin: "0.5rem 0 0", maxWidth: 600, lineHeight: 1.55 }}>
          HEOR value-dossier claims drafted from real PubMed evidence — each one independently
          verifiable through Walrus and ENS. Augmentation with a human in the loop, not autonomous
          drafting.
        </p>
      </details>
    </header>
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
  padding: "0.5rem 1rem",
  borderRadius: 7,
  border: "1px solid var(--border)",
  background: "var(--panel)",
  color: "var(--text)",
  fontWeight: 600,
  fontSize: "0.86rem",
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

async function fetchExample(): Promise<DossierResultData> {
  const r = await fetch("/demo/sample-bundle.json");
  return fromVerify((await r.json()) as VerifyResult);
}

/** Load-an-example / Start-fresh toolbar shared by both tabs. */
function ExampleToolbar({ onLoad, onClear }: { onLoad: () => void; onClear: () => void }) {
  return (
    <div style={{ display: "flex", gap: "0.6rem", justifyContent: "flex-end", flexWrap: "wrap" }}>
      <button onClick={onLoad} style={quietBtn}>
        Load an example
      </button>
      <button onClick={onClear} style={{ ...quietBtn, color: "var(--muted)" }}>
        Start fresh
      </button>
    </div>
  );
}

// ── Generate (first tab) ───────────────────────────────────────────────────────

function GeneratePanel() {
  const [example, setExample] = useState<DossierResultData | null>(null);
  // Bumping the key remounts the form so "Start fresh" clears any live result.
  const [freshKey, setFreshKey] = useState(0);

  async function loadExample() {
    try {
      setExample(await fetchExample());
    } catch {
      /* ignore — example is best-effort */
    }
  }
  function startFresh() {
    setExample(null);
    setFreshKey((k) => k + 1);
  }
  return (
    <div style={{ display: "grid", gap: "1.1rem" }}>
      <ExampleToolbar onLoad={loadExample} onClear={startFresh} />
      {example ? (
        <DossierResult data={example} source="example" />
      ) : (
        <GenerateForm key={freshKey} />
      )}
    </div>
  );
}

const README_GENERATE_URL =
  "https://github.com/vedantMahangade/heor-provenance#generate-requires-keys";

const STEP_LABELS: Record<ProgressStep, string> = {
  pubmed: "Fetch PubMed evidence",
  chapter: "Draft cited chapter in enclave + verify every citation",
  walrus: "Store evidence bundle on Walrus",
  ens: "Pin provenance to ENS text records",
};
const STEP_ORDER: ProgressStep[] = ["pubmed", "chapter", "walrus", "ens"];
type StepState = "pending" | "active" | "done" | "skipped";

function GenerateForm() {
  const [cfg, setCfg] = useState<{ generateEnabled: boolean; missing: string[] } | null>(null);
  const [drug, setDrug] = useState("");
  const [indication, setIndication] = useState("");
  const [focus, setFocus] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [running, setRunning] = useState(false);
  const [steps, setSteps] = useState<Record<ProgressStep, StepState>>({
    pubmed: "pending",
    chapter: "pending",
    walrus: "pending",
    ens: "pending",
  });
  const [result, setResult] = useState<FullGenerateResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Read config once so we can hint (not block) when live keys are missing.
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

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!drug.trim() || !indication.trim() || !file || running) return;

    setRunning(true);
    setResult(null);
    setError(null);
    setSteps({ pubmed: "pending", chapter: "pending", walrus: "pending", ens: "pending" });

    const fd = new FormData();
    fd.set("drug", drug.trim());
    fd.set("indication", indication.trim());
    if (focus.trim()) fd.set("focus", focus.trim());
    fd.set("source", file);

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

  const keysMissing = cfg !== null && !cfg.generateEnabled;

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
            <label htmlFor="focus">Focus (optional)</label>
            <input id="focus" type="text" value={focus} placeholder="e.g. Clinical value chapter, payer-facing" onChange={(e) => setFocus(e.target.value)} disabled={running} />
            <p style={{ color: "var(--faint)", fontSize: "0.78rem", margin: "0.4rem 0 0" }}>
              Targets a specific GVD section — shapes the chapter the enclave drafts.
            </p>
          </div>
          <div>
            <label htmlFor="source">Source document — required (.docx, .pdf, .txt)</label>
            <input
              id="source"
              type="file"
              accept=".docx,.pdf,.txt,.md,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              disabled={running}
            />
            <p style={{ color: "var(--faint)", fontSize: "0.78rem", margin: "0.4rem 0 0" }}>
              The chapter is drafted from this document inside the enclave — it never touches a public LLM.{" "}
              
              <a href="/synthetic-embargoed-readout.txt" download>

                Download a sample
                
              </a>
              
            </p>
          </div>
          <div>
            <button type="submit" style={primaryBtn} disabled={running || !drug.trim() || !indication.trim() || !file}>
              {running ? "Running…" : "Generate cited chapter + anchor provenance"}
            </button>
            {running ? (
              <span style={{ color: "var(--muted)", fontSize: "0.82rem", marginLeft: "0.75rem" }}>
                This takes ~1–3 min (PubMed + dual-model enclave + verify + Walrus + ENS).
              </span>
            ) : null}
          </div>
          {keysMissing ? (
            <p style={{ color: "var(--faint)", fontSize: "0.8rem", margin: 0 }}>
              A live run needs server-side keys{cfg && cfg.missing.length ? <> (missing: <span className="mono">{cfg.missing.join(", ")}</span>)</> : null}. See{" "}
              <a href={README_GENERATE_URL} target="_blank" rel="noreferrer">README → Generate</a>, or use “Load an example” above.
            </p>
          ) : null}
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

// ── Verify (second tab) ────────────────────────────────────────────────────────

function VerifyPanel() {
  const [data, setData] = useState<DossierResultData | null>(null);
  const [source, setSource] = useState<"example" | "live">("example");
  const [name, setName] = useState("heor-prov.eth");
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadExample() {
    setError(null);
    try {
      setData(await fetchExample());
      setSource("example");
    } catch {
      /* ignore */
    }
  }

  function startFresh() {
    setData(null);
    setError(null);
    setName("heor-prov.eth");
  }

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
      <ExampleToolbar onLoad={loadExample} onClear={startFresh} />

      {data ? (
        <DossierResult data={data} source={source} />
      ) : (
        <Card>
          <SectionTitle>Verify a dossier</SectionTitle>
          <p style={{ color: "var(--muted)", fontSize: "0.88rem", margin: "0 0 1rem" }}>
            Resolve an ENS name, fetch its evidence from Walrus, and recompute the integrity hash.
            Reads run against a public Sepolia RPC — no keys needed.
          </p>
          <div style={{ display: "flex", gap: "0.6rem", alignItems: "flex-end", flexWrap: "wrap" }}>
            <div style={{ flex: "1 1 240px" }}>
              <label htmlFor="ens">ENS name</label>
              <input id="ens" type="text" value={name} placeholder="heor-prov.eth" onChange={(e) => setName(e.target.value)} disabled={verifying} />
            </div>
            <button onClick={verifyLive} style={primaryBtn} disabled={verifying}>
              {verifying ? "Verifying…" : "Verify on-chain"}
            </button>
          </div>
          <p style={{ color: "var(--faint)", fontSize: "0.8rem", margin: "0.8rem 0 0" }}>
            Or press “Load an example” to see a verified dossier instantly.
          </p>
        </Card>
      )}

      {error ? <ErrorNote message={error} /> : null}
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

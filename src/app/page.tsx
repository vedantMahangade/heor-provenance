export default function Home() {
  return (
    <main style={{ fontFamily: "system-ui, sans-serif", padding: "3rem", maxWidth: 640 }}>
      <h1>HEOR Provenance Agent</h1>
      <p>
        Drafts pharma HEOR value-dossier sections from real evidence, then makes
        every claim independently verifiable.
      </p>
      <p style={{ color: "#666" }}>
        Phase 1 (backend pipeline) is implemented. Run it with:
      </p>
      <pre style={{ background: "#f4f4f4", padding: "1rem", borderRadius: 8 }}>
        npm run generate -- --drug &quot;semaglutide&quot; --indication &quot;type 2
        diabetes&quot;
      </pre>
      <p style={{ color: "#999", fontSize: 14 }}>
        UI (Generate form + Verify view) and the Walrus/ENS provenance rails
        land in later phases.
      </p>
    </main>
  );
}

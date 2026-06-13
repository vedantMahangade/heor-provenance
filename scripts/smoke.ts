/**
 * Phase 1 smoke test: exercise the full pipeline end to end against the live
 * LLM for a fixed query, and report the counts that prove the draft + grounding
 * steps work. Does not change pipeline logic — just runs it.
 *
 *   npm run smoke
 *
 * Requires LLM_BASE_URL / LLM_API_KEY / LLM_MODEL in .env.
 */
import "dotenv/config";
import { generateEvidenceBundle } from "../src/lib/pipeline";

const DRUG = "semaglutide";
const INDICATION = "type 2 diabetes";
const MAX_SOURCES = 6;

async function main() {
  console.error(`Smoke test — full Phase 1 pipeline against the live LLM`);
  console.error(`  Drug:        ${DRUG}`);
  console.error(`  Indication:  ${INDICATION}`);
  console.error(`  Max sources: ${MAX_SOURCES}`);
  console.error(`  Running…\n`);

  const { bundle, query, stats } = await generateEvidenceBundle({
    drug: DRUG,
    indication: INDICATION,
    maxSources: MAX_SOURCES,
  });

  console.error(`PubMed query:      ${query}`);
  console.error(`Sources fetched:   ${stats.sourcesFetched}`);
  console.error(`Model:             ${bundle.model}\n`);

  console.error(`Claims drafted:    ${stats.claimsDrafted}`);
  console.error(`  accepted:        ${stats.claimsGrounded}`);
  console.error(`  flagged:         ${stats.claimsFlagged}`);
  console.error(`sha256:            ${bundle.sha256}`);

  if (stats.claimsDrafted === 0) {
    console.error(
      `\n⚠  No claims were drafted. Check the LLM endpoint/model — the draft step may not be returning grounded JSON.`,
    );
    process.exit(1);
  }

  console.error(`\n✓ Draft step works end to end.`);
}

main().catch((err) => {
  console.error("\nSmoke test failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});

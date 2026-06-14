/**
 * Re-export public/demo/sample-bundle.json from a FRESH end-to-end run so the
 * keyless demo matches the current bundle format (cited GVD chapter + verified
 * citations). Runs the real loop (enclave + Walrus + ENS), then independently
 * re-verifies the pinned blob and writes the VerifyResult the UI loads.
 *
 *   npx tsx scripts/export-sample.ts
 *
 * Requires CHAINLINK_CONF_AI_KEY, ENS_PRIVATE_KEY, ENS_NAME. The source doc is
 * the bundled SYNTHETIC embargoed readout — never real PHI.
 */
import "dotenv/config";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { runFullGenerate } from "../src/lib/fullGenerate";
import { CHAPTER_MODELS } from "../src/lib/chapter";
import { verifyByEnsName } from "../src/lib/verify";

const SOURCE = resolve(__dirname, "../public/synthetic-embargoed-readout.txt");
const OUT = resolve(__dirname, "../public/demo/sample-bundle.json");

async function main() {
  console.error("> Fresh sample run (semaglutide / type 2 diabetes / Clinical value)…");
  console.error("  ⚠ source doc goes to the confidential dev preview — synthetic only.\n");

  const result = await runFullGenerate({
    drug: "semaglutide",
    indication: "type 2 diabetes",
    focus: "Clinical value, payer-facing",
    source: {
      document: await readFile(SOURCE),
      filename: "synthetic-embargoed-readout.txt",
      contentType: "text/plain",
    },
    // Always race both models for the canonical sample, regardless of any
    // ENCLAVE_SINGLE_MODEL fast-path flag set for live runs.
    models: CHAPTER_MODELS,
    onProgress: (e) => console.error(`  [${e.step}] ${e.status}${e.detail ? ` — ${e.detail}` : ""}`),
  });

  console.error(`\n  model: ${result.stats.model}, verified ${result.stats.citationsVerified}/${result.stats.citations}`);
  console.error(`  ensName: ${result.ensName}`);
  console.error(`  blobId:  ${result.blobId}`);

  // Independently re-verify from chain + Walrus to produce the exact shape the
  // Verify view consumes (with retry on the aggregator's post-upload 404 window).
  console.error("\n> Re-verifying pinned blob from ENS + Walrus…");
  const verify = await verifyByEnsName(result.ensName);
  if (!verify.hashMatch) throw new Error("Re-verify hash mismatch — not writing sample.");

  await writeFile(OUT, JSON.stringify(verify, null, 2) + "\n", "utf8");
  console.error(`\n✓ Wrote ${OUT}`);
  console.error(`  citations: ${verify.dossier.claims.length}, sources: ${verify.dossier.sources.length}`);
}

main().catch((err) => {
  console.error("\nError:", err instanceof Error ? err.message : err);
  process.exit(1);
});

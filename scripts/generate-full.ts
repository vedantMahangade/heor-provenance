/**
 * Full cited-GVD-chapter loop: parse source doc -> PubMed -> confidential-enclave
 * cited chapter (two models, keep the more accurate) -> independent citation
 * verification -> content-addressed bundle -> Walrus -> ENS provenance records.
 *
 *   npm run generate-full -- --drug "semaglutide" --indication "type 2 diabetes" --source note.txt
 *   npm run generate-full -- --drug "..." --indication "..." --source readout.docx --focus "Clinical value, payer-facing"
 *
 * Thin CLI wrapper around runFullGenerate() (src/lib/fullGenerate.ts) — the same
 * function the /api/generate route calls.
 *
 * ⚠ The source document goes to the confidential dev preview, which MAY LOG
 * INPUTS — use only SYNTHETIC data, never real PHI/PII.
 *
 * Requires CHAINLINK_CONF_AI_KEY, ENS_PRIVATE_KEY, ENS_NAME (+ optional Walrus vars).
 */
import "dotenv/config";
import { readFile } from "node:fs/promises";
import { basename, extname, resolve } from "node:path";
import { runFullGenerate } from "../src/lib/fullGenerate";

const CONTENT_TYPES: Record<string, string> = {
  ".txt": "text/plain",
  ".md": "text/markdown",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".pdf": "application/pdf",
};

interface Args {
  drug?: string;
  indication?: string;
  focus?: string;
  query?: string;
  max?: number;
  source?: string;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {};
  for (let i = 0; i < argv.length; i++) {
    const v = argv[i + 1];
    switch (argv[i]) {
      case "--drug": args.drug = v; i++; break;
      case "--indication": args.indication = v; i++; break;
      case "--focus": args.focus = v; i++; break;
      case "--query": args.query = v; i++; break;
      case "--max": args.max = Number(v); i++; break;
      case "--source":
      case "--sensitive": args.source = v; i++; break;
    }
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.drug || !args.indication || !args.source) {
    console.error(
      'Usage: npm run generate-full -- --drug "<drug>" --indication "<indication>" ' +
        '--source <file.docx|.pdf|.txt> [--focus "..."] [--max N] [--query "..."]',
    );
    process.exit(1);
  }

  const inPath = resolve(args.source);
  const filename = basename(inPath);
  const contentType = CONTENT_TYPES[extname(filename).toLowerCase()] ?? "application/octet-stream";

  console.error(`> Source doc:  ${filename}`);
  console.error(`  ⚠ goes to the confidential dev preview (MAY LOG INPUTS) — synthetic data only.`);
  console.error(`> Drug:        ${args.drug}`);
  console.error(`> Indication:  ${args.indication}`);
  if (args.focus) console.error(`> Focus:       ${args.focus}\n`);
  else console.error("");

  const result = await runFullGenerate({
    drug: args.drug,
    indication: args.indication,
    focus: args.focus,
    query: args.query,
    maxSources: args.max,
    source: { document: await readFile(inPath), filename, contentType },
    onProgress: (e) =>
      console.error(`  [${e.step}] ${e.status}${e.detail ? ` — ${e.detail}` : ""}`),
  });

  console.error(`\n✓ End-to-end loop complete.`);
  console.error(`  model:    ${result.stats.model}`);
  console.error(`  verified: ${result.stats.citationsVerified}/${result.stats.citations} citations`);
  console.error(`  sha256:   ${result.bundle.sha256}`);
  console.error(`  blobId:   ${result.blobId}`);
  console.error(`  ENS name: ${result.ensName}`);
  console.error(`\nVerify with: npm run verify -- --name ${result.ensName}`);

  console.log(
    JSON.stringify(
      { ensName: result.ensName, blobId: result.blobId, sha256: result.bundle.sha256 },
      null,
      2,
    ),
  );
}

main().catch((err) => {
  console.error("\nError:", err instanceof Error ? err.message : err);
  process.exit(1);
});

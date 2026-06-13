/**
 * Full end-to-end loop: PubMed-grounded draft -> (optional confidential
 * attestation) -> content-addressed bundle -> Walrus -> ENS provenance records.
 *
 *   npm run generate-full -- --drug "semaglutide" --indication "type 2 diabetes"
 *   npm run generate-full -- --drug "..." --indication "..." --sensitive note.txt
 *   npm run generate-full -- --drug "..." --indication "..." --max 10 --model gemma4
 *
 * Thin CLI wrapper around runFullGenerate() (src/lib/fullGenerate.ts) — the same
 * function the /api/generate route calls.
 *
 * ⚠ --sensitive inputs go to the dev preview, which MAY LOG INPUTS — use only
 * SYNTHETIC data, never real PHI/PII.
 *
 * Requires the LLM, Walrus, ENS, and (for --sensitive) Confidential AI env vars.
 */
import "dotenv/config";
import { readFile } from "node:fs/promises";
import { basename, extname, resolve } from "node:path";
import { runFullGenerate, type SensitiveInput } from "../src/lib/fullGenerate";

// Extension -> MIME for the confidential doc (preview accepts text + image).
const CONTENT_TYPES: Record<string, string> = {
  ".txt": "text/plain",
  ".md": "text/markdown",
  ".json": "application/json",
  ".csv": "text/csv",
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
};

interface Args {
  drug?: string;
  indication?: string;
  query?: string;
  max?: number;
  sensitive?: string;
  prompt?: string;
  model?: string;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {};
  for (let i = 0; i < argv.length; i++) {
    const v = argv[i + 1];
    switch (argv[i]) {
      case "--drug": args.drug = v; i++; break;
      case "--indication": args.indication = v; i++; break;
      case "--query": args.query = v; i++; break;
      case "--max": args.max = Number(v); i++; break;
      case "--sensitive": args.sensitive = v; i++; break;
      case "--prompt": args.prompt = v; i++; break;
      case "--model": args.model = v; i++; break;
    }
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.drug || !args.indication) {
    console.error(
      'Usage: npm run generate-full -- --drug "<drug>" --indication "<indication>" ' +
        '[--max N] [--query "..."] [--sensitive <file>] [--prompt "..."] [--model <id>]',
    );
    process.exit(1);
  }

  let sensitive: SensitiveInput | undefined;
  if (args.sensitive) {
    const inPath = resolve(args.sensitive);
    const filename = basename(inPath);
    sensitive = {
      document: await readFile(inPath),
      filename,
      contentType: CONTENT_TYPES[extname(filename).toLowerCase()] ?? "application/octet-stream",
      prompt: args.prompt,
      model: args.model,
    };
    console.error(`> --sensitive: ${filename}`);
    console.error(`  ⚠ dev preview MAY LOG INPUTS — synthetic data only, never real PHI.`);
  }

  console.error(`> Drug:        ${args.drug}`);
  console.error(`> Indication:  ${args.indication}\n`);

  const result = await runFullGenerate({
    drug: args.drug,
    indication: args.indication,
    query: args.query,
    maxSources: args.max,
    sensitive,
    onProgress: (e) =>
      console.error(`  [${e.step}] ${e.status}${e.detail ? ` — ${e.detail}` : ""}`),
  });

  console.error(`\n✓ End-to-end loop complete.`);
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

/**
 * Run a confidential-enclave analysis over a SYNTHETIC sensitive document via
 * the Chainlink Confidential AI Attester, and print the output + attestation
 * digests (the field that slots into the evidence bundle).
 *
 *   npm run confidential -- --prompt "Summarize the diabetes management plan."
 *   npm run confidential -- --in path/to/synthetic.txt --prompt "..." --model qwen3.6
 *
 * --in defaults to a bundled synthetic clinical note. NEVER point this at real
 * PHI/PII: the dev preview MAY LOG INPUTS. Use only fabricated data.
 *
 * Requires CHAINLINK_CONF_AI_KEY in .env (CHAINLINK_CONF_AI_URL optional).
 */
import "dotenv/config";
import { readFile } from "node:fs/promises";
import { basename, extname, resolve } from "node:path";
import {
  analyzeConfidential,
  buildConfidentialAttestation,
} from "../src/lib/confidential";

const DEFAULT_DOC = resolve(
  __dirname,
  "fixtures/synthetic-patient-note.txt",
);

// Minimal extension -> MIME map for the formats the preview accepts (text + image).
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
  in?: string;
  prompt?: string;
  model?: string;
  contentType?: string;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {};
  for (let i = 0; i < argv.length; i++) {
    const v = argv[i + 1];
    switch (argv[i]) {
      case "--in":
        args.in = v;
        i++;
        break;
      case "--prompt":
        args.prompt = v;
        i++;
        break;
      case "--model":
        args.model = v;
        i++;
        break;
      case "--content-type":
        args.contentType = v;
        i++;
        break;
    }
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const inPath = args.in ? resolve(args.in) : DEFAULT_DOC;
  const prompt =
    args.prompt ??
    "Summarize this clinical note: indication, current medications, and the management plan.";

  const filename = basename(inPath);
  const contentType =
    args.contentType ?? CONTENT_TYPES[extname(filename).toLowerCase()] ?? "application/octet-stream";

  if (!args.in) {
    console.error(`> No --in given; using bundled SYNTHETIC document: ${filename}`);
  }
  console.error(
    "  ⚠ Confidential AI dev preview MAY LOG INPUTS — synthetic data only, never real PHI.\n",
  );

  const document = await readFile(inPath);

  console.error(`> Confidential inference`);
  console.error(`  document:    ${filename} (${contentType}, ${document.length} bytes)`);
  console.error(`  prompt:      ${prompt}`);
  console.error(`  submitting + polling (cap ~120s)…\n`);

  const result = await analyzeConfidential({
    document,
    filename,
    contentType,
    prompt,
    model: args.model,
  });

  console.error(`✓ completed (model: ${result.model})`);
  console.error(`  contentDigest:  ${result.contentDigest}`);
  console.error(`  requestDigest:  ${result.requestDigest}`);
  console.error(`  responseDigest: ${result.responseDigest}`);
  console.error(`\n── output ──────────────────────────────────────────────────`);
  console.error(result.output);
  console.error(`────────────────────────────────────────────────────────────\n`);

  // The bundle field, ready to attach to an EvidenceBundle. Printed to stdout so
  // it can be captured/piped (e.g. jq) without the human-facing logs above.
  const attestation = buildConfidentialAttestation(result);
  console.log(JSON.stringify(attestation, null, 2));
}

main().catch((err) => {
  console.error("\nError:", err instanceof Error ? err.message : err);
  process.exit(1);
});

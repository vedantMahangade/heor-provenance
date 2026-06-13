/**
 * Phase 1 CLI: run the full backend pipeline and print/save the JSON evidence
 * bundle. No chain, no UI — just PubMed -> grounded draft -> bundle.
 *
 * Usage:
 *   npm run generate -- --drug "semaglutide" --indication "type 2 diabetes"
 *   npm run generate -- --drug "..." --indication "..." --max 10 --out bundle.json
 */
import "dotenv/config";
import { writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { generateEvidenceBundle } from "../src/lib/pipeline";

interface Args {
  drug?: string;
  indication?: string;
  query?: string;
  max?: number;
  out?: string;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {};
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const value = argv[i + 1];
    switch (flag) {
      case "--drug":
        args.drug = value;
        i++;
        break;
      case "--indication":
        args.indication = value;
        i++;
        break;
      case "--query":
        args.query = value;
        i++;
        break;
      case "--max":
        args.max = Number(value);
        i++;
        break;
      case "--out":
        args.out = value;
        i++;
        break;
    }
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!args.drug || !args.indication) {
    console.error(
      'Usage: npm run generate -- --drug "<drug>" --indication "<indication>" [--max N] [--query "..."] [--out path.json]',
    );
    process.exit(1);
  }

  console.error(`> Drug:        ${args.drug}`);
  console.error(`> Indication:  ${args.indication}`);
  console.error(`> Fetching PubMed evidence and drafting grounded claims…\n`);

  const { bundle, query, stats } = await generateEvidenceBundle({
    drug: args.drug,
    indication: args.indication,
    query: args.query,
    maxSources: args.max,
  });

  console.error(`  PubMed query:     ${query}`);
  console.error(`  Sources fetched:  ${stats.sourcesFetched}`);
  console.error(`  Claims drafted:   ${stats.claimsDrafted}`);
  console.error(`  Grounded:         ${stats.claimsGrounded}`);
  console.error(`  Flagged/dropped:  ${stats.claimsFlagged}`);
  console.error(`  Model:            ${bundle.model}`);
  console.error(`  sha256:           ${bundle.sha256}\n`);

  const json = JSON.stringify(bundle, null, 2);

  if (args.out) {
    await mkdir(dirname(args.out), { recursive: true });
    await writeFile(args.out, json, "utf8");
    console.error(`  Wrote bundle -> ${args.out}`);
  } else {
    // Bundle to stdout so it can be piped; logs go to stderr above.
    console.log(json);
  }
}

main().catch((err) => {
  console.error("\nError:", err instanceof Error ? err.message : err);
  process.exit(1);
});

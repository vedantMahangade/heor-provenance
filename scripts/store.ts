/**
 * Phase 2 (storage only): upload a JSON evidence bundle to Walrus testnet and
 * print the blobId. No ENS yet.
 *
 *   npm run store -- --in bundle.json
 *
 * Uses WALRUS_PUBLISHER / WALRUS_AGGREGATOR from env (testnet defaults apply).
 */
import "dotenv/config";
import { readFile } from "node:fs/promises";
import { storeBlob } from "../src/lib/walrus";

interface Args {
  in?: string;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--in") {
      args.in = argv[i + 1];
      i++;
    }
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.in) {
    console.error("Usage: npm run store -- --in <bundle.json>");
    process.exit(1);
  }

  const json = await readFile(args.in, "utf8");
  // Validate it parses before spending an upload.
  JSON.parse(json);

  console.error(`> Storing ${args.in} on Walrus testnet…`);
  const blobId = await storeBlob(json);

  console.error(`  blobId: ${blobId}`);
  // blobId to stdout so it can be piped/captured.
  console.log(blobId);
}

main().catch((err) => {
  console.error("\nError:", err instanceof Error ? err.message : err);
  process.exit(1);
});

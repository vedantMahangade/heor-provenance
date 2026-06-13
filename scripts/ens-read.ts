/**
 * Read provenance records back from ENS text records on Sepolia.
 *
 *   npm run ens-read              # uses ENS_NAME from .env
 *   npm run ens-read -- --name foo.eth
 *
 * Requires SEPOLIA_RPC_URL (and ENS_NAME unless --name is given) in .env.
 */
import "dotenv/config";
import { readProvenance, PROVENANCE_KEYS } from "../src/lib/ens";

interface Args {
  name?: string;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--name") {
      args.name = argv[i + 1];
      i++;
    }
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const result = await readProvenance(args.name);

  console.error(`ENS name: ${result.name}`);
  console.error(`node:     ${result.node}`);
  console.error(`resolver: ${result.resolver}\n`);

  for (const key of PROVENANCE_KEYS) {
    const value = result.records[key];
    console.error(`  ${key.padEnd(24)} = ${value || "(empty)"}`);
  }

  // Machine-readable records to stdout for piping.
  console.log(JSON.stringify(result.records, null, 2));
}

main().catch((err) => {
  console.error("\nError:", err instanceof Error ? err.message : err);
  process.exit(1);
});

/**
 * Write provenance records into ENS text records on Sepolia.
 *
 *   npm run ens-write -- --blob <blobId>
 *   npm run ens-write -- --blob <blobId> --capabilities "..." --version "..."
 *
 * Defaults: version = AGENT_VERSION, capabilities = the agent's standard set.
 * Requires ENS_NAME, ENS_PRIVATE_KEY, SEPOLIA_RPC_URL in .env.
 */
import "dotenv/config";
import { writeProvenance } from "../src/lib/ens";
import { AGENT_VERSION } from "../src/lib/version";

const DEFAULT_CAPABILITIES =
  "pubmed-grounded-drafting,claim-level-verification,walrus-storage,sha256-provenance";

interface Args {
  blob?: string;
  version?: string;
  capabilities?: string;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {};
  for (let i = 0; i < argv.length; i++) {
    const v = argv[i + 1];
    switch (argv[i]) {
      case "--blob":
        args.blob = v;
        i++;
        break;
      case "--version":
        args.version = v;
        i++;
        break;
      case "--capabilities":
        args.capabilities = v;
        i++;
        break;
    }
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.blob) {
    console.error("Usage: npm run ens-write -- --blob <blobId> [--version <v>] [--capabilities <c>]");
    process.exit(1);
  }

  const version = args.version ?? AGENT_VERSION;
  const capabilities = args.capabilities ?? DEFAULT_CAPABILITIES;

  console.error(`> Writing provenance records to ENS on Sepolia…`);
  console.error(`  heor.dossier.latest      = ${args.blob}`);
  console.error(`  heor.agent.version       = ${version}`);
  console.error(`  heor.agent.capabilities  = ${capabilities}\n`);

  const result = await writeProvenance(args.blob, version, capabilities);

  console.error(`  ENS name: ${result.name}`);
  console.error(`  resolver: ${result.resolver}`);
  for (const tx of result.txs) {
    console.error(`  ✓ ${tx.key} -> tx ${tx.hash}`);
  }
  console.error(`\nDone. Verify with: npm run ens-read`);
}

main().catch((err) => {
  console.error("\nError:", err instanceof Error ? err.message : err);
  process.exit(1);
});

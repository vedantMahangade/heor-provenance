/**
 * Verify a dossier's provenance from nothing but its ENS name: resolve the
 * pinned blobId, fetch the bundle from Walrus, and recompute its sha256.
 *
 *   npm run verify -- --name heor-prov.eth
 *
 * Falls back to ENS_NAME in .env if --name is omitted. Requires SEPOLIA_RPC_URL
 * (and Walrus aggregator defaults apply).
 */
import "dotenv/config";
import { verifyByEnsName } from "../src/lib/verify";

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

  console.error(`> Verifying provenance via ENS${args.name ? ` for ${args.name}` : ""}…`);
  const result = await verifyByEnsName(args.name);

  console.error(`  ENS name:      ${result.ensName}`);
  console.error(`  blobId:        ${result.blobId}`);
  console.error(`  aggregator:    ${result.aggregatorUrl}`);
  console.error(`  stored sha256: ${result.dossier.sha256}`);
  console.error(`  hash match:    ${result.hashMatch ? "✓ yes" : "✗ NO"}`);

  const { query, claims, sources, confidentialAttestation } = result.dossier;
  console.error(`\n  Dossier: ${query.drug} / ${query.indication}`);
  console.error(`  ${claims.length} claim(s), ${sources.length} source(s)`);
  if (confidentialAttestation) {
    console.error(
      `  Confidential attestation: ${confidentialAttestation.provider} ` +
        `(${confidentialAttestation.enclave}, model ${confidentialAttestation.model})`,
    );
  }

  console.error(
    `\n${result.verified ? "✓ PROVENANCE VERIFIED" : "✗ VERIFICATION FAILED — hash mismatch"}`,
  );

  // Machine-readable result to stdout (omit the full dossier for brevity).
  console.log(
    JSON.stringify(
      {
        verified: result.verified,
        hashMatch: result.hashMatch,
        ensName: result.ensName,
        blobId: result.blobId,
        aggregatorUrl: result.aggregatorUrl,
        confidentialAttestation: result.confidentialAttestation ?? null,
      },
      null,
      2,
    ),
  );

  if (!result.verified) process.exit(1);
}

main().catch((err) => {
  console.error("\nError:", err instanceof Error ? err.message : err);
  process.exit(1);
});

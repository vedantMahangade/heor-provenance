/**
 * Inspect the TestnetV1PremigrationRegistrar's registry/resolver wiring and check
 * who owns the .eth node in the canonical ENS registry, so we know whether a name
 * minted via this registrar will resolve through viem getEnsText (the demo path).
 *
 *   npx tsx scripts/ens-check-wiring.ts
 */
import "dotenv/config";
import { createPublicClient, http, namehash, type Address } from "viem";
import { sepolia } from "viem/chains";

const rpcUrl = process.env.SEPOLIA_RPC_URL!;
const REGISTRAR: Address = "0xdf60C561Ca35AD3C89D24BbA854654b1c3477078";
const CANONICAL_REGISTRY: Address = "0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e";

const addrGetter = (name: string) =>
  ({ type: "function", name, stateMutability: "view", inputs: [], outputs: [{ type: "address" }] }) as const;
const bytes32Getter = (name: string) =>
  ({ type: "function", name, stateMutability: "view", inputs: [], outputs: [{ type: "bytes32" }] }) as const;

const registryAbi = [
  { type: "function", name: "owner", stateMutability: "view", inputs: [{ name: "node", type: "bytes32" }], outputs: [{ type: "address" }] },
  { type: "function", name: "resolver", stateMutability: "view", inputs: [{ name: "node", type: "bytes32" }], outputs: [{ type: "address" }] },
] as const;

async function main() {
  const client = createPublicClient({ chain: sepolia, transport: http(rpcUrl) });

  const consts = ["BASE", "ENS_REGISTRY", "REVERSE_REGISTRAR", "ETH_REGISTRY", "PREMIGRATION_REGISTRY", "PREMIGRATION_RESOLVER"];
  console.log("TestnetV1PremigrationRegistrar constants:");
  for (const c of consts) {
    try {
      const v = await client.readContract({ address: REGISTRAR, abi: [addrGetter(c)], functionName: c });
      console.log(`  ${c.padEnd(22)} ${v}`);
    } catch {
      console.log(`  ${c.padEnd(22)} (read failed)`);
    }
  }
  try {
    const node = await client.readContract({ address: REGISTRAR, abi: [bytes32Getter("ETH_NODE")], functionName: "ETH_NODE" });
    console.log(`  ${"ETH_NODE".padEnd(22)} ${node}`);
  } catch {}

  const ethNode = namehash("eth");
  console.log(`\nCanonical registry ${CANONICAL_REGISTRY}:`);
  const ethOwner = await client.readContract({ address: CANONICAL_REGISTRY, abi: registryAbi, functionName: "owner", args: [ethNode] });
  console.log(`  owner(namehash("eth")) = ${ethOwner}`);
  console.log(`  (this should be the BaseRegistrar 0x57f1...ea85 if classic resolution still holds)`);

  // Does an already-registered demo name resolve? Try a known recently-registered name if provided.
  const probe = process.env.PROBE_NAME;
  if (probe) {
    const n = namehash(probe);
    const resolver = await client.readContract({ address: CANONICAL_REGISTRY, abi: registryAbi, functionName: "resolver", args: [n] });
    console.log(`\nresolver(namehash("${probe}")) in canonical registry = ${resolver}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

/**
 * Find the currently-authorized ETHRegistrarController(s) on Sepolia by replaying
 * the BaseRegistrar's ControllerAdded / ControllerRemoved event history, then
 * filtering to those whose controllers[] flag is still true.
 *
 *   npx tsx scripts/ens-find-controller.ts
 */
import "dotenv/config";
import { createPublicClient, http, parseAbiItem, type Address } from "viem";
import { sepolia } from "viem/chains";

// Public RPC that permits wide eth_getLogs ranges (Alchemy free tier caps at 10
// blocks). Override with LOGS_RPC_URL if this one is down.
const rpcUrl = process.env.LOGS_RPC_URL || "https://ethereum-sepolia-rpc.publicnode.com";
const BASE_REGISTRAR: Address = "0x57f1887a8bf19b14fc0df6fd9b2acc9af147ea85";

const added = parseAbiItem("event ControllerAdded(address indexed controller)");
const removed = parseAbiItem("event ControllerRemoved(address indexed controller)");
const controllersAbi = [
  {
    type: "function",
    name: "controllers",
    stateMutability: "view",
    inputs: [{ name: "", type: "address" }],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;

async function main() {
  const client = createPublicClient({ chain: sepolia, transport: http(rpcUrl) });

  const tip = await client.getBlockNumber();
  const CHUNK = 50000n;
  const SPAN = 250000n; // ~35 days back, covers the May-2026 redeploy
  const start = tip > SPAN ? tip - SPAN : 0n;
  const addLogs: Awaited<ReturnType<typeof client.getLogs>> = [];
  const remLogs: Awaited<ReturnType<typeof client.getLogs>> = [];
  for (let from = start; from <= tip; from += CHUNK) {
    const to = from + CHUNK - 1n > tip ? tip : from + CHUNK - 1n;
    const [a, r] = await Promise.all([
      client.getLogs({ address: BASE_REGISTRAR, event: added, fromBlock: from, toBlock: to }),
      client.getLogs({ address: BASE_REGISTRAR, event: removed, fromBlock: from, toBlock: to }),
    ]);
    addLogs.push(...a);
    remLogs.push(...r);
  }
  console.log(`Scanned blocks ${start}..${tip} for Controller events.\n`);

  const seen = new Map<string, bigint>(); // controller -> last event block
  for (const l of addLogs) seen.set(l.args.controller as string, l.blockNumber!);
  for (const l of remLogs) {
    const b = l.blockNumber!;
    const prev = seen.get(l.args.controller as string);
    if (prev === undefined || b >= prev) seen.set(l.args.controller as string, b);
  }

  console.log(`Controllers ever touched on BaseRegistrar (${seen.size}):\n`);
  for (const ctrl of seen.keys()) {
    const active = await client.readContract({
      address: BASE_REGISTRAR,
      abi: controllersAbi,
      functionName: "controllers",
      args: [ctrl as Address],
    });
    console.log(`  ${active ? "✓ ACTIVE  " : "  removed "} ${ctrl}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

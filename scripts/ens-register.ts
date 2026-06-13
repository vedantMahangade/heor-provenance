/**
 * Register a fresh .eth name on Sepolia via the ENS v2 TestnetV1PremigrationRegistrar.
 * Signs with ENS_PRIVATE_KEY (the throwaway key that holds Sepolia test ETH).
 *
 *   npm run ens-register              # registers ENS_REGISTER_LABEL.eth for 1 year
 *   npm run ens-register -- --dry-run # simulate only, send no transaction
 *
 * ── Why this is not the classic commit→register flow ────────────────────────
 * Under ENS's v2 migration on Sepolia (latest contract redeploy ~May 2026) the
 * old ETHRegistrarController (0xfb3cE5D0…F1f968, and earlier ones) were
 * DE-AUTHORIZED on the BaseRegistrar: commit() still succeeds (it only stores a
 * hash) but register() reverts because the controller can no longer mint on the
 * BaseRegistrar. The docs/ens-contracts repo still list that dead address.
 *
 * The contract that IS authorized to mint fresh .eth names is the
 * `TestnetV1PremigrationRegistrar` (0xdf60C561…477078). It takes the SAME
 * Registration struct as the old struct controller but with NO commit step,
 * NO availability/rentPrice getters, and (currently) NO fee — a single payable
 * register() call. We verified its wiring: ENS_REGISTRY is the canonical
 * 0x0000…2e1e and owner(namehash("eth")) is still the BaseRegistrar, so a name
 * minted here resolves through standard viem getEnsText — the demo read path is
 * unchanged. Availability is still checked on the BaseRegistrar's
 * available(uint256 labelhash). To rediscover the active registrar if it moves
 * again, run scripts/ens-find-controller.ts (replays ControllerAdded events).
 *
 * The resolver is set to the Sepolia PublicResolver during registration, so after
 * this you can go straight to `npm run ens-write` (no ens-set-resolver needed).
 *
 * Requires ENS_REGISTER_LABEL, ENS_PRIVATE_KEY, SEPOLIA_RPC_URL in .env.
 */
import "dotenv/config";
import { randomBytes } from "node:crypto";
import {
  BaseError,
  ContractFunctionRevertedError,
  createPublicClient,
  createWalletClient,
  http,
  keccak256,
  stringToHex,
  toHex,
  zeroHash,
  type Address,
  type Hex,
  type PublicClient,
  type WalletClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";

// Active ENS v2 registrar on Sepolia (TestnetV1PremigrationRegistrar). Override
// via ENS_CONTROLLER_ADDRESS if a future redeploy moves it (find the new one with
// scripts/ens-find-controller.ts).
const DEFAULT_REGISTRAR: Address = "0xdf60C561Ca35AD3C89D24BbA854654b1c3477078";
const DEFAULT_PUBLIC_RESOLVER: Address = "0xE99638b40E4Fff0129D56f03b55b6bbC4BBE49b5";
const BASE_REGISTRAR: Address = "0x57f1887a8BF19b14fC0dF6Fd9B2acc9Af147eA85";

const SECONDS_PER_YEAR = 365n * 24n * 60n * 60n; // 31536000

// ── ABIs ──────────────────────────────────────────────────────────────────
// Custom errors known to surface from the registrar / BaseRegistrar. Including
// them lets viem decode an otherwise reason-less revert into a NAMED error.
const REGISTRAR_ERRORS = [
  { type: "error", name: "NameNotAvailable", inputs: [{ name: "name", type: "string" }] },
  { type: "error", name: "DurationTooShort", inputs: [{ name: "duration", type: "uint256" }] },
  { type: "error", name: "InsufficientValue", inputs: [] },
  { type: "error", name: "ResolverRequiredWhenDataSupplied", inputs: [] },
  { type: "error", name: "ResolverRequiredForReverseRecord", inputs: [] },
  { type: "error", name: "Unauthorised", inputs: [{ name: "node", type: "bytes32" }] },
] as const;

const REGISTRAR_ABI = [
  ...REGISTRAR_ERRORS,
  {
    type: "function",
    name: "register",
    stateMutability: "payable",
    inputs: [
      {
        name: "registration",
        type: "tuple",
        components: [
          { name: "label", type: "string" },
          { name: "owner", type: "address" },
          { name: "duration", type: "uint256" },
          { name: "secret", type: "bytes32" },
          { name: "resolver", type: "address" },
          { name: "data", type: "bytes[]" },
          { name: "reverseRecord", type: "uint8" },
          { name: "referrer", type: "bytes32" },
        ],
      },
    ],
    outputs: [],
  },
] as const;

const BASE_REGISTRAR_ABI = [
  {
    type: "function",
    name: "available",
    stateMutability: "view",
    inputs: [{ name: "id", type: "uint256" }],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;

// ── Helpers ─────────────────────────────────────────────────────────────────

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`Error: ${name} is not set in .env`);
    process.exit(1);
  }
  return v;
}

function revertReason(err: unknown): string {
  if (err instanceof BaseError) {
    const revert = err.walk((e) => e instanceof ContractFunctionRevertedError);
    if (revert instanceof ContractFunctionRevertedError) {
      const name = revert.data?.errorName;
      if (name) {
        const args = revert.data?.args;
        return args && args.length
          ? `${name}(${args.map((a) => String(a)).join(", ")})`
          : `${name}()`;
      }
      if (revert.signature) return `undecoded custom error ${revert.signature}`;
      return revert.shortMessage;
    }
    return err.shortMessage;
  }
  const anyErr = err as { shortMessage?: string; message?: string };
  if (anyErr?.shortMessage) return anyErr.shortMessage;
  if (anyErr?.message) return anyErr.message.split("\n")[0];
  return String(err);
}

async function main() {
  const dryRun =
    process.argv.slice(2).includes("--dry-run") ||
    process.env.ENS_REGISTER_DRY_RUN === "1";

  const label = requireEnv("ENS_REGISTER_LABEL").replace(/\.eth$/i, "");
  const rpcUrl = requireEnv("SEPOLIA_RPC_URL");
  const rawKey = requireEnv("ENS_PRIVATE_KEY");

  const registrar =
    (process.env.ENS_CONTROLLER_ADDRESS as Address) ?? DEFAULT_REGISTRAR;
  const resolver =
    (process.env.ENS_PUBLIC_RESOLVER_ADDRESS as Address) ?? DEFAULT_PUBLIC_RESOLVER;
  const years = BigInt(process.env.ENS_REGISTER_DURATION_YEARS || "1");
  const duration = years * SECONDS_PER_YEAR;

  const pk = (rawKey.startsWith("0x") ? rawKey : `0x${rawKey}`) as Hex;
  let account;
  try {
    account = privateKeyToAccount(pk);
  } catch {
    console.error("Error: ENS_PRIVATE_KEY is not a valid 32-byte hex private key.");
    process.exit(1);
  }

  const name = `${label}.eth`;
  const secret = toHex(randomBytes(32));

  const publicClient: PublicClient = createPublicClient({
    chain: sepolia,
    transport: http(rpcUrl),
  });
  const walletClient: WalletClient = createWalletClient({
    account,
    chain: sepolia,
    transport: http(rpcUrl),
  });

  console.error(`> Registering "${name}" via ENS v2 registrar on Sepolia (single tx, no commit)`);
  console.error(`  registrar: ${registrar}`);
  console.error(`  resolver:  ${resolver}`);
  console.error(`  owner:     ${account.address}`);
  console.error(`  duration:  ${years} year(s) (${duration}s)\n`);

  // 1. Availability — checked on the BaseRegistrar via available(uint256 labelhash).
  const labelId = BigInt(keccak256(stringToHex(label)));
  let available: boolean;
  try {
    available = (await publicClient.readContract({
      address: BASE_REGISTRAR,
      abi: BASE_REGISTRAR_ABI,
      functionName: "available",
      args: [labelId],
    })) as boolean;
  } catch (err) {
    console.error(`Error: could not check availability on the BaseRegistrar.\nUnderlying: ${revertReason(err)}`);
    process.exit(1);
  }
  if (!available) {
    console.error(`Revert reason: "${name}" is not available (already registered). Pick a fresh ENS_REGISTER_LABEL.`);
    process.exit(1);
  }
  console.error(`  ✓ "${name}" is available`);

  // 2. Build the Registration struct (no commit step under the v2 registrar).
  const registration = {
    label,
    owner: account.address,
    duration,
    secret,
    resolver,
    data: [] as Hex[],
    reverseRecord: 0,
    referrer: zeroHash,
  };

  // The registrar has no rentPrice getter and currently charges no fee; send 0.
  // Override via ENS_REGISTER_VALUE_WEI if a future deploy reintroduces a fee.
  const value = BigInt(process.env.ENS_REGISTER_VALUE_WEI || "0");

  // 3. Simulate first so any revert surfaces a NAMED reason before we spend gas.
  console.error(`\n> Simulating register() (value ${value} wei)…`);
  try {
    await publicClient.simulateContract({
      account,
      address: registrar,
      abi: REGISTRAR_ABI,
      functionName: "register",
      args: [registration],
      value,
    });
    console.error(`  ✓ simulation OK`);
  } catch (err) {
    console.error(`register() would revert.\nRevert reason: ${revertReason(err)}`);
    process.exit(1);
  }

  if (dryRun) {
    console.error(`\n> Dry-run: simulation passed, no transaction sent.`);
    return;
  }

  // 4. Send the single register transaction.
  console.error(`\n> Sending register()…`);
  let txHash: Hex;
  try {
    txHash = await walletClient.writeContract({
      account,
      chain: sepolia,
      address: registrar,
      abi: REGISTRAR_ABI,
      functionName: "register",
      args: [registration],
      value,
    });
  } catch (err) {
    console.error(`register() failed.\nRevert reason: ${revertReason(err)}`);
    process.exit(1);
  }
  console.error(`  tx sent: ${txHash}`);
  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
  if (receipt.status !== "success") {
    console.error(`register reverted on-chain. tx: ${txHash}`);
    process.exit(1);
  }

  console.error(`\n✓ Registered "${name}" for ${years} year(s).`);
  console.error(`  owner:    ${account.address}`);
  console.error(`  resolver: ${resolver} (set during registration)`);
  console.error(`  register: ${txHash}`);
  console.error(`\nNext: set ENS_NAME=${name} in .env, then run: npm run ens-write -- --blob <blobId>`);
  console.log(txHash);
}

main().catch((err) => {
  console.error("\nError:", err instanceof Error ? err.message : err);
  process.exit(1);
});

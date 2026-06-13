/**
 * Register a fresh .eth name directly via the on-chain ETHRegistrarController on
 * Sepolia, bypassing sepolia.app.ens.domains. Signs with ENS_PRIVATE_KEY (the
 * throwaway key that already holds Sepolia test ETH).
 *
 *   npm run ens-register            # registers ENS_REGISTER_LABEL.eth for 1 year
 *
 * Two incompatible controller ABIs exist on Sepolia:
 *   - STRUCT (canonical, default 0xfb3cE5D01e0f33f41DbB39035dB9745962F1f968):
 *       register((string label,address owner,uint256 duration,bytes32 secret,
 *                 address resolver,bytes[] data,uint8 reverseRecord,bytes32 referrer))
 *   - LEGACY v1 (older address, likely disabled under the v2 system):
 *       register(string,address,uint256,bytes32,address,bytes[],bool,uint16)
 * We auto-detect which one the configured ENS_CONTROLLER_ADDRESS exposes by probing
 * its pure makeCommitment(), then drive the matching commit -> wait -> register flow.
 * Any revert (e.g. a disabled v1 controller) is simulated first so its reason prints.
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
  toHex,
  zeroHash,
  type Address,
  type Hex,
  type PublicClient,
  type WalletClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";

const DEFAULT_CONTROLLER: Address =
  "0xfb3cE5D01e0f33f41DbB39035dB9745962F1f968";
const DEFAULT_PUBLIC_RESOLVER: Address =
  "0xE99638b40E4Fff0129D56f03b55b6bbC4BBE49b5";

const SECONDS_PER_YEAR = 365n * 24n * 60n * 60n; // 31536000

// ── ABIs ──────────────────────────────────────────────────────────────────
// Custom errors thrown by the ETHRegistrarController. Including these in the ABI
// lets viem decode an otherwise reason-less revert into a NAMED error. The struct
// (v2-era) and legacy v1 controllers declare DIFFERENT signatures for the same
// names (e.g. CommitmentTooNew takes 3 args on the struct controller but 1 on the
// legacy one), so they cannot share one list — viem would see an ambiguous ABI.
//
// STRUCT errors mirror the deployed Sepolia controller's ABI exactly
// (ensdomains/ens-contracts deployments/sepolia/ETHRegistrarController.json).
const STRUCT_ERRORS = [
  { type: "error", name: "CommitmentNotFound", inputs: [{ name: "commitment", type: "bytes32" }] },
  {
    type: "error",
    name: "CommitmentTooNew",
    inputs: [
      { name: "commitment", type: "bytes32" },
      { name: "minimumCommitmentTimestamp", type: "uint256" },
      { name: "currentTimestamp", type: "uint256" },
    ],
  },
  {
    type: "error",
    name: "CommitmentTooOld",
    inputs: [
      { name: "commitment", type: "bytes32" },
      { name: "maximumCommitmentTimestamp", type: "uint256" },
      { name: "currentTimestamp", type: "uint256" },
    ],
  },
  { type: "error", name: "DurationTooShort", inputs: [{ name: "duration", type: "uint256" }] },
  { type: "error", name: "InsufficientValue", inputs: [] },
  { type: "error", name: "MaxCommitmentAgeTooHigh", inputs: [] },
  { type: "error", name: "MaxCommitmentAgeTooLow", inputs: [] },
  { type: "error", name: "NameNotAvailable", inputs: [{ name: "name", type: "string" }] },
  { type: "error", name: "ResolverRequiredForReverseRecord", inputs: [] },
  { type: "error", name: "ResolverRequiredWhenDataSupplied", inputs: [] },
  { type: "error", name: "UnexpiredCommitmentExists", inputs: [{ name: "commitment", type: "bytes32" }] },
] as const;

// LEGACY v1 controller errors (classic single-arg commitment errors + Unauthorised).
const LEGACY_ERRORS = [
  { type: "error", name: "CommitmentTooNew", inputs: [{ name: "commitment", type: "bytes32" }] },
  { type: "error", name: "CommitmentTooOld", inputs: [{ name: "commitment", type: "bytes32" }] },
  { type: "error", name: "NameNotAvailable", inputs: [{ name: "name", type: "string" }] },
  { type: "error", name: "DurationTooShort", inputs: [{ name: "duration", type: "uint256" }] },
  { type: "error", name: "ResolverRequiredWhenDataSupplied", inputs: [] },
  { type: "error", name: "UnexpiredCommitmentExists", inputs: [{ name: "commitment", type: "bytes32" }] },
  { type: "error", name: "InsufficientValue", inputs: [] },
  { type: "error", name: "Unauthorised", inputs: [{ name: "node", type: "bytes32" }] },
  { type: "error", name: "MaxCommitmentAgeTooLow", inputs: [] },
  { type: "error", name: "MaxCommitmentAgeTooHigh", inputs: [] },
] as const;

// Shared read-only fragments live on both controller versions.
const SHARED_ABI = [
  {
    type: "function",
    name: "available",
    stateMutability: "view",
    inputs: [{ name: "name", type: "string" }],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "rentPrice",
    stateMutability: "view",
    inputs: [
      { name: "name", type: "string" },
      { name: "duration", type: "uint256" },
    ],
    outputs: [
      {
        name: "price",
        type: "tuple",
        components: [
          { name: "base", type: "uint256" },
          { name: "premium", type: "uint256" },
        ],
      },
    ],
  },
  {
    type: "function",
    name: "minCommitmentAge",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "commit",
    stateMutability: "nonpayable",
    inputs: [{ name: "commitment", type: "bytes32" }],
    outputs: [],
  },
] as const;

// Canonical v2-era controller: single struct arg, uint8 reverseRecord, bytes32 referrer.
const STRUCT_CONTROLLER_ABI = [
  ...SHARED_ABI,
  ...STRUCT_ERRORS,
  {
    type: "function",
    name: "makeCommitment",
    stateMutability: "pure",
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
    outputs: [{ name: "", type: "bytes32" }],
  },
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

// Legacy v1 controller: positional args, bool reverseRecord, uint16 ownerControlledFuses.
const LEGACY_CONTROLLER_ABI = [
  ...SHARED_ABI,
  ...LEGACY_ERRORS,
  {
    type: "function",
    name: "makeCommitment",
    stateMutability: "pure",
    inputs: [
      { name: "name", type: "string" },
      { name: "owner", type: "address" },
      { name: "duration", type: "uint256" },
      { name: "secret", type: "bytes32" },
      { name: "resolver", type: "address" },
      { name: "data", type: "bytes[]" },
      { name: "reverseRecord", type: "bool" },
      { name: "ownerControlledFuses", type: "uint16" },
    ],
    outputs: [{ name: "", type: "bytes32" }],
  },
  {
    type: "function",
    name: "register",
    stateMutability: "payable",
    inputs: [
      { name: "name", type: "string" },
      { name: "owner", type: "address" },
      { name: "duration", type: "uint256" },
      { name: "secret", type: "bytes32" },
      { name: "resolver", type: "address" },
      { name: "data", type: "bytes[]" },
      { name: "reverseRecord", type: "bool" },
      { name: "ownerControlledFuses", type: "uint16" },
    ],
    outputs: [],
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
  // Dig the decoded custom error out of viem's nested error chain so we print the
  // NAMED error (e.g. "CommitmentNotFound(0x…)") rather than the generic outer
  // "the contract function reverted" message or a raw 4-byte signature.
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
      // Selector didn't match any ABI error — surface the raw signature.
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const dryRun =
    process.argv.slice(2).includes("--dry-run") ||
    process.env.ENS_REGISTER_DRY_RUN === "1";

  const label = requireEnv("ENS_REGISTER_LABEL").replace(/\.eth$/i, "");
  const rpcUrl = requireEnv("SEPOLIA_RPC_URL");
  const rawKey = requireEnv("ENS_PRIVATE_KEY");

  const controller =
    (process.env.ENS_CONTROLLER_ADDRESS as Address) ?? DEFAULT_CONTROLLER;
  const resolver =
    (process.env.ENS_PUBLIC_RESOLVER_ADDRESS as Address) ??
    DEFAULT_PUBLIC_RESOLVER;
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

  const secret = toHex(randomBytes(32));
  const name = `${label}.eth`;

  const publicClient: PublicClient = createPublicClient({
    chain: sepolia,
    transport: http(rpcUrl),
  });
  const walletClient: WalletClient = createWalletClient({
    account,
    chain: sepolia,
    transport: http(rpcUrl),
  });

  console.error(`> Registering "${name}" directly via ETHRegistrarController on Sepolia`);
  console.error(`  controller: ${controller}`);
  console.error(`  resolver:   ${resolver}`);
  console.error(`  owner:      ${account.address}`);
  console.error(`  duration:   ${years} year(s) (${duration}s)\n`);

  // 1. Availability.
  let available: boolean;
  try {
    available = (await publicClient.readContract({
      address: controller,
      abi: SHARED_ABI,
      functionName: "available",
      args: [label],
    })) as boolean;
  } catch (err) {
    console.error(
      `Error: could not call available() on the controller at ${controller}. ` +
        `Is ENS_CONTROLLER_ADDRESS correct?\nUnderlying: ${revertReason(err)}`,
    );
    process.exit(1);
  }
  if (!available) {
    console.error(`Revert reason: "${name}" is not available (already registered). Pick a fresh ENS_REGISTER_LABEL.`);
    process.exit(1);
  }
  console.error(`  ✓ "${name}" is available`);

  // 2. Auto-detect the ABI shape via the pure makeCommitment().
  const structArg = {
    label,
    owner: account.address,
    duration,
    secret,
    resolver,
    data: [] as Hex[],
    reverseRecord: 0,
    referrer: zeroHash,
  };
  const legacyArgs = [
    label,
    account.address,
    duration,
    secret,
    resolver,
    [] as Hex[],
    false,
    0,
  ] as const;

  let mode: "struct" | "legacy";
  let commitment: Hex;
  try {
    commitment = (await publicClient.readContract({
      address: controller,
      abi: STRUCT_CONTROLLER_ABI,
      functionName: "makeCommitment",
      args: [structArg],
    })) as Hex;
    mode = "struct";
  } catch {
    try {
      commitment = (await publicClient.readContract({
        address: controller,
        abi: LEGACY_CONTROLLER_ABI,
        functionName: "makeCommitment",
        args: legacyArgs,
      })) as Hex;
      mode = "legacy";
    } catch (err) {
      console.error(
        `Error: controller at ${controller} exposes neither the struct nor the legacy ` +
          `makeCommitment ABI. Check ENS_CONTROLLER_ADDRESS.\nUnderlying: ${revertReason(err)}`,
      );
      process.exit(1);
      return;
    }
  }
  const abi = mode === "struct" ? STRUCT_CONTROLLER_ABI : LEGACY_CONTROLLER_ABI;
  console.error(`  ✓ detected ${mode} controller ABI`);
  console.error(`  commitment: ${commitment}`);

  // 3. Price (base + premium), sent with a 10% buffer for USD->ETH drift.
  const price = (await publicClient.readContract({
    address: controller,
    abi: SHARED_ABI,
    functionName: "rentPrice",
    args: [label, duration],
  })) as { base: bigint; premium: bigint };
  const cost = price.base + price.premium;
  const value = (cost * 11n) / 10n;
  console.error(`  rentPrice:  ${cost} wei (sending ${value} wei with buffer)\n`);

  const registerArgs = mode === "struct" ? [structArg] : legacyArgs;

  // Dry-run: ONLY simulate register() with the custom-error ABI so viem decodes
  // any revert into a named error. Sends no transaction (no commit either).
  if (dryRun) {
    console.error(`> Dry-run: simulating register() only (no transaction sent)`);
    try {
      await publicClient.simulateContract({
        account,
        address: controller,
        abi,
        functionName: "register",
        args: registerArgs as never,
        value,
      });
      console.error(`  ✓ register() simulation succeeded — no revert.`);
      console.error(
        `    (Note: a real run still needs commit() + ${"minCommitmentAge"} wait first.)`,
      );
    } catch (err) {
      console.error(`  register() reverts with:\n    ${revertReason(err)}`);
      console.error(
        `\n  Note: with no on-chain commitment for this run's random secret, the expected\n` +
          `  revert here is CommitmentNotFound — that confirms the args reach the\n` +
          `  commitment-consumption step cleanly. To decode the revert from a real\n` +
          `  attempt, run the full flow — its register simulation uses this same\n` +
          `  custom-error ABI and prints the named error before sending any tx.`,
      );
    }
    return;
  }

  // 4. Commit.
  console.error(`> Step 1/2: commit`);
  let commitHash: Hex;
  try {
    commitHash = await walletClient.writeContract({
      account,
      chain: sepolia,
      address: controller,
      abi,
      functionName: "commit",
      args: [commitment],
    });
  } catch (err) {
    console.error(`commit() failed.\nRevert reason: ${revertReason(err)}`);
    process.exit(1);
  }
  console.error(`  tx sent: ${commitHash}`);
  const commitReceipt = await publicClient.waitForTransactionReceipt({ hash: commitHash });
  if (commitReceipt.status !== "success") {
    console.error(`commit reverted on-chain. tx: ${commitHash}`);
    process.exit(1);
  }
  console.error(`  ✓ committed`);

  // 5. Wait the minimum commitment age (+5s buffer).
  const minAge = (await publicClient.readContract({
    address: controller,
    abi: SHARED_ABI,
    functionName: "minCommitmentAge",
  })) as bigint;
  const waitSecs = Number(minAge) + 5;
  console.error(`  waiting ${waitSecs}s for minimum commitment age…`);
  await sleep(waitSecs * 1000);

  // 6. Register: simulate first so a disabled-controller revert surfaces its reason.
  console.error(`\n> Step 2/2: register`);
  try {
    await publicClient.simulateContract({
      account,
      address: controller,
      abi,
      functionName: "register",
      args: registerArgs as never,
      value,
    });
  } catch (err) {
    console.error(`register() would revert.\nRevert reason: ${revertReason(err)}`);
    process.exit(1);
  }

  let registerHash: Hex;
  try {
    registerHash = await walletClient.writeContract({
      account,
      chain: sepolia,
      address: controller,
      abi,
      functionName: "register",
      args: registerArgs as never,
      value,
    });
  } catch (err) {
    console.error(`register() failed.\nRevert reason: ${revertReason(err)}`);
    process.exit(1);
  }
  console.error(`  tx sent: ${registerHash}`);
  const registerReceipt = await publicClient.waitForTransactionReceipt({ hash: registerHash });
  if (registerReceipt.status !== "success") {
    console.error(`register reverted on-chain. tx: ${registerHash}`);
    process.exit(1);
  }

  console.error(`\n✓ Registered "${name}" for ${years} year(s).`);
  console.error(`  owner:    ${account.address}`);
  console.error(`  resolver: ${resolver} (set during registration)`);
  console.error(`  commit:   ${commitHash}`);
  console.error(`  register: ${registerHash}`);
  console.error(`\nNext: set ENS_NAME=${name} in .env, then run: npm run ens-write -- --blob <blobId>`);
  console.log(registerHash);
}

main().catch((err) => {
  console.error("\nError:", err instanceof Error ? err.message : err);
  process.exit(1);
});

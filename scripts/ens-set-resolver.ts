/**
 * Set a resolver for ENS_NAME on Sepolia, signed with ENS_PRIVATE_KEY.
 *
 *   npm run ens-set-resolver
 *
 * Handles both ownership models:
 *   - Unwrapped: owner(node) == signer  -> call ENS Registry.setResolver(node, resolver)
 *   - Wrapped:   owner(node) == NameWrapper -> call NameWrapper.setResolver(node, resolver)
 *     (the registry rejects a direct call for wrapped names). Before sending we
 *     verify the signer actually holds the wrapped-name token via ownerOf.
 *
 * Canonical Sepolia addresses (all env-overridable):
 *   Registry        0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e  (ENS_REGISTRY_ADDRESS)
 *   PublicResolver  0xE99638b40E4Fff0129D56f03b55b6bbC4BBE49b5  (ENS_PUBLIC_RESOLVER_ADDRESS)
 *   NameWrapper     0x0635513f179D50A207757E05759CbD106d7dFcE8  (ENS_NAMEWRAPPER_ADDRESS)
 *
 * Both setResolver paths revert WITHOUT a reason string when the caller isn't
 * authorized, so we pre-check ownership for a clear message, then simulate +
 * send and surface any revert reason.
 *
 * Requires ENS_NAME, ENS_PRIVATE_KEY, SEPOLIA_RPC_URL in .env.
 */
import "dotenv/config";
import {
  createPublicClient,
  createWalletClient,
  http,
  isAddressEqual,
  zeroAddress,
  type Address,
  type Hex,
} from "viem";
import { namehash, normalize } from "viem/ens";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";

const DEFAULT_REGISTRY: Address = "0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e";
const DEFAULT_PUBLIC_RESOLVER: Address =
  "0xE99638b40E4Fff0129D56f03b55b6bbC4BBE49b5";
const DEFAULT_NAME_WRAPPER: Address =
  "0x0635513f179D50A207757E05759CbD106d7dFcE8";

const REGISTRY_ABI = [
  {
    type: "function",
    name: "owner",
    stateMutability: "view",
    inputs: [{ name: "node", type: "bytes32" }],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "resolver",
    stateMutability: "view",
    inputs: [{ name: "node", type: "bytes32" }],
    outputs: [{ name: "", type: "address" }],
  },
] as const;

const NAME_WRAPPER_ABI = [
  {
    type: "function",
    name: "ownerOf",
    stateMutability: "view",
    inputs: [{ name: "id", type: "uint256" }],
    outputs: [{ name: "", type: "address" }],
  },
] as const;

// setResolver(bytes32,address) has the same signature on both the Registry and
// the NameWrapper, so one ABI fragment serves whichever contract we target.
const SET_RESOLVER_ABI = [
  {
    type: "function",
    name: "setResolver",
    stateMutability: "nonpayable",
    inputs: [
      { name: "node", type: "bytes32" },
      { name: "resolver", type: "address" },
    ],
    outputs: [],
  },
] as const;

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`Error: ${name} is not set in .env`);
    process.exit(1);
  }
  return v;
}

function revertReason(err: unknown): string {
  // viem decorates errors with shortMessage; fall back to first line.
  const anyErr = err as { shortMessage?: string; message?: string };
  if (anyErr?.shortMessage) return anyErr.shortMessage;
  if (anyErr?.message) return anyErr.message.split("\n")[0];
  return String(err);
}

async function main() {
  const ensName = requireEnv("ENS_NAME");
  const rpcUrl = requireEnv("SEPOLIA_RPC_URL");
  const rawKey = requireEnv("ENS_PRIVATE_KEY");

  const registry = (process.env.ENS_REGISTRY_ADDRESS as Address) ?? DEFAULT_REGISTRY;
  const resolver =
    (process.env.ENS_PUBLIC_RESOLVER_ADDRESS as Address) ?? DEFAULT_PUBLIC_RESOLVER;
  const nameWrapper =
    (process.env.ENS_NAMEWRAPPER_ADDRESS as Address) ?? DEFAULT_NAME_WRAPPER;

  const pk = (rawKey.startsWith("0x") ? rawKey : `0x${rawKey}`) as Hex;
  let account;
  try {
    account = privateKeyToAccount(pk);
  } catch {
    console.error("Error: ENS_PRIVATE_KEY is not a valid 32-byte hex private key.");
    process.exit(1);
  }

  const node = namehash(normalize(ensName)) as Hex;
  const publicClient = createPublicClient({ chain: sepolia, transport: http(rpcUrl) });
  const walletClient = createWalletClient({
    account,
    chain: sepolia,
    transport: http(rpcUrl),
  });

  console.error(`> Setting resolver for "${ensName}" on Sepolia`);
  console.error(`  node:      ${node}`);
  console.error(`  resolver:  ${resolver}`);
  console.error(`  signer:    ${account.address}`);

  // Who owns the node in the registry? Decides which contract we call.
  const owner = (await publicClient.readContract({
    address: registry,
    abi: REGISTRY_ABI,
    functionName: "owner",
    args: [node],
  })) as Address;

  if (isAddressEqual(owner, zeroAddress)) {
    console.error(
      `\nRevert reason: name "${ensName}" is not registered on Sepolia (registry owner is the zero address). Register it in sepolia.app.ens.domains first.`,
    );
    process.exit(1);
  }

  // Determine the target contract for setResolver.
  let target: Address;
  if (isAddressEqual(owner, account.address)) {
    target = registry;
    console.error(`  ownership: unwrapped (registry owner == signer)`);
    console.error(`  target:    ENS Registry ${registry}\n`);
  } else if (isAddressEqual(owner, nameWrapper)) {
    // Wrapped: verify the signer holds the wrapped-name token before sending.
    let tokenOwner: Address;
    try {
      tokenOwner = (await publicClient.readContract({
        address: nameWrapper,
        abi: NAME_WRAPPER_ABI,
        functionName: "ownerOf",
        args: [BigInt(node)],
      })) as Address;
    } catch (err) {
      console.error(
        `\nError: could not read NameWrapper.ownerOf at ${nameWrapper}: ${revertReason(err)}`,
      );
      process.exit(1);
    }

    if (!isAddressEqual(tokenOwner, account.address)) {
      console.error(
        `\nRevert reason: not owner — "${ensName}" is wrapped, and the NameWrapper token is held by ` +
          `${tokenOwner}, but the signing key is ${account.address}. Use the owner's key, or ` +
          `transfer/approve this address in sepolia.app.ens.domains.`,
      );
      process.exit(1);
    }

    target = nameWrapper;
    console.error(`  ownership: wrapped (NameWrapper token held by signer)`);
    console.error(`  target:    NameWrapper ${nameWrapper}\n`);
  } else {
    console.error(
      `\nRevert reason: not owner — the ENS Registry says "${ensName}" is owned by ${owner}, ` +
        `but the signing key is ${account.address}. Use the owner's key, or set this address ` +
        `as the name's manager in sepolia.app.ens.domains.`,
    );
    process.exit(1);
  }

  // Idempotency: registry.resolver(node) reflects the resolver for wrapped names
  // too (NameWrapper.setResolver writes through to the registry).
  const existing = (await publicClient.readContract({
    address: registry,
    abi: REGISTRY_ABI,
    functionName: "resolver",
    args: [node],
  })) as Address;
  if (isAddressEqual(existing, resolver)) {
    console.error(`Resolver is already set to ${resolver}. Nothing to do.`);
    return;
  }

  // Simulate against the chosen target to catch any revert with its reason
  // before spending gas.
  try {
    await publicClient.simulateContract({
      account,
      address: target,
      abi: SET_RESOLVER_ABI,
      functionName: "setResolver",
      args: [node, resolver],
    });
  } catch (err) {
    console.error(`Transaction would revert.\nRevert reason: ${revertReason(err)}`);
    process.exit(1);
  }

  let hash: Hex;
  try {
    hash = await walletClient.writeContract({
      address: target,
      abi: SET_RESOLVER_ABI,
      functionName: "setResolver",
      args: [node, resolver],
    });
  } catch (err) {
    console.error(`Transaction failed.\nRevert reason: ${revertReason(err)}`);
    process.exit(1);
  }

  console.error(`  tx sent: ${hash}`);
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") {
    console.error(`Transaction reverted on-chain (status: ${receipt.status}). tx: ${hash}`);
    process.exit(1);
  }

  console.error(`\n✓ Resolver set to ${resolver} for "${ensName}".`);
  console.error(`  Next: npm run ens-write -- --blob <blobId>`);
  console.log(hash);
}

main().catch((err) => {
  console.error("\nError:", err instanceof Error ? err.message : err);
  process.exit(1);
});

/**
 * ENS text-record provenance layer (Sepolia testnet). SERVER-SIDE ONLY — this
 * module reads the throwaway private key from env and must never run in a
 * browser bundle.
 *
 * Context: the name is registered via the ENS v2 preview (app.ens.dev) on
 * Sepolia. As of this writing that preview still uses the canonical ENS
 * Registry (0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e, same address as
 * mainnet), so we resolve the resolver through the registry and read/write text
 * records directly on it. We deliberately do NOT use viem's bundled
 * getEnsText / UniversalResolver: ENS redeploys the Universal Resolver on
 * Sepolia frequently, so the address viem ships can be stale and silently fail.
 * Going registry -> resolver -> text is the robust path.
 *
 * NOTE: ENS resets Sepolia names/state on periodic redeploys. If a read/write
 * starts failing with "no resolver" after previously working, the name likely
 * needs re-registering in sepolia.app.ens.domains.
 *
 * Writes use viem writeContract on the resolver's setText (simpler than, and
 * avoids version/v2 mismatches in, @ensdomains/ensjs — the spec's allowed
 * fallback). If the registry/resolver interface ever diverges from the classic
 * ABI, the on-chain calls revert and we surface a clear error rather than
 * pretending success.
 */
import {
  createPublicClient,
  createWalletClient,
  http,
  isAddressEqual,
  zeroAddress,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";
import { namehash, normalize } from "viem/ens";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import { sepolia } from "viem/chains";

// Canonical ENS Registry (same address on mainnet + testnets). Override only if
// the v2 preview ever moves it (set ENS_REGISTRY_ADDRESS in .env).
const DEFAULT_ENS_REGISTRY: Address =
  "0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e";

/** The three provenance keys this agent owns, in render order. */
export const PROVENANCE_KEYS = [
  "heor.dossier.latest",
  "heor.agent.version",
  "heor.agent.capabilities",
] as const;

// ── Minimal ABIs ────────────────────────────────────────────────────────────

const REGISTRY_ABI = [
  {
    type: "function",
    name: "resolver",
    stateMutability: "view",
    inputs: [{ name: "node", type: "bytes32" }],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "owner",
    stateMutability: "view",
    inputs: [{ name: "node", type: "bytes32" }],
    outputs: [{ name: "", type: "address" }],
  },
] as const;

const RESOLVER_ABI = [
  {
    type: "function",
    name: "text",
    stateMutability: "view",
    inputs: [
      { name: "node", type: "bytes32" },
      { name: "key", type: "string" },
    ],
    outputs: [{ name: "", type: "string" }],
  },
  {
    type: "function",
    name: "setText",
    stateMutability: "nonpayable",
    inputs: [
      { name: "node", type: "bytes32" },
      { name: "key", type: "string" },
      { name: "value", type: "string" },
    ],
    outputs: [],
  },
] as const;

// Wrapped names are owned in the NameWrapper (an ERC-1155). We don't hardcode
// its address — we only call ownerOf() on whatever the registry says owns the
// node, and treat a revert as "not a wrapper".
const NAME_WRAPPER_ABI = [
  {
    type: "function",
    name: "ownerOf",
    stateMutability: "view",
    inputs: [{ name: "id", type: "uint256" }],
    outputs: [{ name: "", type: "address" }],
  },
] as const;

// ── Config (env) ─────────────────────────────────────────────────────────────

function getRegistryAddress(): Address {
  return (process.env.ENS_REGISTRY_ADDRESS as Address) ?? DEFAULT_ENS_REGISTRY;
}

function requireRpcUrl(): string {
  const rpc = process.env.SEPOLIA_RPC_URL;
  if (!rpc) {
    throw new Error(
      "SEPOLIA_RPC_URL is not set. Add a Sepolia JSON-RPC endpoint to .env.",
    );
  }
  return rpc;
}

function requireEnsName(explicit?: string): string {
  const name = explicit ?? process.env.ENS_NAME;
  if (!name) {
    throw new Error("ENS_NAME is not set. Add your Sepolia ENS name to .env.");
  }
  return name;
}

/** Load the signing account from env. Never logs or returns the raw key. */
function loadAccount(): PrivateKeyAccount {
  // Defensive: this module is server-only; bail loudly if bundled to a browser.
  if (typeof window !== "undefined") {
    throw new Error("ens.ts is server-side only and must not run in a browser.");
  }
  const raw = process.env.ENS_PRIVATE_KEY;
  if (!raw) {
    throw new Error(
      "ENS_PRIVATE_KEY is not set. Add the throwaway Sepolia key to .env.",
    );
  }
  const pk = (raw.startsWith("0x") ? raw : `0x${raw}`) as Hex;
  try {
    return privateKeyToAccount(pk);
  } catch {
    // Never echo the key material in the error.
    throw new Error(
      "ENS_PRIVATE_KEY is not a valid 32-byte hex private key.",
    );
  }
}

function makePublicClient(): PublicClient {
  return createPublicClient({ chain: sepolia, transport: http(requireRpcUrl()) });
}

// ── Resolver discovery ───────────────────────────────────────────────────────

function nodeOf(name: string): Hex {
  return namehash(normalize(name)) as Hex;
}

/** Resolve the resolver address for a node, or throw a clear "no resolver" error. */
async function resolveResolver(
  client: PublicClient,
  name: string,
  node: Hex,
): Promise<Address> {
  let resolver: Address;
  try {
    resolver = (await client.readContract({
      address: getRegistryAddress(),
      abi: REGISTRY_ABI,
      functionName: "resolver",
      args: [node],
    })) as Address;
  } catch (err) {
    throw new Error(
      `Failed to query the ENS registry at ${getRegistryAddress()} on Sepolia ` +
        `(does the v2 preview still use the classic registry ABI?). Underlying: ${errMsg(err)}`,
    );
  }
  if (isAddressEqual(resolver, zeroAddress)) {
    throw new Error(
      `ENS name "${name}" has no resolver set on Sepolia. ` +
        `Set a resolver for it in sepolia.app.ens.domains before reading/writing records.`,
    );
  }
  return resolver;
}

// ── Public API ───────────────────────────────────────────────────────────────

export interface EnsStatus {
  name: string;
  node: Hex;
  resolver: Address;
  /** Address derived from the configured private key. */
  account: Address;
  /** Whatever the registry reports as owner of the node. */
  registryOwner: Address;
  /** True if the name is held in the NameWrapper. */
  wrapped: boolean;
}

/**
 * Sanity check: confirm ENS_NAME resolves to a resolver on Sepolia AND that the
 * configured key is authorized to write its records (registry manager, or the
 * NameWrapper owner if the name is wrapped). Throws an actionable error stating
 * exactly what is wrong. Returns the resolved context on success.
 */
export async function assertWritable(name?: string): Promise<EnsStatus> {
  const account = loadAccount();
  const ensName = requireEnsName(name);
  const node = nodeOf(ensName);
  const client = makePublicClient();

  const resolver = await resolveResolver(client, ensName, node);

  const registryOwner = (await client.readContract({
    address: getRegistryAddress(),
    abi: REGISTRY_ABI,
    functionName: "owner",
    args: [node],
  })) as Address;

  // Direct manager match (unwrapped name).
  if (isAddressEqual(registryOwner, account.address)) {
    return {
      name: ensName,
      node,
      resolver,
      account: account.address,
      registryOwner,
      wrapped: false,
    };
  }

  // Otherwise the registry owner might be the NameWrapper — check token owner.
  let wrappedOwner: Address | null = null;
  try {
    wrappedOwner = (await client.readContract({
      address: registryOwner,
      abi: NAME_WRAPPER_ABI,
      functionName: "ownerOf",
      args: [BigInt(node)],
    })) as Address;
  } catch {
    wrappedOwner = null; // registryOwner isn't a NameWrapper-like contract.
  }

  if (wrappedOwner && isAddressEqual(wrappedOwner, account.address)) {
    return {
      name: ensName,
      node,
      resolver,
      account: account.address,
      registryOwner,
      wrapped: true,
    };
  }

  if (wrappedOwner) {
    throw new Error(
      `ENS name "${ensName}" is wrapped (NameWrapper ${registryOwner}); its owner is ` +
        `${wrappedOwner}, not the configured key ${account.address}. ` +
        `Use the owner's key, or set this address as owner/approved in sepolia.app.ens.domains.`,
    );
  }

  throw new Error(
    `ENS name "${ensName}" is managed by ${registryOwner} on Sepolia, but the configured ` +
      `key resolves to ${account.address}. This key is not the manager and cannot write ` +
      `records. In sepolia.app.ens.domains, set this address as the name's manager ` +
      `(or use the manager's key).`,
  );
}

export interface WriteResult {
  name: string;
  node: Hex;
  resolver: Address;
  /** One tx hash per record written, in PROVENANCE_KEYS order. */
  txs: { key: string; value: string; hash: Hex }[];
}

/**
 * Write the three provenance text records:
 *   heor.dossier.latest  = blobId
 *   heor.agent.version   = version
 *   heor.agent.capabilities = capabilities
 *
 * Runs the sanity check first, then sends one setText tx per record and waits
 * for each receipt. Sequential (not multicall) so a failure points at the exact
 * record, and so it works against any resolver implementing setText.
 */
export async function writeProvenance(
  blobId: string,
  version: string,
  capabilities: string,
): Promise<WriteResult> {
  const status = await assertWritable();
  const account = loadAccount();
  const wallet = createWalletClient({
    account,
    chain: sepolia,
    transport: http(requireRpcUrl()),
  });
  const client = makePublicClient();

  const records: [string, string][] = [
    ["heor.dossier.latest", blobId],
    ["heor.agent.version", version],
    ["heor.agent.capabilities", capabilities],
  ];

  const txs: WriteResult["txs"] = [];
  for (const [key, value] of records) {
    let hash: Hex;
    try {
      hash = await wallet.writeContract({
        address: status.resolver,
        abi: RESOLVER_ABI,
        functionName: "setText",
        args: [status.node, key, value],
      });
    } catch (err) {
      throw new Error(
        `setText for "${key}" reverted on resolver ${status.resolver}. ` +
          `The resolver may not implement the classic setText ABI, or the key may not be ` +
          `authorized. Underlying: ${errMsg(err)}`,
      );
    }
    await client.waitForTransactionReceipt({ hash });
    txs.push({ key, value, hash });
  }

  return { name: status.name, node: status.node, resolver: status.resolver, txs };
}

export interface ProvenanceRecords {
  name: string;
  node: Hex;
  resolver: Address;
  records: Record<(typeof PROVENANCE_KEYS)[number], string>;
}

/**
 * Read the three provenance text records back. Resolves the resolver via the
 * registry and reads text() directly off it (robust against Sepolia's volatile
 * Universal Resolver). Functionally equivalent to viem getEnsText, but pinned
 * to the registry's current resolver.
 */
export async function readProvenance(name?: string): Promise<ProvenanceRecords> {
  const ensName = requireEnsName(name);
  const node = nodeOf(ensName);
  const client = makePublicClient();
  const resolver = await resolveResolver(client, ensName, node);

  const values = await Promise.all(
    PROVENANCE_KEYS.map((key) =>
      client.readContract({
        address: resolver,
        abi: RESOLVER_ABI,
        functionName: "text",
        args: [node, key],
      }) as Promise<string>,
    ),
  );

  const records = Object.fromEntries(
    PROVENANCE_KEYS.map((key, i) => [key, values[i] ?? ""]),
  ) as ProvenanceRecords["records"];

  return { name: ensName, node, resolver, records };
}

function errMsg(err: unknown): string {
  if (err instanceof Error) {
    // viem errors are verbose; first line is the most actionable.
    return err.message.split("\n")[0];
  }
  return String(err);
}

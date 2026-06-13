/**
 * Browser-side bundle hashing for the Verify view's tamper demo.
 *
 * Mirrors src/lib/hash.ts::bundleSha256 exactly — same canonicalize() (imported
 * from the shared isomorphic module) and the same "sha256 over every field
 * except sha256" rule — but uses the Web Crypto SubtleCrypto digest instead of
 * node:crypto. The UTF-8 bytes hashed are identical, so a recomputed hash of the
 * UNEDITED bundle equals the server's stored sha256 byte-for-byte; any edit
 * changes the canonical JSON and therefore the hash.
 */
import { canonicalize } from "@/lib/canonicalize";

/** Hex sha256 of a string via Web Crypto (async). */
async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Canonical sha256 of a bundle-shaped object, ignoring any existing sha256. */
export async function bundleSha256Client(
  bundleWithoutHash: Record<string, unknown>,
): Promise<string> {
  const { sha256: _omit, ...rest } = bundleWithoutHash;
  return sha256Hex(canonicalize(rest));
}

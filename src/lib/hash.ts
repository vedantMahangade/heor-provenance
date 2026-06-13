import { createHash } from "node:crypto";

// Canonical JSON lives in its own isomorphic module so the browser can reuse the
// exact same serialization (the Verify view's tamper demo recomputes hashes
// client-side and they must match byte-for-byte).
export { canonicalize } from "./canonicalize";
import { canonicalize } from "./canonicalize";

/** Hex sha256 of a string. */
export function sha256Hex(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

/**
 * Compute the canonical sha256 of a bundle-shaped object, ignoring any existing
 * `sha256` field. This is the single source of truth for integrity checks —
 * the same function is used to stamp a bundle and (later) to verify it.
 */
export function bundleSha256(bundleWithoutHash: Record<string, unknown>): string {
  const { sha256: _omit, ...rest } = bundleWithoutHash;
  return sha256Hex(canonicalize(rest));
}

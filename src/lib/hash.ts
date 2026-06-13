import { createHash } from "node:crypto";

/**
 * Deterministic JSON serialization with recursively sorted object keys.
 *
 * Two structurally-equal objects always produce the same string regardless of
 * key insertion order, so the sha256 of a bundle is reproducible by anyone.
 */
export function canonicalize(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortKeys);
  }
  if (value !== null && typeof value === "object") {
    return Object.keys(value as Record<string, unknown>)
      .sort()
      .reduce<Record<string, unknown>>((acc, key) => {
        acc[key] = sortKeys((value as Record<string, unknown>)[key]);
        return acc;
      }, {});
  }
  return value;
}

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

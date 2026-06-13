/**
 * Deterministic JSON serialization with recursively sorted object keys.
 *
 * Two structurally-equal objects always produce the same string regardless of
 * key insertion order, so the sha256 of a bundle is reproducible by anyone.
 *
 * ISOMORPHIC: this file has no Node or browser dependencies, so the SAME logic
 * runs on the server (src/lib/hash.ts) and in the browser (the Verify view's
 * tamper demo). Keeping it in one place guarantees client/server hashes match
 * byte-for-byte. Do not import anything platform-specific here.
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

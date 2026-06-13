/**
 * Server-side feature gating based on which env vars are present. Used by
 * /api/config (so the UI can gate the Generate tab) and by /api/generate (so a
 * keyless clone gets a clear message instead of a 500).
 *
 * The keyless Verify demo needs NO keys (reads default to a public RPC + the
 * public Walrus aggregator), so it is never gated. Generate writes to chain and
 * calls a paid/keyed LLM, so it requires the full set below.
 */
export interface FeatureConfig {
  /** True when the server has everything needed to run the Generate flow. */
  generateEnabled: boolean;
  /** Which required vars are missing (for a precise UI message). */
  missing: string[];
}

const REQUIRED_FOR_GENERATE = [
  "LLM_BASE_URL",
  "LLM_API_KEY",
  "LLM_MODEL",
  "ENS_PRIVATE_KEY",
  "ENS_NAME",
] as const;

export function getFeatureConfig(): FeatureConfig {
  const missing = REQUIRED_FOR_GENERATE.filter((k) => !process.env[k]);
  return { generateEnabled: missing.length === 0, missing };
}

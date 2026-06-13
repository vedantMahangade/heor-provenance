import OpenAI from "openai";

/**
 * Provider-agnostic LLM client.
 *
 * The LLM is a commodity drafter — the product is the provenance layer, not the
 * text generation. We therefore never hardcode a provider: everything comes
 * from env (LLM_BASE_URL / LLM_API_KEY / LLM_MODEL). Point it at any free,
 * OpenAI-compatible endpoint (Groq, Gemini's OpenAI shim, etc.).
 */

export interface LlmConfig {
  baseURL: string;
  apiKey: string;
  model: string;
}

export function getLlmConfig(): LlmConfig {
  const baseURL = process.env.LLM_BASE_URL;
  const apiKey = process.env.LLM_API_KEY;
  const model = process.env.LLM_MODEL;

  const missing = [
    ["LLM_BASE_URL", baseURL],
    ["LLM_API_KEY", apiKey],
    ["LLM_MODEL", model],
  ]
    .filter(([, v]) => !v)
    .map(([k]) => k);

  if (missing.length > 0) {
    throw new Error(
      `Missing required LLM env vars: ${missing.join(", ")}. ` +
        `See .env.example.`,
    );
  }

  return { baseURL: baseURL!, apiKey: apiKey!, model: model! };
}

export function createLlmClient(config: LlmConfig = getLlmConfig()): OpenAI {
  return new OpenAI({ baseURL: config.baseURL, apiKey: config.apiKey });
}

export interface ChatJsonOptions {
  system: string;
  user: string;
  /** Lower is more deterministic. Drafting should be conservative. */
  temperature?: number;
}

/**
 * Run a chat completion that is expected to return a single JSON object, and
 * return the parsed value. Requests JSON mode where the provider supports it,
 * and defensively extracts the first JSON object if the model wraps it in prose
 * or code fences (some OpenAI-compatible providers ignore response_format).
 */
export async function chatJson<T = unknown>(
  client: OpenAI,
  model: string,
  { system, user, temperature = 0.2 }: ChatJsonOptions,
): Promise<T> {
  const completion = await client.chat.completions.create({
    model,
    temperature,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
  });

  const content = completion.choices[0]?.message?.content ?? "";
  return parseJsonObject<T>(content);
}

/** Extract and parse the first balanced JSON object from a model response. */
export function parseJsonObject<T = unknown>(raw: string): T {
  const trimmed = raw.trim();
  try {
    return JSON.parse(trimmed) as T;
  } catch {
    // Strip code fences / surrounding prose and retry on the first {...} block.
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start !== -1 && end > start) {
      return JSON.parse(trimmed.slice(start, end + 1)) as T;
    }
    throw new Error(
      `LLM did not return parseable JSON. Got: ${trimmed.slice(0, 200)}…`,
    );
  }
}

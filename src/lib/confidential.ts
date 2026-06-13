/**
 * Chainlink Confidential AI Attester client.
 *
 * Runs an LLM inference over a document inside a confidential AWS Nitro enclave
 * and returns cryptographic digests attesting WHAT was processed (contentDigest)
 * and the request/response that the enclave actually saw. Those digests slot
 * into the evidence bundle as an independent provenance anchor: a third party
 * can confirm the analysis ran in a trusted enclave over the exact bytes we
 * claim, alongside our own sha256 and the Walrus/ENS pins.
 *
 *   POST /v1/inference            -> 202 { id, status: "queued", ... }
 *   GET  /v1/inference/{id}        -> { status, output, resources[], error? }
 *
 * Auth: Bearer CHAINLINK_CONF_AI_KEY. Base URL defaults to the dev preview and
 * is overridable via CHAINLINK_CONF_AI_URL.
 *
 * NOTE: the dev preview MAY LOG INPUTS. Only ever send synthetic data — never
 * real PHI/PII. The accompanying script enforces this by design.
 */

import type { ConfidentialAttestation } from "./types";

const DEFAULT_BASE_URL = "https://confidential-ai-dev-preview.cldev.cloud";

/** The enclave platform these attestations are produced in. */
export const CONFIDENTIAL_ENCLAVE = "aws-nitro" as const;
export const CONFIDENTIAL_PROVIDER = "chainlink-confidential-ai" as const;

export interface ConfidentialConfig {
  baseURL: string;
  apiKey: string;
}

export function getConfidentialConfig(): ConfidentialConfig {
  const apiKey = process.env.CHAINLINK_CONF_AI_KEY;
  if (!apiKey) {
    throw new Error(
      "CHAINLINK_CONF_AI_KEY is not set. Add your Chainlink Confidential AI key to .env. See .env.example.",
    );
  }
  const baseURL = (process.env.CHAINLINK_CONF_AI_URL ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
  return { baseURL, apiKey };
}

export interface AnalyzeConfidentialOptions {
  /** Document bytes (Buffer/Uint8Array) or UTF-8 text. Base64-encoded for transport. */
  document: Uint8Array | string;
  /** Original filename, surfaced to the enclave (e.g. "note.txt"). */
  filename: string;
  /** MIME type, e.g. "text/plain", "application/pdf". */
  contentType: string;
  /** Instruction for the model to run over the document. */
  prompt: string;
  /** Model id from GET /v1/models. Defaults to the small local model. */
  model?: string;
  /** Injected config (defaults to env). */
  config?: ConfidentialConfig;
  /** Total time budget for the whole submit+poll cycle (ms). Default ~120s. */
  timeoutMs?: number;
}

/** What a successful confidential inference yields. */
export interface ConfidentialResult {
  /** The model's text output. */
  output: string;
  /** Model id that produced it. */
  model: string;
  /** Digest of the input document the enclave processed. */
  contentDigest: string;
  /** Digest of the request the enclave saw. */
  requestDigest: string;
  /** Digest of the response the enclave produced. */
  responseDigest: string;
}

// The provenance record embedded in the evidence bundle (ConfidentialAttestation)
// is defined in ./types so EvidenceBundle can reference it; built below via
// buildConfidentialAttestation().

// ── Wire shapes (only the fields we read) ───────────────────────────────────

interface SubmitResponse {
  id?: string;
  status?: string;
}

interface InferenceResource {
  filename?: string;
  content_type?: string;
  digest?: string;
  request_digest?: string;
  response_digest?: string;
}

interface StatusResponse {
  id?: string;
  status?: string;
  output?: string;
  error?: string;
  model?: string;
  resources?: InferenceResource[];
  // Some fields may also surface at the top level depending on deploy; read
  // defensively as a fallback to the per-resource digests.
  request_digest?: string;
  response_digest?: string;
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Submit a document for confidential inference, poll to completion, and return
 * the output plus the enclave's content/request/response digests.
 */
export async function analyzeConfidential(
  opts: AnalyzeConfidentialOptions,
): Promise<ConfidentialResult> {
  const config = opts.config ?? getConfidentialConfig();
  const model = opts.model ?? "gemma4";
  const timeoutMs = opts.timeoutMs ?? 120_000;
  const deadline = Date.now() + timeoutMs;

  const bytes =
    typeof opts.document === "string"
      ? Buffer.from(opts.document, "utf8")
      : Buffer.from(opts.document);
  const contentBase64 = bytes.toString("base64");

  // 1. Submit. The API returns 202 with an id; tolerate any 2xx that carries one.
  const submit = (await requestJson(
    config,
    "POST",
    "/v1/inference",
    deadline,
    {
      model,
      prompt: opts.prompt,
      resources: [
        {
          filename: opts.filename,
          content_type: opts.contentType,
          content_base64: contentBase64,
        },
      ],
    },
  )) as SubmitResponse;

  const id = submit.id;
  if (!id) {
    throw new Error(
      `Confidential AI submit returned no id. Response: ${JSON.stringify(submit).slice(0, 300)}`,
    );
  }

  // 2. Poll with exponential backoff until completed/failed or the deadline.
  let delay = 1000;
  const maxDelay = 8000;
  for (;;) {
    if (Date.now() >= deadline) {
      throw new Error(
        `Confidential AI inference ${id} did not complete within ${Math.round(timeoutMs / 1000)}s.`,
      );
    }

    const status = (await requestJson(
      config,
      "GET",
      `/v1/inference/${id}`,
      deadline,
    )) as StatusResponse;

    switch (status.status) {
      case "completed":
        return extractResult(status, model);
      case "failed":
        throw new Error(
          `Confidential AI inference ${id} failed: ${status.error ?? "unknown error"}`,
        );
      default:
        // queued / running / processing — keep waiting.
        await sleepUntil(delay, deadline);
        delay = Math.min(delay * 2, maxDelay);
    }
  }
}

/** Shape the bundle's provenance field from a completed inference. */
export function buildConfidentialAttestation(
  result: ConfidentialResult,
): ConfidentialAttestation {
  return {
    provider: CONFIDENTIAL_PROVIDER,
    model: result.model,
    enclave: CONFIDENTIAL_ENCLAVE,
    contentDigest: result.contentDigest,
    requestDigest: result.requestDigest,
    responseDigest: result.responseDigest,
    output: result.output,
  };
}

// ── Internals ─────────────────────────────────────────────────────────────

function extractResult(status: StatusResponse, fallbackModel: string): ConfidentialResult {
  const resource = status.resources?.[0];
  const contentDigest = resource?.digest;
  const requestDigest = resource?.request_digest ?? status.request_digest;
  const responseDigest = resource?.response_digest ?? status.response_digest;

  const missing = [
    ["contentDigest", contentDigest],
    ["requestDigest", requestDigest],
    ["responseDigest", responseDigest],
  ]
    .filter(([, v]) => !v)
    .map(([k]) => k);
  if (missing.length > 0) {
    throw new Error(
      `Confidential AI completed but is missing attestation digests: ${missing.join(", ")}. ` +
        `Response: ${JSON.stringify(status).slice(0, 300)}`,
    );
  }

  return {
    output: status.output ?? "",
    model: status.model ?? fallbackModel,
    contentDigest: contentDigest!,
    requestDigest: requestDigest!,
    responseDigest: responseDigest!,
  };
}

/**
 * Issue a JSON request, retrying transient capacity errors (429 per_key_limit,
 * 503 queue_full) with backoff that respects Retry-After and never overruns the
 * shared deadline. Non-transient non-2xx responses fail fast.
 */
async function requestJson(
  config: ConfidentialConfig,
  method: "GET" | "POST",
  path: string,
  deadline: number,
  body?: unknown,
): Promise<unknown> {
  let delay = 1000;
  const maxDelay = 8000;

  for (;;) {
    const res = await fetch(`${config.baseURL}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

    if (res.ok) {
      return res.json();
    }

    // Transient capacity backpressure — wait and retry within the deadline.
    if ((res.status === 429 || res.status === 503) && Date.now() < deadline) {
      const retryAfterMs = parseRetryAfter(res.headers.get("retry-after"));
      await sleepUntil(retryAfterMs ?? delay, deadline);
      delay = Math.min(delay * 2, maxDelay);
      continue;
    }

    const detail = await safeText(res);
    throw new Error(
      `Confidential AI ${method} ${path} failed: ${res.status} ${res.statusText} ${detail}`,
    );
  }
}

/** Parse a Retry-After header (seconds or HTTP-date) into ms, if present. */
function parseRetryAfter(value: string | null): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(value);
  if (!Number.isNaN(date)) return Math.max(0, date - Date.now());
  return undefined;
}

/** Sleep `ms`, but never past the deadline (so the overall cap holds). */
function sleepUntil(ms: number, deadline: number): Promise<void> {
  const capped = Math.max(0, Math.min(ms, deadline - Date.now()));
  return new Promise((resolve) => setTimeout(resolve, capped));
}

async function safeText(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 300);
  } catch {
    return "";
  }
}

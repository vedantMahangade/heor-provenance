/**
 * POST /api/generate — runs the full end-to-end loop and STREAMS progress.
 *
 * Accepts multipart/form-data: drug, indication, optional max, optional file
 * field "sensitive". All API keys (LLM, Confidential AI, ENS) stay server-side;
 * the browser only ever talks to this route.
 *
 * Response is application/x-ndjson: one JSON object per line —
 *   { type: "progress", step, status, detail? }
 *   { type: "result", data: FullGenerateResult }
 *   { type: "error", message }
 * Streaming keeps the connection alive across the 1-2 minute run.
 */
import { runFullGenerate, type SourceInput } from "@/lib/fullGenerate";
import { getFeatureConfig } from "@/lib/featureConfig";
import { docKindFor } from "@/lib/docparse";

// viem / openai / node:crypto require the Node runtime (not edge). Allow up to
// 5 minutes for the full PubMed + LLM + confidential + Walrus + ENS flow.
export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";

const CONTENT_TYPES: Record<string, string> = {
  txt: "text/plain",
  md: "text/markdown",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  pdf: "application/pdf",
  json: "application/json",
  csv: "text/csv",
};

function contentTypeFor(filename: string, fallback?: string): string {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  return CONTENT_TYPES[ext] ?? fallback ?? "application/octet-stream";
}

export async function POST(req: Request) {
  // Gate behind keys so a clean clone gets a clear message, not a 500.
  const config = getFeatureConfig();
  if (!config.generateEnabled) {
    return Response.json(
      {
        error:
          `Generate requires API keys that aren't configured: ${config.missing.join(", ")}. ` +
          `See the "Generate (requires keys)" section in the README. The Verify demo works with no keys.`,
      },
      { status: 503 },
    );
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return Response.json({ error: "Expected multipart/form-data." }, { status: 400 });
  }

  const drug = String(form.get("drug") ?? "").trim();
  const indication = String(form.get("indication") ?? "").trim();
  const focus = String(form.get("focus") ?? "").trim() || undefined;
  const maxRaw = form.get("max");
  const maxSources = maxRaw ? Number(maxRaw) : undefined;

  if (!drug || !indication) {
    return Response.json({ error: "drug and indication are required." }, { status: 400 });
  }

  // The source document is mandatory: the chapter is drafted FROM it.
  const file = form.get("source") ?? form.get("sensitive");
  if (!(file instanceof File) || file.size === 0) {
    return Response.json(
      { error: "A source document (.docx, .pdf, or .txt) is required." },
      { status: 400 },
    );
  }
  const contentType = contentTypeFor(file.name || "", file.type);
  if (!docKindFor(file.name || "", contentType)) {
    return Response.json(
      { error: `Unsupported file type "${file.name}". Upload a .docx, .pdf, or .txt.` },
      { status: 400 },
    );
  }
  const source: SourceInput = {
    document: new Uint8Array(await file.arrayBuffer()),
    filename: file.name || "source-document",
    contentType,
  };

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: unknown) => controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));
      try {
        const data = await runFullGenerate({
          drug,
          indication,
          focus,
          maxSources: Number.isFinite(maxSources) ? maxSources : undefined,
          source,
          onProgress: (event) => send({ type: "progress", ...event }),
        });
        send({ type: "result", data });
      } catch (err) {
        send({ type: "error", message: err instanceof Error ? err.message : String(err) });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store, no-transform",
    },
  });
}

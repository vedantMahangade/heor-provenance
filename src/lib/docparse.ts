/**
 * Server-side source-document parsing for the cited-GVD-chapter flow.
 *
 * The Generate flow now REQUIRES a source document (a confidential readout, an
 * internal memo, etc.). We parse it to plain text here and feed that text into
 * the confidential enclave alongside the public PubMed abstracts — it never
 * touches the public LLM. SERVER-SIDE ONLY (mammoth + pdf-parse are Node libs).
 *
 * Accepts .docx (mammoth), .pdf (pdf-parse), and .txt/.md (plain UTF-8). Anything
 * else is rejected with a clear, actionable error.
 */

export type SupportedDocKind = "docx" | "pdf" | "text";

export interface ParsedDocument {
  text: string;
  kind: SupportedDocKind;
  filename: string;
}

/** Decide how to parse from filename extension (falls back to MIME hints). */
export function docKindFor(filename: string, contentType?: string): SupportedDocKind | null {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  if (ext === "docx") return "docx";
  if (ext === "pdf") return "pdf";
  if (ext === "txt" || ext === "md" || ext === "markdown") return "text";

  // Fall back to content type when the extension is missing/odd.
  const ct = (contentType ?? "").toLowerCase();
  if (ct.includes("wordprocessingml")) return "docx";
  if (ct.includes("pdf")) return "pdf";
  if (ct.startsWith("text/")) return "text";
  return null;
}

/**
 * Parse a source document buffer to plain text. Throws a clear error for
 * unsupported types or empty extractions (e.g. a scanned/image-only PDF).
 */
export async function parseDocument(
  buffer: Uint8Array,
  filename: string,
  contentType?: string,
): Promise<ParsedDocument> {
  const kind = docKindFor(filename, contentType);
  if (!kind) {
    throw new Error(
      `Unsupported document type for "${filename}". Upload a .docx, .pdf, or .txt file.`,
    );
  }

  let text: string;
  if (kind === "docx") {
    text = await parseDocx(buffer);
  } else if (kind === "pdf") {
    text = await parsePdf(buffer);
  } else {
    text = Buffer.from(buffer).toString("utf8");
  }

  text = text.replace(/\r\n/g, "\n").replace(/[ \t]+\n/g, "\n").trim();
  if (text.length < 20) {
    throw new Error(
      `Could not extract usable text from "${filename}" (got ${text.length} chars). ` +
        `If it is a scanned/image-only PDF, upload a text-based version.`,
    );
  }
  return { text, kind, filename };
}

async function parseDocx(buffer: Uint8Array): Promise<string> {
  const mammoth = await import("mammoth");
  const result = await mammoth.extractRawText({ buffer: Buffer.from(buffer) });
  return result.value;
}

async function parsePdf(buffer: Uint8Array): Promise<string> {
  // pdf-parse v2: new PDFParse({ data }).getText() -> { text }.
  const { PDFParse } = await import("pdf-parse");
  const parser = new PDFParse({ data: new Uint8Array(buffer) });
  try {
    const result = await parser.getText();
    return result.text;
  } finally {
    await parser.destroy?.();
  }
}

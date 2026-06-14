/**
 * DE-RISK TEST (one-off, no app code touched).
 *
 * Question this answers: if we ask the confidential enclave to draft a *cited*
 * Clinical Value chapter (instead of our usual one-claim-one-PMID grounding),
 * are the inline [PMID ...] citations ACTUALLY accurate — or just well-formatted?
 *
 * What it does:
 *   1. Fetches semaglutide / type 2 diabetes abstracts via the existing pubmed.ts.
 *   2. Packs BOTH those abstracts (with PMIDs) AND the synthetic patient note into
 *      ONE document and sends it to the Chainlink enclave (confidential.ts),
 *      prompting gemma4 to write a Clinical Value chapter with inline [PMID]s.
 *   3. Prints the raw chapter output.
 *   4. For each [PMID] cited, prints the citing sentence beside that PMID's actual
 *      abstract text, side by side, for eyeballing.
 *   5. Prints a tally: cited PMIDs in-set vs hallucinated, and a heuristic flag
 *      for any citation whose sentence looks unsupported by its abstract.
 *
 *   npx tsx scripts/test-cited-chapter.ts
 *
 * Requires CHAINLINK_CONF_AI_KEY in .env. The patient note is SYNTHETIC; never
 * point this at real PHI — the dev preview may log inputs.
 */
import "dotenv/config";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { searchAndFetch } from "../src/lib/pubmed";
import { analyzeConfidential } from "../src/lib/confidential";
import type { Source } from "../src/lib/types";

const QUERY = "semaglutide type 2 diabetes";
const MODEL = "gemma4";
const NOTE_PATH = resolve(__dirname, "fixtures/synthetic-patient-note.txt");

const CHAPTER_PROMPT =
  "Using the published evidence and the confidential patient note in the attached document, " +
  "write a Clinical Value chapter for a value dossier, citing every statement inline with its " +
  "source PMID in square brackets like [PMID 12345678]; only cite PMIDs from the provided abstracts.";

async function main() {
  console.error("⚠ Confidential AI dev preview MAY LOG INPUTS — synthetic data only, never real PHI.\n");

  // 1. Real PubMed evidence.
  console.error(`> Fetching PubMed abstracts for "${QUERY}"…`);
  const all = await searchAndFetch(QUERY, { retmax: 8 });
  const sources = all.filter((s) => s.abstract.trim().length > 0);
  if (sources.length === 0) throw new Error("No abstracts returned from PubMed.");
  const providedPmids = new Set(sources.map((s) => s.pmid));
  console.error(`  got ${sources.length} abstracts: ${[...providedPmids].join(", ")}\n`);

  // 2. Pack BOTH abstracts AND the synthetic note into one document for the enclave.
  const note = await readFile(NOTE_PATH, "utf8");
  const document = buildDocument(note, sources);
  console.error(`> Sending to enclave (model: ${MODEL}, ${Buffer.byteLength(document)} bytes)…`);
  console.error(`  prompt: ${CHAPTER_PROMPT}`);
  console.error(`  submitting + polling (cap ~180s)…\n`);

  const result = await analyzeConfidential({
    document,
    filename: "value-dossier-inputs.txt",
    contentType: "text/plain",
    prompt: CHAPTER_PROMPT,
    model: MODEL,
    timeoutMs: 180_000,
  });

  // 3. Raw output.
  const rule = "─".repeat(78);
  console.log(`\n${rule}`);
  console.log(`RAW CHAPTER OUTPUT  (model: ${result.model})`);
  console.log(rule);
  console.log(result.output);
  console.log(`${rule}\n`);

  // 4. Citation-by-citation, side by side with the cited abstract.
  const citations = extractCitations(result.output);
  console.log(`${rule}`);
  console.log(`CITATION CHECK  (${citations.length} inline citation${citations.length === 1 ? "" : "s"})`);
  console.log(rule);

  const byPmid = new Map<string, Source>(sources.map((s) => [s.pmid, s]));
  let hallucinated = 0;
  let unsupported = 0;
  const citedPmids = new Set<string>();

  for (const [i, c] of citations.entries()) {
    citedPmids.add(c.pmid);
    const source = byPmid.get(c.pmid);
    const inSet = providedPmids.has(c.pmid);
    if (!inSet) hallucinated++;

    const status = inSet ? "✓ in provided set" : "✗ HALLUCINATED (not in provided set)";
    console.log(`\n[${i + 1}] [PMID ${c.pmid}]  ${status}`);

    const abstractText = source
      ? `${source.title}\n${decodeEntities(source.abstract)}`
      : "(no abstract — this PMID was not in the provided evidence)";

    let support: ReturnType<typeof assessSupport> | null = null;
    if (source) {
      support = assessSupport(c.sentence, decodeEntities(source.abstract));
      if (!support.supported) unsupported++;
    }

    printSideBySide("CITED AS", c.sentence, "ACTUAL ABSTRACT", abstractText);

    if (support) {
      const flag = support.supported ? "looks supported" : "⚑ NOT clearly supported";
      const nums =
        support.missingNumbers.length > 0
          ? `  numbers in sentence not in abstract: ${support.missingNumbers.join(", ")}`
          : "";
      console.log(`   heuristic: ${flag}  (word overlap ${Math.round(support.overlap * 100)}%)${nums}`);
    }
  }

  // 5. Final tally.
  console.log(`\n${rule}`);
  console.log("TALLY");
  console.log(rule);
  console.log(`  provided PMIDs:        ${providedPmids.size}  (${[...providedPmids].join(", ")})`);
  console.log(`  inline citations:      ${citations.length}`);
  console.log(`  distinct PMIDs cited:  ${citedPmids.size}`);
  console.log(`  cited & in set:        ${citations.length - hallucinated}`);
  console.log(`  cited & HALLUCINATED:  ${hallucinated}`);
  console.log(`  unsupported (heuristic, in-set only): ${unsupported}`);

  const flaggedPmids = [...citedPmids].filter((p) => !providedPmids.has(p));
  if (flaggedPmids.length) {
    console.log(`\n  ⚑ hallucinated PMIDs: ${flaggedPmids.join(", ")}`);
  }
  console.log(
    `\n  NOTE: "supported" is a crude word/number-overlap heuristic — use the side-by-side\n` +
      `  text above for the real eyeball check. The heuristic only narrows where to look.`,
  );
}

/** Pack the confidential note + the published abstracts into one document. */
function buildDocument(note: string, sources: Source[]): string {
  const evidence = sources
    .map((s) => {
      const meta = [s.journal, s.year].filter(Boolean).join(", ");
      return `[PMID ${s.pmid}]${meta ? ` (${meta})` : ""}\nTitle: ${s.title}\nAbstract: ${s.abstract}`;
    })
    .join("\n\n---\n\n");

  return [
    "=== CONFIDENTIAL SYNTHETIC PATIENT NOTE (context only, do not cite) ===",
    note.trim(),
    "",
    "=== PUBLISHED EVIDENCE (cite ONLY these PMIDs, inline, like [PMID 12345678]) ===",
    evidence,
  ].join("\n");
}

interface Citation {
  pmid: string;
  /** The sentence in the output that contains this citation. */
  sentence: string;
}

/** Pull every [PMID ...] from the output, paired with its enclosing sentence. */
function extractCitations(text: string): Citation[] {
  const citationRe = /\[\s*PMID[\s:]*?(\d{4,})\s*\]/gi;
  const sentences = splitSentences(text);
  const out: Citation[] = [];
  const seen = new Set<string>();

  for (const sentence of sentences) {
    let m: RegExpExecArray | null;
    citationRe.lastIndex = 0;
    while ((m = citationRe.exec(sentence)) !== null) {
      const pmid = m[1];
      const clean = sentence.replace(/\s+/g, " ").trim();
      const key = `${pmid}::${clean}`;
      if (seen.has(key)) continue; // dedup identical pmid+sentence pairs
      seen.add(key);
      out.push({ pmid, sentence: clean });
    }
  }
  return out;
}

/** Naive sentence splitter — good enough to attach a citation to its context. */
function splitSentences(text: string): string[] {
  return text
    .replace(/\n+/g, " ")
    .split(/(?<=[.!?])\s+(?=[A-Z0-9"“(\[])/)
    .map((s) => s.trim())
    .filter(Boolean);
}

const STOPWORDS = new Set(
  ("the a an and or of to in for with on at by from as is was were are be been being that this " +
    "these those it its their patients patient study trial results compared versus vs than into " +
    "which who whom also more most significantly significant associated demonstrated showed shown " +
    "treatment group groups dose doses both all over our we have has had").split(" "),
);

/**
 * Crude support heuristic: how many of the sentence's content words appear in
 * the abstract, plus whether every number in the sentence is present in the
 * abstract (HEOR claims hinge on the numbers). NOT a substitute for the
 * side-by-side eyeball — just a pointer to where to look.
 */
function assessSupport(sentence: string, abstract: string) {
  const sentClean = sentence.replace(/\[\s*PMID[\s:]*\d+\s*\]/gi, " ");
  const absNorm = normalizeWords(abstract);
  const absSet = new Set(absNorm);

  const words = normalizeWords(sentClean).filter((w) => w.length >= 4 && !STOPWORDS.has(w));
  const matched = words.filter((w) => absSet.has(w)).length;
  const overlap = words.length ? matched / words.length : 0;

  // Numbers: normalize the middle-dot decimals PubMed sometimes emits.
  const absNumbers = new Set(extractNumbers(abstract));
  const sentNumbers = extractNumbers(sentClean);
  const missingNumbers = [...new Set(sentNumbers)].filter((n) => !absNumbers.has(n));

  const supported = overlap >= 0.4 && missingNumbers.length === 0;
  return { overlap, missingNumbers, supported };
}

function normalizeWords(s: string): string[] {
  return decodeEntities(s)
    .toLowerCase()
    .replace(/[^a-z0-9.\-%\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

/** Extract numeric tokens (percentages, decimals, ratios) for cross-checking. */
function extractNumbers(s: string): string[] {
  const decoded = decodeEntities(s).replace(/·/g, ".");
  const matches = decoded.match(/\d+(?:\.\d+)?%?/g) ?? [];
  // Drop bare PMIDs (4+ digit integers) so they don't masquerade as data.
  return matches.filter((n) => !/^\d{4,}$/.test(n));
}

/** Decode the numeric/basic HTML entities PubMed abstracts carry. */
function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => safeFromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => safeFromCodePoint(parseInt(d, 10)))
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"');
}

function safeFromCodePoint(cp: number): string {
  try {
    return String.fromCodePoint(cp);
  } catch {
    return "";
  }
}

/** Print two labeled text blocks as wrapped side-by-side columns. */
function printSideBySide(leftLabel: string, left: string, rightLabel: string, right: string) {
  const col = 46;
  const gap = "   │   ";
  const L = wrap(left, col);
  const R = wrap(right, col);
  const rows = Math.max(L.length, R.length);

  console.log(`   ${pad(leftLabel, col)}${gap}${rightLabel}`);
  console.log(`   ${"-".repeat(col)}${gap}${"-".repeat(col)}`);
  for (let i = 0; i < rows; i++) {
    console.log(`   ${pad(L[i] ?? "", col)}${gap}${R[i] ?? ""}`);
  }
}

function wrap(text: string, width: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    if (line.length + w.length + 1 > width) {
      if (line) lines.push(line);
      // Hard-break tokens longer than the column.
      if (w.length > width) {
        for (let i = 0; i < w.length; i += width) lines.push(w.slice(i, i + width));
        line = "";
      } else {
        line = w;
      }
    } else {
      line = line ? `${line} ${w}` : w;
    }
  }
  if (line) lines.push(line);
  return lines.length ? lines : [""];
}

function pad(s: string, width: number): string {
  return s.length >= width ? s.slice(0, width) : s + " ".repeat(width - s.length);
}

main().catch((err) => {
  console.error("\nError:", err instanceof Error ? err.message : err);
  process.exit(1);
});

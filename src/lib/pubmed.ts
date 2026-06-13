import { XMLParser } from "fast-xml-parser";
import type { Source } from "./types";

/**
 * PubMed E-utilities fetcher (esearch + efetch).
 *
 * Free, no auth required. An optional NCBI_API_KEY raises the rate limit.
 * We keep PMIDs + abstract text — that abstract text is the ground truth every
 * claim is later verified against, so we never paraphrase or trim it here.
 */

const EUTILS_BASE = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils";

function eutilsParams(extra: Record<string, string>): URLSearchParams {
  const params = new URLSearchParams({
    db: "pubmed",
    tool: process.env.NCBI_TOOL ?? "heor-provenance",
    ...extra,
  });
  if (process.env.NCBI_EMAIL) params.set("email", process.env.NCBI_EMAIL);
  if (process.env.NCBI_API_KEY) params.set("api_key", process.env.NCBI_API_KEY);
  return params;
}

async function eutilsFetch(
  endpoint: "esearch.fcgi" | "efetch.fcgi",
  params: URLSearchParams,
): Promise<Response> {
  const url = `${EUTILS_BASE}/${endpoint}?${params.toString()}`;
  const res = await fetch(url, { headers: { Accept: "*/*" } });
  if (!res.ok) {
    throw new Error(
      `PubMed ${endpoint} failed: ${res.status} ${res.statusText}`,
    );
  }
  return res;
}

export interface SearchOptions {
  /** Max records to fetch. */
  retmax?: number;
}

/**
 * esearch: turn a query string into a list of PMIDs, most relevant first.
 */
export async function searchPubmed(
  query: string,
  { retmax = 8 }: SearchOptions = {},
): Promise<string[]> {
  const params = eutilsParams({
    term: query,
    retmax: String(retmax),
    retmode: "json",
    sort: "relevance",
  });
  const res = await eutilsFetch("esearch.fcgi", params);
  const json = (await res.json()) as {
    esearchresult?: { idlist?: string[] };
  };
  return json.esearchresult?.idlist ?? [];
}

/**
 * efetch: pull full records (incl. abstracts) for a set of PMIDs as XML, parse
 * into Source objects. PMIDs with no abstract are kept but carry an empty
 * abstract (and will be unusable for grounding — that's intentional).
 */
export async function fetchArticles(pmids: string[]): Promise<Source[]> {
  if (pmids.length === 0) return [];

  const params = eutilsParams({
    id: pmids.join(","),
    retmode: "xml",
    rettype: "abstract",
  });
  const res = await eutilsFetch("efetch.fcgi", params);
  const xml = await res.text();

  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    // Abstracts often contain inline markup; keep text content.
    textNodeName: "#text",
  });
  const doc = parser.parse(xml);

  const articles = asArray(doc?.PubmedArticleSet?.PubmedArticle);
  return articles.map(parseArticle).filter((s): s is Source => s !== null);
}

/** Convenience: search then fetch in one call. */
export async function searchAndFetch(
  query: string,
  options?: SearchOptions,
): Promise<Source[]> {
  const pmids = await searchPubmed(query, options);
  return fetchArticles(pmids);
}

// ── XML parsing helpers ─────────────────────────────────────────────────────

function parseArticle(article: unknown): Source | null {
  const a = article as Record<string, any>;
  const citation = a?.MedlineCitation;
  if (!citation) return null;

  const pmid = textOf(citation.PMID);
  if (!pmid) return null;

  const art = citation.Article ?? {};
  const title = textOf(art.ArticleTitle) || "(no title)";
  const abstract = parseAbstract(art.Abstract);
  const journal = textOf(art.Journal?.Title);
  const year = parseYear(art);
  const authors = parseAuthors(art.AuthorList);

  return {
    pmid,
    title,
    abstract,
    journal: journal || undefined,
    year: year || undefined,
    authors: authors.length ? authors : undefined,
    url: `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`,
  };
}

/**
 * Abstracts may be a single string or several labelled sections
 * (Background/Methods/Results/Conclusions). Concatenate, prefixing labels so
 * the grounding text mirrors what a reader sees on PubMed.
 */
function parseAbstract(abstract: unknown): string {
  if (!abstract) return "";
  const sections = asArray((abstract as any).AbstractText);
  const parts = sections
    .map((s) => {
      const text = textOf(s);
      if (!text) return "";
      const label =
        typeof s === "object" && s !== null
          ? (s["@_Label"] as string | undefined)
          : undefined;
      return label ? `${label}: ${text}` : text;
    })
    .filter(Boolean);
  return parts.join(" ");
}

function parseYear(art: Record<string, any>): string {
  return (
    textOf(art.Journal?.JournalIssue?.PubDate?.Year) ||
    textOf(art.ArticleDate?.Year) ||
    ""
  );
}

function parseAuthors(authorList: unknown): string[] {
  const authors = asArray((authorList as any)?.Author);
  return authors
    .map((au) => {
      const last = textOf((au as any)?.LastName);
      const initials = textOf((au as any)?.Initials);
      const collective = textOf((au as any)?.CollectiveName);
      if (collective) return collective;
      return [last, initials].filter(Boolean).join(" ");
    })
    .filter(Boolean);
}

/** Normalize a node that may be a string, number, or { "#text": ... } object. */
function textOf(node: unknown): string {
  if (node === null || node === undefined) return "";
  if (typeof node === "string") return node.trim();
  if (typeof node === "number") return String(node);
  if (typeof node === "object") {
    const t = (node as Record<string, unknown>)["#text"];
    if (t !== undefined) return textOf(t);
  }
  return "";
}

/** Coerce an element-or-array (fast-xml-parser's shape) into an array. */
function asArray<T>(value: T | T[] | undefined | null): T[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

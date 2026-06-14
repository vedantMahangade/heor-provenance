/**
 * Client-side .docx export of the drafted GVD chapter.
 *
 * Dynamically imports the `docx` library (kept out of the initial bundle) and
 * renders the chapter markdown — headings, lists, **bold** — into a Word file,
 * followed by a References section. Inline [PMID] markers are kept as plain text
 * so the exported chapter reads exactly as drafted.
 */
import { parseMarkdownBlocks } from "@/lib/markdownBlocks";
import type { EvidenceBundle } from "@/lib/types";

/** Split a line into runs, honoring **bold** spans. */
function inlineRuns(TextRun: typeof import("docx").TextRun, text: string) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g).filter(Boolean);
  return parts.map((p) => {
    const bold = /^\*\*[^*]+\*\*$/.test(p);
    return new TextRun({ text: bold ? p.slice(2, -2) : p, bold });
  });
}

export async function downloadChapterDocx(bundle: EvidenceBundle): Promise<void> {
  const docx = await import("docx");
  const { Document, Packer, Paragraph, TextRun, HeadingLevel } = docx;

  const headingFor = (level: number) =>
    [
      HeadingLevel.HEADING_1,
      HeadingLevel.HEADING_2,
      HeadingLevel.HEADING_3,
      HeadingLevel.HEADING_4,
      HeadingLevel.HEADING_5,
      HeadingLevel.HEADING_6,
    ][Math.min(level, 6) - 1];

  const focus = bundle.query.focus ? ` · ${bundle.query.focus}` : "";
  const title = `${bundle.query.drug} — ${bundle.query.indication}${focus}`;

  const children: import("docx").Paragraph[] = [
    new Paragraph({ heading: HeadingLevel.TITLE, children: [new TextRun({ text: title })] }),
    new Paragraph({
      children: [
        new TextRun({
          text: "GVD chapter (draft) — grounded and independently verified, not the full dossier.",
          italics: true,
        }),
      ],
    }),
    new Paragraph({ text: "" }),
  ];

  for (const block of parseMarkdownBlocks(bundle.chapter ?? "")) {
    if (block.type === "heading") {
      children.push(
        new Paragraph({ heading: headingFor(block.level), children: inlineRuns(TextRun, block.text) }),
      );
    } else if (block.type === "list") {
      for (const item of block.items) {
        children.push(
          new Paragraph({
            children: inlineRuns(TextRun, item),
            bullet: block.ordered ? undefined : { level: 0 },
            numbering: undefined,
          }),
        );
      }
    } else {
      children.push(new Paragraph({ children: inlineRuns(TextRun, block.text) }));
    }
  }

  // References.
  children.push(new Paragraph({ text: "" }));
  children.push(
    new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun({ text: "References" })] }),
  );
  for (const s of bundle.sources) {
    const meta = [s.journal, s.year].filter(Boolean).join(", ");
    children.push(
      new Paragraph({
        children: [
          new TextRun({ text: `[PMID ${s.pmid}] `, bold: true }),
          new TextRun({ text: `${s.title}${meta ? ` — ${meta}` : ""}` }),
        ],
      }),
    );
  }

  const doc = new Document({ sections: [{ children }] });
  const blob = await Packer.toBlob(doc);

  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const slug = `${bundle.query.drug}-${bundle.query.indication}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
  a.href = url;
  a.download = `gvd-chapter-${slug || "draft"}.docx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

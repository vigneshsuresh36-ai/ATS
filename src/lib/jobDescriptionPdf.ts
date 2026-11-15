import * as bundledFontsModule from "pdfmake/build/vfs_fonts";
import PdfPrinter from "pdfmake";
import type { ContentText, TDocumentDefinitions } from "pdfmake/interfaces";
import type { JobDescriptionMark } from "./jobDescriptionFormatting";

type FontFiles = Record<string, string>;
// pdfmake ships its Latin fonts as a virtual filesystem for browser builds.
const fontModule = bundledFontsModule as unknown as { default?: FontFiles };
const fonts = fontModule.default ?? bundledFontsModule as unknown as FontFiles;
const font = (name: string) => Buffer.from(fonts["Roboto-" + name + ".ttf"], "base64");

export function createJobDescriptionPdf(title: string, text: string, marks: JobDescriptionMark[] = []) {
  const segments: ContentText[] = [];
  let cursor = 0;
  for (const { start, end, bold, italic, underline } of marks) {
    if (cursor < start) segments.push({ text: text.slice(cursor, start) });
    segments.push({ text: text.slice(start, end), bold, italics: italic, decoration: underline ? "underline" : undefined });
    cursor = end;
  }
  if (cursor < text.length) segments.push({ text: text.slice(cursor) });

  const definition: TDocumentDefinitions = {
    pageSize: "A4",
    pageMargins: [46, 46, 46, 46],
    info: { title: title + " – Job description" },
    defaultStyle: { font: "Roboto", fontSize: 11, color: "#191919", lineHeight: 1.3 },
    content: [
      { text: title, bold: true, fontSize: 21, margin: [0, 0, 0, 4] },
      { text: "Job description", color: "#555555", margin: [0, 0, 0, 18] },
      { text: segments, preserveLeadingSpaces: true },
    ],
  };
  const printer = new PdfPrinter({ Roboto: {
    normal: font("Regular"), bold: font("Medium"), italics: font("Italic"), bolditalics: font("MediumItalic"),
  } });
  const pdf = printer.createPdfKitDocument(definition);
  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    pdf.on("data", (chunk: Buffer) => chunks.push(chunk));
    pdf.on("end", () => resolve(Buffer.concat(chunks)));
    pdf.on("error", reject);
    pdf.end();
  });
}

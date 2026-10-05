import { NextRequest } from "next/server";
import { ApiError, errResponse, json, requireUser } from "@/lib/auth";
import { canRecruit } from "@/lib/roles";

function extractResumeFields(text: string) {
  const cleaned = text.replace(/\r/g, "");
  const emailMatch = cleaned.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  const phoneMatch = cleaned.match(/(?:\+?\d[\d\s().-]{7,}\d)/);
  const nameCandidates = cleaned
    .split(/\n+/)
    .map((line) => line.trim())
    .filter((line) => line.length > 2 && !line.includes("@") && !/\d/.test(line))
    .filter((line) => line.split(/\s+/).length >= 2)
    .slice(0, 5);
  const name =
    nameCandidates.find((line) => !/resume|cv|profile|summary|experience/i.test(line)) ||
    nameCandidates[0] ||
    "";

  return {
    name: name || undefined,
    email: emailMatch?.[0] || undefined,
    phone: phoneMatch?.[0]?.replace(/\s+/g, " ").trim() || undefined,
  };
}

async function extractText(fileName: string, mime: string, buffer: Buffer) {
  const lowerName = fileName.toLowerCase();
  if (mime.includes("pdf") || lowerName.endsWith(".pdf")) {
    const pdfModule = await import("pdf-parse");
    const PDFParse = pdfModule.PDFParse;
    const parser = new PDFParse({ data: buffer });
    try {
      return (await parser.getText()).text;
    } finally {
      await parser.destroy();
    }
  }
  if (
    mime.includes("word") ||
    mime.includes("officedocument") ||
    lowerName.endsWith(".docx")
  ) {
    const mammothModule = await import("mammoth");
    const mammoth = mammothModule.default || mammothModule;
    return (await mammoth.extractRawText({ buffer })).value;
  }
  return buffer.toString("utf8");
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser(req);
    if (user.role !== "Admin" && !canRecruit(user.role)) throw new ApiError(403, "Only Admins and Recruiters can parse resumes.");

    const body = await req.json();
    const files = Array.isArray(body.files) ? body.files : [];
    if (!files.length) throw new ApiError(400, "At least one resume is required.");
    if (files.length > 50) throw new ApiError(400, "Upload up to 50 resumes at a time.");

    const resumes = await Promise.all(
      files.map(async (file: { fileName?: string; mime?: string; base64?: string }) => {
        const fileName = String(file.fileName || "resume");
        const base64 = String(file.base64 || "");
        if (!base64) throw new ApiError(400, `Resume data missing for ${fileName}.`);
        const text = await extractText(fileName, String(file.mime || ""), Buffer.from(base64, "base64"));
        return {
          fileName,
          text,
          ...extractResumeFields(text),
        };
      })
    );

    return json({ resumes });
  } catch (e) {
    return errResponse(e);
  }
}

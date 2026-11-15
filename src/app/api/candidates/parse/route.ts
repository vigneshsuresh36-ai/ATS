import { NextRequest } from "next/server";
import { ApiError, errResponse, json, requireUser } from "@/lib/auth";
import { canRecruit } from "@/lib/roles";
import { aiConfigured, generateAI, reserveAIUsage } from "@/lib/ai";
import { getAutomationSettings } from "@/lib/automations";
import { automationContext } from "@/lib/automationContext";
import { z } from "zod";

export const maxDuration = 60;
const extractedSchema = z.object({
  name: z.string().max(200).optional(), email: z.string().email().optional(), phone: z.string().max(40).optional(),
  skills: z.array(z.string().max(100)).max(80).optional(), experienceYears: z.number().min(0).max(80).optional(),
  location: z.string().max(200).optional(), notice: z.string().max(100).optional(),
});

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
  const skills = [
    "JavaScript", "TypeScript", "React", "Next.js", "Node.js", "Python", "Java", "C++", "C#", ".NET", "SQL", "PostgreSQL", "MySQL", "MongoDB", "AWS", "Azure", "GCP", "Docker", "Kubernetes", "Excel", "Power BI", "Tableau", "Salesforce", "SAP", "Recruitment", "Talent Acquisition", "Supply Chain", "Logistics", "Project Management", "Agile", "Finance", "Accounting", "Marketing", "Data Analysis",
  ].filter((skill) => cleaned.toLowerCase().includes(skill.toLowerCase()));
  const experienceMatch = cleaned.match(/(\d{1,2})\s*(?:\+|plus)?\s*(?:years?|yrs?)(?:\s+of)?\s+(?:total\s+)?experience/i)
    || cleaned.match(/(?:experience|work experience)[^\d]{0,20}(\d{1,2})\s*(?:\+|plus)?\s*(?:years?|yrs?)/i);

  return {
    name: name || undefined,
    email: emailMatch?.[0] || undefined,
    phone: phoneMatch?.[0]?.replace(/\s+/g, " ").trim() || undefined,
    skills,
    experienceYears: experienceMatch ? Number(experienceMatch[1]) : undefined,
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
    const parsedFiles = z.array(z.object({ fileName: z.string().max(255).optional(), mime: z.string().max(255).optional(), base64: z.string().min(1) })).max(50).safeParse(body.files);
    if (!parsedFiles.success) throw new ApiError(400, "Choose up to 50 valid resume files.");
    const files = parsedFiles.data;
    if (!files.length) throw new ApiError(400, "At least one resume is required.");
    if (files.length > 50) throw new ApiError(400, "Upload up to 50 resumes at a time.");
    if (files.some((f: { base64?: string }) => String(f.base64 || "").length > 11_000_000) || files.reduce((n: number, f: { base64?: string }) => n + String(f.base64 || "").length, 0) > 28_000_000) throw new ApiError(400, "Use files under 8 MB and batches under 20 MB.");
    const [settings, context] = await Promise.all([getAutomationSettings(user.email), automationContext(user)]);
    const enhance = settings.intake.enabled && aiConfigured();

    const resumes = await Promise.all(
      files.map(async (file: { fileName?: string; mime?: string; base64?: string }, index: number) => {
        const fileName = String(file.fileName || "resume");
        const base64 = String(file.base64 || "");
        if (!base64) throw new ApiError(400, `Resume data missing for ${fileName}.`);
        const text = await extractText(fileName, String(file.mime || ""), Buffer.from(base64, "base64"));
        let fields = { ...extractResumeFields(text), location: "", notice: "" };
        let extractionMethod = "Standard extraction";
        let extractionWarning = settings.intake.enabled && !aiConfigured() ? "AI is not connected; standard extraction was used." : enhance && index >= 3 ? "Standard extraction used. AI enhancement is limited to the first 3 files per batch." : "";
        if (enhance && index < 3 && text.trim()) {
          try {
            await reserveAIUsage(user.email);
            const raw = await generateAI("Extract explicit resume fields as a JSON object only: name, email, phone, skills (string array), experienceYears (number), location, notice. Omit unknown fields; do not guess or infer protected attributes. Do not compute experience from overlapping dates. All values must be supported by the resume.", { resume: text.slice(0, 20000) }, true);
            const parsed = extractedSchema.parse(JSON.parse(raw));
            fields = { ...fields, ...parsed, skills: parsed.skills || fields.skills, notice: parsed.notice?.match(/^\d{1,2}$/) ? parsed.notice : "" };
            extractionMethod = "AI-assisted extraction";
          } catch { extractionWarning = "AI enhancement could not complete; standard extraction was used. Please verify all fields."; }
        }
        const digits = (value: string) => value.replace(/\D/g, "");
        const possibleDuplicates = context.candidates.filter((c) => (fields.email && c.email?.toLowerCase() === fields.email.toLowerCase()) || (fields.phone && digits(fields.phone).length >= 10 && digits(c.phone || "").slice(-10) === digits(fields.phone).slice(-10))).map((c) => ({ id: c.id, name: c.name }));
        return {
          fileName,
          resumeText: text,
          ...fields, possibleDuplicates, extractionMethod, extractionWarning,
        };
      })
    );

    for (let index = 0; index < resumes.length; index++) {
      const resume = resumes[index];
      for (let otherIndex = 0; otherIndex < index; otherIndex++) {
        const other = resumes[otherIndex];
        const phone = (value: string | undefined) => (value || "").replace(/\D/g, "").slice(-10);
        if ((resume.email && resume.email.toLowerCase() === other.email?.toLowerCase()) || (phone(resume.phone).length === 10 && phone(resume.phone) === phone(other.phone))) {
          resume.extractionWarning = [resume.extractionWarning, `Possible duplicate in this upload: ${other.fileName}.`].filter(Boolean).join(" ");
        }
      }
    }
    return json({ resumes });
  } catch (e) {
    return errResponse(e);
  }
}

export type CvComparisonItem = { requirement: string; evidence: string; found: boolean };
export type CvComparison = { score: number; items: CvComparisonItem[] };

function normalized(value: string) {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

/** Accept only requirements and evidence that appear in the supplied documents. */
export function verifyCvComparison(raw: unknown, jd: string, cv: string): CvComparison | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as { requirements?: unknown; evidence?: unknown };
  if (!Array.isArray(obj.requirements) || !Array.isArray(obj.evidence)) return null;
  const jdText = normalized(jd);
  const cvText = normalized(cv);
  const seen = new Set<string>();
  const requirements = obj.requirements.flatMap((value: unknown, index: number) => {
    if (typeof value !== "string") return [];
    const text = value.trim();
    const key = normalized(text);
    if (key.length < 4 || text.length > 300 || !jdText.includes(key) || seen.has(key) || /\b(age|gender|sex|religion|caste|race|ethnicity|marital status|pregnancy|disability|nationality)\b/i.test(text)) return [];
    seen.add(key);
    return [{ text, index }];
  }).slice(0, 8);
  if (!requirements.length) return null;
  const items = requirements.map(({ text: requirement, index }) => {
    const entry = (obj.evidence as unknown[])[index];
    const quote = typeof entry === "string" ? entry.trim() : "";
    const valid = quote.length >= 4 && quote.length <= 500 && cvText.includes(normalized(quote));
    return { requirement, evidence: valid ? quote : "No verified evidence found in the reviewed CV text.", found: valid };
  });
  return { score: Math.round(items.filter((item) => item.found).length * 100 / items.length), items };
}

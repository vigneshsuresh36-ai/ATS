import type { FeedbackQuestion, FeedbackFormTemplate } from "./types";

export function normalizeQuestion(question: FeedbackQuestion | string): FeedbackQuestion {
  return typeof question === "string" ? { label: question, type: "paragraph", required: false, options: [], scaleMax: 5 } : question;
}

export function feedbackFormIssue(form: FeedbackFormTemplate): string {
  if (!form.name.trim()) return "Add a name for this form.";
  if (!form.questions.length) return "Add at least one question.";
  for (let index = 0; index < form.questions.length; index += 1) {
    const question = normalizeQuestion(form.questions[index]);
    if (!question.label.trim()) return `Add a title for question ${index + 1}.`;
    if (["dropdown", "multiple", "checkboxes"].includes(question.type)) {
      const options = question.options.map((option) => option.trim()).filter(Boolean);
      if (options.length < 2) return `Question ${index + 1} needs at least two answer options.`;
      if (new Set(options).size !== options.length) return `Question ${index + 1} has duplicate answer options.`;
    }
  }
  return "";
}

export function validFeedbackForms(value: unknown): value is FeedbackFormTemplate[] {
  if (!Array.isArray(value) || value.length > 50) return false;
  const ids = new Set<string>();
  return value.every((form) => {
    if (!form || typeof form.id !== "string" || !form.id.trim() || form.id.length > 100 || ids.has(form.id) || typeof form.name !== "string" || !form.name.trim() || form.name.length > 120 || (form.description !== undefined && (typeof form.description !== "string" || form.description.length > 500)) || !Array.isArray(form.questions) || !form.questions.length || form.questions.length > 20) return false;
    ids.add(form.id);
    return form.questions.every((item: unknown) => {
      if (typeof item === "string") return !!item.trim() && item.length <= 200;
      if (!item || typeof item !== "object") return false;
      const q = item as FeedbackQuestion;
      return typeof q.label === "string" && !!q.label.trim() && q.label.length <= 200 && (q.description === undefined || (typeof q.description === "string" && q.description.length <= 500)) && ["short", "paragraph", "dropdown", "multiple", "checkboxes", "scale", "stars"].includes(q.type) && typeof q.required === "boolean" && Array.isArray(q.options) && q.options.length <= 20 && q.options.every((o) => typeof o === "string" && !!o.trim() && o.length <= 120) && new Set(q.options).size === q.options.length && (!['dropdown','multiple','checkboxes'].includes(q.type) || q.options.length >= 2) && Number.isInteger(q.scaleMax) && q.scaleMax >= 2 && q.scaleMax <= 10;
    });
  });
}
export function validFeedbackAnswer(q: FeedbackQuestion, answer: string): boolean {
  if (answer.length > 6000) return false;
  if (!answer.trim()) return !q.required;
  if (q.type === "checkboxes") {
    try { const values = JSON.parse(answer); return Array.isArray(values) && values.length > 0 && new Set(values).size === values.length && values.every((v) => typeof v === "string" && q.options.includes(v)); } catch { return false; }
  }
  if (["dropdown", "multiple"].includes(q.type)) return q.options.includes(answer);
  if (["stars", "scale"].includes(q.type)) return /^\d+$/.test(answer) && Number(answer) >= 1 && Number(answer) <= q.scaleMax;
  return true;
}

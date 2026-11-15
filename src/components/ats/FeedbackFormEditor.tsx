"use client";

import { useState } from "react";
import { feedbackFormIssue, normalizeQuestion } from "@/lib/feedbackForms";
import type { FeedbackFormTemplate, FeedbackQuestion } from "@/lib/types";

const inputStyle = {
  width: "100%",
  minHeight: 42,
  padding: "10px 12px",
  border: "1px solid #cad5e2",
  borderRadius: 5,
  background: "#fff",
  color: "#26374b",
  fontSize: 14,
  fontWeight: 400,
} as const;

const labelStyle = {
  display: "grid",
  gap: 7,
  marginTop: 12,
  color: "#46576c",
  fontSize: 13,
  fontWeight: 650,
} as const;

const questionTypes: { value: FeedbackQuestion["type"]; label: string }[] = [
  { value: "short", label: "Short answer" },
  { value: "paragraph", label: "Paragraph" },
  { value: "dropdown", label: "Dropdown" },
  { value: "multiple", label: "Multiple choice" },
  { value: "checkboxes", label: "Checkboxes" },
  { value: "scale", label: "Number scale" },
  { value: "stars", label: "Star rating" },
];

function copyQuestion(question: FeedbackQuestion | string): FeedbackQuestion {
  const normalized = normalizeQuestion(question);
  return { ...normalized, options: [...normalized.options] };
}

export function FeedbackFormEditor({
  form,
  busy,
  message,
  onBack,
  onSave,
}: {
  form: FeedbackFormTemplate;
  busy: boolean;
  message: string;
  onBack: () => void;
  onSave: (form: FeedbackFormTemplate) => Promise<boolean>;
}) {
  const initialForm = { ...form, questions: form.questions.map(copyQuestion) };
  const [draft, setDraft] = useState<FeedbackFormTemplate>(initialForm);
  const issue = feedbackFormIssue(draft);
  const hasChanges = JSON.stringify(draft) !== JSON.stringify(initialForm);

  function updateQuestion(index: number, patch: Partial<FeedbackQuestion>) {
    setDraft((current) => ({
      ...current,
      questions: current.questions.map((question, questionIndex) => questionIndex === index
        ? { ...copyQuestion(question), ...patch }
        : copyQuestion(question)),
    }));
  }

  function leaveEditor() {
    if (hasChanges && !window.confirm("Discard unsaved changes to this feedback form?")) return;
    onBack();
  }

  return (
    <main style={{ width: "min(920px, 100%)", margin: "0 auto", padding: "8px 0 32px" }}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16, flexWrap: "wrap", marginBottom: 24 }}>
        <div>
          <button type="button" onClick={leaveEditor} style={{ border: 0, padding: 0, background: "transparent", color: "#405873", cursor: "pointer", fontSize: 13, fontWeight: 600 }}>
            Back to feedback forms
          </button>
          <p style={{ margin: "18px 0 4px", color: "#718096", fontSize: 11, fontWeight: 700, textTransform: "uppercase" }}>Feedback form editor</p>
          <h1 style={{ margin: 0, color: "#172332", fontSize: 24, lineHeight: 1.25 }}>{draft.name.trim() || "New feedback form"}</h1>
          <p style={{ margin: "6px 0 0", color: "#64748b", fontSize: 13 }}>Build a focused form for a role or interview round.</p>
        </div>
        <button type="button" className="ats-primary-button" disabled={busy || !!issue} onClick={() => void onSave(draft)}>
          {busy ? "Saving…" : "Save form"}
        </button>
      </header>

      {issue && <p role="alert" style={{ padding: "10px 12px", borderRadius: 5, background: "#fff5f3", color: "#9b3b32", fontSize: 13 }}>{issue}</p>}
      {message && <p role="status" style={{ color: "#9b3b32", fontSize: 13 }}>{message}</p>}

      <section aria-labelledby="feedback-form-details" style={{ padding: "18px 20px", border: "1px solid #dce4ef", borderRadius: 8, background: "#fff" }}>
        <h2 id="feedback-form-details" style={{ margin: 0, color: "#26374b", fontSize: 16 }}>Form details</h2>
        <label style={labelStyle}>
          Form name
          <input style={inputStyle} autoFocus maxLength={120} value={draft.name} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} placeholder="e.g. Engineering interview" />
        </label>
        <label style={labelStyle}>
          Instructions for interviewers <span style={{ color: "#718096", fontWeight: 400 }}>Optional</span>
          <textarea style={{ ...inputStyle, minHeight: 72, resize: "vertical" }} maxLength={500} value={draft.description || ""} onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))} placeholder="Add context for this interview or role" />
        </label>
      </section>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, margin: "24px 0 10px" }}>
        <h2 style={{ margin: 0, color: "#172332", fontSize: 18 }}>Questions</h2>
        <span style={{ color: "#718096", fontSize: 12 }}>{draft.questions.length} / 20</span>
      </div>

      {draft.questions.map((rawQuestion, index) => {
        const question = copyQuestion(rawQuestion);
        const isChoice = ["dropdown", "multiple", "checkboxes"].includes(question.type);
        return (
          <article key={index} style={{ padding: 14, border: "1px solid #dce4ef", borderRadius: 8, background: "#fff", marginTop: 8 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
              <strong style={{ color: "#26374b", fontSize: 14 }}>Question {index + 1}</strong>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                <button type="button" aria-label={`Move question ${index + 1} up`} disabled={index === 0} onClick={() => setDraft((current) => { const questions = current.questions.map(copyQuestion); [questions[index - 1], questions[index]] = [questions[index], questions[index - 1]]; return { ...current, questions }; })}>Move up</button>
                <button type="button" aria-label={`Move question ${index + 1} down`} disabled={index === draft.questions.length - 1} onClick={() => setDraft((current) => { const questions = current.questions.map(copyQuestion); [questions[index], questions[index + 1]] = [questions[index + 1], questions[index]]; return { ...current, questions }; })}>Move down</button>
                <button type="button" disabled={draft.questions.length >= 20} onClick={() => setDraft((current) => ({ ...current, questions: [...current.questions.slice(0, index + 1).map(copyQuestion), copyQuestion(question), ...current.questions.slice(index + 1).map(copyQuestion)] }))}>Duplicate</button>
                <button type="button" onClick={() => setDraft((current) => ({ ...current, questions: current.questions.filter((_, questionIndex) => questionIndex !== index).map(copyQuestion) }))}>Remove</button>
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.5fr) minmax(180px, 1fr)", gap: 12 }}>
              <label style={labelStyle}>
                Question title
                <input style={inputStyle} maxLength={200} value={question.label} onChange={(event) => updateQuestion(index, { label: event.target.value })} placeholder="e.g. How would you approach this problem?" />
              </label>
              <label style={labelStyle}>
                Answer type
                <select style={inputStyle} value={question.type} onChange={(event) => {
                  const type = event.target.value as FeedbackQuestion["type"];
                  const wasChoice = ["dropdown", "multiple", "checkboxes"].includes(question.type);
                  const becomesChoice = ["dropdown", "multiple", "checkboxes"].includes(type);
                  updateQuestion(index, { type, options: becomesChoice && !wasChoice && question.options.length < 2 ? ["Option 1", "Option 2"] : question.options });
                }}>
                  {questionTypes.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                </select>
              </label>
            </div>

            <label style={labelStyle}>
              Helper text <span style={{ color: "#718096", fontWeight: 400 }}>Optional</span>
              <textarea style={{ ...inputStyle, minHeight: 58, resize: "vertical" }} maxLength={500} value={question.description || ""} onChange={(event) => updateQuestion(index, { description: event.target.value })} placeholder="Clarify what a useful answer should cover" />
            </label>

            {isChoice && <fieldset style={{ margin: "18px 0 0", padding: 0, border: 0 }}>
              <legend style={{ color: "#46576c", fontSize: 13, fontWeight: 650 }}>Answer options</legend>
              {question.options.map((option, optionIndex) => <div key={optionIndex} style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8 }}>
                <span aria-hidden="true" style={{ color: "#718096", fontSize: 12 }}>{optionIndex + 1}.</span>
                <input style={inputStyle} maxLength={120} aria-label={`Question ${index + 1}, option ${optionIndex + 1}`} value={option} onChange={(event) => updateQuestion(index, { options: question.options.map((value, i) => i === optionIndex ? event.target.value : value) })} placeholder={`Option ${optionIndex + 1}`} />
                <button type="button" aria-label={`Remove option ${optionIndex + 1}`} onClick={() => updateQuestion(index, { options: question.options.filter((_, i) => i !== optionIndex) })}>Remove</button>
              </div>)}
              <button type="button" style={{ marginTop: 10 }} disabled={question.options.length >= 20} onClick={() => updateQuestion(index, { options: [...question.options, ""] })}>+ Add option</button>
            </fieldset>}

            {["scale", "stars"].includes(question.type) && <label style={labelStyle}>
              Maximum rating
              <select style={inputStyle} value={question.scaleMax} onChange={(event) => updateQuestion(index, { scaleMax: Number(event.target.value) })}>
                {[2, 3, 4, 5, 6, 7, 8, 9, 10].map((value) => <option key={value} value={value}>{value}</option>)}
              </select>
            </label>}

            <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 12, color: "#46576c", fontSize: 13 }}>
              <span>Required</span>
              <button type="button" role="switch" aria-label={`Require an answer to question ${index + 1}`} aria-checked={question.required} className={`hb-program-switch${question.required ? " is-on" : ""}`} onClick={() => updateQuestion(index, { required: !question.required })}>
                <span aria-hidden="true" />
              </button>
            </div>
          </article>
        );
      })}

      <button type="button" style={{ marginTop: 12 }} disabled={draft.questions.length >= 20} onClick={() => setDraft((current) => ({ ...current, questions: [...current.questions.map(copyQuestion), { label: "", type: "paragraph", required: false, options: [], scaleMax: 5 }] }))}>+ Add question</button>
      <footer style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap", marginTop: 18, paddingTop: 12, borderTop: "1px solid #e3e9ef" }}>
        <button type="button" onClick={leaveEditor}>Back to feedback forms</button>
        <button type="button" className="ats-primary-button" disabled={busy || !!issue} onClick={() => void onSave(draft)}>{busy ? "Saving…" : "Save form"}</button>
      </footer>
    </main>
  );
}
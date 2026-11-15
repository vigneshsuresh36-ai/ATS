"use client";
import { useEffect, useState } from "react";
import { formatDateTime } from "@/lib/dateFormat";

type Comment = { id: string; text: string; author: string; createdAt: string };
export function CandidateComments({ candidateId, apiFetch }: { candidateId: string; apiFetch: (path: string, init?: RequestInit) => Promise<Response> }) {
  const [comments, setComments] = useState<Comment[]>([]);
  const [text, setText] = useState("");
  const [showAll, setShowAll] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    setLoading(true); setError("");
    apiFetch(`/api/candidates/${candidateId}/comments`).then(async (response) => {
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not load comments.");
      if (active) setComments(result.comments);
    }).catch((cause) => { if (active) setError(cause instanceof Error ? cause.message : "Could not load comments."); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [apiFetch, candidateId]);
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!text.trim() || saving) return;
    setSaving(true); setError("");
    try {
      const response = await apiFetch(`/api/candidates/${candidateId}/comments`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not add comment.");
      setComments((previous) => [result.comment, ...previous]); setText("");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not add comment."); }
    finally { setSaving(false); }
  }
  return <details className="ats-comments"><summary>Comments ({comments.length})</summary><div className="ats-comments-body"><form onSubmit={submit}><label htmlFor="candidate-comment">Add a comment</label><textarea id="candidate-comment" value={text} onChange={(event) => setText(event.target.value)} maxLength={3000} placeholder="Add a follow-up…" /><button type="submit" disabled={saving || !text.trim()}>{saving ? "Saving…" : "Add comment"}</button></form>{error && <p role="alert">{error}</p>}{loading ? <p>Loading comments…</p> : comments.length ? <><ol>{(showAll ? comments : comments.slice(0, 2)).map((comment) => <li key={comment.id}><div><strong>{comment.author}</strong><time dateTime={comment.createdAt}>{formatDateTime(comment.createdAt, "Date not recorded")}</time></div><p>{comment.text}</p></li>)}</ol>{comments.length > 2 && <button type="button" className="ats-comments-more" onClick={() => setShowAll(!showAll)}>{showAll ? "Show fewer comments" : `View all comments (${comments.length})`}</button>}</> : <p>No comments yet.</p>}</div></details>;
}

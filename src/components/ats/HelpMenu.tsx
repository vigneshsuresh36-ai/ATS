"use client";
import { useEffect, useRef, useState } from "react";
import { TicketComments } from "./TicketComments";

type Ticket = { id: string; ticketNumber: string; subject: string; description: string; status: string; createdAt: string; reporterEmail: string; emailStatus: string; attachmentName?: string | null };
export function HelpMenu({ apiFetch }: { apiFetch: (url: string, init?: RequestInit) => Promise<Response> }) {
  const menu = useRef<HTMLDetailsElement>(null);
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [subject, setSubject] = useState("");
  const [description, setDescription] = useState("");
  const [attachment, setAttachment] = useState<File | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [canManage, setCanManage] = useState(false);
  const [openTicket, setOpenTicket] = useState<string | null>(null);
  useEffect(() => {
    const outside = (event: PointerEvent) => { if (menu.current && !menu.current.contains(event.target as Node)) menu.current.open = false; };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape" && menu.current?.open) { menu.current.open = false; menu.current.querySelector("summary")?.focus(); } };
    document.addEventListener("pointerdown", outside); document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", outside); document.removeEventListener("keydown", escape); };
  }, []);
  async function load() {
    try { const response = await apiFetch("/api/support-tickets"); const data = await response.json(); if (!response.ok) throw new Error(data.error || "Could not load tickets."); setTickets(data.tickets); setCanManage(data.canManage); } catch (error) { setMessage(error instanceof Error ? error.message : "Could not load tickets."); }
  }
  async function changeStatus(ticket: Ticket) {
    setBusy(true); setMessage("");
    try { const status = ticket.status === "Open" ? "Resolved" : "Open"; const response = await apiFetch("/api/support-tickets", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: ticket.id, status }) }); const data = await response.json(); if (!response.ok) throw new Error(data.error || "Could not update ticket."); setTickets((items) => items.map((item) => item.id === ticket.id ? { ...item, status } : item)); } catch (error) { setMessage(error instanceof Error ? error.message : "Could not update ticket."); } finally { setBusy(false); }
  }
  async function submit(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setMessage("");
    try {
      const form = new FormData(); form.set("subject", subject); form.set("description", description); if (attachment) form.set("attachment", attachment);
      const response = await apiFetch("/api/support-tickets", { method: "POST", body: form });
      const data = await response.json(); if (!response.ok) throw new Error(data.error || "Could not create ticket.");
      setSubject(""); setDescription(""); setAttachment(null); if (fileInput.current) fileInput.current.value = ""; setTickets((items) => [data.ticket, ...items]);
      setMessage(data.ticket.emailStatus === "sent" ? `${data.ticket.ticketNumber} created and emailed to Vignesh.` : `${data.ticket.ticketNumber} created and assigned to Vignesh. Email notification was not sent; contact Vignesh directly if urgent.`);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not create ticket."); } finally { setBusy(false); }
  }
  async function download(ticket: Ticket) {
    try { const response = await apiFetch(`/api/support-tickets?attachment=${encodeURIComponent(ticket.id)}`); if (!response.ok) throw new Error("Could not download attachment."); const url = URL.createObjectURL(await response.blob()); const link = document.createElement("a"); link.href = url; link.download = ticket.attachmentName || "attachment"; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); } catch (error) { setMessage(error instanceof Error ? error.message : "Could not download attachment."); }
  }
  return <details ref={menu} className="help-menu" onToggle={(event) => { if (event.currentTarget.open) void load(); }}>
    <summary aria-label="Help">
      <span className="help-menu-icon-shell" aria-hidden="true">
        <span className="help-menu-icon">?</span>
      </span>
      <span>Help</span>
    </summary>
    <div className="help-panel"><h2>Help &amp; support</h2><p>Report an issue and it will be assigned to Vignesh.</p>
      <form onSubmit={submit}><label>Subject<input value={subject} onChange={(event) => setSubject(event.target.value)} maxLength={150} required placeholder="What went wrong?" /></label><label>Issue details<textarea value={description} onChange={(event) => setDescription(event.target.value)} maxLength={5000} required rows={4} placeholder="Describe what happened and what you expected." /></label><label>Attachment (optional)<input ref={fileInput} type="file" accept=".png,.jpg,.jpeg,.pdf,image/png,image/jpeg,application/pdf" onChange={(event) => setAttachment(event.target.files?.[0] || null)} /><small>PNG, JPG or PDF, up to 5 MB.</small></label><button type="submit" disabled={busy}>{busy ? "Creating…" : "Create ticket"}</button></form>
      {message && <p role="status">{message}</p>}
      <h3>{canManage ? "Assigned tickets" : "Your tickets"}</h3>{tickets.length ? <ul>{tickets.map((ticket) => <li key={ticket.id}><strong>{ticket.subject}</strong><small>{ticket.status} · {ticket.reporterEmail} · {new Date(ticket.createdAt).toLocaleDateString()}</small><details onToggle={(event) => setOpenTicket(event.currentTarget.open ? ticket.id : null)}><summary>View details</summary><p>{ticket.description}</p><small>Ticket ID: {ticket.ticketNumber}</small>{ticket.attachmentName && <button type="button" onClick={() => void download(ticket)}>Download {ticket.attachmentName}</button>}{canManage && <button type="button" disabled={busy} onClick={() => void changeStatus(ticket)}>{ticket.status === "Open" ? "Mark resolved" : "Reopen"}</button>}{openTicket === ticket.id && <TicketComments ticketId={ticket.id} apiFetch={apiFetch} status={ticket.status} />}</details></li>)}</ul> : <p>No tickets to show.</p>}
    </div>
  </details>;
}

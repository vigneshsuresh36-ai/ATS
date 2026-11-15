"use client";
import { useCallback, useEffect, useState } from "react";
import { TicketComments } from "./TicketComments";

type Ticket = { id: string; ticketNumber: string; subject: string; description: string; reporterName: string; reporterEmail: string; status: string; createdAt: string; attachmentName?: string | null; assignedTo: string; emailStatus: string };
export function SupportTicketsView({ apiFetch }: { apiFetch: (path: string, init?: RequestInit) => Promise<Response> }) {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"All" | "Open" | "Resolved">("All");
  const [page, setPage] = useState(1);
  const [expanded, setExpanded] = useState<string | null>(null);
  const load = useCallback(async () => {
    setLoading(true); setError("");
    try { const response = await apiFetch("/api/support-tickets?all=1"); const data = await response.json(); if (!response.ok) throw new Error(data.error || "Could not load tickets."); setTickets(data.tickets); } catch (e) { setError(e instanceof Error ? e.message : "Could not load tickets."); } finally { setLoading(false); }
  }, [apiFetch]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const close = (event: PointerEvent) => { document.querySelectorAll<HTMLDetailsElement>(".support-action-menu[open]").forEach((menu) => { if (!menu.contains(event.target as Node)) menu.open = false; }); };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") document.querySelectorAll<HTMLDetailsElement>(".support-action-menu[open]").forEach((menu) => { menu.open = false; menu.querySelector("summary")?.focus(); }); };
    document.addEventListener("pointerdown", close); document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", close); document.removeEventListener("keydown", escape); };
  }, []);
  async function change(ticket: Ticket) {
    setBusy(ticket.id); setError("");
    try { const status = ticket.status === "Open" ? "Resolved" : "Open"; const response = await apiFetch("/api/support-tickets", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: ticket.id, status }) }); const data = await response.json(); if (!response.ok) throw new Error(data.error || "Could not update ticket."); setTickets((items) => items.map((item) => item.id === ticket.id ? { ...item, status } : item)); } catch (e) { setError(e instanceof Error ? e.message : "Could not update ticket."); } finally { setBusy(null); }
  }
  async function download(ticket: Ticket) {
    try { const response = await apiFetch(`/api/support-tickets?attachment=${encodeURIComponent(ticket.id)}`); if (!response.ok) throw new Error("Could not download attachment."); const url = URL.createObjectURL(await response.blob()); const link = document.createElement("a"); link.href = url; link.download = ticket.attachmentName || "attachment"; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); } catch (e) { setError(e instanceof Error ? e.message : "Could not download attachment."); }
  }
  const openCount = tickets.filter((ticket) => ticket.status === "Open").length;
  const resolvedCount = tickets.filter((ticket) => ticket.status === "Resolved").length;
  const query = search.trim().toLowerCase();
  const visible = tickets.filter((ticket) => (filter === "All" || ticket.status === filter) && (!query || [ticket.ticketNumber, ticket.subject, ticket.description, ticket.reporterName, ticket.reporterEmail, ticket.id].some((value) => (value || "").toLowerCase().includes(query))));
  const pages = Math.max(1, Math.ceil(visible.length / 20));
  const currentPage = Math.min(page, pages);
  const pageTickets = visible.slice((currentPage - 1) * 20, currentPage * 20);
  return <section className="support-tickets-view">
    <div className="support-redesign-head"><div><h1>Support Tickets</h1><p>{tickets.length} total · {openCount} open · {resolvedCount} resolved</p></div><div className="support-ticket-tools"><input type="search" aria-label="Search tickets" placeholder="Search tickets (subject, person, or keyword)" value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} /><select aria-label="Filter tickets by status" value={filter} onChange={(event) => { setFilter(event.target.value as "All" | "Open" | "Resolved"); setPage(1); }}><option value="All">All statuses</option><option value="Open">Open</option><option value="Resolved">Resolved</option></select></div></div>
    <div className="support-ticket-board support-redesign-board">
    {error && <p role="alert" className="support-ticket-message">{error}</p>}{loading ? <p role="status" className="support-ticket-message">Loading tickets…</p> : visible.length ? <div className="support-table-scroll"><table className="support-table"><thead><tr><th>Ticket ID</th><th>Subject</th><th>Date ↓</th><th>Status</th><th>Attachment</th><th>Actions</th></tr></thead><tbody>{pageTickets.map((ticket) => <SupportTicketRows key={ticket.id} ticket={ticket} apiFetch={apiFetch} expanded={expanded === ticket.id} busy={busy === ticket.id} onDetails={() => setExpanded(expanded === ticket.id ? null : ticket.id)} onChange={() => void change(ticket)} onDownload={() => void download(ticket)} />)}</tbody></table></div> : <p className="support-ticket-message">{tickets.length ? "No tickets match your search or filter." : "No support tickets yet."}</p>}
    <nav className="support-ticket-pagination" aria-label="Ticket pages"><span>{visible.length ? (currentPage - 1) * 20 + 1 : 0}–{Math.min(currentPage * 20, visible.length)} of {visible.length}</span><div><button type="button" disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)}>‹ Previous</button><button type="button" disabled={currentPage === pages} onClick={() => setPage(currentPage + 1)}>Next ›</button></div></nav></div><small className="support-ticket-footnote">Showing up to the 100 most recent tickets. <button type="button" onClick={() => void load()}>Refresh</button></small></section>;
}

function SupportTicketRows({ ticket, apiFetch, expanded, busy, onDetails, onChange, onDownload }: { ticket: Ticket; apiFetch: (path: string, init?: RequestInit) => Promise<Response>; expanded: boolean; busy: boolean; onDetails: () => void; onChange: () => void; onDownload: () => void }) {
  return <><tr><td><span className="support-ticket-number">{ticket.ticketNumber}</span></td><td><button type="button" className="support-subject" aria-expanded={expanded} onClick={onDetails}>{ticket.subject}</button></td><td>{new Date(ticket.createdAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}</td><td><span className="support-status">{ticket.status}</span></td><td>{ticket.attachmentName ? <button type="button" className="support-attachment" onClick={onDownload}>⌁ {ticket.attachmentName}</button> : "—"}</td><td><details className="support-action-menu"><summary aria-label={`Actions for ${ticket.subject}`}>•••</summary><div><button type="button" onClick={(event) => { event.currentTarget.closest("details")?.removeAttribute("open"); onDetails(); }}>{expanded ? "Hide details" : "View details"}</button><button type="button" disabled={busy} onClick={(event) => { event.currentTarget.closest("details")?.removeAttribute("open"); onChange(); }}>{busy ? "Saving…" : ticket.status === "Open" ? "Mark resolved" : "Reopen"}</button></div></details></td></tr>{expanded && <tr className="support-expanded"><td colSpan={6} style={{ textAlign: "left", padding: "20px 24px", background: "#f7f7f6" }}><strong>Issue details</strong><p>{ticket.description}</p><small>Raised by {ticket.reporterName} · {ticket.reporterEmail} · Assigned to {ticket.assignedTo}</small><TicketComments ticketId={ticket.id} apiFetch={apiFetch} canComment status={ticket.status} statusBusy={busy} onStatusChange={onChange} /></td></tr>}</>;
}

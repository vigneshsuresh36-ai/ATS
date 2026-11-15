import { NextRequest } from "next/server";
import { ApiError, errResponse, json, requireUser } from "@/lib/auth";
import { adminStorage, requireAdminDb } from "@/lib/firebaseAdmin";

const assignee = "vignesh.s@letstransport.team";
const formatTicketNumber = (number: number) => `Ticket${String(number).padStart(3, "0")}`;

async function ensureTicketNumbers() {
  const db = requireAdminDb();
  const counter = db.collection("support_ticket_meta").doc("sequence");
  await db.runTransaction(async (tx) => {
    const state = await tx.get(counter);
    if (state.exists) return;
    const existing = await tx.get(db.collection("support_tickets").orderBy("createdAt", "asc"));
    if (existing.size > 450) throw new ApiError(503, "Existing tickets need a numbering migration before continuing.");
    let number = 0;
    for (const doc of existing.docs) { number += 1; tx.update(doc.ref, { ticketNumber: formatTicketNumber(number) }); }
    tx.create(counter, { lastNumber: number });
  });
}

export async function GET(req: NextRequest) {
  try {
    const user = await requireUser(req);
    await ensureTicketNumbers();
    const commentsId = req.nextUrl.searchParams.get("comments");
    if (commentsId) {
      if (!/^[a-zA-Z0-9]{20}$/.test(commentsId)) throw new ApiError(400, "Invalid ticket.");
      const ref = requireAdminDb().collection("support_tickets").doc(commentsId);
      const ticket = (await ref.get()).data();
      if (!ticket || (user.role !== "Admin" && ticket.reporterEmail !== user.email.toLowerCase())) throw new ApiError(404, "Ticket not found.");
      const comments = await ref.collection("comments").orderBy("createdAt", "asc").get();
      return json({ comments: comments.docs.map((item) => ({ id: item.id, ...item.data() })) });
    }
    const historyId = req.nextUrl.searchParams.get("history");
    if (historyId) {
      if (!/^[a-zA-Z0-9]{20}$/.test(historyId)) throw new ApiError(400, "Invalid ticket.");
      const ref = requireAdminDb().collection("support_tickets").doc(historyId);
      const ticket = (await ref.get()).data();
      if (!ticket || (user.role !== "Admin" && ticket.reporterEmail !== user.email.toLowerCase())) throw new ApiError(404, "Ticket not found.");
      const history = await ref.collection("status_history").orderBy("createdAt", "asc").get();
      return json({ history: history.docs.map((item) => ({ id: item.id, ...item.data() })) });
    }
    const attachmentId = req.nextUrl.searchParams.get("attachment");
    if (attachmentId) {
      if (!/^[a-zA-Z0-9]{20}$/.test(attachmentId)) throw new ApiError(400, "Invalid ticket.");
      const snapshot = await requireAdminDb().collection("support_tickets").doc(attachmentId).get();
      const ticket = snapshot.data();
      if (!ticket || (user.role !== "Admin" && ticket.reporterEmail !== user.email.toLowerCase()) || !ticket.attachmentPath) throw new ApiError(404, "Attachment not found.");
      const bucket = adminStorage()?.bucket();
      if (!bucket) throw new ApiError(503, "Attachment storage is unavailable.");
      const [data] = await bucket.file(ticket.attachmentPath).download();
      return new Response(new Uint8Array(data), { headers: { "Content-Type": "application/octet-stream", "Content-Disposition": `attachment; filename="${String(ticket.attachmentName).replace(/[^a-zA-Z0-9._-]/g, "_")}"`, "X-Content-Type-Options": "nosniff", "Cache-Control": "private, no-store" } });
    }
    const all = req.nextUrl.searchParams.get("all") === "1";
    if (all && user.role !== "Admin") throw new ApiError(403, "Admin access required.");
    const collection = requireAdminDb().collection("support_tickets");
    const snapshot = all ? await collection.orderBy("createdAt", "desc").limit(100).get() : await collection.where("reporterEmail", "==", user.email.toLowerCase()).get();
    const tickets = snapshot.docs.map((doc) => doc.data()).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    return json({ tickets, canManage: all && user.role === "Admin" });
  } catch (error) { return errResponse(error); }
}

export async function PATCH(req: NextRequest) {
  try {
    const user = await requireUser(req);
    if (user.role !== "Admin") throw new ApiError(403, "Only admins can update tickets.");
    const body = await req.json();
    if (body.action === "comment") {
      if (typeof body.id !== "string" || !/^[a-zA-Z0-9]{20}$/.test(body.id) || typeof body.comment !== "string" || !body.comment.trim() || body.comment.trim().length > 5000) throw new ApiError(400, "Enter a comment up to 5,000 characters.");
      const ref = requireAdminDb().collection("support_tickets").doc(body.id);
      if (!(await ref.get()).exists) throw new ApiError(404, "Ticket not found.");
      const comment = { text: body.comment.trim(), authorName: user.name, authorEmail: user.email.toLowerCase(), createdAt: new Date().toISOString() };
      const saved = await ref.collection("comments").add(comment);
      return json({ comment: { id: saved.id, ...comment } }, 201);
    }
    if (typeof body.id !== "string" || !/^[a-zA-Z0-9]{20}$/.test(body.id) || !["Open", "Resolved"].includes(body.status)) throw new ApiError(400, "Invalid ticket or status.");
    const ref = requireAdminDb().collection("support_tickets").doc(body.id);
    const db = requireAdminDb();
    await db.runTransaction(async (tx) => {
      const snapshot = await tx.get(ref);
      if (!snapshot.exists) throw new ApiError(404, "Ticket not found.");
      const previousStatus = snapshot.data()?.status;
      if (previousStatus === body.status) return;
      const createdAt = new Date().toISOString();
      tx.update(ref, { status: body.status, updatedAt: createdAt });
      tx.create(ref.collection("status_history").doc(), { previousStatus: previousStatus || "Unknown", status: body.status, actorName: user.name, actorEmail: user.email.toLowerCase(), createdAt });
    });
    return json({ ok: true });
  } catch (error) { return errResponse(error); }
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser(req);
    const form = await req.formData();
    const subject = String(form.get("subject") || "").trim();
    const description = String(form.get("description") || "").trim();
    if (!subject || subject.length > 150 || /[\r\n]/.test(subject) || !description || description.length > 5000) throw new ApiError(400, "Enter a subject (up to 150 characters) and issue details (up to 5,000 characters).");
    await ensureTicketNumbers();
    const db = requireAdminDb();
    const ref = db.collection("support_tickets").doc();
    const attachment = form.get("attachment");
    let attachmentPath: string | null = null;
    let attachmentName: string | null = null;
    if (attachment instanceof File && attachment.size) {
      if (attachment.size > 5 * 1024 * 1024 || !["image/png", "image/jpeg", "application/pdf"].includes(attachment.type)) throw new ApiError(400, "Attach a PNG, JPG or PDF up to 5 MB.");
      const bucket = adminStorage()?.bucket();
      if (!bucket) throw new ApiError(503, "Attachment storage is unavailable.");
      attachmentName = attachment.name.slice(0, 150).replace(/[^a-zA-Z0-9._-]/g, "_") || "attachment";
      attachmentPath = `support-tickets/${ref.id}/attachment`;
      await bucket.file(attachmentPath).save(Buffer.from(await attachment.arrayBuffer()), { contentType: "application/octet-stream", resumable: false });
    }
    const ticket = { id: ref.id, ticketNumber: "", subject, description, reporterName: user.name, reporterEmail: user.email.toLowerCase(), assignedTo: assignee, status: "Open", createdAt: new Date().toISOString(), emailStatus: "not_configured", attachmentPath, attachmentName };
    try { await db.runTransaction(async (tx) => { const counter = db.collection("support_ticket_meta").doc("sequence"); const state = await tx.get(counter); const next = Number(state.data()?.lastNumber || 0) + 1; ticket.ticketNumber = formatTicketNumber(next); tx.update(counter, { lastNumber: next }); tx.create(ref, ticket); }); } catch (error) { if (attachmentPath) await adminStorage()?.bucket().file(attachmentPath).delete({ ignoreNotFound: true }).catch(() => {}); throw error; }
    let emailStatus = ticket.emailStatus;
    if (process.env.RESEND_API_KEY && process.env.AUTOMATION_FROM_EMAIL) {
      try {
        const response = await fetch("https://api.resend.com/emails", { method: "POST", signal: AbortSignal.timeout(15000), headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json", "Idempotency-Key": `support-${ref.id}` }, body: JSON.stringify({ from: process.env.AUTOMATION_FROM_EMAIL, to: [assignee], reply_to: user.email, subject: `${ticket.ticketNumber}: ${subject}`, text: `Ticket: ${ticket.ticketNumber}\nReported by: ${user.name} (${user.email})\n\n${description}${attachmentName ? `\n\nAttachment: ${attachmentName} (available to admins in Support Tickets).` : ""}` }) });
        emailStatus = response.ok ? "sent" : "failed";
      } catch { emailStatus = "failed"; }
      await ref.update({ emailStatus }).catch(() => { /* Ticket was already saved; do not invite a duplicate submission. */ });
    }
    return json({ ticket: { ...ticket, emailStatus } }, 201);
  } catch (error) { return errResponse(error); }
}

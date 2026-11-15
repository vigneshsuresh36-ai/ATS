import { NextRequest } from "next/server";
import { ApiError, errResponse, json, requireUser } from "@/lib/auth";
import { listInterviews, listRequisitions, listUsers } from "@/lib/db";
import { requireAdminDb } from "@/lib/firebaseAdmin";
import { STATUS_AUDIT_COLLECTION, type StatusAuditEvent } from "@/lib/statusAudit";

const PAGE_SIZE = 100;

export async function GET(request: NextRequest) {
  try {
    const user = await requireUser(request);
    if (user.role !== "Admin" || user.actingAdminEmail) throw new ApiError(403, "Only signed-in administrators can review audit exports.");

    const { searchParams } = request.nextUrl;
    const from = searchParams.get("from");
    const to = searchParams.get("to");
    for (const date of [from, to]) {
      if (date && (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date)))) {
        throw new ApiError(400, "Enter valid UTC dates.");
      }
    }
    if (from && to && from > to) throw new ApiError(400, "The start date must come before the end date.");
    const type = searchParams.get("type");
    const id = searchParams.get("id")?.trim();
    const source = searchParams.get("source");
    const cursor = searchParams.get("cursor");

    const db = requireAdminDb();
    const collection = db.collection(STATUS_AUDIT_COLLECTION);
    let query = collection.orderBy("changedAt", "asc");
    if (from) query = query.where("changedAt", ">=", `${from}T00:00:00.000Z`);
    if (to) query = query.where("changedAt", "<=", `${to}T23:59:59.999Z`);
    if (cursor) {
      if (cursor.includes("/")) throw new ApiError(400, "Invalid activity cursor.");
      const previous = await collection.doc(cursor).get();
      if (!previous.exists) throw new ApiError(400, "Invalid activity cursor.");
      query = query.startAfter(previous);
    }
    const page = await query.limit(PAGE_SIZE + 1).get();
    const events = page.docs.slice(0, PAGE_SIZE).map((doc) => doc.data() as StatusAuditEvent)
      .filter((event) => (!type || event.entityType === type) && (!id || event.entityId === id) && (!source || event.source === source));

    const [requisitions, users, interviews] = await Promise.all([
      listRequisitions(), listUsers(), events.some((event) => event.entityType === "interview") ? listInterviews() : [],
    ]);
    const team = new Set(users.filter((member) => member.role === "Recruiter" && member.managerEmail === user.email).map((member) => member.email));
    const visibleReqs = new Set(requisitions.filter((record) => !record.recruiterEmail || team.has(record.recruiterEmail)).map((record) => record.id));
    const visibleInterviews = new Set(interviews.filter((record) => visibleReqs.has(record.reqId)).map((record) => record.id));
    return json({
      activity: events.filter((event) => (
        event.entityType === "requisition" && visibleReqs.has(event.entityId) ||
        event.entityType === "interview" && visibleInterviews.has(event.entityId)
      )),
      nextCursor: page.docs.length > PAGE_SIZE ? page.docs[PAGE_SIZE - 1].id : null,
    });
  } catch (error) {
    return errResponse(error);
  }
}

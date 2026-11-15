import { NextRequest } from "next/server";
import { ApiError, errResponse } from "@/lib/auth";
import { getVendorSpendRecord } from "@/lib/db";
import { adminStorage } from "@/lib/firebaseAdmin";
import { requireVendorsSpendUser } from "@/lib/vendorsSpendAccess";

export async function GET(request: NextRequest) {
  try {
    const user = await requireVendorsSpendUser(request);
    const { resource, id, field } = Object.fromEntries(request.nextUrl.searchParams.entries());
    if (!resource || !id || !field) throw new ApiError(400, "Record and attachment are required.");
    if (resource === "consultants" && field === "agreementPath" && user.role !== "Admin") throw new ApiError(403, "Commercial agreements are Admin-only.");
    if (!["consultants", "subscriptions", "invoices"].includes(resource)) throw new ApiError(400, "Invalid attachment source.");
    const record = await getVendorSpendRecord<Record<string, unknown>>(resource as "consultants" | "subscriptions" | "invoices", id);
    if (!record) throw new ApiError(404, "Record not found.");
    if (resource === "invoices" && user.role === "Recruiter" && record.createdBy !== user.email) throw new ApiError(403, "You cannot access this invoice.");
    if (!["agreementPath", "invoicePath", "attachmentPath"].includes(field)) throw new ApiError(400, "Invalid attachment field.");
    const path = String(record[field] || "");
    if (!path.startsWith("vendors-spend/")) throw new ApiError(404, "Attachment not found.");
    const bucket = adminStorage()?.bucket();
    if (!bucket) throw new ApiError(503, "File storage is not configured.");
    const [buffer] = await bucket.file(path).download();
    const fileNameKey = field.replace("Path", "FileName");
    const fileName = String(record[fileNameKey] || "vendor-document").replace(/[\r\n"]+/g, "_");
    const bytes = new Uint8Array(buffer.length);
    bytes.set(buffer);
    return new Response(bytes.buffer, { headers: { "Content-Type": "application/octet-stream", "Content-Disposition": `attachment; filename="${fileName}"` } });
  } catch (error) {
    return errResponse(error);
  }
}
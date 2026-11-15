import { NextRequest } from "next/server";
import { ApiError, errResponse, json, requireUser } from "@/lib/auth";
import { getOrg } from "@/lib/db";
import { adminStorage } from "@/lib/firebaseAdmin";

export async function POST(request: NextRequest) {
  try {
    const user = await requireUser(request);
    if (user.role !== "Admin" && user.role !== "Recruiter") throw new ApiError(403, "Only Admins and Recruiters can upload vendor documents.");
    if (!(await getOrg()).vendorsSpendEnabled) throw new ApiError(404, "Vendors & Spend is not enabled for this organization.");
    const body = await request.json();
    const fileName = String(body.fileName || "").replace(/[^\w.\- ()]+/g, "_");
    const resource = String(body.resource || "");
    const base64 = String(body.base64 || "");
    if (!fileName || !base64 || !["agreement", "invoice"].includes(resource)) throw new ApiError(400, "Choose a valid agreement or invoice file.");
    if (resource === "agreement" && user.role !== "Admin") throw new ApiError(403, "Only Admins can upload commercial agreements.");
    const bytes = Buffer.from(base64, "base64");
    if (!bytes.length || bytes.length > 10 * 1024 * 1024) throw new ApiError(400, "Vendor documents must be smaller than 10 MB.");
    const bucket = adminStorage()?.bucket();
    if (!bucket) throw new ApiError(503, "File storage is not configured.");
    const path = `vendors-spend/${resource}/${Date.now()}_${fileName}`;
    await bucket.file(path).save(bytes, { metadata: { contentType: String(body.mime || "application/octet-stream"), metadata: { uploadedBy: user.email, originalName: fileName } } });
    return json({ path, fileName });
  } catch (error) {
    return errResponse(error);
  }
}
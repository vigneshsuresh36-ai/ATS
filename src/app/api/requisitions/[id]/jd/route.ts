import { isAssignedRecruiter } from "@/lib/recruiterAssignment";
import { NextRequest } from "next/server";
import { ApiError, errResponse, requireManagedRequisitionAccess, requireUser } from "@/lib/auth";
import { getRequisition } from "@/lib/db";
import { userCoversDepartment } from "@/lib/roles";
import { createJobDescriptionPdf } from "@/lib/jobDescriptionPdf";
import { adminStorage } from "@/lib/firebaseAdmin";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, ctx: Ctx) {
  try {
    const user = await requireUser(req);
    const { id } = await ctx.params;
    const requisition = await getRequisition(id);
    if (!requisition) throw new ApiError(404, "Requisition not found.");
    await requireManagedRequisitionAccess(user, requisition);
    if (user.role === "Recruiter" && !isAssignedRecruiter(requisition, user.email)) throw new ApiError(403, "This requisition is not assigned to you.");
    if (user.role === "HiringManager" && requisition.raisedByEmail !== user.email) throw new ApiError(403, "Not your requisition.");
    if (user.role === "DepartmentHead" && !userCoversDepartment(user.departments, requisition.department)) throw new ApiError(403, "Not your department.");
    const r = requisition;

    if (req.nextUrl.searchParams.get("format") === "saved") {
      if (!["Admin", "Recruiter", "HiringManager", "DepartmentHead"].includes(user.role)) throw new ApiError(403, "Job description downloads are unavailable for this role.");
      if (!r.jdText?.trim()) throw new ApiError(404, "No saved job description is available.");
      const pdf = await createJobDescriptionPdf(r.title, r.jdText, r.jdFormatting);
      return new Response(new Uint8Array(pdf), {
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": 'attachment; filename="job-description.pdf"',
          "Cache-Control": "private, no-store",
        },
      });
    }

    if (!r.jdPath) {
      throw new ApiError(404, "No JD PDF attached to this requisition.");
    }

    const bucket = adminStorage()?.bucket();
    if (!bucket) {
      throw new ApiError(503, "File storage is not configured.");
    }

    const file = bucket.file(r.jdPath);
    const [exists] = await file.exists();
    if (!exists) {
      throw new ApiError(
        404,
        "JD file is missing in storage. Re-upload when editing is available."
      );
    }

    const [buf] = await file.download();
    const name = (r.jdFileName || "job-description.pdf").replace(
      /[^\w.\- ()]+/g,
      "_"
    );

    return new Response(new Uint8Array(buf), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${name}"`,
        "Cache-Control": "private, max-age=60",
      },
    });
  } catch (e) {
    return errResponse(e);
  }
}

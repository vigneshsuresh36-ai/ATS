import { ApiError, errResponse } from "@/lib/auth";
import { getActiveSocialApplication } from "@/lib/socialApplications";
import { adminStorage } from "@/lib/firebaseAdmin";

type Ctx = { params: Promise<{ token: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  try {
    const { token } = await ctx.params;
    const application = await getActiveSocialApplication(token);
    if (!application) throw new ApiError(404, "This application link is no longer available.");
    const { requisition } = application;
    if (!requisition.jdPath) throw new ApiError(404, "No job description file is available.");
    const bucket = adminStorage()?.bucket();
    if (!bucket) throw new ApiError(503, "File storage is not configured.");
    const file = bucket.file(requisition.jdPath);
    const [exists] = await file.exists();
    if (!exists) throw new ApiError(404, "The job description file is missing.");
    const [buffer] = await file.download();
    const name = (requisition.jdFileName || "job-description.pdf").replace(/[^\w.\- ()]+/g, "_");
    return new Response(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${name}"`,
        "Cache-Control": "public, max-age=300",
      },
    });
  } catch (error) {
    return errResponse(error);
  }
}
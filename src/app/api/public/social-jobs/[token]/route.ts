import { ApiError, errResponse, json } from "@/lib/auth";
import { getOrg } from "@/lib/db";
import { getActiveSocialApplication } from "@/lib/socialApplications";

type Ctx = { params: Promise<{ token: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  try {
    const { token } = await ctx.params;
    const application = await getActiveSocialApplication(token);
    if (!application) throw new ApiError(404, "This application link is no longer available.");
    const { requisition, link } = application;
    const org = await getOrg();
    return json({
      requisition: {
        id: requisition.id,
        title: requisition.title,
        department: requisition.department,
        location: requisition.location,
        employment: requisition.employment,
        level: requisition.level,
        ...(link.kind !== "employee-referral" || org.referralShareSalary === true ? { salaryMin: requisition.salaryMin, salaryMax: requisition.salaryMax } : {}),
        priority: requisition.priority,
        jdText: requisition.jdText,
        jdFileName: requisition.jdFileName,
        hasJdPdf: !!requisition.jdPath,
      },
      recruiterName: requisition.recruiterEmail === link.recruiterEmail
        ? requisition.recruiterEmail
        : "Talent Acquisition",
      referral: link.kind === "employee-referral"
        ? { referrerName: link.referrerName || "A teammate" }
        : null,
      company: org.shareCompanyOnSocialLinks === false ? {} : {
        name: org.company,
        logoUrl: org.logoUrl,
        story: org.story,
        foundedYear: org.foundedYear,
        websiteUrl: org.websiteUrl,
      },
    });
  } catch (error) {
    return errResponse(error);
  }
}

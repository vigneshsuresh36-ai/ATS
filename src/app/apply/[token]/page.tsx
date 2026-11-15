import type { Metadata } from "next";
import { PublicSocialApplication } from "@/components/ats/PublicSocialApplication";
import { getActiveSocialApplication } from "@/lib/socialApplications";

type PageProps = {
  params: Promise<{ token: string }>;
  searchParams?: Promise<{ step?: string }>;
};

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { token } = await params;
  const application = await getActiveSocialApplication(token);
  if (!application) {
    return {
      title: "Position unavailable | LT Recruitment Project",
      description: "This job application link is no longer available.",
    };
  }
  const { requisition } = application;
  const description = [requisition.department, requisition.location, requisition.employment]
    .filter(Boolean)
    .join(" · ");
  return {
    title: `${requisition.title} | LT Recruitment Project Careers`,
    description: description || `Apply for ${requisition.title} at LT Recruitment Project.`,
    openGraph: {
      title: `${requisition.title} | LT Recruitment Project Careers`,
      description: description || `Apply for ${requisition.title} at LT Recruitment Project.`,
      type: "website",
    },
  };
}

export default async function PublicApplicationPage({ params, searchParams }: PageProps) {
  const { token } = await params;
  const { step } = (await searchParams) || {};
  return <PublicSocialApplication token={token} view={step === "application" ? "application" : "details"} />;
}
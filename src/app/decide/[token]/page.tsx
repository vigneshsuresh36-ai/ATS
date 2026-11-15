import type { Metadata } from "next";
import { PublicDecision } from "@/components/ats/PublicDecision";

export const metadata: Metadata = {
  title: "Candidate decision | LT Recruitment Project",
  robots: { index: false, follow: false },
};

export default async function DecidePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <PublicDecision token={token} />;
}

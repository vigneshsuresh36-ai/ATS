import Link from "next/link";
import { getOrg, getOrCreateCareerLink, listRequisitions } from "@/lib/db";
import { canListOnCareersPage } from "@/lib/careers";
import "./careers.css";

export const dynamic = "force-dynamic";
export const metadata = { title: "Careers | LT Recruitment Project" };

export default async function CareersPage() {
  try {
    const [org, requisitions] = await Promise.all([getOrg(), listRequisitions()]);
    const eligible = requisitions.filter(canListOnCareersPage);
    const jobs = await Promise.all(eligible.map(async (r) => ({ requisition: r, link: await getOrCreateCareerLink(r.id, r.recruiterEmail!, r.recruiterEmail!) })));
    return <main className="careers-page"><header><div className="careers-brand">{org.company || "LT Recruitment Project"}</div><h1>Find your next opportunity.</h1><p>Explore our open positions and discover where you could make an impact.</p></header><section><div className="careers-heading"><h2>Open positions</h2><span>{jobs.length} {jobs.length === 1 ? "role" : "roles"}</span></div>{jobs.length ? <div className="careers-list">{jobs.map(({ requisition: r, link }) => <article key={r.id}><div><h3>{r.title}</h3><p>{[r.department, r.location, r.employment].filter(Boolean).join(" · ")}</p></div><Link href={`/apply/${encodeURIComponent(link!.token)}`}>View role <span aria-hidden="true">→</span></Link></article>)}</div> : <p className="careers-empty">There are no open positions listed right now. Please check back later.</p>}</section></main>;
  } catch {
    return <main className="careers-page"><header><h1>Careers</h1><p>We can’t load open positions right now. Please try again later.</p></header></main>;
  }
}

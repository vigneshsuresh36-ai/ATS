"use client";

import { IndianCityPicker } from "./IndianCityPicker";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import Image from "next/image";
import { formatSalaryRange } from "@/lib/salaryFormat";
import { renderInlineFormatting } from "@/lib/inlineFormatting";

type PublicJob = {
  id: string;
  title: string;
  department: string;
  location: string;
  employment: string;
  level: string;
  salaryMin?: number;
  salaryMax?: number;
  priority: string;
  jdText: string;
  jdFileName?: string;
  hasJdPdf: boolean;
};

type PublicCompany = {
  name: string;
  logoUrl?: string;
  story?: string;
  foundedYear?: number;
  websiteUrl?: string;
};

type ReferralInfo = { referrerName: string } | null;

function readAsBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(`Could not read ${file.name}.`));
    reader.onload = () => {
      const raw = String(reader.result || "");
      resolve(raw.includes(",") ? raw.split(",")[1] : raw);
    };
    reader.readAsDataURL(file);
  });
}

export function PublicSocialApplication({ token, view = "details" }: { token: string; view?: "details" | "application" }) {
  const [job, setJob] = useState<PublicJob | null>(null);
  const [company, setCompany] = useState<PublicCompany>({ name: "Talent Acquisition" });
  const [referral, setReferral] = useState<ReferralInfo>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [location, setLocation] = useState("");
  const [currentFixedCtc, setCurrentFixedCtc] = useState("");
  const [currentVariableCtc, setCurrentVariableCtc] = useState("");
  const [presentEsops, setPresentEsops] = useState("0");
  const [expectedCtc, setExpectedCtc] = useState("");
  const [experienceYears, setExperienceYears] = useState("");
  const [notice, setNotice] = useState("");
  const [resume, setResume] = useState<File | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/public/social-jobs/${encodeURIComponent(token)}`, { cache: "no-store" })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "This application link is unavailable.");
        if (!cancelled) {
          setJob(data.requisition as PublicJob);
          setCompany(data.company || { name: "Talent Acquisition" });
          setReferral(data.referral || null);
        }
      })
      .catch((error) => {
        if (!cancelled) setLoadError(error instanceof Error ? error.message : "Could not load this position.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [token]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!location) {
      setMessage("Choose a city from the location suggestions.");
      return;
    }
    if (!resume) {
      setMessage("Attach your resume before submitting.");
      return;
    }
    if (resume.size > 10 * 1024 * 1024) {
      setMessage("Resume must be smaller than 10 MB.");
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(`/api/public/social-jobs/${encodeURIComponent(token)}/applications`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          email,
          phone,
          location,
          currentFixedCtc,
          currentVariableCtc,
          presentEsops,
          expectedCtc,
          experienceYears,
          notice,
          cvBase64: await readAsBase64(resume),
          cvFileName: resume.name,
          cvMime: resume.type,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not submit application.");
      setMessage(referral
        ? "Your application has been submitted. The recruiting team and your referrer will be able to follow its progress."
        : "Your application has been submitted. The recruiter will review it shortly.");
      setName("");
      setEmail("");
      setPhone("");
      setLocation("");
      setCurrentFixedCtc("");
      setCurrentVariableCtc("");
      setPresentEsops("0");
      setExpectedCtc("");
      setExperienceYears("");
      setNotice("");
      setResume(null);
      const fileInput = document.getElementById("social-application-resume") as HTMLInputElement | null;
      if (fileInput) fileInput.value = "";
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not submit application.");
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <main className="ats-public-page"><div className="ats-public-status">Loading position…</div></main>;
  if (!job) return <main className="ats-public-page"><div className="ats-public-status"><strong>Application link unavailable</strong><span>{loadError || "This position may be closed."}</span></div></main>;
  const companyName = company.name || "Talent Acquisition";

  return (
    <main className="ats-public-page">
      <header className="ats-public-header">
        {company.name && <Link className="ats-public-brand" href="/" aria-label={`${companyName} home`}>
          {company.logoUrl ? (
            <Image src={company.logoUrl} alt="" width={200} height={76} unoptimized style={{ width: 200, height: 76, objectFit: "contain" }} />
          ) : <span>{companyName.split(/\s+/).slice(0, 2).map((word) => word[0]).join("").toUpperCase()}</span>}
        </Link>}
        <span>Careers</span>
      </header>
      <div className={`ats-public-content ${view === "details" ? "ats-public-details" : "ats-public-application-view"}`}>
        {view === "details" ? (
        <section className="ats-public-job">
          {company.name && <p className="ats-public-company-name">{companyName}</p>}
          <span className="ats-public-eyebrow">{referral ? "Employee referral" : "Open position"}</span>
          <h1>{job.title}</h1>
          {referral && <p className="ats-public-referral-note">Shared by {referral.referrerName}</p>}
          <p className="ats-public-department">{job.department}</p>
          <div className="ats-public-job-facts">
            <span>{job.location || "Location not specified"}</span>
            <span>{job.employment || "Full-time"}</span>
            <span>{job.level || "Experience not specified"}</span>
            {job.salaryMin !== undefined && job.salaryMax !== undefined && <span>{formatSalaryRange(job.salaryMin, job.salaryMax)}</span>}
            {job.priority && <span>Joining: {job.priority}</span>}
          </div>
          {(company.story || company.foundedYear || company.websiteUrl) && (
            <section className="ats-public-description">
              <h2>About {companyName}</h2>
              {company.foundedYear && <div>Started in {company.foundedYear}</div>}
              {company.story && <div>{renderInlineFormatting(company.story)}</div>}
              {company.websiteUrl && <a href={company.websiteUrl} target="_blank" rel="noreferrer">Visit {companyName}</a>}
            </section>
          )}
          {job.hasJdPdf && <div className="ats-public-job-actions"><a className="ats-public-jd-link" href={`/api/public/social-jobs/${encodeURIComponent(token)}/jd`} target="_blank" rel="noreferrer">View job description PDF</a></div>}
          {job.jdText && <section className="ats-public-description"><h2>Role details</h2><div>{job.jdText}</div></section>}
          <div className="ats-public-apply-action">
            <Link className="ats-public-apply-button" href={`/apply/${encodeURIComponent(token)}?step=application`}>Apply Now</Link>
          </div>
        </section>
        ) : (
        <section className="ats-public-form-section" id="apply">
          <Link className="ats-public-back-link" href={`/apply/${encodeURIComponent(token)}`}>Back to job details</Link>
          <div className="ats-public-form-heading"><div><span className="ats-public-eyebrow">Candidate application</span><h2>Apply to {job.title}</h2></div><span className="ats-public-required">* Required</span></div>
          {message && <div className={`ats-public-message${message.startsWith("Your application") ? " is-success" : ""}`} role="status">{message}</div>}
          <form className="ats-public-form" onSubmit={submit}>
            <div className="ats-public-field-grid">
              <label>Full name *<input required autoComplete="name" value={name} onChange={(event) => setName(event.target.value)} /></label>
              <label>Email *<input required type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} /></label>
              <label>Mobile number *<input required type="tel" inputMode="numeric" autoComplete="tel" maxLength={10} value={phone} onChange={(event) => setPhone(event.target.value.replace(/\D/g, "").slice(0, 10))} /></label>
              <div className="ats-public-city-field">
                <label htmlFor="social-application-city">Current location *</label>
                <IndianCityPicker id="social-application-city" value={location} onChange={setLocation} />
              </div>
              <label>Present fixed CTC *<input required inputMode="numeric" value={currentFixedCtc} onChange={(event) => setCurrentFixedCtc(event.target.value.replace(/\D/g, ""))} /></label>
              <label>Present variable CTC *<input required inputMode="numeric" value={currentVariableCtc} onChange={(event) => setCurrentVariableCtc(event.target.value.replace(/\D/g, ""))} /></label>
              <label>Present ESOPs *<input required inputMode="numeric" value={presentEsops} onChange={(event) => setPresentEsops(event.target.value.replace(/\D/g, ""))} /></label>
              <label>Expected CTC *<input required inputMode="numeric" value={expectedCtc} onChange={(event) => setExpectedCtc(event.target.value.replace(/\D/g, ""))} /></label>
              <label>Experience in years<input type="number" min="0" max="60" value={experienceYears} onChange={(event) => setExperienceYears(event.target.value)} /></label>
              <label>Notice period in days *<input required inputMode="numeric" maxLength={2} value={notice} onChange={(event) => setNotice(event.target.value.replace(/\D/g, "").slice(0, 2))} /></label>
            </div>
            <label className="ats-public-resume">Resume *<input id="social-application-resume" type="file" required accept=".pdf,.doc,.docx,.txt,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain" onChange={(event) => setResume(event.target.files?.[0] || null)} /><span>PDF, DOC, DOCX or TXT · up to 10 MB</span></label>
            <button className="ats-public-submit" type="submit" disabled={busy}>{busy ? "Submitting…" : "Submit application"}</button>
            <p className="ats-public-privacy">Your application will be reviewed by the recruiter responsible for this position.</p>
          </form>
        </section>
        )}
      </div>
      <footer className="ats-public-footer">{companyName} · Careers</footer>
    </main>
  );
}

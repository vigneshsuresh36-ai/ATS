"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { formatSalaryRange } from "@/lib/salaryFormat";

type ReferralRole = {
  id: string;
  title: string;
  department: string;
  location: string;
  employment: string;
  level: string;
  openings: number;
  salaryMin?: number;
  salaryMax?: number;
  jdText: string;
  referralBonus: number;
  referralInterviewBonus: number;
};

type ReferralHistoryItem = { stage: string; at: string };
type InterviewPayout = { id: string; roundIndex: number; roundName: string; amount: number; status: "Pending" | "Overdue" | "Paid"; earnedAt: string; paidAt?: string };
type JoiningPayout = { id: string; amount: number; status: "Pending" | "Overdue" | "Paid"; joiningDate: string; dueAt: string; paidAt?: string };

type ReferralRecord = {
  id: string;
  name: string;
  stage: string;
  createdAt: string;
  reqId: string;
  requisitionTitle: string;
  location: string;
  referralBonus: number;
  bonusEarned: boolean;
  joiningPayout?: JoiningPayout;
  interviewPayouts: InterviewPayout[];
  history: ReferralHistoryItem[];
};

type LeaderboardEntry = { email: string; name: string; referralCount: number; bonusEarned: number };

const REFERRAL_STAGES = ["Submitted", "Screened", "Shortlist", "Interview", "Selected", "Offer stage"];

function referralStageIndex(stage: string) {
  return REFERRAL_STAGES.indexOf(stage);
}

function formatMoney(value: number) {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(value || 0);
}

function formatDate(value: string) {
  if (!value) return "Recently";
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(new Date(value));
}

export function EmployeeReferralsView({
  apiFetch,
  company,
  employeeName,
  employeeEmail,
  section,
  onSectionChange,
}: {
  apiFetch: (path: string, init?: RequestInit) => Promise<Response>;
  company: string;
  employeeName: string;
  employeeEmail: string;
  section: "leaderboard" | "roles" | "referrals";
  onSectionChange: (section: "leaderboard" | "roles" | "referrals") => void;
}) {
  const [roles, setRoles] = useState<ReferralRole[]>([]);
  const [referrals, setReferrals] = useState<ReferralRecord[]>([]);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [instagramMessage, setInstagramMessage] = useState("");
  const [query, setQuery] = useState("");
  const [department, setDepartment] = useState("All");
  const [shareRole, setShareRole] = useState<ReferralRole | null>(null);
  const [shareUrl, setShareUrl] = useState("");
  const [shareBusy, setShareBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [shareError, setShareError] = useState("");

  useEffect(() => {
    let cancelled = false;
    apiFetch("/api/referrals")
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Could not load referrals.");
        if (!cancelled) {
          setRoles(data.openRoles || []);
          setReferrals(data.referrals || []);
          setLeaderboard(data.leaderboard || []);
        }
      })
      .catch((cause) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : "Could not load referrals.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [apiFetch]);

  const departments = useMemo(() => ["All", ...new Set(roles.map((role) => role.department).filter(Boolean))], [roles]);
  const filteredRoles = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return roles.filter((role) =>
      (department === "All" || role.department === department) &&
      (!normalizedQuery || `${role.title} ${role.department} ${role.location}`.toLowerCase().includes(normalizedQuery))
    );
  }, [department, query, roles]);
  const activeReferrals = referrals.filter((referral) => referral.stage !== "Not selected");
  const earnedTotal = referrals.reduce((sum, referral) =>
    sum + (referral.bonusEarned ? referral.referralBonus : 0) + referral.interviewPayouts.reduce((roundSum, payout) => roundSum + payout.amount, 0), 0);

  const shareText = shareRole && shareUrl
    ? `Hi! ${company} is hiring a ${shareRole.title} in ${shareRole.location || "a flexible location"}. I think you'd be a great fit, and I'm happy to refer you. Details and a quick apply form are here: ${shareUrl}`
    : "";

  async function openShare(role: ReferralRole) {
    setShareBusy(true);
    setShareError("");
    setCopied(false);
    setShareUrl("");
    setInstagramMessage("");
    setShareRole(role);
    try {
      const response = await apiFetch("/api/referrals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reqId: role.id }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not create a referral link.");
      setShareUrl(new URL(`/apply/${encodeURIComponent(data.token)}`, window.location.origin).toString());
    } catch (cause) {
      setShareError(cause instanceof Error ? cause.message : "Could not create a referral link.");
    } finally {
      setShareBusy(false);
    }
  }

  async function copyLink() {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
    } catch {
      setShareError("Clipboard access is unavailable. Select and copy the link instead.");
    }
  }

  async function shareToInstagram() {
    if (!shareText) return;
    setInstagramMessage("");
    try {
      if (navigator.share) {
        await navigator.share({ title: shareRole?.title, text: shareText, url: shareUrl });
        return;
      }
      await navigator.clipboard.writeText(shareText);
      setInstagramMessage("Message copied. Paste it into Instagram to share.");
    } catch (cause) {
      if (cause instanceof Error && cause.name === "AbortError") return;
      setInstagramMessage("Copy the referral message and paste it into Instagram to share.");
    }
  }

  const roleSummary = (role: ReferralRole) => {
    const description = role.jdText.replace(/\s+/g, " ").trim();
    return description.length > 180 ? `${description.slice(0, 177)}…` : description;
  };

  return (
    <section className="hb-referrals">
      <header className="hb-referrals-heading">
        <div>
          <span className="hb-referrals-eyebrow">{company.toUpperCase()} · EMPLOYEE REFERRALS</span>
          <h2>Good people know good people.</h2>
          <p>Share an open role with someone you trust, then follow their journey here.</p>
        </div>
        <span className="hb-referrals-greeting"><span className="hb-referrals-avatar">{employeeName.trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase()}</span> {employeeName}</span>
      </header>

      <div className="hb-referral-stats" aria-label="Your referral summary">
        <div><strong>{referrals.length}</strong><span>Referrals made</span></div>
        <div><strong>{activeReferrals.length}</strong><span>In progress</span></div>
        <div><strong>{formatMoney(earnedTotal)}</strong><span>Bonus earned</span></div>
      </div>

      {section === "leaderboard" ? (
        <div className="hb-referral-rankings">
          <section className="hb-referral-ranking">
            <div className="hb-ranking-heading"><span>01</span><div><h3>Most referrals</h3><p>Teammates bringing great people into the pipeline.</p></div></div>
            {loading ? <div className="hb-ranking-empty">Loading leaderboard…</div> : leaderboard.some((entry) => entry.referralCount > 0) ? leaderboard.filter((entry) => entry.referralCount > 0).slice(0, 10).map((entry, index) => <div className={`hb-ranking-row${entry.email.toLowerCase() === employeeEmail.toLowerCase() ? " is-you" : ""}`} key={`count-${entry.email}`}><span className="hb-ranking-place">{String(index + 1).padStart(2, "0")}</span><span className="hb-ranking-name">{entry.name}{entry.email.toLowerCase() === employeeEmail.toLowerCase() && <small>You</small>}</span><strong>{entry.referralCount}<small>{entry.referralCount === 1 ? "referral" : "referrals"}</small></strong></div>) : <div className="hb-ranking-empty">No referrals submitted yet. Be the first to share a role.</div>}
          </section>
          <section className="hb-referral-ranking">
            <div className="hb-ranking-heading"><span>02</span><div><h3>Top bonus earned</h3><p>Includes completed interview rounds and joined candidates.</p></div></div>
            {loading ? <div className="hb-ranking-empty">Loading leaderboard…</div> : leaderboard.some((entry) => entry.bonusEarned > 0) ? [...leaderboard].filter((entry) => entry.bonusEarned > 0).sort((a, b) => b.bonusEarned - a.bonusEarned || b.referralCount - a.referralCount).slice(0, 10).map((entry, index) => <div className={`hb-ranking-row${entry.email.toLowerCase() === employeeEmail.toLowerCase() ? " is-you" : ""}`} key={`bonus-${entry.email}`}><span className="hb-ranking-place">{String(index + 1).padStart(2, "0")}</span><span className="hb-ranking-name">{entry.name}{entry.email.toLowerCase() === employeeEmail.toLowerCase() && <small>You</small>}</span><strong>{formatMoney(entry.bonusEarned)}</strong></div>) : <div className="hb-ranking-empty">Bonuses appear here when a candidate clears a round or joins.</div>}
          </section>
        </div>
      ) : section === "roles" ? (
        <>
          <div className="hb-referral-toolbar">
            <input type="search" aria-label="Search roles" placeholder="Search by role, city or team" value={query} onChange={(event) => setQuery(event.target.value)} />
            <div className="hb-referral-departments" role="group" aria-label="Filter roles by department">
              {departments.map((item) => <button key={item} type="button" aria-pressed={department === item} onClick={() => setDepartment(item)}>{item}</button>)}
            </div>
          </div>
          {loading ? <div className="hb-referral-empty">Loading open roles…</div> : error ? <div className="hb-referral-empty is-error" role="alert">{error}</div> : filteredRoles.length ? (
            <div className="hb-role-list">
              {filteredRoles.map((role) => (
                <article className="hb-role" key={role.id}>
                  <div className="hb-role-main">
                    <span className="hb-role-dept">{role.department} <span aria-hidden="true">/</span> {role.id}</span>
                    <h3>{role.title}</h3>
                    <ul className="hb-role-facts">
                      <li>{role.location || "Location flexible"}</li>
                      <li>{role.employment || "Full-time"}</li>
                      <li>{role.level || "Experience flexible"}</li>
                      {role.salaryMin !== undefined && role.salaryMax !== undefined && <li>{formatSalaryRange(role.salaryMin, role.salaryMax)}</li>}
                    </ul>
                    {roleSummary(role) && <p className="hb-role-summary">{roleSummary(role)}</p>}
                  </div>
                  <div className="hb-role-side">
                    <span className="hb-role-openings"><strong>{role.openings}</strong> {role.openings === 1 ? "opening" : "openings"}</span>
                    {role.referralBonus > 0 && <span className="hb-role-bonus">{formatMoney(role.referralBonus)} after joining</span>}
                    {role.referralInterviewBonus > 0 && <span className="hb-role-bonus">{formatMoney(role.referralInterviewBonus)} per cleared interview round</span>}
                    <button type="button" className="hb-referral-button" onClick={() => void openShare(role)}><span aria-hidden="true">↗</span> Refer someone</button>
                  </div>
                </article>
              ))}
            </div>
          ) : <div className="hb-referral-empty">No open roles match. Try another search or department.</div>}
        </>
      ) : (
        <div className="hb-referral-tracker">
          {loading ? <div className="hb-referral-empty">Loading your referrals…</div> : error ? <div className="hb-referral-empty is-error" role="alert">{error}</div> : referrals.length ? referrals.map((referral) => {
            const rejected = referral.stage === "Not selected";
            const stageIndex = referralStageIndex(referral.stage);
            const progress = Math.max(0, stageIndex) / (REFERRAL_STAGES.length - 1);
            return (
              <article className="hb-referral-record" key={referral.id}>
                <div className="hb-referral-record-head">
                  <div><h3>{referral.name}</h3><p>{referral.requisitionTitle} <span>·</span> {referral.location || "Location flexible"}</p></div>
                  <time dateTime={referral.createdAt}>{formatDate(referral.createdAt)}</time>
                </div>
                <ol className={`hb-referral-trail${rejected ? " is-rejected" : ""}`} style={{ "--referral-progress": `${Math.round(progress * 86)}%` } as CSSProperties} aria-label={`Current stage: ${referral.stage}`}>
                  {REFERRAL_STAGES.map((stage, index) => <li key={stage} className={`${index < stageIndex ? "is-done" : ""}${index === stageIndex ? " is-current" : ""}`}><span className="hb-trail-node"/><span>{stage}</span></li>)}
                </ol>
                <p className={`hb-referral-stage${rejected ? " is-rejected" : ""}`}>
                  {rejected ? "Not moving forward" : `Current stage: ${referral.stage}`}
                  {referral.bonusEarned && referral.referralBonus > 0 && <strong>Joining bonus earned: {formatMoney(referral.referralBonus)}</strong>}
                  {!referral.bonusEarned && referral.stage === "Offer stage" && referral.referralBonus > 0 && <strong>Joining bonus after Date of Joining: {formatMoney(referral.referralBonus)}</strong>}
                </p>
                {referral.joiningPayout && <ul className="hb-referral-payout-list" aria-label="Joining bonus record"><li><span><strong>Joining bonus</strong><small>Date of Joining: {formatDate(referral.joiningPayout.joiningDate)} · Due: {formatDate(referral.joiningPayout.dueAt)}</small></span><span><strong>{formatMoney(referral.joiningPayout.amount)}</strong><small className={`is-${referral.joiningPayout.status.toLowerCase()}`}>{referral.joiningPayout.status}</small></span></li></ul>}
                {referral.interviewPayouts.length > 0 && <ul className="hb-referral-payout-list" aria-label="Interview round bonuses">{referral.interviewPayouts.map((payout) => <li key={payout.id}><span><strong>{payout.roundName} bonus</strong><small>Earned {formatDate(payout.earnedAt)}</small></span><span><strong>{formatMoney(payout.amount)}</strong><small className={payout.status === "Paid" ? "is-paid" : "is-pending"}>{payout.status}</small></span></li>)}</ul>}
                <ol className="hb-referral-activity" aria-label="Referral activity">
                  {referral.history.map((item, index) => <li key={`${item.stage}-${item.at}-${index}`}><span className="hb-referral-activity-dot"/><div><strong>{item.stage}</strong><time dateTime={item.at}>{formatDate(item.at)}</time></div></li>)}
                </ol>
              </article>
            );
          }) : <div className="hb-referral-empty"><strong>Your referral trail starts here.</strong><span>Share an open role with a great candidate to see their progress.</span><button type="button" className="hb-referral-button" onClick={() => onSectionChange("roles")}>Browse open roles</button></div>}
        </div>
      )}

      {shareRole && (
        <div className="hb-share-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setShareRole(null); }}>
          <section className="hb-share-dialog" role="dialog" aria-modal="true" aria-labelledby="hb-share-title">
            <button type="button" className="hb-share-close" aria-label="Close share dialog" onClick={() => setShareRole(null)}>×</button>
            <span className="hb-referrals-eyebrow">YOUR PERSONAL REFERRAL LINK</span>
            <h3 id="hb-share-title">Share {shareRole.title}</h3>
            <p>This link credits the application to you and lets you follow its progress.</p>
            <label className="hb-share-link-label">Referral link<input readOnly value={shareBusy ? "Creating your link…" : shareUrl} onFocus={(event) => event.currentTarget.select()} /></label>
            {shareError && <p className="hb-share-error" role="alert">{shareError}</p>}
            <div className="hb-share-actions">
              <button type="button" className="hb-referral-button" disabled={!shareUrl} onClick={() => void copyLink()}>{copied ? "Copied" : "Copy link"}</button>
              <a className="hb-share-secondary" aria-disabled={!shareUrl} href={shareUrl ? `https://wa.me/?text=${encodeURIComponent(shareText)}` : undefined} target="_blank" rel="noreferrer">WhatsApp</a>
              <a className="hb-share-secondary" aria-disabled={!shareUrl} href={shareUrl ? `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(shareUrl)}` : undefined} target="_blank" rel="noreferrer">LinkedIn</a>
              <button type="button" className="hb-share-secondary" disabled={!shareUrl} onClick={() => void shareToInstagram()}>Instagram</button>
              <a className="hb-share-secondary" aria-disabled={!shareUrl} href={shareUrl ? `mailto:?subject=${encodeURIComponent(`${company} is hiring: ${shareRole.title}`)}&body=${encodeURIComponent(shareText)}` : undefined}>Gmail</a>
            </div>
            {instagramMessage && <p className="hb-share-channel-note" role="status">{instagramMessage}</p>}
          </section>
        </div>
      )}
    </section>
  );
}

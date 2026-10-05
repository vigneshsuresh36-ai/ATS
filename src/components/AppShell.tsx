"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { AuthBootScreen, useAuth } from "@/components/AuthProvider";
import { formatDate } from "@/lib/dateFormat";
import { DEPARTMENTS } from "@/lib/roles";
import { ini } from "@/components/ats/ui";
import type {
  AppUser,
  ApprovalStatus,
  Candidate,
  Requisition,
  Role,
} from "@/lib/types";

const TodayView = dynamic(
  () => import("@/components/ats/TodayView").then((m) => m.TodayView),
  { ssr: false }
);
const ReqBoard = dynamic(
  () => import("@/components/ats/ReqBoard").then((m) => m.ReqBoard),
  { ssr: false }
);
const ApprovalsView = dynamic(
  () => import("@/components/ats/ApprovalsView").then((m) => m.ApprovalsView),
  { ssr: false }
);
const ScheduleView = dynamic(
  () => import("@/components/ats/ScheduleView").then((m) => m.ScheduleView),
  { ssr: false }
);
const AnalyticsView = dynamic(
  () => import("@/components/ats/AnalyticsView").then((m) => m.AnalyticsView),
  { ssr: false }
);
const RecruiterDashboard = dynamic(
  () => import("@/components/ats/RecruiterDashboard").then((m) => m.RecruiterDashboard),
  { ssr: false }
);
const DepartmentHeadDashboard = dynamic(
  () => import("@/components/ats/DepartmentHeadDashboard").then((m) => m.DepartmentHeadDashboard),
  { ssr: false }
);
const HiringManagerDashboard = dynamic(
  () => import("@/components/ats/HiringManagerDashboard").then((m) => m.HiringManagerDashboard),
  { ssr: false }
);
const TeamView = dynamic(
  () => import("@/components/ats/TeamView").then((m) => m.TeamView),
  { ssr: false }
);

type Tab =
  | "requisitions"
  | "approvals"
  | "schedule"
  | "dashboard"
  | "team";

export default function AppShell() {
  const { profile, loading, token, apiFetch, signOut, error, actingAsEmail, startActingAs, stopActingAs } = useAuth();
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("dashboard");
  const [orgName, setOrgName] = useState("Talent Acquisition");
  const [overlay, setOverlay] = useState(false);
  const [panel, setPanel] = useState<ReactNode>(null);
  const [today, setToday] = useState<Record<string, unknown> | null>(null);
  const [reqs, setReqs] = useState<Requisition[]>([]);
  const [approvals, setApprovals] = useState<Requisition[]>([]);
  const [offerApprovals, setOfferApprovals] = useState<
    { candidate: Candidate; requisition: Requisition | null }[]
  >([]);
  const [analytics, setAnalytics] = useState<Record<string, unknown> | null>(
    null
  );
  const [team, setTeam] = useState<AppUser[]>([]);
  const [searchQ, setSearchQ] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [schedulePrefill, setSchedulePrefill] = useState<{
    reqId: string;
    candidateId: string;
    roundIndex: number;
  } | null>(null);

  const role = profile?.role as Role | undefined;

  const updateReqStatus = useCallback(
    async (id: string, status: ApprovalStatus) => {
      const response = await apiFetch(`/api/requisitions/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not update status.");
      const updated = data.requisition as Requisition;
      setReqs((current) =>
        current.map((req) => (req.id === updated.id ? updated : req))
      );
      setMsg(`Status updated to ${status}.`);
      return updated;
    },
    [apiFetch]
  );

  useEffect(() => {
    if (!loading && (!token || !profile)) router.replace("/login");
  }, [loading, token, profile, router]);

  const loadToday = useCallback(async () => {
    const r = await apiFetch("/api/today");
    const d = await r.json();
    if (r.ok) setToday(d);
  }, [apiFetch]);

  const loadReqs = useCallback(async () => {
    const r = await apiFetch("/api/requisitions");
    const d = await r.json();
    if (r.ok) setReqs(d.requisitions || []);
  }, [apiFetch]);

  const loadApprovals = useCallback(async () => {
    const r = await apiFetch("/api/approvals");
    const d = await r.json();
    if (r.ok) {
      setApprovals(d.requisitions || []);
      setOfferApprovals(d.offerApprovals || []);
    }
  }, [apiFetch]);

  const loadAnalytics = useCallback(async () => {
    const r = await apiFetch("/api/analytics");
    const d = await r.json();
    if (r.ok) setAnalytics(d);
  }, [apiFetch]);

  const loadTeam = useCallback(async () => {
    const r = await apiFetch("/api/team");
    const d = await r.json();
    if (r.ok) setTeam(d.users || []);
  }, [apiFetch]);

  useEffect(() => {
    if (!profile) return;
    apiFetch("/api/org")
      .then((r) => r.json())
      .then((d) => {
        const company = String(d.org?.company || "").trim();
        // Product brand is Talent Acquisition; ignore legacy org names.
        if (company && !/letstransport/i.test(company)) {
          setOrgName(company);
        } else {
          setOrgName("Talent Acquisition");
        }
      });
    if (role === "DepartmentHead") setTab("dashboard");
    else if (role === "HiringManager") setTab("dashboard");
    else if (role === "Recruiter") setTab("dashboard");
    else setTab("dashboard");
  }, [profile, apiFetch, role]);

  useEffect(() => {
    if (!profile) return;
    if (tab === "dashboard") {
      loadToday();
      loadAnalytics();
      loadReqs();
      if (role === "Recruiter" || role === "DepartmentHead" || role === "HiringManager") loadApprovals();
      if (role === "Admin") {
        loadTeam();
        loadApprovals();
      }
    }
    if (tab === "requisitions") loadReqs();
    if (tab === "approvals") loadApprovals();
    if (tab === "team") loadTeam();
    if (tab === "schedule") {
      loadReqs();
      loadToday();
    }
  }, [
    tab,
    profile,
    loadToday,
    loadReqs,
    loadApprovals,
    loadAnalytics,
    loadTeam,
    role,
  ]);

  const tabs = useMemo(() => {
    const all: { id: Tab; label: string; show: boolean }[] = [
      { id: "dashboard", label: "Dashboard", show: true },
      { id: "requisitions", label: "Requisitions", show: true },
      { id: "schedule", label: "Interview", show: true },
      { id: "approvals", label: "Approvals", show: true },
      { id: "team", label: "Teams", show: true },
    ];
    return all.filter((t) => t.show);
  }, []);

  function openModal(node: ReactNode) {
    setPanel(node);
    setOverlay(true);
  }
  function closeModal() {
    setOverlay(false);
    setPanel(null);
  }

  async function openCandidate(id: string) {
    const [{ CandidatePanel }, r] = await Promise.all([
      import("@/components/ats/CandidatePanel"),
      apiFetch(`/api/candidates/${id}`),
    ]);
    const d = await r.json();
    if (!r.ok) {
      setMsg(d.error);
      return;
    }
    const cand = d.candidate as { reqId: string };
    const reqMeta = reqs.find((x) => x.id === cand.reqId);
    const isHmOwner =
      !!profile?.email &&
      !!reqMeta &&
      reqMeta.raisedByEmail === profile.email.toLowerCase();
    // If req not in list, fetch for ownership check
    let hmOwner = isHmOwner;
    if (!reqMeta && role === "HiringManager") {
      const rr = await apiFetch(`/api/requisitions/${cand.reqId}`);
      const rd = await rr.json();
      if (rr.ok) {
        hmOwner =
          rd.requisition.raisedByEmail === profile!.email.toLowerCase();
      }
    }
    openModal(
      <CandidatePanel
        data={d}
        role={role!}
        isHmOwner={hmOwner || role === "Admin"}
        onClose={closeModal}
        apiFetch={apiFetch}
        onRefresh={() => openCandidate(id)}
        onScheduleRound={(roundIndex) => {
          closeModal();
          setSchedulePrefill({
            reqId: cand.reqId,
            candidateId: id,
            roundIndex,
          });
          setTab("schedule");
        }}
      />
    );
  }

  async function openPipeline(reqId: string) {
    const [{ PipelinePanel }, rr, cr, ir, pr] = await Promise.all([
      import("@/components/ats/PipelinePanel"),
      apiFetch(`/api/requisitions/${reqId}`),
      apiFetch(`/api/candidates?reqId=${reqId}`),
      apiFetch(`/api/schedule?reqId=${reqId}`),
      apiFetch(`/api/requisitions/${reqId}/plan`),
    ]);
    const rd = await rr.json();
    const cd = await cr.json();
    const idata = await ir.json();
    const pdata = await pr.json();
    if (!rr.ok) {
      setMsg(rd.error || "Failed to load requisition.");
      return;
    }
    openModal(
      <PipelinePanel
        req={rd.requisition}
        candidates={cd.candidates || []}
        interviews={idata.interviews || []}
        plan={pdata.plan || null}
        recruiters={team.filter((member) => member.role === "Recruiter" && member.managerEmail === profile?.email?.toLowerCase())}
        role={role!}
        profileEmail={profile?.email}
        onClose={closeModal}
        apiFetch={apiFetch}
        onRefresh={() => openPipeline(reqId)}
        onCand={openCandidate}
        onAddCandidate={() => openAddCandidate(reqId, rd.requisition.title)}
        onScheduleCandidate={(candidateId, roundIndex) => {
          closeModal();
          setSchedulePrefill({ reqId, candidateId, roundIndex });
          setTab("schedule");
        }}
      />
    );
  }

  async function openAddCandidate(reqId: string, reqTitle: string) {
    const { AddCandidateModal } = await import(
      "@/components/ats/AddCandidateModal"
    );
    openModal(
      <AddCandidateModal
        reqId={reqId}
        reqTitle={reqTitle}
        apiFetch={apiFetch}
        onClose={closeModal}
        onBack={() => openPipeline(reqId)}
        onSaved={() => {
          setMsg("Candidate added.");
          openPipeline(reqId);
        }}
      />
    );
  }

  async function doSearch() {
    if (searchQ.trim().length < 2) return;
    const [{ SearchPanel }, r] = await Promise.all([
      import("@/components/ats/SearchPanel"),
      apiFetch(`/api/search?q=${encodeURIComponent(searchQ)}`),
    ]);
    const d = await r.json();
    if (r.ok) {
      openModal(
        <SearchPanel
          data={d}
          onClose={closeModal}
          onReq={(id) => {
            closeModal();
            openPipeline(id);
          }}
          onCand={(id) => {
            closeModal();
            openCandidate(id);
          }}
        />
      );
    }
  }

  async function openNewReq() {
    const { NewReqForm } = await import("@/components/ats/NewReqForm");
    openModal(
      <NewReqForm
        raisedBy={`${profile?.name} · ${profile?.email}`}
        allowedDepartments={
          role === "Admin"
            ? [...DEPARTMENTS]
            : profile?.departments?.length
              ? profile.departments
              : [...DEPARTMENTS]
        }
        onClose={closeModal}
        onSave={async (body) => {
          const r = await apiFetch("/api/requisitions", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          });
          const d = await r.json();
          if (!r.ok) {
            setMsg(d.error || "Failed");
            return;
          }
          setMsg(
            `Requisition ${d.requisition.id} sent to ${d.requisition.department} department head(s) for approval.`
          );
          closeModal();
          setTab("requisitions");
          loadReqs();
        }}
      />
    );
  }

  if (loading || !profile) {
    return (
      <AuthBootScreen
        message="Loading workspace"
        detail="Pulling in your requisitions and pipeline…"
      />
    );
  }

  const dateStr = formatDate(new Date());
  const firstName = profile.name?.trim().split(/\s+/)[0] || "there";
  const dashboardGreeting = (() => {
    const hour = new Date().getHours();
    if (hour >= 5 && hour < 12) return `Good morning, ${firstName}`;
    if (hour >= 12 && hour < 17) return `Good noon, ${firstName}`;
    return `Good evening, ${firstName}`;
  })();

  return (
    <div className="ats-app-shell">
      <aside className="ats-sidebar">
        <div className="ats-brand">
          <img src="/ats-logo.svg" alt="TalentOS" />
          <div>
            <strong>Talent<span className="ats-brand-os">OS</span></strong>
          </div>
        </div>
        <nav className="ats-side-nav" aria-label="Main navigation">
          {tabs.map((t) => {
            const glyph: Record<Tab, string> = {
              dashboard: "▦",
              requisitions: "▤",
              approvals: "✓",
              schedule: "◷",
              team: "◉",
            };
            const openPositionCount = reqs
              .filter((req) => ["Approved", "Position Reopened", "Partially Fulfilled"].includes(req.status))
              .reduce((sum, req) => sum + Math.max(0, req.openings || 0), 0);
            const count = t.id === "approvals"
              ? role === "Recruiter"
                ? offerApprovals.filter(({ candidate }) => candidate.offerApprovalStatus === "Pending").length
                : role === "HiringManager"
                  ? approvals.filter((requisition) => requisition.status === "PendingApproval").length + offerApprovals.filter(({ candidate }) => candidate.offerApprovalStatus === "Pending").length
                : approvals.length + offerApprovals.length
              : t.id === "requisitions"
                ? openPositionCount
                : t.id === "schedule"
                  ? ((today?.interviewsToday as unknown[] | undefined) || []).length
                  : 0;
            return (
              <button
                key={t.id}
                type="button"
                className={`ats-side-link${tab === t.id ? " is-active" : ""}`}
                onClick={() => setTab(t.id)}
                aria-current={tab === t.id ? "page" : undefined}
              >
                <span className="ats-side-glyph" aria-hidden="true">{glyph[t.id]}</span>
                <span>{t.label}</span>
                {count > 0 && <b className="ats-nav-count">{count}</b>}
              </button>
            );
          })}
        </nav>
        <div className="ats-sidebar-footer">
          <div className="ats-profile-avatar">{ini(profile.name)}</div>
          <div className="ats-profile-copy">
            <strong>{profile.name}</strong>
            <small>{profile.role} · {profile.title}</small>
          </div>
          <button
            type="button"
            className="ats-signout"
            onClick={() => signOut().then(() => router.push("/login"))}
          >
            Sign out
          </button>
        </div>
      </aside>

      <div className="ats-main-column">
        <header className="ats-topbar">
          <div className="ats-global-search">
            <span aria-hidden="true">⌕</span>
            <input
              value={searchQ}
              onChange={(e) => setSearchQ(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && doSearch()}
              placeholder="Search requisitions, candidates, departments..."
              aria-label="Search ATS"
            />
            {(role === "Admin" || role === "Recruiter") && (
              <button type="button" onClick={doSearch}>Search</button>
            )}
          </div>
          <div className="ats-topbar-actions">
            <button
              type="button"
              className="ats-date-button"
              onClick={() => setTab(role === "Recruiter" || role === "Admin" || role === "HiringManager" ? "schedule" : "dashboard")}
              title="Open interview calendar"
            >
              {dateStr}
            </button>
            <span className="ats-topbar-user">{profile.email}</span>
          </div>
        </header>

        {actingAsEmail && (
          <div className="ats-act-as-banner" role="status">
            <span>Acting as {profile.name} ({profile.role}) · Admin session</span>
            <button type="button" onClick={() => stopActingAs().then(() => setTab("dashboard"))}>Exit act as</button>
          </div>
        )}
        {(msg || error) && (
          <div className="ats-message-banner" role="status">
            <span>{msg || error}</span>
            <button type="button" onClick={() => setMsg(null)} aria-label="Dismiss message">×</button>
          </div>
        )}

        <main className="ats-workspace">
          <div className="ats-page-heading">
            <div>
              <span className="ats-page-eyebrow">Talent Acquisition</span>
              <h1 className="ats-heading-primary" style={{ fontFamily: 'Calibri, "Segoe UI", sans-serif' }}>
                {tab === "dashboard" ? dashboardGreeting : tabs.find((item) => item.id === tab)?.label || "Dashboard"}
              </h1>
            </div>
            {(role === "Admin" || role === "Recruiter") && (
              <div
                className="ats-tab-illustration"
                style={{ backgroundImage: `url("/ats-art/${tab}.svg")` }}
                aria-hidden="true"
              />
            )}
            {(role === "HiringManager" || role === "Admin") && tab === "requisitions" && (
              <button type="button" className="ats-primary-button" onClick={openNewReq}>
                <span aria-hidden="true">＋</span> New requisition
              </button>
            )}
          </div>
        {tab === "dashboard" && (
          <>
            {role !== "DepartmentHead" && role !== "HiringManager" && (
              <TodayView
                data={today}
                onReq={openPipeline}
                onCand={openCandidate}
              />
            )}
            <div style={{ marginTop: role === "DepartmentHead" || role === "HiringManager" ? 0 : 28 }}>
              {role === "Recruiter" ? (
                <RecruiterDashboard analytics={analytics} onReq={openPipeline} />
              ) : role === "DepartmentHead" ? (
                <DepartmentHeadDashboard analytics={analytics} onReq={openPipeline} onCand={openCandidate} />
              ) : role === "HiringManager" ? (
                <HiringManagerDashboard analytics={analytics} onReq={openPipeline} />
              ) : (
                <AnalyticsView
                  data={analytics}
                  today={today}
                  onReq={openPipeline}
                  onCand={openCandidate}
                />
              )}
            </div>
          </>
        )}
        {tab === "requisitions" && (
          <ReqBoard
            reqs={reqs}
            onOpen={openPipeline}
            role={role!}
            onStatusChange={updateReqStatus}
          />
        )}
        {tab === "approvals" && (
          <ApprovalsView
            list={approvals}
            offerApprovals={offerApprovals}
            apiFetch={apiFetch}
            onOpen={openPipeline}
            onOpenCandidate={openCandidate}
            role={role!}
            onDone={() => {
              loadApprovals();
              loadReqs();
              setMsg("Decision saved.");
            }}
          />
        )}
        {tab === "schedule" && (
          <ScheduleView
            key={
              schedulePrefill
                ? `${schedulePrefill.reqId}-${schedulePrefill.candidateId}-${schedulePrefill.roundIndex}`
                : "schedule"
            }
            reqs={reqs.filter(
              (r) => r.status === "Approved" || r.status === "Position Reopened"
                || r.status === "Partially Fulfilled"
            )}
            apiFetch={apiFetch}
            readOnly={role === "HiringManager"}
            initialReqId={schedulePrefill?.reqId}
            initialCandidateId={schedulePrefill?.candidateId}
            initialRoundIndex={schedulePrefill?.roundIndex}
            onDone={() => {
              setMsg("Interview scheduled.");
              setSchedulePrefill(null);
            }}
          />
        )}
        {tab === "team" && (
          <TeamView
            users={team}
            apiFetch={apiFetch}
            onRefresh={loadTeam}
            currentEmail={profile.email}
            onActAs={(user) => {
              if (!window.confirm(`Act as ${user.name} (${user.role})? Your activity will use this user's permissions.`)) return;
              startActingAs(user.email)
                .then(() => setTab(user.role === "Admin" ? "dashboard" : user.role === "DepartmentHead" ? "approvals" : "requisitions"))
                .catch((cause) => setMsg(cause instanceof Error ? cause.message : "Could not act as this user."));
            }}
          />
        )}
      </main>
      </div>

      {overlay && (
        <div
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) closeModal();
          }}
          className="ats-overlay"
        >
          <div
            className="ats-dialog"
          >
            <button
              type="button"
              className="ats-dialog-close"
              onClick={closeModal}
              aria-label="Close panel"
            >
              ✕
            </button>
            {panel}
          </div>
        </div>
      )}
    </div>
  );
}
